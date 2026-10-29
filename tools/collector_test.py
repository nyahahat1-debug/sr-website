#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""수집기 공개 게이트·변환·검증 회귀 검사 (로그인·네트워크 없음) — python tools/collector_test.py
  · granted 현장만 공개 JSON 에 포함. pending·denied·누락·알 수 없는 값은 이름·식별자·합계·오류 어디에도 나오지 않음
  · publish.fields 허용 목록 적용, 내부 메모 미출력
  · 공개 상태 전환: granted 파일이 있는 상태에서 pending/denied 로 바꾸고 재실행 → 비공개 안전 JSON 으로 교체(실제 파일, main() 실행)
  · 수집 실패·검증 실패 경로와 v1 파일도 공개 제한을 우회하지 못함
"""
import sys, os, json, datetime as dt, copy, tempfile, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import generation_collect as G
import qhub_collect as Q
PY = sys.executable

fails = 0
def ok(c, m):
    global fails
    print(('  ok   ' if c else '  FAIL ') + m)
    if not c: fails += 1

# ── 합성 포털 응답 (실제 값 아님)
def portal_rows():
    return [
        {'SITE_ID': 'M0001', 'DESCRIPTION': '시험 현장 A', 'SIDO_NAME': '전북', 'SIGU_NAME': '시험시', 'totalCapacity': 100, 'PVPCS_Pac': 40.5, 'PVPCS_Daily_P': 300, 'Daily_Time': 3, 'INV_CNT': 2, 'runCount': 2, 'run_status': 'Run', 'communicationStatus': 'Normal'},
        {'SITE_ID': 'M0002', 'DESCRIPTION': '비공개 현장 B', 'SIDO_NAME': '전북', 'SIGU_NAME': '시험시', 'totalCapacity': 50, 'PVPCS_Pac': 0, 'PVPCS_Daily_P': 10, 'Daily_Time': 0.5, 'INV_CNT': 1, 'runCount': 0, 'run_status': 'Run', 'communicationStatus': 'Error'},
        {'SITE_ID': 'M0003', 'DESCRIPTION': '시험 현장 C', 'SIDO_NAME': '전북', 'SIGU_NAME': '시험시', 'totalCapacity': 70, 'PVPCS_Pac': 12, 'PVPCS_Daily_P': 50, 'Daily_Time': 1, 'INV_CNT': 1, 'runCount': 1, 'run_status': 'Run', 'communicationStatus': 'Normal'},
    ]
def united(sid):
    return {'united': {'unitedSiteInfo': {'PVPCS_Pcs_Capa': 100, 'PVPCS_Pac': 40.5, 'PVPCS_Daily_P': 300, 'PVPCS_Day': 3, 'PVPCS_CurrentMonth_P': 5000, 'PVPCS_Month': 60, 'PVPCS_AfterMonth_P': 7000, 'PVPCS_Total_P': 100000}},
            'day': {'solraDayWork': {'runTime': ['06:00', '07:00', '08:00'], 'runData': [0, 10, 40.5]}},
            'month': {'solraMonthWork': {'runData': [100] * 30}}, 'year': {'solraYearWork': {'runData': [1000] * 12}}}
calls = []
def fetch_ok(sid): calls.append(sid); return united(sid)
def fetch_fail(sid):
    calls.append(sid)
    if sid == 'M0003': raise RuntimeError('timeout')
    return united(sid)
today = dt.date(2026, 10, 29)
FIELDS = ['id', 'name', 'capacityKw', 'nowKw', 'todayKwh', 'daySeries']

print('1) granted 만 공개 · 허용 목록 · 우회 노출 없음')
cfgs = [
    {'id': 'M0001', 'name': '현장 A', 'page': 'case-a.html', 'capacityKw': 100, 'publish': {'status': 'granted', 'fields': FIELDS, 'note': '동의서 2026-10-01 (내부)'}},
    {'id': 'M0002', 'name': '비공개 현장 B', 'page': 'case-b.html', 'publish': {'status': 'denied'}},
    {'id': 'M0003', 'name': '대기 현장 C', 'page': 'case-c.html', 'publish': {'status': 'pending'}},
    {'match': '시험 현장 C', 'name': '플래그 없음 D', 'page': 'case-d.html'},
    {'id': 'M0003', 'name': '이상값 E', 'page': 'case-e.html', 'publish': {'status': 'yes'}},
    {'id': 'HYOSUNG', 'collector': 'qhub', 'name': '다른 수집기', 'publish': {'status': 'granted'}},
]
calls.clear(); d = G.build(cfgs, portal_rows(), fetch_ok, today)
txt = json.dumps(d, ensure_ascii=False)
ok([s['page'] for s in d['sites']] == ['case-a.html'], 'granted 현장 1곳만 포함 (denied·pending·누락·알 수 없는 값 제외)')
ok(all(x not in txt for x in ('M0002', 'M0003', '비공개', '대기 현장', '플래그 없음', '이상값', 'case-b', 'case-c', 'case-d', 'case-e', 'publishExcluded', '동의서', '내부')), '비공개 현장의 식별자·이름·페이지·제외 목록·내부 메모가 JSON 어디에도 없음')
ok(calls == ['M0001'], f'비공개 현장은 포털 호출도 하지 않음 (호출 {calls})')
a = d['sites'][0]
ok(set(a) == set(FIELDS) | set(G.PUBLIC_BASE_KEYS), f'허용 목록 + 기본 키만 출력: {sorted(a)}')
ok(a['publish'] == {'status': 'granted', 'allowed': True, 'fields': FIELDS}, 'publish 에는 상태·허용 목록만 (note 없음)')
ok(d['totals']['sites'] == 1 and d['totals']['capacityKw'] == 100 and d['totals']['monthKwh'] in (None, 0, 0.0), '합계는 공개 현장만 (허용 밖 monthKwh 는 합계에 안 들어감)')
ok(d['errors'] == [], '비공개 현장 관련 경고·오류 문구 없음')
ok(G.validate(d) == [], f'validate 통과 ({G.validate(d)})')

print('2) 품질 판정 (공개 현장만)')
cfgs2 = [{'id': 'M0001', 'name': 'A', 'page': 'a.html', 'publish': {'status': 'granted', 'fields': FIELDS + ['comm', 'ids']}}, {'id': 'M0002', 'name': 'B', 'page': 'b.html', 'publish': {'status': 'granted', 'fields': FIELDS + ['comm']}}, {'ids': ['M0001', 'M0003'], 'name': 'AC 합산', 'page': 'ac.html', 'publish': {'status': 'granted', 'fields': FIELDS + ['ids']}}]
d2 = G.build(cfgs2, portal_rows(), fetch_fail, today)
by = {s['name']: s for s in d2['sites']}
ok(by['A']['quality']['status'] == 'ok' and by['B']['quality']['status'] == 'comm_error', "정상 → ok, comm='Error' → comm_error")
ok(by['AC 합산']['quality']['status'] == 'partial' and by['AC 합산']['ids'] == ['M0001'], '일부 호출 실패 → partial, 합산은 받은 범위')
ok(G.validate(d2) == [], 'validate 통과')

print('3) validate 가 공개 제한 위반을 막는지')
bad = copy.deepcopy(d); bad['sites'][0]['publish'] = {'status': 'pending', 'allowed': None, 'fields': FIELDS}
ok(any('granted' in p for p in G.validate(bad)), 'pending 현장이 공개 파일에 있으면 거부')
bad = copy.deepcopy(d); bad['sites'][0]['monthKwh'] = 5000
ok(any('허용 밖' in p for p in G.validate(bad)), '허용 목록 밖 필드 거부')
bad = copy.deepcopy(d); bad['publishExcluded'] = ['x']
ok(any('publishExcluded' in p for p in G.validate(bad)), '제외 목록(이름 노출) 거부')
bad = copy.deepcopy(d); bad['sites'][0]['publish']['note'] = '동의서'
ok(any('내부 메모' in p for p in G.validate(bad)), 'publish 내부 메모 거부')
v1 = {'sample': False, 'updated': '2026-10-23T19:20:40+09:00', 'sites': [{'id': 'M0001', 'name': 'A', 'daySeries': {'t': [], 'kw': []}, 'monthSeries': [], 'yearSeries': []}], 'errors': []}
ok(any('granted' in p for p in G.validate(v1)), '옛 v1 자료(동의 플래그 없음)는 공개 파일로 검증 통과하지 못함')
wh = G.withheld_payload('2026-10-29T10:00:00+09:00', today)
ok(G.validate(wh) == [] and wh['sites'] == [] and 'name' not in json.dumps(wh), '비공개 안전 JSON 은 통과하고 현장 정보가 없음')

print('4) 공개 상태 전환 — 실제 파일 + main() 실행 (fixture)')
def run_main(mod, tmp, cfg_sites, out, extra=()):
    sites = os.path.join(tmp, 'sites.json'); json.dump({'sites': cfg_sites}, open(sites, 'w', encoding='utf-8'), ensure_ascii=False)
    fx = os.path.join(tmp, 'fx'); os.makedirs(fx, exist_ok=True)
    if mod == 'gen':
        json.dump({'datas': portal_rows()}, open(os.path.join(fx, 'monitoring_site.json'), 'w', encoding='utf-8'))
        for sid in ('M0001', 'M0002', 'M0003'):
            for k, v in united(sid).items(): json.dump({'datas': v}, open(os.path.join(fx, f'{k}_{sid}.json'), 'w', encoding='utf-8'))
        cmd = [PY, '-X', 'utf8', os.path.join(HERE, 'generation_collect.py'), '--out', out, '--sites', sites, '--fixture-dir', fx, *extra]
    else:
        json.dump({'multiEnergyData': [{'todayGenerationKwh': 1200, 'monthGenerationKwh': 30000, 'yearGenerationKwh': 900000, 'todayGenerationTime': 3.2, 'monthGenerationTime': 90}]}, open(os.path.join(fx, 'realtime.json'), 'w'))
        json.dump({'siteRealTime': [{'id': 1, 'name': '피드1', 'capacity': 500, 'totalActivePowerKw': 120.5, 'finalTotalEnergy': 600, 'operStatus': 'Normal'}]}, open(os.path.join(fx, 'sites.json'), 'w', encoding='utf-8'))
        json.dump({'chartData': [{'periodStart': '2026-10-29 07:00', 'totalCumulativeKwh': 50}]}, open(os.path.join(fx, 'chart.json'), 'w'))
        cmd = [PY, '-X', 'utf8', os.path.join(HERE, 'qhub_collect.py'), '--out', out, '--sites', sites, '--fixture-dir', fx, '--status-file', os.path.join(tmp, 'status.json'), *extra]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', cwd=tmp)
    return r.returncode, (r.stdout + r.stderr), (json.load(open(out, encoding='utf-8')) if os.path.exists(out) else None)
tmp = tempfile.mkdtemp(prefix='sr-collector-')
try:
    out = os.path.join(tmp, 'generation.json')
    granted = [{'id': 'M0001', 'name': '현장 A', 'page': 'case-a.html', 'capacityKw': 100, 'publish': {'status': 'granted', 'fields': FIELDS}}]
    rc, log, f = run_main('gen', tmp, granted, out)
    ok(rc == 0 and f and [s['page'] for s in f['sites']] == ['case-a.html'] and f['sites'][0]['nowKw'] == 40.5, f'granted → 공개 파일 생성 (rc {rc})')
    for st in ('pending', 'denied'):
        cfg = copy.deepcopy(granted); cfg[0]['publish']['status'] = st
        rc, log, f = run_main('gen', tmp, cfg, out)
        ok(rc == 0 and f and f.get('withheld') is True and f['sites'] == [] and '현장 A' not in json.dumps(f, ensure_ascii=False) and 'M0001' not in json.dumps(f), f'granted 파일이 있는 상태에서 {st} 로 전환 후 재실행 → 비공개 안전 JSON 으로 교체 (rc {rc})')
        ok('수집 호출 없음' in log, '비공개 전환 시 포털 호출 없음')
    rc, log, f = run_main('gen', tmp, granted, out)
    ok(rc == 0 and f and len(f['sites']) == 1, '다시 granted → 공개 파일 복귀')
    ok(not any(n.startswith('.') and n.endswith('.tmp') for n in os.listdir(tmp)), '임시 파일이 남지 않음(원자적 교체)')
    # 허용 목록 축소 후 재실행 → 파일의 필드도 줄어든다
    cfg = copy.deepcopy(granted); cfg[0]['publish']['fields'] = ['name', 'todayKwh']
    rc, log, f = run_main('gen', tmp, cfg, out)
    ok(rc == 0 and set(f['sites'][0]) == {'name', 'todayKwh'} | set(G.PUBLIC_BASE_KEYS), '허용 목록 축소 → 출력 필드 축소')
    # 수집 실패 경로: granted 파일이 있는데 denied 로 바뀐 뒤 수집이 실패해도(현장 없음) 기존 파일이 정리된다
    run_main('gen', tmp, granted, out)
    cfg = copy.deepcopy(granted) + [{'id': 'M0002', 'name': '비공개 B', 'page': 'case-b.html', 'publish': {'status': 'granted', 'fields': FIELDS}}]
    rc, log, f = run_main('gen', tmp, cfg, out)   # 두 현장 공개 파일
    cfg[1]['publish']['status'] = 'denied'; cfg[0]['id'] = 'M9999'; cfg[0].pop('match', None)   # A 는 포털에서 못 찾음(수집 실패 경로), B 는 denied
    rc, log, f = run_main('gen', tmp, cfg, out)
    ok(rc == 1 and f and 'case-b.html' not in json.dumps(f) and '비공개 B' not in json.dumps(f, ensure_ascii=False), f'수집 실패 경로(rc {rc})에서도 기존 파일의 denied 현장을 제거 (정리: {"withheld" if f.get("withheld") else "rewritten"})')
    # v1 파일이 남아 있는 상태 + 수집 실패 → v1 은 공개 자료로 인정하지 않고 비공개 안전 JSON 으로
    json.dump(v1, open(out, 'w', encoding='utf-8'))
    cfg = [{'id': 'M9999', 'name': 'A', 'page': 'case-a.html', 'publish': {'status': 'granted', 'fields': FIELDS}}]
    rc, log, f = run_main('gen', tmp, cfg, out)
    ok(rc == 1 and f and f.get('withheld') is True and f['sites'] == [], '옛 v1 파일 + 수집 실패 → 비공개 안전 JSON 으로 교체')
    # Q.HUB
    outq = os.path.join(tmp, 'hyosung.json')
    qg = [{'id': 'HYOSUNG', 'collector': 'qhub', 'name': '효성', 'publish': {'status': 'granted', 'fields': ['site', 'capacityKw', 'live', 'months']}}]
    rc, log, f = run_main('qhub', tmp, qg, outq)
    ok(rc == 0 and f and f['publish']['status'] == 'granted' and f['live']['todayKwh'] == 1200 and 'tariffId' not in f and 'portalCapacityKw' not in f, f'Q.HUB granted → 공개 파일(허용 목록 적용, rc {rc})')
    for st in ('pending', 'denied'):
        qc = copy.deepcopy(qg); qc[0]['publish']['status'] = st
        rc, log, f = run_main('qhub', tmp, qc, outq)
        ok(rc == 0 and f and f.get('withheld') is True and f['live'] is None and f['months'] == [] and '효성' not in json.dumps(f, ensure_ascii=False) and 'site' not in f, f'Q.HUB granted 파일 → {st} 전환 재실행 → 비공개 안전 JSON (rc {rc})')
        st_file = json.load(open(os.path.join(tmp, 'status.json'), encoding='utf-8'))
        ok(st_file.get('withheld') is True and st_file.get('ok') is True, '상태 파일에 withheld 기록')
    ok(Q.validate(json.load(open(outq, encoding='utf-8'))) == [], '비공개 안전 JSON validate 통과')
    # Q.HUB 옛 v1 파일 + granted + 수집 실패(fixture 없음) → 정리
    json.dump({'site': '효성', 'live': {'todayKwh': 1}, 'months': [], 'updated': '2026-10-23T19:00:04+09:00'}, open(outq, 'w', encoding='utf-8'))
    sites = os.path.join(tmp, 'sites.json'); json.dump({'sites': qg}, open(sites, 'w', encoding='utf-8'), ensure_ascii=False)
    r = subprocess.run([PY, '-X', 'utf8', os.path.join(HERE, 'qhub_collect.py'), '--out', outq, '--sites', sites, '--fixture-dir', os.path.join(tmp, 'nope'), '--status-file', os.path.join(tmp, 'status.json')], capture_output=True, text=True, encoding='utf-8', cwd=tmp)
    f = json.load(open(outq, encoding='utf-8'))
    ok(r.returncode != 0 and f.get('withheld') is True and '효성' not in json.dumps(f, ensure_ascii=False), f'Q.HUB v1 파일 + 수집 실패(rc {r.returncode}) → 비공개 안전 JSON 으로 교체')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('5) Q.HUB build/validate')
rt = {'multiEnergyData': [{'todayGenerationKwh': 1200, 'monthGenerationKwh': 30000, 'yearGenerationKwh': 900000, 'todayGenerationTime': 3.2, 'monthGenerationTime': 90}]}
st = {'siteRealTime': [{'id': 1, 'name': '피드1', 'capacity': 500, 'totalActivePowerKw': 120.5, 'finalTotalEnergy': 600, 'operStatus': 'Error'}]}
ch = {'chartData': [{'periodStart': '2026-10-29 07:00', 'totalCumulativeKwh': 50}]}
now = dt.datetime(2026, 10, 29, 10, 0, tzinfo=Q.KST)
qp = {'status': 'granted', 'allowed': True, 'fields': ['site', 'capacityKw', 'portalCapacityKw', 'tariffId', 'live', 'months']}
q = Q.build({}, rt, st, ch, {}, now, publish=qp)
ok(q['schemaVersion'] == 2 and q['collectedAt'] == q['updated'] and q['observedAt'] is None and q['quality']['status'] == 'comm_error', 'v2 필드 · 관측 시각 null · 피드 Error → comm_error')
ok(Q.validate(q) == [], f'validate 통과 ({Q.validate(q)})')
for s_ in ('pending', 'denied', 'unknown'):
    ok(Q.build({}, rt, st, ch, {}, now, publish={'status': s_, 'allowed': False, 'fields': []}) is None, f'{s_} → None')
bad = copy.deepcopy(q); bad['publish'] = {'status': 'pending', 'allowed': None, 'fields': []}
ok(any('granted' in p for p in Q.validate(bad)), 'pending 상태 파일에 값이 있으면 거부')
bad = copy.deepcopy(q); bad['extra'] = 1
ok(any('허용 밖' in p for p in Q.validate(bad)), '허용 밖 상위 키 거부')
pub = Q.publish_cfg()
ok(pub['status'] in ('granted', 'pending', 'denied', 'unknown') and pub['allowed'] == (pub['status'] == 'granted'), f"저장소 설정의 qhub 공개 상태 읽기 ({pub['status']})")

print('6) 현재 저장소 설정·공개 파일')
cfg = json.load(open(G.SITES_FILE, encoding='utf-8'))
ok(all(isinstance(c.get('publish'), dict) and c['publish'].get('status') in G.PUBLISH_STATES and c['publish'].get('fields') for c in cfg['sites']), '모든 현장에 publish.status·fields 가 있음')
ok(not any(c['publish']['status'] == 'granted' for c in cfg['sites']), '현재 granted 현장 없음(동의 미확인) → 다음 수집 실행에서 공개 파일이 비공개 안전 JSON 으로 바뀐다')
DATA = os.path.join(HERE, '..', 'assets', 'data')
cur = json.load(open(os.path.join(DATA, 'generation.json'), encoding='utf-8')); cur2 = json.load(open(os.path.join(DATA, 'hyosung-generation.json'), encoding='utf-8'))
ok(cur.get('withheld') is True and cur['sites'] == [] and G.validate(cur) == [], '배포 대상 generation.json 은 비공개 안전 JSON (validate 통과)')
ok(cur2.get('withheld') is True and cur2['live'] is None and cur2['months'] == [] and Q.validate(cur2) == [], '배포 대상 hyosung-generation.json 은 비공개 안전 JSON (validate 통과)')
pub_txt = open(os.path.join(DATA, 'generation.json'), encoding='utf-8').read() + open(os.path.join(DATA, 'hyosung-generation.json'), encoding='utf-8').read() + open(os.path.join(DATA, 'qhub-status.json'), encoding='utf-8').read()
toks = [t for c in cfg['sites'] for t in ([c.get('id'), c.get('name'), c.get('match')] + list(c.get('ids') or []) + list(c.get('matches') or [])) if t]
ok(not any(t in pub_txt for t in toks) and 'kWh' not in pub_txt and 'note' not in cur, '배포 대상 3개 파일에 현장명·식별자·검색어·값·메모 없음')
fx_txt = ''.join(open(os.path.join(HERE, 'fixtures', n), encoding='utf-8').read() for n in ('generation_v2.json', 'hyosung_v2.json'))
ok(not any(t in fx_txt for t in toks), '시험 fixture 는 합성 자료 (실제 현장명·식별자 없음)')
# 이미 withheld 인 파일은 다시 쓰지 않는다 (매시 시각만 바뀐 커밋 방지)
tmp2 = tempfile.mkdtemp(prefix='sr-collector2-')
try:
    out = os.path.join(tmp2, 'generation.json'); pend = [{'id': 'M0001', 'name': '현장 A', 'page': 'case-a.html', 'publish': {'status': 'pending', 'fields': FIELDS}}]
    rc, log, f1 = run_main('gen', tmp2, pend, out); t1 = open(out, encoding='utf-8').read()
    rc, log, f2 = run_main('gen', tmp2, pend, out); t2 = open(out, encoding='utf-8').read()
    ok(rc == 0 and t1 == t2 and '변경 없음' in log, 'HI SMART: 이미 비공개 안전 JSON 이면 다시 쓰지 않음(바이트 동일)')
    outq = os.path.join(tmp2, 'hyosung.json'); qp = [{'id': 'HYOSUNG', 'collector': 'qhub', 'name': '효성', 'publish': {'status': 'pending', 'fields': ['site', 'live', 'months']}}]
    rc, log, f1 = run_main('qhub', tmp2, qp, outq); t1 = open(outq, encoding='utf-8').read()
    rc, log, f2 = run_main('qhub', tmp2, qp, outq); t2 = open(outq, encoding='utf-8').read()
    ok(rc == 0 and t1 == t2 and '변경 없음' in log, 'Q.HUB: 이미 비공개 안전 JSON 이면 다시 쓰지 않음')
finally:
    shutil.rmtree(tmp2, ignore_errors=True)

print('\n실패 %d건' % fails if fails else '\n전부 통과')
sys.exit(1 if fails else 0)
