#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""발전 현황 수집기 — HD현대에너지솔루션 HI SMART 3.0 모니터링(hs3.hyundai-es.co.kr) → assets/data/generation.json

사용: HS3_USER_ID=<아이디> HS3_PASSWORD=<비밀번호> python tools/generation_collect.py [--out assets/data/generation.json]
      python tools/generation_collect.py --fixture-dir <폴더>   # 저장해 둔 응답 JSON 으로 변환 로직만 시험 (로그인 없음)

대상 현장은 tools/generation_sites.json 에서 읽는다. 한 번 실행에 호출 약 2 + 현장수×3 회.
아이디·비밀번호는 환경변수로만 받고, 토큰·자격증명은 파일과 로그 어디에도 쓰지 않는다.
포털 API 는 공개 문서가 없는 내부 API 라 응답 형식이 바뀌면 validate() 가 막고 파일을 쓰지 않는다.
"""
import json, os, re, sys, math, uuid, datetime as dt, urllib.request, urllib.parse, urllib.error, argparse

BASE = 'https://hs3.hyundai-es.co.kr/hismart'
KST = dt.timezone(dt.timedelta(hours=9))
SITES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generation_sites.json')

class Client:
    """HI SMART 프런트가 쓰는 것과 같은 헤더로 호출한다. 토큰은 로그인 응답 헤더(x-auth-token)에서 받는다."""
    def __init__(self, user_id, password):
        self.user_id, self.password, self.token, self.calls = user_id, password, None, 0

    def headers(self, api_version='v1.0'):
        h = {'Content-Type': 'application/json', 'Accept': 'application/json', 'X-APP': 'HIWAY4VUETIFY', 'X-APIVERSION': api_version,
             'X-LOGKEY': uuid.uuid4().hex[:16], 'X-CHANNEL': 'WEB', 'X-VNAME': 'UI', 'X-LANG': 'ko', 'X-MID': '', 'X-CALLTYPE': '0',
             'User-Agent': 'Mozilla/5.0 (sr-website generation collector)', 'Origin': 'https://hs3.hyundai-es.co.kr', 'Referer': 'https://hs3.hyundai-es.co.kr/'}
        if self.token: h['X-Auth-Token'] = self.token
        return h

    def call(self, method, path, params=None, body=None, api_version='v1.0'):
        url = BASE + path + ('?' + urllib.parse.urlencode(params) if params else '')
        data = json.dumps(body).encode('utf-8') if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self.headers(api_version))
        self.calls += 1
        with urllib.request.urlopen(req, timeout=40) as r:
            tok = r.headers.get('x-auth-token') or r.headers.get('jwt')
            if tok: self.token = tok
            payload = json.loads(r.read().decode('utf-8'))
        res = (payload or {}).get('result') or {}
        if str(res.get('code', '')) not in ('20000000', '200', '') and str(res.get('status', '')) != '200':
            raise RuntimeError(f'API {res.get("code")} {res.get("type")}: {str(res.get("desc", "")).strip()}')
        return payload.get('datas')

    def login(self):
        self.call('POST', '/login', body={'user_id': self.user_id, 'password': self.password})
        if not self.token: raise RuntimeError('로그인 응답에 토큰 헤더가 없음')
        return True

    def logout(self):
        try: self.call('GET', '/login/sessionout')
        except Exception: pass

def redact(msg, *secrets):
    s = str(msg)
    for x in secrets:
        if x: s = s.replace(x, '***').replace(urllib.parse.quote(x, safe=''), '***')
    return re.sub(r'[<>]', '', s)[:300]

def num(v, default=None):
    try:
        if v is None: return default
        return float(str(v).replace(',', ''))
    except Exception: return default

# ── 변환 ────────────────────────────────────────────────────────────
def build(site_cfgs, site_list, fetch_site, today):
    """site_list: /monitoring/site 응답(현장 배열). fetch_site(site_id) -> {'united':…, 'day':…, 'month':…, 'year':…}"""
    out, errors = [], []
    for cfg in site_cfgs:
        row = None
        if cfg.get('id'): row = next((r for r in site_list if r.get('SITE_ID') == cfg['id']), None)
        if row is None and cfg.get('match'): row = next((r for r in site_list if cfg['match'] in (r.get('DESCRIPTION') or '')), None)
        if row is None: errors.append(f"현장을 찾지 못함: {cfg.get('name')}"); continue
        sid = row['SITE_ID']
        try:
            d = fetch_site(sid)
        except Exception as e:
            errors.append(f"{cfg.get('name')}: {redact(e)}"); continue
        u = (d.get('united') or {}).get('unitedSiteInfo') or {}
        day = (d.get('day') or {}).get('solraDayWork') or {}
        month = (d.get('month') or {}).get('solraMonthWork') or {}
        year = (d.get('year') or {}).get('solraYearWork') or {}
        mrun = [num(x, 0) for x in (month.get('runData') or [])]
        yrun = [num(x, 0) for x in (year.get('runData') or [])]
        ydays = (today.day - 2) if today.day >= 2 else None
        out.append({
            'id': sid, 'name': cfg.get('name') or (row.get('DESCRIPTION') or '').strip(), 'portalName': (row.get('DESCRIPTION') or '').strip(),
            'page': cfg.get('page'), 'label': cfg.get('label'), 'sido': row.get('SIDO_NAME'), 'sigu': row.get('SIGU_NAME'),
            'capacityKw': num(u.get('PVPCS_Pcs_Capa'), num(row.get('totalCapacity'))),
            'nowKw': num(u.get('PVPCS_Pac'), num(row.get('PVPCS_Pac'))),
            'todayKwh': num(u.get('PVPCS_Daily_P'), num(row.get('PVPCS_Daily_P'))),
            'todayHours': num(u.get('PVPCS_Day'), num(row.get('Daily_Time'))),
            'yesterdayKwh': (mrun[ydays] if ydays is not None and ydays < len(mrun) else None),
            'monthKwh': num(u.get('PVPCS_CurrentMonth_P')), 'monthHours': num(u.get('PVPCS_Month')),
            'prevMonthKwh': num(u.get('PVPCS_AfterMonth_P')), 'totalKwh': num(u.get('PVPCS_Total_P')),
            'inverters': int(row.get('INV_CNT') or 0), 'running': int(row.get('runCount') or 0),
            'status': row.get('run_status'), 'comm': row.get('communicationStatus'),
            'daySeries': {'t': list(day.get('runTime') or []), 'kw': [round(num(x, 0), 1) for x in (day.get('runData') or [])]},
            'monthSeries': [round(x, 1) for x in mrun], 'yearSeries': [round(x, 1) for x in yrun],
        })
    tot = lambda k: round(sum((s.get(k) or 0) for s in out), 1) if out else None
    data = {
        'sample': False,
        'updated': dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00'),
        'date': today.isoformat(),
        'source': 'HD현대에너지솔루션 HI SMART 3.0 모니터링 (에스알 계정) · 20분 단위 계측값, 매시 갱신',
        'sites': out,
        'totals': {'capacityKw': tot('capacityKw'), 'nowKw': tot('nowKw'), 'todayKwh': tot('todayKwh'), 'monthKwh': tot('monthKwh'), 'totalKwh': tot('totalKwh'), 'sites': len(out)},
        'errors': errors,
    }
    return data

def _ok(v, lo, hi): return v is None or (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi)

def validate(data):
    """스키마·범위 검증 (문제 목록, 비어 있으면 정상). 공개 파일이므로 숫자·짧은 문자열만 허용."""
    pr = []
    if data.get('sample') not in (True, False): pr.append('sample')
    if not isinstance(data.get('updated'), str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', data['updated']): pr.append('updated 형식')
    if not isinstance(data.get('sites'), list): pr.append('sites 배열'); return pr
    for s in data['sites']:
        if not re.match(r'^[A-Z]\d{3,6}$', str(s.get('id', ''))): pr.append(f"id 형식 {s.get('id')!r}")
        for k in ('name', 'portalName', 'page', 'label', 'sido', 'sigu', 'status', 'comm'):
            v = s.get(k)
            if v is not None and (not isinstance(v, str) or len(v) > 80 or '<' in v): pr.append(f'{k} 형식 {s.get("id")}')
        if s.get('page') and not re.match(r'^[a-z0-9-]+\.html$', s['page']): pr.append(f'page 형식 {s.get("id")}')
        for k, hi in (('capacityKw', 100000), ('nowKw', 100000), ('todayKwh', 1e6), ('todayHours', 24), ('yesterdayKwh', 1e6), ('monthKwh', 1e8), ('monthHours', 800), ('prevMonthKwh', 1e8), ('totalKwh', 1e10)):
            if not _ok(s.get(k), 0, hi): pr.append(f'{k} 범위 {s.get("id")}')
        ds = s.get('daySeries') or {}
        if not (isinstance(ds.get('t'), list) and isinstance(ds.get('kw'), list) and len(ds['t']) == len(ds['kw']) and len(ds['t']) <= 150): pr.append(f'daySeries {s.get("id")}')
        elif any(not re.match(r'^\d{2}:\d{2}$', str(t)) for t in ds['t']) or any(not _ok(v, 0, 100000) for v in ds['kw']): pr.append(f'daySeries 값 {s.get("id")}')
        for k, n in (('monthSeries', 31), ('yearSeries', 12)):
            v = s.get(k)
            if not isinstance(v, list) or len(v) > n or any(not _ok(x, 0, 1e8) for x in v): pr.append(f'{k} {s.get("id")}')
    errs = data.get('errors')
    if not isinstance(errs, list) or any(not isinstance(e, str) or len(e) > 300 or '<' in e for e in errs): pr.append('errors 형식')
    return pr

# ── 실행 ────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='assets/data/generation.json'); ap.add_argument('--fixture-dir'); ap.add_argument('--sites', default=SITES_FILE)
    args = ap.parse_args()
    site_cfgs = json.load(open(args.sites, encoding='utf-8'))['sites']
    today = dt.datetime.now(KST).date()

    if args.fixture_dir:
        fx = lambda n: json.load(open(os.path.join(args.fixture_dir, n), encoding='utf-8'))
        site_list = fx('monitoring_site.json')['datas']
        def fetch_site(sid):
            return {k: fx(f'{k}_{sid}.json')['datas'] for k in ('united', 'day', 'month', 'year')}
        data = build(site_cfgs, site_list, fetch_site, today); calls = 0
    else:
        uid, pw = os.environ.get('HS3_USER_ID', '').strip(), os.environ.get('HS3_PASSWORD', '')
        if not uid or not pw: print('HS3_USER_ID, HS3_PASSWORD 환경변수가 필요합니다', file=sys.stderr); sys.exit(2)
        c = Client(uid, pw)
        try:
            c.login()
            site_list = c.call('GET', '/monitoring/site', {'userId': uid, 'sido': '', 'sigu': ''}) or []
            def fetch_site(sid):
                p = {'site_id': sid}; pd = {'site_id': sid, 'startDate': today.isoformat()}
                return {'united': c.call('GET', '/site/getSolraUnitedWork', p), 'day': c.call('GET', '/site/getSolraDayWork', pd),
                        'month': c.call('GET', '/site/getSolraMonthWork', pd), 'year': c.call('GET', '/site/getSolraYearWork', pd)}
            data = build(site_cfgs, site_list, fetch_site, today)
        except Exception as e:
            print('수집 실패:', redact(e, pw, uid), file=sys.stderr); sys.exit(1)
        finally:
            c.logout()
        calls = c.calls
        data['errors'] = [redact(e, pw, uid) for e in data['errors']]
    data['apiCalls'] = calls
    if not data['sites']:
        print('현장 데이터 없음:', data['errors'], file=sys.stderr); sys.exit(1)
    problems = validate(data)
    if problems:
        print('검증 실패 — 파일을 쓰지 않습니다:', problems[:10], file=sys.stderr); sys.exit(1)
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    t = data['totals']
    print(f"ok: {t['sites']}개 현장, 오늘 {t['todayKwh']} kWh, 이달 {t['monthKwh']} kWh, 호출 {calls}회, 오류 {data['errors'] or '없음'}")

if __name__ == '__main__':
    main()
