#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""페이지별 보안 메타(Content-Security-Policy · referrer) 생성·검사

  python tools/security_meta.py --write        # 모든 페이지에 적용 (멱등)
  python tools/security_meta.py --check        # 페이지의 메타가 생성 결과와 같은지 확인 (CI)
  python tools/security_meta.py --print index.html

정적 호스팅(GitHub Pages)은 HTTP 응답 헤더를 바꿀 수 없으므로 <meta http-equiv> 로 CSP 를 건다.
frame-ancestors 는 meta 로 적용되지 않아 assets/js/site.js 의 프레임 차단으로 보완한다.
인라인 <script> 는 importmap(해시 허용) 외에는 쓰지 않는다 — 새 스크립트는 assets/js/ 아래 파일로 두고 src 로 불러올 것.
"""
import base64, hashlib, io, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDE = {'map-embed.html'}   # 지도 iframe(자체 CSP 보유)
REFERRER = 'strict-origin-when-cross-origin'

# 기본 정책 — 모든 리소스는 자기 출처. 글꼴 CDN 두 곳만 허용. 인라인 스타일은 페이지 CSS 구조상 허용.
BASE = [
    ('default-src', ["'self'"]),
    ('script-src',  ["'self'"]),
    ('style-src',   ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com']),
    ('font-src',    ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com']),
    ('img-src',     ["'self'", 'data:']),
    ('media-src',   ["'self'"]),
    ('connect-src', ["'self'"]),
    ('worker-src',  ["'none'"]),
    ('frame-src',   ["'none'"]),
    ('object-src',  ["'none'"]),
    ('base-uri',    ["'self'"]),
    ('form-action', ["'self'"]),
    ('manifest-src', ["'self'"]),
]
# 페이지별 추가 허용 — 'none' 인 항목은 교체, 나머지는 덧붙임. '@importmap' 은 해당 페이지 importmap 의 sha256 으로 치환.
EXTRA = {
    'index.html': {   # three.js: DRACO 디코더(blob 워커 + wasm), GLB 텍스처(blob), 영상
        'script-src': ["'wasm-unsafe-eval'", '@importmap'],
        'img-src': ['blob:'], 'media-src': ['blob:'], 'connect-src': ['blob:', 'data:'], 'worker-src': ["'self'", 'blob:'],
    },
    'contact.html': {  # 문의 폼 전송(Web3Forms), 지도 iframe(자체 출처 map-embed.html)
        'connect-src': ['https://api.web3forms.com'], 'form-action': ['https://api.web3forms.com'], 'frame-src': ["'self'"],
    },
}
# 외부 스타일시트 무결성(SRI) — 버전 고정 URL 의 sha384. 바꾸면 security_check 가 알려준다.
SRI = {
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css': 'sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j',
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css': 'sha384-ei/b2Mz3F5J8nqTvpKS89CkzDCuD7Cc+/F+OsaPUKItzHgLNKnGq3rjtYq/B7RnO',
}

def pages():
    return sorted(f for f in (os.path.basename(x) for x in glob.glob(os.path.join(ROOT, '*.html'))) if f not in EXCLUDE)

def importmap_hashes(html):
    out = []
    for m in re.finditer(r'<script\b[^>]*type="importmap"[^>]*>(.*?)</script>', html, re.S):
        out.append("'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode('utf-8')).digest()).decode() + "'")
    return out

def build_policy(page, html):
    extra = EXTRA.get(page, {})
    parts = []
    for name, vals in BASE:
        vals = list(vals); add = list(extra.get(name, []))
        if '@importmap' in add:
            hs = importmap_hashes(html); assert hs, f'{page}: importmap 이 없는데 @importmap 지정'
            add = [h for v in add for h in (hs if v == '@importmap' else [v])]
        if vals == ["'none'"] and add: vals = add
        else: vals += add
        parts.append(name + ' ' + ' '.join(vals))
    return '; '.join(parts)

META_RE = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">')
REF_RE = re.compile(r'<meta name="referrer" content="[^"]*">')
CHARSET_RE = re.compile(r'<meta charset="utf-8">', re.I)

def apply(page, html):
    policy = build_policy(page, html)
    tag = f'<meta http-equiv="Content-Security-Policy" content="{policy}">'
    if META_RE.search(html): html = META_RE.sub(lambda m: tag, html, count=1)
    else:
        m = CHARSET_RE.search(html); assert m, f'{page}: <meta charset> 없음'
        html = html[:m.end()] + '\n' + tag + html[m.end():]
    if not REF_RE.search(html):
        html = html.replace(tag, tag + f'\n<meta name="referrer" content="{REFERRER}">', 1)
    return html

def check():
    problems = []
    for page in pages():
        html = io.open(os.path.join(ROOT, page), encoding='utf-8').read()
        m = META_RE.search(html)
        want = build_policy(page, html)
        if not m: problems.append(f'{page}: CSP 메타 없음 (tools/security_meta.py --write)')
        elif m.group(1) != want: problems.append(f'{page}: CSP 메타가 생성 결과와 다름 (tools/security_meta.py --write)')
        if not REF_RE.search(html): problems.append(f'{page}: referrer 메타 없음')
    return problems

def main(argv):
    if '--write' in argv:
        for page in pages():
            p = os.path.join(ROOT, page); html = io.open(p, encoding='utf-8').read(); new = apply(page, html)
            if new != html: io.open(p, 'w', encoding='utf-8', newline='').write(new); print('updated', page)
        return 0
    if '--check' in argv:
        pr = check(); print('\n'.join(pr) if pr else 'CSP 메타: 모든 페이지 일치'); return 1 if pr else 0
    if '--print' in argv:
        page = argv[argv.index('--print') + 1]; html = io.open(os.path.join(ROOT, page), encoding='utf-8').read(); print(build_policy(page, html)); return 0
    print(__doc__); return 2

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
