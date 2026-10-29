// 2단계 검사 — 전송 경로 분리·접수 API 어댑터·요청 식별자·구조화 계산 조건·위젯 자료 계약 v2·효성 재계산 (playwright-core + Edge headless)
//   1) 저장소 폴더에서 로컬 서버:  python -m http.server 8787 --bind 127.0.0.1
//   2) NODE_PATH=<playwright-core 가 있는 node_modules> node tools/ui_tests_phase2.js [출력폴더]
//   외부로는 아무것도 보내지 않는다: Web3Forms 와 접수 API(/__dev__/intake/inquiries)는 route 로 가로채 응답을 흉내 낸다.
//   접수 API 는 로컬(127.0.0.1)에서 ?intake=dev 일 때만 켜진다 — 공개 호스트를 흉내 낸 검사(A-12)로 플래그가 무시되는지 확인한다.
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8787/';
const W3 = 'https://api.web3forms.com/submit', INTAKE = '**/__dev__/intake/inquiries';
const OUT = process.argv[2] || path.join(__dirname, '..', '_private', 'ui-tests-p2');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), scale: 'css' });

async function fillValid(page) {
  await page.fill('#fld-1', '테스트 담당자'); await page.fill('#fld-2', '010-0000-0000'); await page.fill('#fld-3', '전북 전주시 (테스트)');
  await page.check('input[name="개인정보 수집·이용 동의"]');
}
const submit = p => p.evaluate(() => document.getElementById('analysisForm').requestSubmit());

