#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""배출권(KAU) 시세 수집기 — 한국거래소 배출권시장 정보플랫폼(ets.krx.co.kr) 시세조회 → assets/data/carbon.json

사용: python tools/carbon_collect.py [--out assets/data/carbon.json] [--days 20]
공개 페이지가 쓰는 조회 방식(OTP 발급 → 조회) 그대로이며 인증키가 없다. 하루 2회(시세 워크플로)면 충분하다.
출력: {latest:{name,date,price,change,volume}, history:[{d,name,price,volume}] (최근 90거래일), source, errors}
"""
import json, os, re, sys, math, datetime as dt, urllib.request, urllib.parse, argparse

PAGE = 'https://ets.krx.co.kr/contents/ETS/03/03010000/ETS03010000.jsp'
OTP = 'https://ets.krx.co.kr/contents/COM/GenerateOTP.jspx'
DATA = 'https://ets.krx.co.kr/contents/ETS/99/ETS99000001.jspx'
BLD = 'ETS/03/03010000/ets03010000_05'
KST = dt.timezone(dt.timedelta(hours=9))
UA = 'Mozilla/5.0 (sr-website carbon price collector)'

def fetch_rows(days):
    jar = urllib.request.HTTPCookieProcessor(); opener = urllib.request.build_opener(jar)
    hdr = {'User-Agent': UA, 'Referer': PAGE}
    q = urllib.parse.urlencode({'bld': BLD, 'name': 'grid'})
    with opener.open(urllib.request.Request(OTP + '?' + q, headers=hdr), timeout=30) as r: code = r.read().decode('utf-8').strip()
    if not (100 <= len(code) <= 400): raise RuntimeError('OTP 형식 이상')
    today = dt.datetime.now(KST).date()
    body = urllib.parse.urlencode({'code': code, 'isu_cd': '', 'fromdate': (today - dt.timedelta(days=days)).strftime('%Y%m%d'), 'todate': today.strftime('%Y%m%d'), 'pagePath': '/contents/ETS/03/03010000/ETS03010000.jsp'}).encode()
    with opener.open(urllib.request.Request(DATA, data=body, headers={**hdr, 'Content-Type': 'application/x-www-form-urlencoded'}), timeout=40) as r:
        payload = json.loads(r.read().decode('utf-8'))
    rows = payload.get('DS1') or []
    out = []
    for x in rows:
        try:
            name = str(x.get('isu_eng_abbrv', '')).strip(); d = str(x.get('trd_dd', '')).strip()
            price = float(str(x.get('tdd_clsprc', '0')).replace(',', '')); vol = float(str(x.get('acc_trdvol', '0')).replace(',', '') or 0)
            chg = float(str(x.get('cmpprevdd_prc', '0')).replace(',', '') or 0)
        except Exception: continue
        if re.match(r'^KAU\d{2}$', name) and re.match(r'^\d{4}-\d{2}-\d{2}$', d) and price > 0:
            out.append({'d': d, 'name': name, 'price': int(round(price)), 'volume': int(vol), 'change': int(round(chg))})
    return out

def pick_active(rows):
    """거래가 있는 KAU 종목 중 거래량이 가장 큰 것(현재 이행연도 할당배출권). 없으면 연도가 가장 낮은 KAU."""
    by = {}
    for r in rows: by.setdefault(r['name'], []).append(r)
    if not by: return None
    name = max(by, key=lambda n: (sum(x['volume'] for x in by[n]), -int(n[3:])))
    return name

def _ok(v, lo, hi): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi

def validate(data):
    pr = []
    if data.get('sample') not in (True, False): pr.append('sample')
    if not isinstance(data.get('updated'), str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$', data['updated']): pr.append('updated 형식')
    L = data.get('latest') or {}
    if not re.match(r'^KAU\d{2}$', str(L.get('name', ''))): pr.append('latest.name')
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(L.get('date', ''))): pr.append('latest.date')
    if not _ok(L.get('price'), 1000, 500000): pr.append('latest.price 범위')
    hist = data.get('history')
    if not isinstance(hist, list) or len(hist) > 400: pr.append('history')
    else:
        for h in hist:
            if not (re.match(r'^\d{4}-\d{2}-\d{2}$', str(h.get('d', ''))) and re.match(r'^KAU\d{2}$', str(h.get('name', ''))) and _ok(h.get('price'), 1000, 500000)): pr.append(f"history {h.get('d')}"); break
    if not isinstance(data.get('source'), str) or '<' in data['source'] or len(data['source']) > 200: pr.append('source')
    errs = data.get('errors')
    if not isinstance(errs, list) or any(not isinstance(e, str) or len(e) > 300 or '<' in e for e in errs): pr.append('errors')
    return pr

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='assets/data/carbon.json'); ap.add_argument('--days', type=int, default=20)
    a = ap.parse_args()
    prev = {}
    if os.path.exists(a.out):
        try: prev = json.load(open(a.out, encoding='utf-8'))
        except Exception: prev = {}
    errors = []
    try:
        rows = fetch_rows(a.days)
    except Exception as e:
        rows = []; errors.append(re.sub(r'[<>]', '', str(e))[:300])
    name = pick_active(rows) if rows else (prev.get('latest') or {}).get('name')
    hist = {(h['d'], h['name']): h for h in (prev.get('history') or []) if isinstance(h, dict) and not prev.get('manual')}
    for r in rows: hist[(r['d'], r['name'])] = r
    history = sorted(hist.values(), key=lambda h: (h['d'], h['name']))[-400:]
    mine = [h for h in history if h['name'] == name]
    if not mine:
        print('시세 없음:', errors, file=sys.stderr); sys.exit(1)
    last = mine[-1]
    data = {
        'sample': False, 'manual': False,
        'updated': dt.datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S+09:00'),
        'source': '한국거래소 배출권시장 정보플랫폼(ets.krx.co.kr) 시세조회 · 종가 기준',
        'latest': {'name': last['name'], 'date': last['d'], 'price': last['price'], 'change': last.get('change', 0), 'volume': last.get('volume', 0)},
        'history': [{'d': h['d'], 'name': h['name'], 'price': h['price'], 'volume': h.get('volume', 0)} for h in history if h['name'].startswith('KAU')][-200:],
        'errors': errors,
    }
    pr = validate(data)
    if pr: print('검증 실패 — 파일을 쓰지 않습니다:', pr, file=sys.stderr); sys.exit(1)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"ok: {data['latest']['name']} {data['latest']['date']} 종가 {data['latest']['price']:,}원 (이력 {len(data['history'])}건), 오류 {errors or '없음'}")

if __name__ == '__main__':
    main()
