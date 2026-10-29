#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""발전 현황 수집기 — HD현대에너지솔루션 HI SMART 3.0 모니터링(hs3.hyundai-es.co.kr) → assets/data/generation.json

사용: HS3_USER_ID=<아이디> HS3_PASSWORD=<비밀번호> python tools/generation_collect.py [--out assets/data/generation.json]
      python tools/generation_collect.py --fixture-dir <폴더>   # 저장해 둔 응답 JSON 으로 변환 로직만 시험 (로그인 없음)

대상 현장은 tools/generation_sites.json 에서 읽는다. 한 번 실행에 호출 약 2 + 현장수×3 회.
공개 동의(publish.status): denied 인 현장은 공개 JSON 에서 제외한다. granted/pending 은 싣되 상태를 그대로 기록한다 (pending 은 동의로 간주하지 않음 — 확인 대기).
자료 계약 v2 (docs/handoff/GENERATION_DATA_CONTRACT.md): schemaVersion, collectedAt(수집 시각), generatedAt(파일 생성 시각), 현장별 observedAt(포털 관측 시각 —
포털 응답에 계측 시각이 없으므로 null), quality(수집기 판정), publish(공개 상태·허용 항목). 옛 필드 updated 는 호환을 위해 유지한다.
아이디·비밀번호는 환경변수로만 받고, 토큰·자격증명은 파일과 로그 어디에도 쓰지 않는다.
포털 API 는 공개 문서가 없는 내부 API 라 응답 형식이 바뀌면 validate() 가 막고 파일을 쓰지 않는다.
"""
import json, os, re, sys, math, uuid, datetime as dt, urllib.request, urllib.parse, urllib.error, argparse

BASE = 'https://hs3.hyundai-es.co.kr/hismart'
KST = dt.timezone(dt.timedelta(hours=9))
SITES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generation_sites.json')
SCHEMA_VERSION = 2
PUBLISH_STATES = ('granted', 'pending', 'denied')

def publish_of(cfg, warnings=None):
    """현장 설정의 publish 를 정규화한다. 없거나 모르는 값이면 pending(확인 대기)으로 두고 경고를 남긴다 — 동의로 간주하지 않는다."""
    pub = cfg.get('publish') if isinstance(cfg.get('publish'), dict) else {}
    status = pub.get('status') if pub.get('status') in PUBLISH_STATES else None
    if status is None:
        status = 'pending'
        if warnings is not None: warnings.append(f"publish.status 없음 → pending 으로 처리: {cfg.get('name')}")
    fields = [f for f in (pub.get('fields') or []) if isinstance(f, str) and f.isidentifier()][:40]
    return {'status': status, 'allowed': True if status == 'granted' else (False if status == 'denied' else None), 'fields': fields}

def quality_of(comm, status, errors_for_site):
    """수집기 판정: 포털 통신 상태·부분 수집 여부로만 판단한다 (관측 시각은 포털이 주지 않으므로 지연 판정은 표시 쪽이 수집 시각으로 한다)."""
    if comm == 'Error': return {'status': 'comm_error', 'note': '포털이 통신 이상으로 표시'}
    if errors_for_site: return {'status': 'partial', 'note': '일부 포털 현장 호출 실패 — 합산값은 받은 범위'}
    return {'status': 'ok', 'note': None}

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
    ydays = (today.day - 2) if today.day >= 2 else None
    U = lambda d: ((d.get('united') or {}).get('unitedSiteInfo') or {})
    excluded = []
    for cfg in site_cfgs:
        if cfg.get('collector') and cfg.get('collector') != 'hismart': continue      # 다른 수집기(qhub) 항목
        pub = publish_of(cfg, errors)
        if pub['status'] == 'denied':
            excluded.append(cfg.get('name') or cfg.get('id')); continue             # 공개 금지·철회 → 공개 JSON 에서 제외
        # 한 항목이 포털 현장 여러 곳을 묶을 수 있다 (ids / matches) → 합산해서 한 카드로 보여준다
        ids = [x for x in (cfg.get('ids') or ([cfg['id']] if cfg.get('id') else [])) if x]
        matches = [x for x in (cfg.get('matches') or ([cfg['match']] if cfg.get('match') else [])) if x]
        rows = [r for r in site_list if r.get('SITE_ID') in ids]
        for m in matches:
            r = next((r for r in site_list if m in (r.get('DESCRIPTION') or '') and r not in rows), None)
            if r: rows.append(r)
            elif not rows or len(matches) > 1: errors.append(f"현장을 찾지 못함: {cfg.get('name')} ({m})")
        if not rows: continue
        parts = []; site_errors = []
        for row in rows:
            try: parts.append((row, fetch_site(row['SITE_ID'])))
            except Exception as e: site_errors.append(f"{cfg.get('name')} {row.get('SITE_ID')}: {redact(e)}")
        errors.extend(site_errors)
        if not parts: continue
        def S(fn):   # 부분 합 (값이 하나도 없으면 None)
            vals = [v for v in (fn(row, d) for row, d in parts) if v is not None]
            return round(sum(vals), 2) if vals else None
        def AVG(fn):
            v = S(fn); return round(v / len(parts), 2) if v is not None else None
        def series(key, sub, n):
            acc = [0.0] * n; seen = False
            for _, d in parts:
                arr = [num(x, 0) for x in (((d.get(key) or {}).get(sub) or {}).get('runData') or [])]
                if arr: seen = True
                for i, v in enumerate(arr[:n]): acc[i] += v
            return [round(x, 1) for x in acc] if seen else []
        first_day = next((((d.get('day') or {}).get('solraDayWork') or {}) for _, d in parts), {})
        nday = len(first_day.get('runTime') or [])
        portal_cap = S(lambda row, d: num(U(d).get('PVPCS_Pcs_Capa'), num(row.get('totalCapacity'))))
        out.append({
            'id': parts[0][0]['SITE_ID'], 'ids': [row['SITE_ID'] for row, _ in parts],
            'name': cfg.get('name') or (parts[0][0].get('DESCRIPTION') or '').strip(),
            'portalName': ' + '.join((row.get('DESCRIPTION') or '').strip() for row, _ in parts),
            'page': cfg.get('page'), 'label': cfg.get('label'), 'sido': parts[0][0].get('SIDO_NAME'), 'sigu': parts[0][0].get('SIGU_NAME'),
            'capacityKw': num(cfg.get('capacityKw')) or portal_cap,          # 홈페이지 표기 용량(모듈 기준) 우선, 없으면 포털(인버터) 용량
            'portalCapacityKw': portal_cap,
            'nowKw': S(lambda row, d: num(U(d).get('PVPCS_Pac'), num(row.get('PVPCS_Pac')))),
            'todayKwh': S(lambda row, d: num(U(d).get('PVPCS_Daily_P'), num(row.get('PVPCS_Daily_P')))),
            'todayHours': AVG(lambda row, d: num(U(d).get('PVPCS_Day'), num(row.get('Daily_Time')))),
            'yesterdayKwh': S(lambda row, d: (lambda m: m[ydays] if ydays is not None and ydays < len(m) else None)([num(x, 0) for x in (((d.get('month') or {}).get('solraMonthWork') or {}).get('runData') or [])])),
            'monthKwh': S(lambda row, d: num(U(d).get('PVPCS_CurrentMonth_P'))), 'monthHours': AVG(lambda row, d: num(U(d).get('PVPCS_Month'))),
            'prevMonthKwh': S(lambda row, d: num(U(d).get('PVPCS_AfterMonth_P'))), 'totalKwh': S(lambda row, d: num(U(d).get('PVPCS_Total_P'))),
            'inverters': sum(int(row.get('INV_CNT') or 0) for row, _ in parts), 'running': sum(int(row.get('runCount') or 0) for row, _ in parts),
            'status': 'Run' if any(row.get('run_status') == 'Run' for row, _ in parts) else parts[0][0].get('run_status'),
            'comm': next((row.get('communicationStatus') for row, _ in parts if row.get('communicationStatus') not in (None, 'None')), 'None'),
            'daySeries': {'t': list(first_day.get('runTime') or []), 'kw': series('day', 'solraDayWork', nday)},
            'monthSeries': series('month', 'solraMonthWork', 31), 'yearSeries': series('year', 'solraYearWork', 12),
            # v2: 관측 시각은 포털 응답에 없어 null (만들어 넣지 않는다). 수집 시각은 파일 상단 collectedAt.
            'observedAt': None, 'quality': None, 'publish': pub,
        })
        out[-1]['quality'] = quality_of(out[-1]['comm'], out[-1]['status'], site_errors)
    tot = lambda k: round(sum((s.get(k) or 0) for s in out), 1) if out else None
    now_s = dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00')
    data = {
        'sample': False,
        'schemaVersion': SCHEMA_VERSION,
        'updated': now_s,                 # v1 호환 (= collectedAt)
        'collectedAt': now_s, 'generatedAt': now_s,
        'publishExcluded': excluded,      # denied 로 제외한 현장 이름 (값 없음)
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
        if 'ids' in s and (not isinstance(s['ids'], list) or not s['ids'] or any(not re.match(r'^[A-Z]\d{3,6}$', str(x)) for x in s['ids'])): pr.append(f"ids 형식 {s.get('id')}")
        for k in ('name', 'portalName', 'page', 'label', 'sido', 'sigu', 'status', 'comm'):
            v = s.get(k)
            if v is not None and (not isinstance(v, str) or len(v) > (200 if k == 'portalName' else 80) or '<' in v): pr.append(f'{k} 형식 {s.get("id")}')
        if s.get('page') and not re.match(r'^[a-z0-9-]+\.html$', s['page']): pr.append(f'page 형식 {s.get("id")}')
        for k, hi in (('capacityKw', 100000), ('portalCapacityKw', 100000), ('nowKw', 100000), ('todayKwh', 1e6), ('todayHours', 24), ('yesterdayKwh', 1e6), ('monthKwh', 1e8), ('monthHours', 800), ('prevMonthKwh', 1e8), ('totalKwh', 1e10)):
            if not _ok(s.get(k), 0, hi): pr.append(f'{k} 범위 {s.get("id")}')
        ds = s.get('daySeries') or {}
        if not (isinstance(ds.get('t'), list) and isinstance(ds.get('kw'), list) and len(ds['t']) == len(ds['kw']) and len(ds['t']) <= 150): pr.append(f'daySeries {s.get("id")}')
        elif any(not re.match(r'^\d{2}:\d{2}$', str(t)) for t in ds['t']) or any(not _ok(v, 0, 100000) for v in ds['kw']): pr.append(f'daySeries 값 {s.get("id")}')
        for k, n in (('monthSeries', 31), ('yearSeries', 12)):
            v = s.get(k)
            if not isinstance(v, list) or len(v) > n or any(not _ok(x, 0, 1e8) for x in v): pr.append(f'{k} {s.get("id")}')
        if s.get('observedAt') is not None and (not isinstance(s['observedAt'], str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', s['observedAt'])): pr.append(f'observedAt 형식 {s.get("id")}')
        q = s.get('quality')
        if q is not None and (not isinstance(q, dict) or q.get('status') not in ('ok', 'stale', 'comm_error', 'partial', 'unknown') or (q.get('note') is not None and (not isinstance(q['note'], str) or len(q['note']) > 120 or '<' in q['note']))): pr.append(f'quality {s.get("id")}')
        pb = s.get('publish')
        if pb is not None and (not isinstance(pb, dict) or pb.get('status') not in PUBLISH_STATES or pb.get('status') == 'denied' or pb.get('allowed') not in (True, False, None)): pr.append(f'publish {s.get("id")}')
    for k in ('collectedAt', 'generatedAt'):
        if k in data and (not isinstance(data[k], str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', data[k])): pr.append(f'{k} 형식')
    if 'schemaVersion' in data and data['schemaVersion'] not in (1, 2): pr.append('schemaVersion')
    ex = data.get('publishExcluded', [])
    if not isinstance(ex, list) or any(not isinstance(x, str) or len(x) > 80 or '<' in x for x in ex): pr.append('publishExcluded')
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
