# -*- coding: utf-8 -*-
"""
전력 시세 수집기 — 공공데이터포털(한국전력거래소) 오픈API → assets/data/market.json
  · SMP: 계통한계가격 및 수요예측(하루전 발전계획용)  B552115/SmpWithForecastDemand  (시간별, 최신순, date=YYYYMMDD 필터 가능)
  · REC: REC 현물시장 정보                            B552115/RecMarketInfo2         (거래일별, 오래된 순, 필터 없음)
사용: DATA_GO_KR_KEY=<인증키> python tools/market_collect.py [--out assets/data/market.json] [--days 450]
      개발계정 트래픽 100회/일 — 최초 적재 약 25회, 이후 매일 3회 안팎.
출력 스키마는 assets/data/market.sample.json 과 같고, 계산기용 기준값(latest / avg)을 덧붙인다.
"""
import json, os, sys, time, datetime as dt, urllib.request, urllib.parse, argparse, statistics

SMP_URL = 'https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand'
REC_URL = 'https://apis.data.go.kr/B552115/RecMarketInfo2/getRecMarketInfo2'
KST = dt.timezone(dt.timedelta(hours=9))

def call(url, params, retries=3):
    q = urllib.parse.urlencode(params)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url + '?' + q, headers={'User-Agent': 'sr-website market collector'})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read().decode('utf-8'))
            hdr = data['response']['header']
            if hdr.get('resultCode') != '00':
                raise RuntimeError(f"API {hdr.get('resultCode')}: {hdr.get('resultMsg')}")
            body = data['response']['body'] or {}
            items = (body.get('items') or {}).get('item') or []
            if isinstance(items, dict): items = [items]
            return int(body.get('totalCount') or 0), items
        except Exception as e:
            last = e; time.sleep(2 + 2 * i)
    raise last

def fetch_smp(key, days):
    """최신순 페이지를 넘기며 days 일치 시간별 행을 모은다 → 일별 집계"""
    cutoff = (dt.datetime.now(KST).date() - dt.timedelta(days=days)).strftime('%Y%m%d')
    rows, page, calls = [], 1, 0
    while True:
        total, items = call(SMP_URL, {'serviceKey': key, 'pageNo': page, 'numOfRows': 1000, 'dataType': 'JSON'}); calls += 1
        rows += items
        if not items or items[-1]['date'] < cutoff or page * 1000 >= total or calls >= 40: break
        page += 1
    days_map = {}
    for r in rows:
        d, area = r['date'], r['areaName']
        if d < cutoff: continue
        smp = float(r['smp']); dem = float(r.get('mlfd' if area == '육지' else 'jlfd') or 0)
        slot = days_map.setdefault(d, {'land': [], 'landW': [], 'jeju': []})
        if area == '육지': slot['land'].append(smp); slot['landW'].append((smp, dem))
        else: slot['jeju'].append(smp)
    out = []
    for d in sorted(days_map):
        s = days_map[d]
        if len(s['land']) < 20: continue                                  # 하루치가 덜 들어온 날은 제외
        wsum = sum(dm for _, dm in s['landW']); w = sum(v * dm for v, dm in s['landW']) / wsum if wsum > 0 else statistics.mean(s['land'])
        out.append({'d': f'{d[:4]}-{d[4:6]}-{d[6:]}', 'v': round(w, 2), 's': round(statistics.mean(s['land']), 2), 'j': round(statistics.mean(s['jeju']), 2) if s['jeju'] else None, 'n': len(s['land'])})
    return out, calls

def fetch_rec(key, months):
    """오래된 순 → 마지막 페이지부터 거슬러 올라가며 months 개월치"""
    cutoff = (dt.datetime.now(KST).date() - dt.timedelta(days=31 * months)).strftime('%Y%m%d')
    total, _ = call(REC_URL, {'serviceKey': key, 'pageNo': 1, 'numOfRows': 1, 'dataType': 'JSON'}); calls = 1
    per = 100; page = (total + per - 1) // per; rows = []
    while page >= 1 and calls < 20:
        _, items = call(REC_URL, {'serviceKey': key, 'pageNo': page, 'numOfRows': per, 'dataType': 'JSON'}); calls += 1
        rows = items + rows
        if items and items[0]['bzDd'] < cutoff: break
        page -= 1
    out = []
    for r in rows:
        d = str(r['bzDd'])
        if d < cutoff: continue
        if not r.get('landAvgPrc'): continue
        out.append({'d': f'{d[:4]}-{d[4:6]}-{d[6:]}', 'v': int(round(float(r['landAvgPrc']))), 'hi': int(round(float(r.get('landHgPrc') or 0))), 'lo': int(round(float(r.get('landLwPrc') or 0))),
                    'vol': int(float(r.get('landTrdRecValue') or 0)), 'close': int(round(float(r.get('clsPrc') or 0))), 'jeju': int(round(float(r.get('jejuAvgPrc') or 0))) or None})
    return out, calls

