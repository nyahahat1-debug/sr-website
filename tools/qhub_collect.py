#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""효성 전주공장(자가소비) 발전량 수집기 — 한화큐셀 Q.HUB 모니터링(qhub.qcells.com) → assets/data/hyosung-generation.json

사용: QHUB_USER_ID=<아이디> QHUB_PASSWORD=<비밀번호> python tools/qhub_collect.py [--out assets/data/hyosung-generation.json]
      python tools/qhub_collect.py --fixture-dir <폴더>     # 저장한 응답으로 변환 로직만 시험

Q.HUB 는 세션 쿠키 방식(폼 로그인 /mgt/login/doLogin.do). 자격증명은 환경변수로만 받고 어디에도 쓰지 않는다.
한 번 실행에 로그인 1 + 실시간 3 + 월별 보고서(없는 달만, 최대 N) 호출. 월별 발전량은 보고서(일별 달력 합)로 쌓고,
오늘·이달·올해 실시간 값과 시간별 출력은 live 에 넣는다. 응답 형식이 바뀌면 validate() 가 막고 파일을 쓰지 않는다.
"""
import json, os, re, sys, math, calendar, datetime as dt, urllib.request, urllib.parse, urllib.error, argparse, http.cookiejar

BASE = 'https://qhub.qcells.com'
KST = dt.timezone(dt.timedelta(hours=9))
SITE_NAME = '효성첨단소재 전주공장'
CAPACITY_KW = 1530            # 홈페이지 표기(모듈 기준). 포털 등록 용량은 1,485.9kW(피드 3개)
TARIFF_ID = 'ie-ha2'
FIRST_MONTH = '2025-07'       # 월별 이력 적재 시작(준공 2025). 발전량 0 인 달은 자동으로 건너뛴다

class Client:
    def __init__(self, uid, pw):
        self.uid, self.pw, self.calls = uid, pw, 0
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.hdr = {'User-Agent': 'Mozilla/5.0 (sr-website hyosung generation collector)', 'Referer': BASE + '/imsMain/main.do?cm=M300', 'Origin': BASE}

    def login(self):
        self.op.open(urllib.request.Request(BASE + '/mgt/login/login.do', headers=self.hdr), timeout=30).read()   # 세션 쿠키
        body = urllib.parse.urlencode({'userId': self.uid, 'passwd': self.pw}).encode()
        r = self.op.open(urllib.request.Request(BASE + '/mgt/login/doLogin.do', data=body, headers={**self.hdr, 'Content-Type': 'application/x-www-form-urlencoded'}), timeout=30)
        self.calls += 2
        final = r.geturl()
        if 'login' in final and 'error' in final: raise RuntimeError('로그인 실패(아이디·비밀번호 확인)')
        if 'login' in final: raise RuntimeError('로그인 후에도 로그인 페이지에 머묾 (추가 인증 또는 접속 차단 가능성)')
        self.last_status = self.post('/mgt/session/status.do', None, method='GET')
        return self.last_status

    def post(self, path, payload, method='POST'):
        data = json.dumps(payload).encode() if payload is not None else None
        h = {**self.hdr, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json'}
        if data is not None: h['Content-Type'] = 'application/json; charset=utf-8'
        self.calls += 1
        with self.op.open(urllib.request.Request(BASE + path, data=data, method=method, headers=h), timeout=40) as r:
            txt = r.read().decode('utf-8', 'ignore')
            if 'login.do' in r.geturl(): raise RuntimeError('세션 없음(로그인 페이지로 이동)')
        try: return json.loads(txt)
        except Exception: raise RuntimeError(f'{path} JSON 아님')

    def logout(self):
        try: self.op.open(urllib.request.Request(BASE + '/mgt/login/logout.do', headers=self.hdr), timeout=20).read()
        except Exception: pass

def redact(msg, *secrets):
    s = str(msg)
    for x in secrets:
        if x: s = s.replace(x, '***').replace(urllib.parse.quote(x, safe=''), '***')
    return re.sub(r'[<>]', '', s)[:300]

def num(v, d=None):
    try: return float(str(v).replace(',', '')) if v is not None else d
    except Exception: return d

def month_range(ym):
    y, m = int(ym[:4]), int(ym[5:7]); last = calendar.monthrange(y, m)[1]
    return f'{y:04d}-{m:02d}-01', f'{y:04d}-{m:02d}-{last:02d}'

def months_between(a, b):
    y, m = int(a[:4]), int(a[5:7]); out = []
    while f'{y:04d}-{m:02d}' <= b:
        out.append(f'{y:04d}-{m:02d}'); m += 1
        if m > 12: m = 1; y += 1
    return out

# ── 변환 ────────────────────────────────────────────────────────────
def build(prev, realtime, sites, chart, reports, now):
    """realtime: getRealTimeSiteAjax, sites: getMainSiteListAjax, chart: getSiteChartList(HOUR), reports: {ym: getIntegratedData}"""
    me = ((realtime or {}).get('multiEnergyData') or [{}])[0]
    feeds = []
    for s in (sites or {}).get('siteRealTime') or []:
        feeds.append({'id': str(s.get('id')), 'name': str(s.get('name', '')).strip(), 'capacityKw': num(s.get('capacity')), 'nowKw': num(s.get('totalActivePowerKw'), 0),
                      'todayKwh': num(s.get('finalTotalEnergy'), 0), 'status': str(s.get('operStatus', ''))})
    t, kw = [], []
    for c in (chart or {}).get('chartData') or []:
        ps = str(c.get('periodStart', ''))[-5:]
        if re.match(r'^\d{2}:\d{2}$', ps): t.append(ps); kw.append(round(num(c.get('totalCumulativeKwh'), 0), 1))   # 시간당 kWh ≈ 평균 kW
    months = {m['m']: m for m in (prev.get('months') or []) if isinstance(m, dict) and re.match(r'^\d{4}-\d{2}$', str(m.get('m', '')))}
    for ym, rep in (reports or {}).items():
        days = (rep or {}).get('calendarDisplayData') or []
        rows = [d for d in days if str(d.get('dayLabel', '')).startswith(ym)]
        if not rows: continue
        total = round(sum(num(d.get('genKwh'), 0) for d in rows), 1)
        if total <= 0: continue                       # 가동 전(0 kWh) 달은 싣지 않는다
        months[ym] = {'m': ym, 'kwh': total, 'days': len(rows), 'source': 'Q.HUB 발전보고서 일별 합', 'partial': ym == now.strftime('%Y-%m')}
    mlist = [months[k] for k in sorted(months)]
    return {
        'site': SITE_NAME, 'capacityKw': CAPACITY_KW, 'portalCapacityKw': round(sum((f['capacityKw'] or 0) for f in feeds), 1) if feeds else None, 'tariffId': TARIFF_ID,
        'note': '월별 발전량은 Q.HUB 발전보고서의 일별 값을 더한 것. 이번 달은 집계 중(partial). 자가소비 현장이라 포털의 SMP·REC 수익은 쓰지 않고 요금제로 절감액을 계산한다.',
        'updated': now.strftime('%Y-%m-%dT%H:%M:%S+09:00'),
        'source': '한화큐셀 Q.HUB 모니터링 (에스알 계정) · 매시 갱신',
        'live': {'nowKw': round(sum(f['nowKw'] for f in feeds), 1) if feeds else None, 'todayKwh': num(me.get('todayGenerationKwh')), 'monthKwh': num(me.get('monthGenerationKwh')),
                 'yearKwh': num(me.get('yearGenerationKwh')), 'todayHours': num(me.get('todayGenerationTime')), 'monthHours': num(me.get('monthGenerationTime')),
                 'feeds': feeds, 'daySeries': {'t': t, 'kw': kw}},
        'months': mlist, 'errors': [],
    }

def _ok(v, lo, hi): return v is None or (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi)

def validate(data):
    pr = []
    if not isinstance(data.get('months'), list): pr.append('months 배열'); return pr
    for m in data['months']:
        if not re.match(r'^\d{4}-\d{2}$', str(m.get('m', ''))): pr.append(f"months.m {m.get('m')!r}")
        if not _ok(m.get('kwh'), 0, 5e6) or m.get('kwh') is None: pr.append(f"months.kwh {m.get('m')}")
        if m.get('source') is not None and (not isinstance(m['source'], str) or len(m['source']) > 80 or '<' in m['source']): pr.append('months.source')
    if 'updated' in data and (not isinstance(data['updated'], str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', data['updated'])): pr.append('updated 형식')
    L = data.get('live') or {}
    for k, hi in (('nowKw', 1e5), ('todayKwh', 1e6), ('monthKwh', 1e8), ('yearKwh', 1e9), ('todayHours', 24), ('monthHours', 800)):
        if not _ok(L.get(k), 0, hi): pr.append(f'live.{k} 범위')
    ds = L.get('daySeries') or {'t': [], 'kw': []}
    if not (isinstance(ds.get('t'), list) and isinstance(ds.get('kw'), list) and len(ds['t']) == len(ds['kw']) and len(ds['t']) <= 48): pr.append('live.daySeries')
    elif any(not re.match(r'^\d{2}:\d{2}$', str(x)) for x in ds['t']) or any(not _ok(v, 0, 1e5) for v in ds['kw']): pr.append('live.daySeries 값')
    for f in L.get('feeds') or []:
        if not re.match(r'^\d{1,8}$', str(f.get('id', ''))) or not isinstance(f.get('name'), str) or len(f['name']) > 60 or '<' in f['name']: pr.append('live.feeds')
        for k, hi in (('capacityKw', 1e5), ('nowKw', 1e5), ('todayKwh', 1e6)):
            if not _ok(f.get(k), 0, hi): pr.append(f'live.feeds.{k}')
    for k in ('site', 'note', 'source'):
        v = data.get(k)
        if v is not None and (not isinstance(v, str) or len(v) > 200 or '<' in v): pr.append(k)
    errs = data.get('errors', [])
    if not isinstance(errs, list) or any(not isinstance(e, str) or len(e) > 300 or '<' in e for e in errs): pr.append('errors')
    return pr

# ── 실행 ────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='assets/data/hyosung-generation.json'); ap.add_argument('--fixture-dir'); ap.add_argument('--max-months', type=int, default=6)
    ap.add_argument('--status-file', default='assets/data/qhub-status.json', help='성공/실패와 (자격증명을 지운) 오류 메시지를 남기는 작은 파일 — 로그 없이도 원인을 볼 수 있게')
    a = ap.parse_args()
    def status(ok, **kw):
        try:
            with open(a.status_file, 'w', encoding='utf-8') as f: json.dump({'ok': ok, 'at': dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00'), **kw}, f, ensure_ascii=False)
        except Exception: pass
    now = dt.datetime.now(KST); cur = now.strftime('%Y-%m')
    prev = {}
    if os.path.exists(a.out):
        try: prev = json.load(open(a.out, encoding='utf-8'))
        except Exception: prev = {}
    have = {m.get('m') for m in (prev.get('months') or []) if isinstance(m, dict) and not m.get('partial') and not m.get('manual')}   # 수동 입력·집계 중인 달은 다시 받는다
    wanted = [ym for ym in months_between(FIRST_MONTH, cur) if ym not in have][-a.max_months:]   # 없는 달 + 이번 달 (한 번에 최대 N)

    if a.fixture_dir:
        fx = lambda n: json.load(open(os.path.join(a.fixture_dir, n), encoding='utf-8'))
        reports = {}
        for ym in wanted:
            p = os.path.join(a.fixture_dir, f'report_{ym}.json')
            if os.path.exists(p): reports[ym] = json.load(open(p, encoding='utf-8'))
        data = build(prev, fx('realtime.json'), fx('sites.json'), fx('chart.json'), reports, now); calls = 0
    else:
        uid, pw = os.environ.get('QHUB_USER_ID', '').strip(), os.environ.get('QHUB_PASSWORD', '')
        if not uid or not pw: print('QHUB_USER_ID, QHUB_PASSWORD 환경변수가 필요합니다', file=sys.stderr); sys.exit(2)
        c = Client(uid, pw); errors = []
        try:
            c.login()
            realtime = c.post('/imsMain/getRealTimeSiteAjax.do', {'userType': ''})
            sites = c.post('/imsMain/getMainSiteListAjax.do', {'userType': ''})
            chart = c.post('/imsMain/getSiteChartList.do', {'dateType': 'HOUR', 'userType': '', 'selectedSites': []})
            ids = [str(s.get('id')) for s in (sites.get('siteRealTime') or [])]; names = [str(s.get('name', '')) for s in (sites.get('siteRealTime') or [])]
            reports = {}
            for ym in wanted:
                s0, e0 = month_range(ym); e0 = min(e0, now.strftime('%Y-%m-%d'))
                try: reports[ym] = c.post('/report/getIntegratedData.do', {'startDate': s0, 'endDate': e0, 'selectedSiteIds': ids, 'selectedSiteNames': names, 'timeGroupType': 'weekly', 'reportType': 'monthly'})
                except Exception as e: errors.append(f'{ym}: ' + redact(e, pw, uid))
            data = build(prev, realtime, sites, chart, reports, now)
            data['errors'] = errors
        except urllib.error.HTTPError as e:
            msg = f'HTTP {e.code} {e.reason} ({redact(getattr(e, "url", ""), pw, uid)[:80]})' + (' — 해외 IP 차단 가능성' if e.code in (403, 406, 429) else '')
            status(False, stage='fetch', error=msg, calls=c.calls); print('수집 실패:', msg, file=sys.stderr); sys.exit(1)
        except Exception as e:
            msg = redact(e, pw, uid); status(False, stage='fetch', error=msg, calls=c.calls, session=str(getattr(c, 'last_status', ''))[:120].replace('<', ''))
            print('수집 실패:', msg, file=sys.stderr); sys.exit(1)
        finally:
            c.logout()
        calls = c.calls
    data['apiCalls'] = calls
    pr = validate(data)
    if pr:
        status(False, stage='validate', error='; '.join(pr[:5])[:300]); print('검증 실패 — 파일을 쓰지 않습니다:', pr[:10], file=sys.stderr); sys.exit(1)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    status(True, calls=calls, months=len(data['months']), newMonths=len(wanted), errors=data['errors'][:3])
    L = data['live']
    print(f"ok: 오늘 {L.get('todayKwh')} kWh, 이달 {L.get('monthKwh')} kWh, 월별 {len(data['months'])}개월(새로 {len(wanted)}), 호출 {calls}회, 오류 {data['errors'] or '없음'}")

if __name__ == '__main__':
    main()
