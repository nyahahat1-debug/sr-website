#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""수집기 변환·검증 회귀 검사 (로그인·네트워크 없음) — python tools/collector_test.py
  · 자료 계약 v2 필드(schemaVersion·collectedAt·observedAt=null·quality·publish)
  · 공개 동의: denied 현장은 공개 JSON 에서 제외, pending 은 상태 그대로(동의로 간주 안 함), 플래그 없음 → pending + 경고
  · 통신 이상·부분 수집 품질 판정, validate() 가 새 필드를 받아들이고 잘못된 값은 막는지
"""
import sys, os, json, datetime as dt, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generation_collect as G
import qhub_collect as Q

fails = 0
def ok(c, m):
    global fails
    print(('  ok   ' if c else '  FAIL ') + m)
    if not c: fails += 1

# ── 합성 포털 응답 (실제 값 아님)
def portal_rows():
    return [
        {'SITE_ID': 'M0001', 'DESCRIPTION': '시험 현장 A', 'SIDO_NAME': '전북', 'SIGU_NAME': '시험시', 'totalCapacity': 100, 'PVPCS_Pac': 40.5, 'PVPCS_Daily_P': 300, 'Daily_Time': 3, 'INV_CNT': 2, 'runCount': 2, 'run_status': 'Run', 'communicationStatus': 'Normal'},
        {'SITE_ID': 'M0002', 'DESCRIPTION': '시험 현장 B', 'SIDO_NAME': '전북', 'SIGU_NAME': '시험시', 'totalCapacity': 50, 'PVPCS_Pac': 0, 'PVPCS_Daily_P': 10, 'Daily_Time': 0.5, 'INV_CNT': 1, 'runCount': 0, 'run_status': 'Run', 'communicationStatus': 'Error'},
        {'SITE_ID': 'M0003', 'DESCRIPTION': '시험 현장 C', 'SIDO_NAME': '전북', 'SIGU_NAME': '시험시', 'totalCapacity': 70, 'PVPCS_Pac': 12, 'PVPCS_Daily_P': 50, 'Daily_Time': 1, 'INV_CNT': 1, 'runCount': 1, 'run_status': 'Run', 'communicationStatus': 'Normal'},
    ]
def fetch_ok(sid):
    return {'united': {'unitedSiteInfo': {'PVPCS_Pcs_Capa': 100, 'PVPCS_Pac': 40.5, 'PVPCS_Daily_P': 300, 'PVPCS_Day': 3, 'PVPCS_CurrentMonth_P': 5000, 'PVPCS_Month': 60, 'PVPCS_AfterMonth_P': 7000, 'PVPCS_Total_P': 100000}},
            'day': {'solraDayWork': {'runTime': ['06:00', '07:00', '08:00'], 'runData': [0, 10, 40.5]}},
            'month': {'solraMonthWork': {'runData': [100] * 30}}, 'year': {'solraYearWork': {'runData': [1000] * 12}}}
def fetch_fail(sid):
    if sid == 'M0003': raise RuntimeError('timeout')
    return fetch_ok(sid)
today = dt.date(2026, 10, 29)

print('1) 공개 동의 상태별 처리')
cfgs = [
    {'id': 'M0001', 'name': '현장 A', 'page': 'case-a.html', 'capacityKw': 100, 'publish': {'status': 'granted', 'fields': ['nowKw']}},
    {'id': 'M0002', 'name': '현장 B', 'page': 'case-b.html', 'publish': {'status': 'denied'}},
    {'id': 'M0003', 'name': '현장 C', 'page': 'case-c.html'},                                # 플래그 없음
    {'id': 'HYOSUNG', 'collector': 'qhub', 'name': '다른 수집기', 'publish': {'status': 'granted'}},
]
d = G.build(cfgs, portal_rows(), fetch_ok, today)
ids = [s['id'] for s in d['sites']]
ok('M0002' not in ids and d['publishExcluded'] == ['현장 B'], 'denied 현장은 공개 JSON 에서 제외되고 이름만 publishExcluded 에 남음')
ok('M0001' in ids and 'M0003' in ids, 'granted·플래그 없음 현장은 포함')
a = next(s for s in d['sites'] if s['id'] == 'M0001'); c = next(s for s in d['sites'] if s['id'] == 'M0003')
ok(a['publish'] == {'status': 'granted', 'allowed': True, 'fields': ['nowKw']}, 'granted → allowed True')
ok(c['publish']['status'] == 'pending' and c['publish']['allowed'] is None, '플래그 없음 → pending, allowed None (동의로 간주하지 않음)')
ok(any('publish.status 없음' in e for e in d['errors']), '플래그 없음은 경고로 기록')
ok(all(s['id'] != 'HYOSUNG' for s in d['sites']), "collector:'qhub' 항목은 HI SMART 수집기가 건너뜀")
ok(d['schemaVersion'] == 2 and d['collectedAt'] == d['updated'] == d['generatedAt'], 'schemaVersion 2 · collectedAt = updated(호환) = generatedAt')
ok(all(s['observedAt'] is None for s in d['sites']), '관측 시각은 포털이 주지 않으므로 null (만들어 넣지 않음)')
ok(G.validate(d) == [], f'validate 통과 ({G.validate(d)})')

print('2) 품질 판정')
cfgs2 = [{'id': 'M0001', 'name': 'A', 'publish': {'status': 'granted'}}, {'id': 'M0002', 'name': 'B', 'publish': {'status': 'pending'}}, {'ids': ['M0001', 'M0003'], 'name': 'AC 합산', 'publish': {'status': 'pending'}}]
d2 = G.build(cfgs2, portal_rows(), fetch_fail, today)
by = {s['name']: s for s in d2['sites']}
ok(by['A']['quality']['status'] == 'ok', '정상 → ok')
ok(by['B']['quality']['status'] == 'comm_error', "comm='Error' → comm_error")
ok(by['AC 합산']['quality']['status'] == 'partial' and by['AC 합산']['ids'] == ['M0001'], '일부 현장 호출 실패 → partial, 합산은 받은 범위')
ok(G.validate(d2) == [], 'validate 통과')

print('3) validate 가 잘못된 v2 값을 막는지')
bad = copy.deepcopy(d); bad['sites'][0]['quality'] = {'status': 'great'}
ok(any('quality' in p for p in G.validate(bad)), '알 수 없는 quality.status 거부')
bad = copy.deepcopy(d); bad['sites'][0]['observedAt'] = '2026-10-29 10:00'
ok(any('observedAt' in p for p in G.validate(bad)), 'observedAt 형식 오류 거부')
bad = copy.deepcopy(d); bad['sites'][0]['publish'] = {'status': 'denied', 'allowed': False}
ok(any('publish' in p for p in G.validate(bad)), 'denied 현장이 공개 파일에 들어 있으면 거부')
bad = copy.deepcopy(d); bad['collectedAt'] = 'yesterday'
ok(any('collectedAt' in p for p in G.validate(bad)), 'collectedAt 형식 오류 거부')
v1 = {'sample': False, 'updated': '2026-10-23T19:20:40+09:00', 'sites': [{'id': 'M0001', 'name': 'A', 'daySeries': {'t': [], 'kw': []}, 'monthSeries': [], 'yearSeries': []}], 'errors': []}
ok(G.validate(v1) == [], '옛 v1 자료(새 필드 없음)도 validate 통과 — 호환')

print('4) Q.HUB 수집기')
rt = {'multiEnergyData': [{'todayGenerationKwh': 1200, 'monthGenerationKwh': 30000, 'yearGenerationKwh': 900000, 'todayGenerationTime': 3.2, 'monthGenerationTime': 90}]}
st = {'siteRealTime': [{'id': 1, 'name': '피드1', 'capacity': 500, 'totalActivePowerKw': 120.5, 'finalTotalEnergy': 600, 'operStatus': 'Normal'}, {'id': 2, 'name': '피드2', 'capacity': 500, 'totalActivePowerKw': 0, 'finalTotalEnergy': 600, 'operStatus': 'Error'}]}
ch = {'chartData': [{'periodStart': '2026-10-29 07:00', 'totalCumulativeKwh': 50}, {'periodStart': '2026-10-29 08:00', 'totalCumulativeKwh': 120}]}
now = dt.datetime(2026, 10, 29, 10, 0, tzinfo=Q.KST)
q = Q.build({}, rt, st, ch, {}, now, publish={'status': 'pending', 'allowed': None, 'fields': []})
ok(q['schemaVersion'] == 2 and q['collectedAt'] == q['updated'] and q['observedAt'] is None, 'v2 필드 · 관측 시각 null')
ok(q['quality']['status'] == 'comm_error', '피드 상태 Error → comm_error')
ok(q['publish']['status'] == 'pending' and q['publish']['allowed'] is None, 'pending 그대로 기록')
ok(Q.validate(q) == [], f'validate 통과 ({Q.validate(q)})')
ok(Q.build({}, rt, st, ch, {}, now, publish={'status': 'denied', 'allowed': False, 'fields': []}) is None, 'denied → None (공개 파일을 쓰지 않음)')
pub = Q.publish_cfg()
ok(pub['status'] in ('granted', 'pending', 'denied'), f"generation_sites.json 의 qhub 항목에서 공개 상태를 읽음 ({pub['status']})")
bad = copy.deepcopy(q); bad['publish'] = {'status': 'denied', 'allowed': False}
ok(any('publish' in p for p in Q.validate(bad)), 'denied 가 공개 파일에 있으면 거부')

print('5) 현재 저장소 설정 파일')
cfg = json.load(open(G.SITES_FILE, encoding='utf-8'))
ok(all(isinstance(c.get('publish'), dict) and c['publish'].get('status') in G.PUBLISH_STATES for c in cfg['sites']), '모든 현장에 publish.status 가 있음')
ok(sum(1 for c in cfg['sites'] if c.get('collector') == 'qhub') == 1, 'qhub 항목 1개')
cur = json.load(open(os.path.join(os.path.dirname(G.SITES_FILE), '..', 'assets', 'data', 'generation.json'), encoding='utf-8'))
ok(G.validate(cur) == [], '현재 공개 generation.json(v1) 이 새 validate 를 통과')
cur2 = json.load(open(os.path.join(os.path.dirname(G.SITES_FILE), '..', 'assets', 'data', 'hyosung-generation.json'), encoding='utf-8'))
ok(Q.validate(cur2) == [], '현재 공개 hyosung-generation.json(v1) 이 새 validate 를 통과')

print('\n실패 %d건' % fails if fails else '\n전부 통과')
sys.exit(1 if fails else 0)
