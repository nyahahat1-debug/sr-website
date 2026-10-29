#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""발전 현황 수집기 — HD현대에너지솔루션 HI SMART 3.0 모니터링(hs3.hyundai-es.co.kr) → assets/data/generation.json

사용: HS3_USER_ID=<아이디> HS3_PASSWORD=<비밀번호> python tools/generation_collect.py [--out assets/data/generation.json]
      python tools/generation_collect.py --fixture-dir <폴더>   # 저장해 둔 응답 JSON 으로 변환 로직만 시험 (로그인 없음)

대상 현장은 tools/generation_sites.json 에서 읽는다. 한 번 실행에 호출 약 2 + 현장수×3 회.
공개 동의(publish.status): **granted 인 현장만** 공개 JSON 에 싣는다. pending·denied·누락·알 수 없는 값은 모두 제외하고, 이름·식별자·합계·오류 문구 어디에도 내지 않는다.
publish.fields 는 실제 필드 허용 목록이다(기본 키 page·publish·quality·observedAt 외에는 목록에 있는 필드만 출력). 공개 현장이 하나도 없으면 비공개 안전 JSON(withheld, sites 비어 있음)으로
원자적으로 교체한다. 수집 실패·검증 실패 시에도 기존 파일에 비공개 현장이나 허용 밖 필드가 남아 있으면 지운다(sanitize_existing).
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
PUBLIC_BASE_KEYS = ('page', 'publish', 'quality', 'observedAt')      # 공개 파일에 항상 두는 상태·위치 키 (값 데이터 아님)
SOURCE_TEXT = 'HD현대에너지솔루션 HI SMART 3.0 모니터링 (에스알 계정) · 20분 단위 계측값, 매시 갱신'

def publish_of(cfg):
    """현장 설정의 publish 를 정규화한다. granted 만 공개 대상(allowed True). pending·denied·누락·알 수 없는 값은 모두 비공개.
    동의 문서 참조·메모(note 등)는 돌려주지 않는다 — 공개 파일에 실리지 않게."""
    pub = cfg.get('publish') if isinstance(cfg.get('publish'), dict) else {}
    status = pub.get('status') if pub.get('status') in PUBLISH_STATES else 'unknown'
    fields = [f for f in (pub.get('fields') or []) if isinstance(f, str) and f.isidentifier()][:40]
    return {'status': status, 'allowed': status == 'granted', 'fields': fields}

def is_public(cfg): return publish_of(cfg)['status'] == 'granted'

def apply_fields(site, fields):
    """허용 목록 적용: 기본 키 + fields 에 있는 키만 남긴다."""
    return {k: v for k, v in site.items() if k in PUBLIC_BASE_KEYS or k in fields}

def withheld_payload(now_s, today):
    """공개 현장이 없을 때 쓰는 비공개 안전 JSON — 현장 이름·식별자·값이 없다."""
    return {'sample': False, 'schemaVersion': SCHEMA_VERSION, 'withheld': True, 'updated': now_s, 'collectedAt': now_s, 'generatedAt': now_s, 'date': today.isoformat(),
            'source': SOURCE_TEXT, 'sites': [], 'totals': {'capacityKw': None, 'nowKw': None, 'todayKwh': None, 'monthKwh': None, 'totalKwh': None, 'sites': 0}, 'errors': []}

def is_withheld_file(path):
    """이미 비공개 안전 JSON(값 없음, 검증 통과)인지 — 그러면 시각만 바뀐 파일을 다시 쓰지 않는다."""
    try: d = json.load(open(path, encoding='utf-8'))
    except Exception: return False
    return isinstance(d, dict) and d.get('withheld') is True and d.get('sites') == [] and not validate(d)

def write_atomic(path, data):
    """같은 폴더의 임시 파일에 쓰고 os.replace 로 바꾼다 (중간 상태 파일이 남지 않게)."""
    d = os.path.dirname(path) or '.'; os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, '.' + os.path.basename(path) + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)

