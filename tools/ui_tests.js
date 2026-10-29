// 문의 폼·사전 선택·발전 위젯 동작 검사 (playwright-core + Edge headless, 외부 전송은 전부 가짜 응답으로 대체)
//   1) 저장소 폴더에서 로컬 서버:  python -m http.server 8787 --bind 127.0.0.1
//   2) NODE_PATH=<playwright-core 가 있는 node_modules> node tools/ui_tests.js [출력폴더]
//   실제 Web3Forms 로는 요청을 보내지 않는다(route 로 가로채 응답을 흉내 낸다).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || path.join(__dirname, '..', '_private', 'ui-tests');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

async function fillValid(page) {
  await page.fill('#fld-1', '테스트 담당자');
  await page.fill('#fld-2', '010-0000-0000');
  await page.fill('#fld-3', '전북 전주시 (테스트)');
  await page.check('input[name="개인정보 수집·이용 동의"]');
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });

  // ── A. 사전 선택 (?topic= / ?calc=)
  console.log('A. 사전 선택');
  {
    const p = await ctx.newPage();
    await p.goto(BASE + 'contact.html?topic=maintenance&calc=' + encodeURIComponent('[경제성 계산기 결과] 자가소비 · 500 kW · 회수 5.3년'));
    await p.waitForTimeout(600);
    ok(await p.$eval('#fld-5', e => e.value) === '발전 저하·인버터·유지보수 상담', 'topic=maintenance → 관심 분야 선택');
    ok(!(await p.$eval('#topicHint', e => e.hidden)) && (await p.$eval('#topicHint', e => e.textContent)).includes('보증'), '유지보수 안내문 표시');
    ok((await p.$eval('#fld-7', e => e.value)).startsWith('[경제성 계산기 결과]'), 'calc → 추가 내용 채움');
    await p.selectOption('#fld-5', '자가소비 태양광');
    ok(await p.$eval('#topicHint', e => e.hidden), '사용자가 바꾸면 안내문 사라짐(선택 변경 가능)');
    await p.screenshot({ path: path.join(OUT, 'prefill-maintenance.png'), scale: 'css', fullPage: false });
    await p.close();
  }
  {
    const p = await ctx.newPage();
    const long = 'x'.repeat(700), html = '<img src=x onerror=alert(1)>계산';
    await p.goto(BASE + `contact.html?topic=admin&calc=${encodeURIComponent(long)}`);
    await p.waitForTimeout(400);
    ok(await p.$eval('#fld-5', e => e.value) === '', '허용 목록 밖 topic 무시');
    ok(await p.$eval('#fld-7', e => e.value) === '', '600자 초과 calc 무시');
    await p.goto(BASE + `contact.html?topic=electrical&calc=${encodeURIComponent(html)}`);
    await p.waitForTimeout(400);
    ok(await p.$eval('#fld-7', e => e.value) === html, 'HTML 문자열은 값으로만 들어감(실행 안 됨)');
    ok((await p.$$('img[src="x"]')).length === 0, '삽입된 img 없음');
    ok(await p.$eval('#fld-5', e => e.value) === '전기설비·안전관리 문의', 'topic=electrical 선택');
    await p.close();
  }

  // ── B. 전송 흐름 (가짜 응답)
  console.log('B. 전송 흐름');
  async function run(name, handler, after) {
    const p = await ctx.newPage();
    const calls = [];
    await p.route('https://api.web3forms.com/submit', async route => { calls.push(JSON.parse(route.request().postData())); await handler(route, calls.length); });
    await p.goto(BASE + 'contact.html?topic=monitoring&calc=' + encodeURIComponent('[계산기] 500 kW'));
    await p.waitForTimeout(400);
    await after(p, calls);
    await p.close();
  }
  await run('검증', async r => r.fulfill({ status: 200, body: '{"success":true}' }), async (p, calls) => {
    await p.click('.form-submit');
    await p.waitForTimeout(200);
    const st = await p.$eval('#formStatus', e => e.textContent);
    ok(calls.length === 0 && st.includes('담당자 성함'), `빈 폼: 전송 없음, 안내 "${st.slice(0, 30)}"`);
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'fld-1', '첫 오류 항목에 포커스');
    await p.fill('#fld-1', '테스트'); await p.fill('#fld-2', '010-0000-0000'); await p.fill('#fld-3', '전주');
    await p.click('.form-submit'); await p.waitForTimeout(200);
    ok(calls.length === 0 && (await p.$eval('#formStatus', e => e.textContent)).includes('동의'), '동의 없이 전송 안 됨 + 동의 안내');
    await p.screenshot({ path: path.join(OUT, 'form-consent-error.png'), scale: 'css' });
  });
  await run('성공', async r => { await new Promise(res => setTimeout(res, 300)); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"message":"ok"}' }); }, async (p, calls) => {
    await fillValid(p);
    await p.click('.form-submit'); await p.evaluate(() => { const f = document.getElementById('analysisForm'); f.requestSubmit(); f.requestSubmit(); });   // 중복 제출 시도
    await p.waitForTimeout(150);
    ok(await p.$eval('.form-submit', e => e.disabled), '전송 중 버튼 비활성');
    ok((await p.$eval('#formStatus', e => e.textContent)).includes('전송 중'), '전송 중 상태 표시');
    ok(!(await p.$eval('#formOk', e => !e.hidden)), '응답 전 성공 화면 없음');
    await p.waitForTimeout(600);
    ok(calls.length === 1, `중복 클릭에도 요청 1회 (실제 ${calls.length})`);
    const body = calls[0];
    ok(body['관심 분야'] === '발전소 모니터링·운영관리 상담', 'payload 에 관심 분야 포함');
    ok(String(body['추가 내용']).includes('[계산기] 500 kW'), 'payload 에 계산기 조건 포함');
    ok(/^SR-\d{6}-[A-Z2-9]{4}$/.test(body['문의 참조번호']), `payload 에 참조번호 ${body['문의 참조번호']}`);
    ok(String(body.subject).includes('모니터링') && String(body.subject).includes(body['문의 참조번호']), '메일 제목에 관심 분야·참조번호');
    ok(!('botcheck' in body), 'honeypot 필드는 전송하지 않음');
    ok(await p.$eval('#formOk', e => !e.hidden) && (await p.$eval('#formOkRef', e => e.textContent)).includes(body['문의 참조번호']), '성공 화면 + 참조번호');
    ok(await p.$eval('#analysisForm', e => e.hidden), '성공 후 폼 숨김');
    await p.screenshot({ path: path.join(OUT, 'form-success.png'), scale: 'css' });
  });
  await run('거부', async r => r.fulfill({ status: 400, contentType: 'application/json', body: '{"success":false,"message":"bad"}' }), async (p, calls) => {
    await fillValid(p); await p.click('.form-submit'); await p.waitForTimeout(400);
    const st = await p.$eval('#formStatus', e => e.textContent);
    ok(st.includes('거부') && st.includes('063-544-8142'), '거부 상태 + 전화 안내');
    ok(await p.$eval('#fld-1', e => e.value) === '테스트 담당자', '실패 후 입력 유지');
    ok(!(await p.$eval('.form-submit', e => e.disabled)), '재시도 가능(버튼 활성)');
    ok(await p.$eval('#formOk', e => e.hidden), '성공 화면 없음');
    await p.screenshot({ path: path.join(OUT, 'form-rejected.png'), scale: 'css' });
  });
  await run('시간초과·재시도', async (r, n) => { if (n === 1) { await new Promise(res => setTimeout(res, 21500)); try { await r.abort(); } catch (e) {} } else await r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); }, async (p, calls) => {
    await fillValid(p); await p.click('.form-submit');
    await p.waitForTimeout(21000);
    const st = await p.$eval('#formStatus', e => e.textContent);
    ok(st.includes('20초') && st.includes('다시 전송'), '시간초과 안내(전송 여부 불확실 + 재시도)');
    const ref1 = calls[0]['문의 참조번호'];
    ok(await p.$eval('.form-submit', e => e.textContent) === '다시 전송', '버튼 "다시 전송"');
    await p.click('.form-submit'); await p.waitForTimeout(500);
    ok(calls.length === 2 && calls[1]['문의 참조번호'] === ref1, `재시도에 같은 참조번호 ${ref1}`);
    ok(await p.$eval('#formOk', e => !e.hidden), '재시도 성공 화면');
  });
  await run('네트워크 오류', async r => r.abort('failed'), async (p) => {
    await fillValid(p); await p.click('.form-submit'); await p.waitForTimeout(500);
    ok((await p.$eval('#formStatus', e => e.textContent)).includes('네트워크'), '네트워크 오류 안내');
    ok(await p.$eval('#fld-3', e => e.value).then(v => v.includes('전주')), '입력 유지');
  });
  await run('키보드', async r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }), async (p) => {
    await p.focus('#fld-1');
    const order = [];
    for (let i = 0; i < 9; i++) { order.push(await p.evaluate(() => document.activeElement.id || document.activeElement.name || document.activeElement.className)); await p.keyboard.press('Tab'); }
    ok(order.includes('fld-5') && order.some(x => String(x).includes('개인정보')) , 'Tab 이동이 선택·동의까지 닿음: ' + order.join(' > '));
    ok(await p.$eval('#formStatus', e => e.getAttribute('role') === 'status' && e.getAttribute('aria-live') === 'polite'), '상태 영역 role=status aria-live');
  });

  // ── C. 발전 위젯 (가짜 JSON)
  console.log('C. 발전 위젯');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'generation_v2.json'), 'utf8'));   // 공개 동의(granted) 가 붙은 v2 fixture — 공개 파일(v1·withheld)은 표시되지 않으므로
  async function widget(name, mutate, check) {
    const p = await ctx.newPage();
    await p.route('**/assets/data/generation.json', route => { const b0 = JSON.parse(JSON.stringify(base)); delete b0.collectedAt; for (const s of b0.sites) { delete s.collectedAt; s.observedAt = null; } const d = mutate(b0); route.fulfill({ status: 200, contentType: 'application/json', body: typeof d === 'string' ? d : JSON.stringify(d) }); });
    await p.route('**/assets/data/hyosung-generation.json', route => route.fulfill({ status: 404, body: '' }));
    await p.goto(BASE + 'case-naewoon.html'); await p.waitForTimeout(900);
    const txt = await p.$eval('#genSite', e => e.textContent).catch(() => null);
    const vis = await p.$eval('.gen-case', e => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false);
    await check(txt, vis, p);
    await p.screenshot({ path: path.join(OUT, `widget-${name}.png`), scale: 'css' });
    await p.close();
  }
  const iso = d => new Date(d).toISOString().replace('Z', '+00:00');
  await widget('normal', d => { d.updated = iso(Date.now() - 30 * 60000); d.sites[0].updated = d.updated; d.sites[0].nowKw = 412.5; d.sites[0].status = 'Run'; d.sites[0].comm = 'Normal'; return d; },
    async (t, v) => { ok(v && t.includes('발전 중') && t.includes('412.5') && !t.includes('자료 지연'), '정상: 발전 중 + 수집 시각 + 지연 없음'); ok(t.includes('수집 '), '"수집 MM.DD HH:MM" 표기'); });
  await widget('stale', d => { d.updated = iso(Date.now() - 30 * 3600000); d.sites[0].updated = d.updated; d.sites[0].nowKw = 0; return d; },
    async (t, v) => { ok(v && t.includes('자료 지연'), '30시간 전 자료 → 자료 지연 표시'); ok(t.includes('0.0'), '값은 마지막 수집값(0.0) 그대로'); });
  await widget('zero-day', d => { d.updated = iso(Date.now() - 20 * 60000); d.sites[0].updated = d.updated; d.sites[0].nowKw = 0; d.sites[0].status = 'Run'; d.sites[0].comm = 'Normal'; return d; },
    async (t, v) => { const h = new Date().getHours(); const night = h < 6 || h >= 20; ok(v && (night ? t.includes('야간 대기') : t.includes('대기 (출력 0')), `출력 0 (${night ? '야간' : '주간'}) 구분 표시`); });
  await widget('comm-error', d => { d.updated = iso(Date.now() - 20 * 60000); d.sites[0].updated = d.updated; d.sites[0].comm = 'Error'; return d; },
    async (t, v) => ok(v && t.includes('포털 통신 이상'), 'comm=Error → 포털 통신 이상 표시'));
  await widget('no-updated', d => { delete d.updated; delete d.sites[0].updated; delete d.collectedAt; delete d.sites[0].collectedAt; delete d.sites[0].observedAt; return d; },
    async (t, v) => ok(v && t.includes('수집 시각 정보 없음'), 'updated 없음 → 시각 정보 없음'));
  await widget('bad-types', d => { d.sites[0].nowKw = 'abc'; d.sites[0].todayKwh = null; d.sites[0].daySeries = { t: null, kw: 'x' }; return d; },
    async (t, v) => ok(v && t.includes('—') && t.includes('오늘 계측값 없음'), '잘못된 타입 → — 와 계측값 없음, 페이지 정상'));
  await widget('invalid-json', () => '{not json', async (t, v) => ok(!v, '깨진 JSON → 위젯 숨김, 페이지 정상'));
  await widget('missing', d => null, async () => {});   // null → JSON "null"
  {
    const p = await ctx.newPage();
    await p.route('**/assets/data/generation.json', r => r.fulfill({ status: 404, body: '' }));
    await p.route('**/assets/data/hyosung-generation.json', r => r.fulfill({ status: 404, body: '' }));
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + 'case-naewoon.html'); await p.waitForTimeout(800);
    ok(!(await p.$eval('.gen-case', e => !e.hidden).catch(() => false)) && errs.length === 0, '파일 없음(404) → 위젯 숨김, JS 오류 없음');
    await p.close();
  }

  // ── D. 경제성 예시 카드 = 계산기 값
  console.log('D. 예시 카드');
  {
    const p = await ctx.newPage();
    await p.goto(BASE + 'analysis.html'); await p.waitForTimeout(1500);
    const card = await p.$eval('.ph-card', e => e.textContent.replace(/\s+/g, ' '));
    const exPay = await p.$eval('#exPayback', e => e.textContent), exSave = await p.$eval('#exSave', e => e.textContent);
    ok(card.includes('500kW') && card.includes('650MWh') && /^\d+\.\d$/.test(exPay), `카드: 500kW · 650MWh · 절감 ${exSave} · 회수 ${exPay}년`);
    const tile = await p.$eval('.ec-tiles', e => e.textContent.replace(/\s+/g, ' '));
    ok(tile.includes(exSave + ' 원') && tile.includes(exPay + '년') && tile.includes('누적 현금흐름'), '계산기 기본 결과 = 카드 값 (절감·회수기간) + 회수기간 기준 표기');
    const detail = await p.$eval('.ec-detail', e => e.textContent);
    ok(/단순 회수기간.*?(\d+\.\d년|회수 안 됨)/.test(detail), '단순 회수기간 행 표시');
    const href = decodeURIComponent(await p.$eval('.ec-actions a', e => e.getAttribute('href')));
    ok(href.includes(`절감(청구금액 기준) ${exSave} 원/년`) && href.includes(`회수 ${exPay}년(누적 현금흐름 기준)`), '문의 링크 요약 = 화면 값');
    await p.screenshot({ path: path.join(OUT, 'analysis-card.png'), scale: 'css' });
    await p.close();
  }
  await browser.close();
  console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})();
