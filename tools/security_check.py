#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사이트 보안 점검 — 로컬과 GitHub Actions(.github/workflows/security-check.yml)에서 같이 쓴다

  python tools/security_check.py          # 결과 출력
  python tools/security_check.py --ci     # 문제가 하나라도 있으면 종료코드 1

검사 항목
  1. 페이지: 인라인 <script>(importmap 제외)·인라인 이벤트 핸들러·javascript: 링크 금지, http:// 리소스 금지,
     target=_blank 에 noopener, Pretendard CSS 의 SRI 해시 일치, CSP·referrer 메타 일치(tools/security_meta.py)
  2. 저장소: 인증키·토큰 패턴, 비밀 파일(.env 등) 추적 금지, 내부 문서(PROJECT_HANDOFF.md, docs/, .claude/) 추적 금지
  3. 워크플로: 외부 액션은 커밋 SHA 로 고정, 권한 선언
  4. 데이터: assets/data/market.json 스키마(tools/market_collect.py 의 validate)
  5. 기타: _config.yml 제외 목록, .well-known/security.txt 만료일
"""
import io, os, re, sys, json, glob, subprocess, datetime as dt, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import security_meta as SM

PAGE_EXCLUDE = set()
INLINE_ALLOWED = {'map-embed.html'}                   # sandbox iframe 전용 페이지: 자체 CSP, 인라인 허용
INTERNAL_PATHS = ['PROJECT_HANDOFF.md', 'docs/', '.claude/', '.mcp.json', '.env', '_private/']
TEXT_EXT = ('.html', '.js', '.css', '.json', '.py', '.yml', '.yaml', '.md', '.txt', '.xml')
SECRET_PATTERNS = {
    '64자리 16진수(인증키 추정)': re.compile(r'(?<![0-9a-fA-F/+=])[0-9a-fA-F]{64}(?![0-9a-fA-F/+=])'),
    'serviceKey= 값': re.compile(r'serviceKey=(?!\{|\*|<|\$)[^&"\'\s)]{8,}'),
    'AWS 키': re.compile(r'AKIA[0-9A-Z]{16}'),
    'GitHub 토큰': re.compile(r'\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b'),
    '개인키': re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
}

def tracked_files():
    try:
        out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout
        return [l for l in out.splitlines() if l]
    except Exception:
        res = []
        for d, _, fs in os.walk(ROOT):
            if any(x in d for x in ('.git', '_backup_', 'node_modules')): continue
            for f in fs: res.append(os.path.relpath(os.path.join(d, f), ROOT).replace('\\', '/'))
        return res

def read(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8', errors='ignore').read()

def check_pages():
    pr = []
    for p in sorted(os.path.basename(x) for x in glob.glob(os.path.join(ROOT, '*.html'))):
        if p in PAGE_EXCLUDE: continue
        s = read(p)
        if p not in INLINE_ALLOWED:
            for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', s, re.S):
                attrs = m.group(1)
                if 'src=' in attrs: continue
                t = re.search(r'type="([^"]+)"', attrs); t = t.group(1) if t else 'classic'
                if t not in ('importmap', 'application/ld+json', 'application/json'):
                    pr.append(f'{p}: 인라인 <script> 발견 (L{s[:m.start()].count(chr(10)) + 1}) → assets/js/ 파일로 분리')
            for m in re.finditer(r'<[a-zA-Z][^>]*\s(on[a-z]+)="', s):
                pr.append(f'{p}: 인라인 이벤트 핸들러 {m.group(1)}= (L{s[:m.start()].count(chr(10)) + 1})')
        if re.search(r'href="javascript:', s): pr.append(f'{p}: javascript: 링크')
        for m in re.finditer(r'(?:src|href|action)="(http://[^"]+)"', s):
            if 'www.w3.org' in m.group(1): continue
            pr.append(f'{p}: 평문 http 리소스 {m.group(1)}')
        for m in re.finditer(r'<a\b[^>]*target="_blank"[^>]*>', s):
            if 'noopener' not in m.group(0): pr.append(f'{p}: target=_blank 링크에 noopener 없음')
        for url, h in SM.SRI.items():
            for m in re.finditer(r'<link rel="stylesheet" href="' + re.escape(url) + r'"([^>]*)>', s):
                if f'integrity="{h}"' not in m.group(1) or 'crossorigin="anonymous"' not in m.group(1):
                    pr.append(f'{p}: Pretendard CSS 의 integrity/crossorigin 누락 또는 불일치')
        if p not in SM.EXCLUDE and 'assets/js/site.js' not in s: pr.append(f'{p}: assets/js/site.js 미포함')
    pr += SM.check()
    return pr

def check_repo():
    pr = []; files = tracked_files()
    for f in files:
        for bad in INTERNAL_PATHS:
            if f == bad or f.startswith(bad): pr.append(f'내부 파일이 저장소에 추적됨: {f}'); break
        if f.startswith('assets/vendor/') or not f.endswith(TEXT_EXT) or f == 'assets/data/market.json': continue
        if f == 'tools/security_check.py': continue   # 패턴 정의 자체가 패턴에 걸리므로 이 파일은 건너뜀
        if not os.path.exists(os.path.join(ROOT, f)): continue   # 삭제했지만 아직 커밋 전인 파일
        s = read(f)
        for name, rx in SECRET_PATTERNS.items():
            for m in rx.finditer(s):
                v = m.group(0); pr.append(f'{f}: {name} 의심 값 {v[:4]}…{v[-2:]} ({len(v)}자)')
    return pr

def check_workflows():
    pr = []
    for wf in glob.glob(os.path.join(ROOT, '.github', 'workflows', '*.yml')):
        s = io.open(wf, encoding='utf-8').read(); name = os.path.relpath(wf, ROOT).replace('\\', '/')
        for m in re.finditer(r'uses:\s*([^\s#]+)', s):
            ref = m.group(1)
            if not re.search(r'@[0-9a-f]{40}$', ref): pr.append(f'{name}: 액션이 커밋 SHA 로 고정되지 않음 → {ref}')
        if 'permissions:' not in s: pr.append(f'{name}: permissions 선언 없음')
        if 'pull_request_target' in s: pr.append(f'{name}: pull_request_target 사용(외부 PR 코드 실행 위험)')
    return pr

def check_market():
    pr = []; p = os.path.join(ROOT, 'assets', 'data', 'market.json')
    if not os.path.exists(p): return pr
    try:
        spec = importlib.util.spec_from_file_location('market_collect', os.path.join(ROOT, 'tools', 'market_collect.py'))
        mc = importlib.util.module_from_spec(spec); spec.loader.exec_module(mc)
        data = json.load(io.open(p, encoding='utf-8'))
        pr += [f'market.json: {x}' for x in mc.validate(data)[:10]]
    except Exception as e:
        pr.append(f'market.json 검사 실패: {e}')
    g = os.path.join(ROOT, 'assets', 'data', 'generation.json')
    if os.path.exists(g):
        try:
            spec = importlib.util.spec_from_file_location('generation_collect', os.path.join(ROOT, 'tools', 'generation_collect.py'))
            gc = importlib.util.module_from_spec(spec); spec.loader.exec_module(gc)
            pr += [f'generation.json: {x}' for x in gc.validate(json.load(io.open(g, encoding='utf-8')))[:10]]
        except Exception as e:
            pr.append(f'generation.json 검사 실패: {e}')
    return pr

def check_misc():
    pr = []
    cfg = os.path.join(ROOT, '_config.yml')
    if not os.path.exists(cfg): pr.append('_config.yml 없음 (Pages 게시 제외 목록)')
    else:
        s = io.open(cfg, encoding='utf-8').read()
        for need in ('tools/', 'README.md', 'docs/', '.claude/'):
            if need not in s: pr.append(f'_config.yml exclude 에 {need} 없음')
    st = os.path.join(ROOT, '.well-known', 'security.txt')
    if not os.path.exists(st): pr.append('.well-known/security.txt 없음')
    else:
        m = re.search(r'Expires:\s*(\d{4}-\d{2}-\d{2})', io.open(st, encoding='utf-8').read())
        if not m: pr.append('security.txt 에 Expires 없음')
        elif dt.date.fromisoformat(m.group(1)) < dt.date.today() + dt.timedelta(days=14): pr.append(f'security.txt 만료 임박/만료: {m.group(1)}')
    if os.path.exists(os.path.join(ROOT, '.nojekyll')): pr.append('.nojekyll 이 있으면 _config.yml 제외 목록이 무시됨')
    return pr

def main(argv):
    groups = [('페이지', check_pages), ('저장소', check_repo), ('워크플로', check_workflows), ('시세 데이터', check_market), ('기타', check_misc)]
    total = 0
    for title, fn in groups:
        pr = fn(); total += len(pr)
        print(f'[{title}] ' + ('이상 없음' if not pr else f'{len(pr)}건'))
        for x in pr: print('  - ' + x)
    print(f'\n합계: 문제 {total}건')
    return 1 if (total and '--ci' in argv) else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