def sanitize_existing(path, site_cfgs, now_s, today):
    """기존 공개 파일에 비공개 현장·허용 밖 필드가 남아 있으면 지운다. 새 값을 받지 못한 경로(수집·검증 실패)에서도 공개 제한이 지켜지게.
    공개 현장과의 대응은 page 로 한다. 돌려주는 값: 'rewritten' | 'withheld' | 'unchanged' | 'absent'"""
    if not os.path.exists(path): return 'absent'
    public = {c.get('page'): publish_of(c) for c in site_cfgs if c.get('page') and is_public(c) and (not c.get('collector') or c.get('collector') == 'hismart')}
    try: old = json.load(open(path, encoding='utf-8'))
    except Exception: old = None
    if not isinstance(old, dict) or not isinstance(old.get('sites'), list):
        write_atomic(path, withheld_payload(now_s, today)); return 'withheld'
    kept = []
    for st in old['sites']:
        if not isinstance(st, dict) or st.get('page') not in public: continue
        pub = public[st['page']]
        if not (isinstance(st.get('publish'), dict) and st['publish'].get('status') == 'granted'): continue   # v1(동의 플래그 없음) 자료는 공개 자료로 보지 않는다
        kept.append(apply_fields({**st, 'publish': pub}, pub['fields']))
    if not kept:
        if old.get('withheld') and not old['sites']: return 'unchanged'
        write_atomic(path, withheld_payload(now_s, today)); return 'withheld'
    if kept == old['sites'] and not old.get('publishExcluded'): return 'unchanged'
    tot = lambda k: round(sum((x.get(k) or 0) for x in kept), 1)
    new = {k: v for k, v in old.items() if k != 'publishExcluded'}
    new.update({'sites': kept, 'totals': {'capacityKw': tot('capacityKw'), 'nowKw': tot('nowKw'), 'todayKwh': tot('todayKwh'), 'monthKwh': tot('monthKwh'), 'totalKwh': tot('totalKwh'), 'sites': len(kept)}})
    write_atomic(path, new); return 'rewritten'


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
    for cfg in site_cfgs:
        if cfg.get('collector') and cfg.get('collector') != 'hismart': continue      # 다른 수집기(qhub) 항목
        pub = publish_of(cfg)
        if not pub['allowed']: continue      # granted 가 아니면(pending·denied·누락·알 수 없음) 공개 JSON 에 아무 흔적도 남기지 않는다 — 호출도 하지 않는다
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
        out[-1] = apply_fields(out[-1], pub['fields'])      # 허용 목록 적용
    tot = lambda k: round(sum((s.get(k) or 0) for s in out), 1) if out else None
    now_s = dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00')
    data = {
        'sample': False,
        'schemaVersion': SCHEMA_VERSION,
        'updated': now_s,                 # v1 호환 (= collectedAt)
        'collectedAt': now_s, 'generatedAt': now_s,
        'date': today.isoformat(),
        'source': SOURCE_TEXT,
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
        if 'id' in s and not re.match(r'^[A-Z]\d{3,6}$', str(s.get('id', ''))): pr.append(f"id 형식 {s.get('id')!r}")   # 허용 목록에서 빠지면 키가 없을 수 있다
        if 'ids' in s and (not isinstance(s['ids'], list) or not s['ids'] or any(not re.match(r'^[A-Z]\d{3,6}$', str(x)) for x in s['ids'])): pr.append(f"ids 형식 {s.get('id')}")
        for k in ('name', 'portalName', 'page', 'label', 'sido', 'sigu', 'status', 'comm'):
            v = s.get(k)
            if v is not None and (not isinstance(v, str) or len(v) > (200 if k == 'portalName' else 80) or '<' in v): pr.append(f'{k} 형식 {s.get("id")}')
        if s.get('page') and not re.match(r'^[a-z0-9-]+\.html$', s['page']): pr.append(f'page 형식 {s.get("id")}')
        for k, hi in (('capacityKw', 100000), ('portalCapacityKw', 100000), ('nowKw', 100000), ('todayKwh', 1e6), ('todayHours', 24), ('yesterdayKwh', 1e6), ('monthKwh', 1e8), ('monthHours', 800), ('prevMonthKwh', 1e8), ('totalKwh', 1e10)):
            if not _ok(s.get(k), 0, hi): pr.append(f'{k} 범위 {s.get("id")}')
        if 'daySeries' in s:                                   # 허용 목록에서 빠지면 키 자체가 없다
            ds = s.get('daySeries') or {}
            if not (isinstance(ds.get('t'), list) and isinstance(ds.get('kw'), list) and len(ds['t']) == len(ds['kw']) and len(ds['t']) <= 150): pr.append(f'daySeries {s.get("id")}')
            elif any(not re.match(r'^\d{2}:\d{2}$', str(t)) for t in ds['t']) or any(not _ok(v, 0, 100000) for v in ds['kw']): pr.append(f'daySeries 값 {s.get("id")}')
        for k, n in (('monthSeries', 31), ('yearSeries', 12)):
            if k not in s: continue
            v = s.get(k)
            if not isinstance(v, list) or len(v) > n or any(not _ok(x, 0, 1e8) for x in v): pr.append(f'{k} {s.get("id")}')
        if s.get('observedAt') is not None and (not isinstance(s['observedAt'], str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', s['observedAt'])): pr.append(f'observedAt 형식 {s.get("id")}')
        q = s.get('quality')
        if q is not None and (not isinstance(q, dict) or q.get('status') not in ('ok', 'stale', 'comm_error', 'partial', 'unknown') or (q.get('note') is not None and (not isinstance(q['note'], str) or len(q['note']) > 120 or '<' in q['note']))): pr.append(f'quality {s.get("id")}')
        pb = s.get('publish')
        if not isinstance(pb, dict) or pb.get('status') != 'granted' or pb.get('allowed') is not True or not isinstance(pb.get('fields'), list): pr.append(f'publish(granted 아님) {s.get("page")}')
        else:
            extra = [k for k in s if k not in PUBLIC_BASE_KEYS and k not in pb['fields']]
            if extra: pr.append(f'허용 밖 필드 {s.get("page")}: {",".join(extra[:5])}')
            if any(k in pb for k in ('note', 'consentRef', 'memo')): pr.append('publish 에 내부 메모')
    for k in ('collectedAt', 'generatedAt'):
        if k in data and (not isinstance(data[k], str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', data[k])): pr.append(f'{k} 형식')
    if 'schemaVersion' in data and data['schemaVersion'] not in (1, 2): pr.append('schemaVersion')
    if 'publishExcluded' in data: pr.append('publishExcluded(비공개 현장 이름 노출)')
    if data.get('withheld') not in (None, True) or (data.get('withheld') and data.get('sites')): pr.append('withheld')
    errs = data.get('errors')
    if not isinstance(errs, list) or any(not isinstance(e, str) or len(e) > 300 or '<' in e for e in errs): pr.append('errors 형식')
    return pr

# ── 실행 ────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='assets/data/generation.json'); ap.add_argument('--fixture-dir'); ap.add_argument('--sites', default=SITES_FILE)
    args = ap.parse_args()
    site_cfgs = json.load(open(args.sites, encoding='utf-8'))['sites']
    today = dt.datetime.now(KST).date(); now_s = dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00')
    public_cfgs = [c for c in site_cfgs if is_public(c) and (not c.get('collector') or c.get('collector') == 'hismart')]
    if not public_cfgs:
        # 공개 동의가 확인된 현장이 없다 → 포털을 호출하지 않고 비공개 안전 JSON 으로 교체(원자적). 이전 공개 파일이 남지 않는다.
        if is_withheld_file(args.out): print('공개 동의(granted) 현장 없음 — 이미 비공개 안전 JSON (변경 없음, 수집 호출 없음)'); return
        write_atomic(args.out, withheld_payload(now_s, today))
        print('공개 동의(granted) 현장 없음 — 비공개 안전 JSON 으로 교체했습니다 (수집 호출 없음)'); return
    def on_failure(stage):
        r = sanitize_existing(args.out, site_cfgs, now_s, today)
        print(f'{stage} — 새 값을 쓰지 않습니다. 기존 파일 정리: {r}', file=sys.stderr)

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
            print('수집 실패:', redact(e, pw, uid), file=sys.stderr); on_failure('수집 실패'); sys.exit(1)
        finally:
            c.logout()
        calls = c.calls
        data['errors'] = [redact(e, pw, uid) for e in data['errors']]
    data['apiCalls'] = calls
    if not data['sites']:
        print('현장 데이터 없음:', data['errors'], file=sys.stderr); on_failure('현장 데이터 없음'); sys.exit(1)
    problems = validate(data)
    if problems:
        print('검증 실패 — 파일을 쓰지 않습니다:', problems[:10], file=sys.stderr); on_failure('검증 실패'); sys.exit(1)
    write_atomic(args.out, data)
    t = data['totals']
    print(f"ok: {t['sites']}개 현장, 오늘 {t['todayKwh']} kWh, 이달 {t['monthKwh']} kWh, 호출 {calls}회, 오류 {data['errors'] or '없음'}")

if __name__ == '__main__':
    main()
