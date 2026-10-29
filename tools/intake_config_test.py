#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""문의 접수 설정 검사 — security_meta 의 접수 API origin 자동 반영과 security_check 의 설정 일관성 검사를 임시 config 로 시험한다.
   python tools/intake_config_test.py     (실제 config.js·contact.html 은 바꾸지 않는다)"""
import io, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import security_meta as SM, security_check as SC

ROOT = SM.ROOT
fails = 0
def ok(c, m):
    global fails
    print(('  ok   ' if c else '  FAIL ') + m)
    if not c: fails += 1

CFG = "export const INTAKE_CONFIG = Object.freeze({\n  provider: '%s',\n  intakeApiUrl: '%s',\n  intakeSchema: 'sr-intake/1',\n});\n"
html = io.open(os.path.join(ROOT, 'contact.html'), encoding='utf-8').read()
orig_cfg = SM.CONFIG_JS
try:
    with tempfile.TemporaryDirectory() as td:
        def use(provider, url):
            p = os.path.join(td, 'config.js'); io.open(p, 'w', encoding='utf-8').write(CFG % (provider, url)); SM.CONFIG_JS = p
        print('1) 현재 저장소 설정')
        SM.CONFIG_JS = orig_cfg
        cur = SM.intake_config()
        ok(cur['provider'] == 'web3forms' and cur['intakeApiUrl'] == '', f"현재: provider web3forms · intakeApiUrl 비어 있음 (주소 미정 → 추측하지 않음)")
        ok(SM.intake_origin() is None and 'api.web3forms.com' in SM.build_policy('contact.html', html), 'CSP: 접수 origin 없음 · Web3Forms 유지')
        ok(SC.check_intake_config() == [], '설정 검사: 문제 없음')

        print('2) 주소 기입 → CSP 자동 반영')
        use('web3forms', 'https://intake.example-public.net/api/public/inquiries')
        pol = SM.build_policy('contact.html', html)
        ok(SM.intake_origin() == 'https://intake.example-public.net' and 'connect-src ' in pol and 'https://intake.example-public.net' in pol.split('connect-src ')[1].split(';')[0], 'connect-src 에 접수 origin 추가')
        ok('https://api.web3forms.com' in pol.split('connect-src ')[1].split(';')[0], 'Web3Forms origin 은 유지(원복 대비)')
        pr = SC.check_intake_config()
        ok(any('CSP connect-src' in x for x in pr) and len(pr) == 1, f'CSP 미갱신 상태는 검사 실패 1건 (security_meta --write 안내): {pr}')

        print('3) 잘못된 설정은 배포 차단')
        use('intake', ''); pr = SC.check_intake_config(); ok(any('비어 있음' in x for x in pr), "provider intake + 주소 없음 → 실패")
        use('web3forms', 'http://intake.example-public.net/api/public/inquiries'); pr = SC.check_intake_config(); ok(any('https' in x for x in pr), 'http 주소 → 실패')
        for bad in ('https://localhost:8000/api/public/inquiries', 'https://ip-172-26-7-69.tail2b9209.ts.net/api/public/inquiries', 'https://3.34.100.150/api/public/inquiries', 'https://127.0.0.1/api/public/inquiries'):
            use('web3forms', bad); pr = SC.check_intake_config(); ok(any('공개 진입점이 아닌' in x for x in pr), f'비공개·로컬 호스트 → 실패: {bad.split("/")[2]}')
        use('web3forms', 'https://intake.example-public.net/api/inquiries'); pr = SC.check_intake_config(); ok(any('/api/public/inquiries' in x for x in pr), '계약 경로가 아니면 실패')
        use('other', ''); pr = SC.check_intake_config(); ok(any('web3forms|intake' in x for x in pr), '알 수 없는 provider → 실패')
finally:
    SM.CONFIG_JS = orig_cfg
print(('\n실패 %d건' % fails) if fails else '\n전부 통과')
sys.exit(1 if fails else 0)