def monthly_from_daily(daily):
    m = {}
    for r in daily: m.setdefault(r['d'][:7], []).append(r['v'])
    return [{'m': k, 'v': round(statistics.mean(v), 2), 'n': len(v)} for k, v in sorted(m.items())]

def avg_last(rows, days, today):
    cut = (today - dt.timedelta(days=days)).isoformat(); vals = [r['v'] for r in rows if r['d'] > cut]
    return round(statistics.mean(vals), 2) if vals else None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='assets/data/market.json'); ap.add_argument('--days', type=int, default=450); ap.add_argument('--rec-months', type=int, default=24)
    args = ap.parse_args()
    key = os.environ.get('DATA_GO_KR_KEY', '').strip()
    if not key: print('DATA_GO_KR_KEY 환경변수가 필요합니다', file=sys.stderr); sys.exit(2)
    prev = {}
    if os.path.exists(args.out):
        try:
            prev = json.load(open(args.out, encoding='utf-8'))
            if prev.get('sample'): prev = {}
        except Exception: prev = {}
    today = dt.datetime.now(KST).date(); errors = []; calls = 0
    smp = prev.get('smpDaily', []); rec = prev.get('rec', [])
    # 이미 쌓인 이력이 있으면 최근 10일만 새로 받는다 (호출 절약)
    smp_days = args.days if not smp else 10
    try:
        new, c = fetch_smp(key, smp_days); calls += c
        merged = {r['d']: r for r in smp}; merged.update({r['d']: r for r in new}); smp = [merged[k] for k in sorted(merged)]
    except Exception as e: errors.append(f'SMP: {e}')
    try:
        new, c = fetch_rec(key, args.rec_months if not rec else 3); calls += c
        merged = {r['d']: r for r in rec}; merged.update({r['d']: r for r in new}); rec = [merged[k] for k in sorted(merged)]
    except Exception as e: errors.append(f'REC: {e}')
    if not smp and not rec:
        print('수집 실패:', errors, file=sys.stderr); sys.exit(1)
    cut = (today - dt.timedelta(days=args.days)).isoformat(); smp = [r for r in smp if r['d'] > cut]
    rcut = (today - dt.timedelta(days=31 * args.rec_months)).isoformat(); rec = [r for r in rec if r['d'] > rcut]
    data = {
        'sample': False,
        'updated': dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00'),
        'note': '한국전력거래소 공개 데이터를 매일 자동 수집. SMP 일별 값은 육지 시간별 SMP 를 예측수요로 가중평균한 값, 월별은 그 일별 값의 평균. REC 는 현물시장 거래일별 육지 평균가(원/REC).',
        'sources': {'smp': '전력거래소 계통한계가격 및 수요예측(하루전 발전계획용) · 공공데이터포털', 'rec': '전력거래소 REC 현물시장 정보 · 공공데이터포털'},
        'smpDaily': smp[-120:], 'smpMonthly': monthly_from_daily(smp), 'rec': rec,
        'latest': {'smp': smp[-1] if smp else None, 'rec': rec[-1] if rec else None},
        'avg': {'smp30': avg_last(smp, 30, today), 'smp365': avg_last(smp, 365, today), 'rec30': avg_last(rec, 30, today), 'rec365': avg_last(rec, 365, today)},
        'errors': errors, 'apiCalls': calls,
    }
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"ok: SMP {len(smp)}일 (최신 {data['latest']['smp'] and data['latest']['smp']['d']}), REC {len(rec)}거래일 (최신 {data['latest']['rec'] and data['latest']['rec']['d']}), 호출 {calls}회, 오류 {errors or '없음'}")

if __name__ == '__main__':
    main()