(async () => {
  const econ = await import(pathToFileURL(path.join(__dirname, '..', 'assets', 'js', 'economics', 'model.js')).href);
  const ct = await import(pathToFileURL(path.join(__dirname, '..', 'assets', 'js', 'economics', 'calc-transfer.js')).href);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });

  // 공통: 페이지 열기 + 두 공급자 route (호출 기록)
  async function open(url, { w3 = r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }), intake = r => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, intakeNo: 'IN-2026-000123', requestId: JSON.parse(r.request().postData()).requestId }) }) } = {}) {
    const p = await ctx.newPage(); const calls = { w3: [], intake: [] };
    await p.route(W3, async r => { calls.w3.push({ body: JSON.parse(r.request().postData()), headers: r.request().headers() }); await w3(r, calls.w3.length); });
    await p.route(INTAKE, async r => { calls.intake.push({ body: JSON.parse(r.request().postData()), headers: r.request().headers() }); await intake(r, calls.intake.length); });
    await p.goto(BASE + url); await p.waitForTimeout(500);
    return { p, calls };
  }
  const statusText = p => p.$eval('#formStatus', e => e.textContent);
  const okVisible = p => p.$eval('#formOk', e => !e.hidden);

  console.log('A. 전송 경로 — 한 번의 제출에 공급자 하나');
  {
    const { p, calls } = await open('contact.html?topic=self');
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    ok(calls.w3.length === 1 && calls.intake.length === 0, '운영 기본: Web3Forms 1회, 접수 API 0회');
    const b = calls.w3[0].body;
    ok(/^[0-9a-f]{32}$/.test(b['요청 식별자']) && /^SR-\d{6}-[A-Z2-9]{4}$/.test(b['문의 참조번호']), `Web3Forms payload 에도 요청 식별자(32자리)·참조번호 포함`);
    ok('계산 조건(JSON)' in b && b['계산 조건(JSON)'] === '', '계산 조건 필드는 있으나 calcd 없으면 빈 값');
    ok(await okVisible(p) && (await p.$eval('#formOkTitle', e => e.textContent)) === '신청이 전송되었습니다' && (await p.$eval('#formOkIntake', e => e.hidden)), 'Web3Forms 성공 화면: 전송 확인 문구만, 서버 접수번호 없음');
    await p.close();
  }
  {
    const { p, calls } = await open('contact.html?intake=dev&topic=monitoring');
    await fillValid(p); await p.fill('#fld-7', '시험 문의'); await submit(p); await p.waitForTimeout(600);
    ok(calls.intake.length === 1 && calls.w3.length === 0, 'dev 접수 API 모드: 접수 API 1회, Web3Forms 0회');
    const { body: b, headers: hd } = calls.intake[0];
    ok(b.schema === 'sr-intake/1' && /^[0-9a-f]{32}$/.test(b.requestId) && hd['idempotency-key'] === b.requestId, '구조화 본문 + Idempotency-Key = 요청 식별자');
    ok(/^SR-\d{6}-/.test(b.clientRef) && b.topic.key === 'monitoring' && b.contact.name === '테스트 담당자' && b.site.address.includes('전주') && b.consent.privacy === true && b.message === '시험 문의', '본문 필드(참조번호·관심 분야·연락처·주소·동의·메시지)');
    ok(!('access_key' in b) && b.calc === null && b.calcSummary === null, 'Web3Forms 키 없음 · 계산 조건 없음');
    ok(await okVisible(p) && (await p.$eval('#formOkTitle', e => e.textContent)) === '문의가 접수되었습니다' && (await p.$eval('#formOkIntake', e => e.textContent)).includes('IN-2026-000123'), '서버 저장 확인(201+intakeNo) → 접수 완료 + 서버 접수번호');
    ok((await p.$eval('#formOkRef', e => e.textContent)).includes(b.clientRef), '브라우저 참조번호도 구분해 표시');
    await shot(p, 'intake-success'); await p.close();
  }
  {
    const { p, calls } = await open('contact.html?intake=dev', { intake: r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) });
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    ok(!(await okVisible(p)) && (await statusText(p)).includes('오류') && (await p.$eval('#fld-1', e => e.value)) === '테스트 담당자', '접수번호 없는 200 → 성공 아님(서버 오류 안내) · 입력 유지');
    ok(calls.w3.length === 0, 'Web3Forms 로 우회 전송 없음');
    await p.close();
  }
  {
    // 시간초과 → 같은 요청 식별자로 재시도, 서버가 replay 로 응답
    const { p, calls } = await open('contact.html?intake=dev', { intake: async (r, n) => { if (n === 1) { await new Promise(res => setTimeout(res, 21500)); try { await r.abort(); } catch (e) { } } else await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, intakeNo: 'IN-2026-000777', replay: true, requestId: JSON.parse(r.request().postData()).requestId }) }); } });
    await fillValid(p); await submit(p); await p.waitForTimeout(21000);
    const st = await statusText(p);
    ok(st.includes('20초') && st.includes('다시 전송') && st.includes('중복 접수되지 않습니다'), '시간초과 안내(저장됐을 수 있음 · 같은 식별자 재시도)');
    ok(calls.w3.length === 0, '시간초과 후 Web3Forms 자동 우회 없음');
    await submit(p); await p.waitForTimeout(700);
    ok(calls.intake.length === 2 && calls.intake[1].body.requestId === calls.intake[0].body.requestId && calls.intake[1].body.clientRef === calls.intake[0].body.clientRef, '재시도: 같은 요청 식별자·같은 참조번호');
    ok(JSON.stringify(calls.intake[1].body) === JSON.stringify(calls.intake[0].body) && calls.intake[1].body.submittedAt === calls.intake[0].body.submittedAt && calls.intake[1].body.consent.at === calls.intake[0].body.consent.at, '재시도 본문 = 최초 전송 스냅샷 (submittedAt·consent.at 포함 동일)');
    ok(await okVisible(p) && (await p.$eval('#formOkIntake', e => e.textContent)).includes('IN-2026-000777') && (await p.$eval('#formOkIntake', e => e.textContent)).includes('이미 접수'), 'replay 응답 → 접수 완료(이미 접수됨 안내)');
    await shot(p, 'intake-timeout-retry'); await p.close();
  }
  {
    // 내용 변경 → 새 요청 식별자
    const { p, calls } = await open('contact.html?intake=dev', { intake: (r, n) => n === 1 ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }) : r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, intakeNo: 'IN-2026-000900' }) }) });
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    ok((await statusText(p)).includes('오류') && (await p.$eval('.form-submit', e => e.textContent)) === '다시 전송', '5xx → 서버 오류 안내 + 다시 전송');
    await submit(p); await p.waitForTimeout(600);   // 같은 내용 재시도
    ok(calls.intake.length === 2 && calls.intake[1].body.requestId === calls.intake[0].body.requestId, '같은 내용 재시도 = 같은 요청 식별자');
    ok(JSON.stringify(calls.intake[1].body) === JSON.stringify(calls.intake[0].body), '5xx 뒤 같은 내용 재시도 본문도 동일');
    await p.close();
  }
  {
    const { p, calls } = await open('contact.html?intake=dev', { intake: (r, n) => n === 1 ? r.fulfill({ status: 500, body: '' }) : r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, intakeNo: 'IN-2026-000901' }) }) });
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    await p.fill('#fld-7', '내용을 바꿨습니다'); await submit(p); await p.waitForTimeout(600);
    ok(calls.intake.length === 2 && calls.intake[1].body.requestId !== calls.intake[0].body.requestId && calls.intake[1].body.clientRef === calls.intake[0].body.clientRef, '내용 변경 → 새 요청 식별자, 참조번호는 유지');
    ok(calls.intake[1].body.message === '내용을 바꿨습니다' && calls.intake[1].body.submittedAt >= calls.intake[0].body.submittedAt, '변경된 내용으로 새 본문');
    await p.close();
  }
  {
    // Web3Forms 모드 재시도도 같은 식별자·같은 본문
    const { p, calls } = await open('contact.html', { w3: (r, n) => n === 1 ? r.fulfill({ status: 500, body: '' }) : r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }) });
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    ok((await p.$eval('.form-submit', e => e.textContent)) === '다시 전송', 'Web3Forms 5xx → 다시 전송');
    await submit(p); await p.waitForTimeout(600);
    ok(calls.w3.length === 2 && JSON.stringify(calls.w3[1].body) === JSON.stringify(calls.w3[0].body) && calls.intake.length === 0, 'Web3Forms 재시도: 같은 식별자·같은 본문, 접수 API 호출 없음');
    await p.close();
  }
  for (const [name, status, body, expect] of [
    ['충돌 409', 409, '{"ok":false,"message":"different content"}', /다른 내용/],
    ['요청 제한 429', 429, '{"ok":false}', /제한/],
    ['입력 오류 422', 422, '{"ok":false,"fields":["contact.phone"]}', /입력 내용/],
    ['거부 403', 403, '{"ok":false}', /거부/],
  ]) {
    const { p, calls } = await open('contact.html?intake=dev', { intake: r => r.fulfill({ status, contentType: 'application/json', headers: status === 429 ? { 'Retry-After': '30' } : {}, body }) });
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    const st = await statusText(p);
    ok(expect.test(st) && !(await okVisible(p)) && (await p.$eval('#fld-3', e => e.value)).includes('전주') && calls.w3.length === 0, `${name}: 구분 안내 "${st.slice(0, 28)}…" · 성공 아님 · 입력 유지 · 우회 없음`);
    if (status === 429) ok(st.includes('30초'), '429 Retry-After 반영');
    if (status === 422) ok((await p.$eval('#fld-2', e => e.closest('.form-row').classList.contains('invalid'))) && (await p.evaluate(() => document.activeElement.id)) === 'fld-2', '서버 항목 오류 → 해당 항목 표시·포커스');
    if (status === 409) await shot(p, 'intake-conflict');
    await p.close();
  }
  {
    // 공개 호스트를 흉내: https://sr-prod.test/… 를 로컬 파일로 응답 → ?intake=dev 가 무시되어 Web3Forms 로만 간다
    const p = await ctx.newPage(); const calls = { w3: 0, intake: 0 };
    await p.route('https://sr-prod.test/**', async r => {
      const u = new URL(r.request().url()); const res = await ctx.request.get(BASE + u.pathname.replace(/^\//, '') + u.search);
      await r.fulfill({ status: res.status(), headers: { 'content-type': res.headers()['content-type'] || 'application/octet-stream' }, body: await res.body() });
    });
    await p.route(W3, r => { calls.w3++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); });
    await p.route('https://sr-prod.test/__dev__/**', r => { calls.intake++; r.fulfill({ status: 201, body: '{"ok":true,"intakeNo":"X-1"}' }); });
    await p.goto('https://sr-prod.test/contact.html?intake=dev'); await p.waitForTimeout(600);
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    ok(calls.w3 === 1 && calls.intake === 0, '공개 호스트에서는 ?intake=dev 무시 → Web3Forms 만 호출 (시험 응답이 운영 화면에 쓰이지 않음)');
    await p.close();
  }

  console.log('B. 구조화된 계산 조건 (?calcd=) — 계산기 → 문의');
  let href = null;
  {
    const p = await ctx.newPage();
    await p.goto(BASE + 'analysis.html'); await p.waitForTimeout(1500);
    href = await p.$eval('.ec-actions a', e => e.getAttribute('href'));
    const u = new URL(href, BASE);
    ok(u.searchParams.get('calc') && u.searchParams.get('calcd'), '문의 링크에 요약(calc)과 구조화 조건(calcd) 둘 다');
    const rec = ct.decodeCalc(u.searchParams.get('calcd'));
    ok(rec && ct.verifyCalc(rec).ok, 'calcd 디코드·재계산 검증 통과');
    const exSave = await p.$eval('#exSave', e => e.textContent), exPay = await p.$eval('#exPayback', e => e.textContent);
    ok(econ.fmt.krw(rec.result.year1SavingKrw).replace(' 원', '') === exSave && rec.result.paybackYears.toFixed(1) === exPay, `구조화 결과 = 화면 값 (절감 ${exSave} · 회수 ${exPay}년)`);
    ok(u.searchParams.get('calc').includes(econ.fmt.krw(rec.result.year1SavingKrw)) && u.searchParams.get('calc').includes(econ.fmt.years(rec.result.paybackYears)), '구조화 결과 = 요약문 값');
    ok(rec.market && rec.market.basis === 'avg365' && rec.market.updated && rec.assumptions.smpKrwPerKwh !== 120, '시세 기준(12개월 평균·갱신일)과 반영된 SMP 가 레코드에 있음');
    ok(!/담당자|연락처|@/.test(u.search), 'URL 에 개인정보 없음');
    // 가정 수정 → edited 반영
    await p.click('.ec-details summary'); await p.waitForTimeout(200);
    await p.fill('.ec-num[aria-label="투자비 원단위"]', '1500000'); await p.waitForTimeout(300);
    const rec2 = ct.decodeCalc(new URL(await p.$eval('.ec-actions a', e => e.getAttribute('href')), BASE).searchParams.get('calcd'));
    ok(rec2 && rec2.assumptions.capexKrwPerKw === 1500000 && rec2.assumptionSource.edited >= 1 && rec2.assumptionSource.demo === false && ct.verifyCalc(rec2).ok, '가정 수정 → 레코드 갱신(수정 개수·데모 아님) + 재계산 일치');
    await p.close();
  }
  {
    const { p, calls } = await open(href.replace(/^\//, '').replace('#form', '&intake=dev#form'));
    await p.waitForTimeout(400);
    const st = await p.$eval('#fldCalc', e => e.dataset.state), val = await p.$eval('#fldCalc', e => e.value);
    ok(st === 'verified' && JSON.parse(val).schema === 'sr-calc/1', '문의 페이지: calcd 검증 통과 → 숨은 필드에 JSON');
    ok((await p.$eval('#fld-7', e => e.value)).startsWith('[경제성 계산기 결과]'), '요약문은 추가 내용에 그대로');
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    const b = calls.intake[0].body;
    ok(b.calc && b.calc.schema === 'sr-calc/1' && b.calc.result.year1SavingKrw === JSON.parse(val).result.year1SavingKrw && b.calcSummary.startsWith('[경제성 계산기 결과]') && /확정 견적|보장 수익/.test(b.calc.disclaimer), '접수 API 본문에 구조화 조건 + 요약 + 추정 고지');
    await shot(p, 'calcd-verified'); await p.close();
  }
  {
    const u = new URL(href, BASE); const rec = ct.decodeCalc(u.searchParams.get('calcd'));
    const tam = JSON.parse(JSON.stringify(rec)); tam.result.year1SavingKrw = Math.round(tam.result.year1SavingKrw * 2);
    const { p, calls } = await open('contact.html?calc=' + encodeURIComponent(u.searchParams.get('calc')) + '&calcd=' + ct.encodeCalc(tam));
    ok((await p.$eval('#fldCalc', e => e.dataset.state)) === 'rejected' && (await p.$eval('#fldCalc', e => e.value)) === '' && (await p.$eval('#fld-7', e => e.value)).startsWith('[경제성'), '변조된 calcd → 거부, 요약만 전달');
    await fillValid(p); await submit(p); await p.waitForTimeout(600);
    ok(calls.w3[0].body['계산 조건(JSON)'] === '' && calls.w3[0].body['추가 내용'].startsWith('[경제성'), 'payload 에 구조화 조건 없음(빈 값) · 요약은 포함');
    await p.close();
  }
  {
    const { p } = await open('contact.html?calc=' + encodeURIComponent('[경제성 계산기 결과] 자가소비 · 500 kW · 회수 5.3년'));
    ok((await p.$eval('#fldCalc', e => e.dataset.state)) === 'none' && (await p.$eval('#fld-7', e => e.value)).includes('500 kW'), '옛 링크(calc 만) → 요약만, 역추출 없음');
    await p.goto(BASE + 'contact.html?calcd=' + 'A'.repeat(2500)); await p.waitForTimeout(300);
    ok((await p.$eval('#fldCalc', e => e.dataset.state)) === 'rejected', '길이 초과 calcd 거부');
    await p.goto(BASE + 'contact.html?calcd=%3Cimg%20src%3Dx%3E'); await p.waitForTimeout(300);
    ok((await p.$eval('#fldCalc', e => e.dataset.state)) === 'rejected' && (await p.$$('img[src="x"]')).length === 0, 'base64url 아닌 문자열 거부 · 삽입 없음');
    await p.close();
  }

  console.log('C. 발전 위젯 — 자료 계약 v1/v2');
  const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'generation.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'generation_v2.json'), 'utf8'));
  const hy2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hyosung_v2.json'), 'utf8'));
  const iso = d => new Date(d).toISOString().replace('Z', '+00:00');
  async function widget(name, page, gen, hy, check) {
    const p = await ctx.newPage();
    await p.route('**/assets/data/generation.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gen) }));
    await p.route('**/assets/data/hyosung-generation.json', r => hy ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hy) }) : r.fulfill({ status: 404, body: '' }));
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + page); await p.waitForTimeout(900);
    const txt = await p.$eval('#genSite', e => e.textContent).catch(() => null);
    const vis = await p.$eval('.gen-case', e => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false);
    await check(txt, vis, errs, p);
    await shot(p, 'widget-' + name); await p.close();
  }
  const fresh = (d, fn) => { const x = JSON.parse(JSON.stringify(d)); const now = iso(Date.now() - 20 * 60000); x.updated = now; if (x.collectedAt) x.collectedAt = now; for (const s of x.sites) { s.updated = now; if (s.collectedAt) s.collectedAt = now; } return fn ? fn(x) || x : x; };
  await widget('v1-current', 'case-naewoon.html', fresh(v1), null, async (t, v, e) => ok(!v && e.length === 0, '옛 자료(v1, 동의 플래그 없음): 표시하지 않음, 오류 없음'));
  await widget('v2-withheld', 'case-naewoon.html', { sample: false, schemaVersion: 2, withheld: true, updated: iso(Date.now()), sites: [], totals: { sites: 0 }, errors: [] }, null, async (t, v, e) => ok(!v && e.length === 0, '비공개 안전 JSON(withheld): 표시하지 않음, 오류 없음'));
  await widget('v2-granted', 'case-naewoon.html', fresh(v2), null, async (t, v) => ok(v && t.includes('수집 '), 'granted + allowed → 표시'));
  await widget('v2-observed', 'case-naewoon.html', fresh(v2, x => { x.sites[0].observedAt = iso(Date.now() - 25 * 60000); }), null, async (t, v) => ok(v && t.includes('수집 ') && t.includes('관측 ') && t.includes('발전 중') && t.includes('123.4'), 'v2: 수집·관측 시각 함께 표시 + 발전 중'));
  await widget('v2-no-observed', 'case-naewoon.html', fresh(v2, x => { x.sites[0].observedAt = null; }), null, async (t, v) => ok(v && !t.includes('관측'), 'v2 observedAt null → 관측 시각 만들어 쓰지 않음'));
  await widget('v2-quality-stale', 'case-naewoon.html', fresh(v2, x => { x.sites[0].quality = { status: 'stale', note: '포털 값 3시간째 동일' }; }), null, async (t, v) => ok(v && t.includes('자료 지연'), 'quality.status=stale → 수집 시각이 최신이어도 자료 지연'));
  await widget('v2-quality-comm', 'case-naewoon.html', fresh(v2, x => { x.sites[0].quality = { status: 'comm_error', note: null }; }), null, async (t, v) => ok(v && t.includes('포털 통신 이상'), 'quality.status=comm_error → 통신 이상'));
  await widget('v2-quality-partial', 'case-naewoon.html', fresh(v2, x => { x.sites[0].quality = { status: 'partial', note: null }; }), null, async (t, v) => ok(v && t.includes('일부') && t.includes('누락'), 'quality.status=partial → 일부 누락 표시'));
  await widget('v2-publish-denied', 'case-naewoon.html', fresh(v2, x => { x.sites[0].publish = { status: 'denied', allowed: false }; }), null, async (t, v, e) => ok(!v && e.length === 0, 'publish.allowed=false → 해당 현장 위젯 숨김(2차 방어), 오류 없음'));
  await widget('v2-publish-other-ok', 'case-pga.html', fresh(v2, x => { x.sites[0].publish = { status: 'denied', allowed: false }; }), null, async (t, v) => ok(v, '다른 현장(pga)은 그대로 표시'));
  await widget('v2-publish-pending', 'case-naewoon.html', fresh(v2, x => { x.sites[0].publish = { status: 'pending', allowed: null }; }), null, async (t, v) => ok(!v, 'pending → 표시하지 않음'));
  await widget('v2-publish-granted-noallowed', 'case-naewoon.html', fresh(v2, x => { x.sites[0].publish = { status: 'granted' }; }), null, async (t, v) => ok(!v, 'granted 인데 allowed 플래그 없음 → 표시하지 않음'));
  const hyFresh = fn => { const x = JSON.parse(JSON.stringify(hy2)); x.updated = x.collectedAt = iso(Date.now() - 20 * 60000); if (fn) fn(x); return x; };
  await widget('hy-v2-observed', 'case-detail.html', fresh(v2), hyFresh(x => { x.live.observedAt = iso(Date.now() - 22 * 60000); }), async (t, v) => ok(v && t.includes('관측 ') && t.includes('456.7'), '효성 v2: 관측 시각 표시'));
  await widget('hy-v2-denied', 'case-detail.html', fresh(v2), hyFresh(x => { x.publish = { status: 'denied', allowed: false }; }), async (t, v, e) => ok(!v && e.length === 0, '효성 publish.allowed=false → 위젯 숨김'));
  await widget('hy-v2-comm', 'case-detail.html', fresh(v2), hyFresh(x => { x.quality = { status: 'comm_error' }; }), async (t, v) => ok(v && t.includes('포털 통신 이상'), '효성 quality comm_error → 통신 이상'));
  await widget('hy-v1', 'case-detail.html', fresh(v2), (() => { const x = JSON.parse(JSON.stringify(hy2)); delete x.publish; x.updated = iso(Date.now()); return x; })(), async (t, v, e, p) => ok(!v && (await p.$eval('.hy-effect', el => el.hidden)) && e.length === 0, '효성 v1(동의 플래그 없음) → 위젯·월별 표 모두 숨김'));
  await widget('hy-withheld', 'case-detail.html', fresh(v2), { schemaVersion: 2, withheld: true, updated: iso(Date.now()), publish: { status: 'withheld', allowed: false, fields: [] }, live: null, months: [] }, async (t, v, e, p) => ok(!v && (await p.$eval('.hy-effect', el => el.hidden)) && e.length === 0, '효성 withheld → 위젯·월별 표 숨김, 오류 없음'));
  await widget('hy-granted-table', 'case-detail.html', fresh(v2), hyFresh(), async (t, v, e, p) => ok(v && !(await p.$eval('.hy-effect', el => el.hidden)), '효성 granted → 위젯 + 월별 표 표시'));

  console.log('C2. 실제 배포 파일(모든 현장 pending → 비공개 안전 JSON) — 가짜 응답 없이');
  for (const pg of ['case-naewoon.html', 'case-dongmul.html', 'case-pga.html', 'case-detail.html']) {
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + pg); await p.waitForTimeout(900);
    const vis = await p.$eval('.gen-case', e => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false);
    const tbl = pg === 'case-detail.html' ? await p.$eval('.hy-effect', e => !e.hidden).catch(() => false) : false;
    const txt = await p.evaluate(() => document.body.innerText);
    ok(!vis && !tbl && errs.length === 0 && !/자료 지연|발전 중|kWh\s*\/\s*수집/.test(txt), `${pg}: 위젯${pg === 'case-detail.html' ? '·월별 표' : ''} 숨김, JS 오류 없음`);
    await p.close();
  }
  {
    const r1 = await ctx.request.get(BASE + 'assets/data/generation.json'), r2 = await ctx.request.get(BASE + 'assets/data/hyosung-generation.json');
    const j1 = await r1.json(), j2 = await r2.json();
    ok(j1.withheld === true && j1.sites.length === 0 && j2.withheld === true && j2.live === null && j2.months.length === 0, 'JSON 직접 접근 경로: 둘 다 withheld, 현장·값 없음');
    const t = JSON.stringify(j1) + JSON.stringify(j2);
    ok(!/새운|동물|도민|효성|M5268|kWh/.test(t), '직접 접근 JSON 에 현장명·식별자 없음');
  }

  console.log('D. 효성 사례 — 기금 요율 재계산 표시');
  {
    const p = await ctx.newPage();
    await p.goto(BASE + 'case-detail.html'); await p.waitForTimeout(1200);
    const r1 = await p.$eval('#hyRecalc', e => e.textContent), r2 = await p.$eval('#hyRecalc2', e => e.textContent);
    ok(r1.includes('3,676만 원') && r1.includes('2.7%') && r1.includes('33만 원'), `같은 배분 × 2.7% 재계산 표시: "${r1}"`);
    ok(r2 === '3,676만 원', '성과 요약에도 재계산값');
    const note = await p.$eval('.hy-note', e => e.textContent).catch(() => '');
    const body = await p.evaluate(() => document.body.innerText);
    ok(body.includes('① 분석 보고서값') && body.includes('② 가정별 재계산값') && body.includes('③ 월별 추정값') && body.includes('정부 발표') && body.includes('2025-07-01부터 2.7%'), '보고서값·가정별 재계산값·월별 추정값 구분 + 요율 출처(정부 발표)');
    ok(!/현행 기금|현행 요율/.test(body), '기금 요율을 "현행"으로 단정하지 않음');
    await shot(p, 'hyosung-recalc'); await p.close();
  }

  console.log('E. 회귀 — 20~30% 문구 제거 · 기존 흐름');
  {
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + 'index.html?nogate&nointro&nowebgl'); await p.waitForTimeout(1500);
    const body = await p.evaluate(() => document.body.innerText);
    ok(!body.includes('20~30'), '메인에 20~30% 없음');
    // 자가진단: 수전합리화가 나오도록 선택 (고압 계약·피크 500kW 미만·낮 사용 적음)
    const chips = await p.$$('.dx-q');
    ok(chips.length >= 6, `자가진단 문항 ${chips.length}개`);
    await p.close();
    const p2 = await ctx.newPage();
    await p2.goto(BASE + 'business.html#rational'); await p2.waitForTimeout(600);
    const bb = await p2.evaluate(() => document.body.innerText);
    ok(!bb.includes('20~30') && bb.includes('예상 약 31%') && bb.includes('시공 전 분석 사례 1건'), '사업영역: 예상 절감률 약 31% · 시공 전 분석 사례 1건');
    await p2.goto(BASE + 'case-suejeon.html'); await p2.waitForTimeout(600);
    const sj = await p2.evaluate(() => document.body.innerText);
    ok(sj.includes('예상 절감률 약 31%') && sj.includes('시공 전 분석') && !/31% 절감 · 최근 12개월 실측/.test(sj), '완주 사례: 예상 절감률·시공 전 분석으로 표기, 실측 절감률 표현 없음');
    ok(!body.includes('실측 기준 약 31%'), '메인에 실측 절감률 표현 없음');
    await p2.close();
  }
  {
    // 1단계 흐름 회귀: topic/calc 호환, 동의 미체크 차단
    const { p, calls } = await open('contact.html?topic=maintenance&calc=' + encodeURIComponent('[경제성 계산기 결과] 500 kW'));
    ok((await p.$eval('#fld-5', e => e.value)) === '발전 저하·인버터·유지보수 상담' && (await p.$eval('#fld-7', e => e.value)).includes('500 kW'), 'topic/calc 링크 호환');
    await p.fill('#fld-1', 'a'); await p.fill('#fld-2', '1'); await p.fill('#fld-3', 'b'); await submit(p); await p.waitForTimeout(300);
    ok(calls.w3.length === 0 && (await statusText(p)).includes('동의'), '동의 없이 전송 안 됨');
    await p.close();
  }
  await browser.close();
  console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
