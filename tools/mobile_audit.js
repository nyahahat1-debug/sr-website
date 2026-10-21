// 휴대폰 화면 크기별 레이아웃 점검 (playwright-core + Edge headless)
//   1) 저장소 폴더에서 로컬 서버:  python -m http.server 8787 --bind 127.0.0.1
//   2) 실행:  NODE_PATH=<playwright-core 가 있는 node_modules> node tools/mobile_audit.js <출력폴더> [페이지,...] [장치id,...]
//      예) npx 캐시의 playwright-core 사용:  NODE_PATH=$LOCALAPPDATA/npm-cache/_npx/<해시>/node_modules node tools/mobile_audit.js _private/audit
//   결과: <출력폴더>/<장치>/<페이지>.png (전체), -top.png (첫 화면), index 는 시작 화면·3D 장면 6곳·본문, results.json 에 넘침·잘린 글·작은 글자·작은 터치 영역.
//   점검 기준: 요소가 화면 밖으로 나가는지(docW > 기기 폭 → 폰에서 축소됨), 12px 미만 글자, 30px 미만 터치 영역, 깨진 이미지.
//   출력 폴더는 저장소에 올리지 않는다(_private/ 권장).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || path.join(__dirname, 'shots');
const ONLY_PAGES = process.argv[3] ? process.argv[3].split(',') : null;
const ONLY_DEV = process.argv[4] ? process.argv[4].split(',') : null;

const PAGES = ['index.html', 'about.html', 'business.html', 'analysis.html', 'cases.html', 'case-naewoon.html', 'case-dongmul.html', 'case-pga.html', 'case-suejeon.html', 'case-detail.html', 'contact.html', 'privacy.html', '404.html'];

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const DEVICES = [
  { id: 'fold1-cover', name: 'Galaxy Fold 1세대 커버 (280x653)', w: 280, h: 653, dpr: 3, ua: UA_ANDROID },
  { id: 'ip5', name: 'iPhone 5/SE1 (320x568)', w: 320, h: 568, dpr: 2, ua: UA_IOS },
  { id: 'zfold-cover', name: 'Galaxy Z Fold5 커버 (344x882)', w: 344, h: 882, dpr: 3, ua: UA_ANDROID },
  { id: 'galaxy-a', name: 'Galaxy A/S 소형 (360x780)', w: 360, h: 780, dpr: 3, ua: UA_ANDROID },
  { id: 'zflip', name: 'Galaxy Z Flip5 펼침 (360x880)', w: 360, h: 880, dpr: 3, ua: UA_ANDROID },
  { id: 'ipse', name: 'iPhone SE 2/3 (375x667)', w: 375, h: 667, dpr: 2, ua: UA_IOS },
  { id: 'ip15', name: 'iPhone 15/16 (393x852)', w: 393, h: 852, dpr: 3, ua: UA_IOS },
  { id: 's-ultra', name: 'Galaxy S24 Ultra (412x915)', w: 412, h: 915, dpr: 3.5, ua: UA_ANDROID },
  { id: 'ip-promax', name: 'iPhone 16 Pro Max (440x956)', w: 440, h: 956, dpr: 3, ua: UA_IOS },
  { id: 'duo', name: 'Surface Duo / 좁은 폴드 펼침 (540x720)', w: 540, h: 720, dpr: 2.5, ua: UA_ANDROID },
  { id: 'zfold-open', name: 'Galaxy Z Fold5 펼침 (690x829)', w: 690, h: 829, dpr: 2.6, ua: UA_ANDROID },
  { id: 'pixel-fold', name: 'Pixel Fold 펼침 (841x701)', w: 841, h: 701, dpr: 2.6, ua: UA_ANDROID },
  { id: 'ipad-mini', name: 'iPad mini (768x1024)', w: 768, h: 1024, dpr: 2, ua: UA_IOS },
  { id: 'land-ipse', name: 'iPhone SE 가로 (667x375)', w: 667, h: 375, dpr: 2, ua: UA_IOS },
  { id: 'land-ip15', name: 'iPhone 15 가로 (852x393)', w: 852, h: 393, dpr: 3, ua: UA_IOS },
  { id: 'land-ultra', name: 'S24 Ultra 가로 (915x412)', w: 915, h: 412, dpr: 3.5, ua: UA_ANDROID },
  { id: 'land-zfold-cover', name: 'Z Fold5 커버 가로 (882x344)', w: 882, h: 344, dpr: 3, ua: UA_ANDROID },
];

const AUDIT = () => {
  const vw = innerWidth, vh = innerHeight;
  const out = { vw, vh, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, bodyW: document.body.scrollWidth,
    overflowRight: [], overflowLeft: [], clippedText: [], smallText: [], smallTargets: [], hscroll: [], brokenImgs: [], fixed: [] };
  const seen = new Set();
  const push = (arr, key, v) => { const k = arr + '|' + key; if (seen.has(k)) return; seen.add(k); if (out[arr].length < 40) out[arr].push(v); };
  const desc = el => { const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50); const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''; return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${c ? '.' + c : ''}${t ? ' "' + t + '"' : ''}`; };
  const vis = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const hiddenByAncestor = el => { let p = el.parentElement; while (p && p !== document.documentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return true; p = p.parentElement; } return false; };
  const clipAncestor = el => { let p = el.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX) || /(hidden|clip|auto|scroll)/.test(cs.overflowY)) return p; p = p.parentElement; } return null; };
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META'].includes(el.tagName)) continue;
    if (!vis(el) || hiddenByAncestor(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) continue; // visually-hidden helpers
    if (r.right > vw + 1 && r.width > 2) { const a = clipAncestor(el); push('overflowRight', desc(el), { el: desc(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), pos: cs.position, clippedBy: a ? desc(a).slice(0, 40) : null }); }
    if (r.left < -1 && r.width > 2) { const a = clipAncestor(el); push('overflowLeft', desc(el), { el: desc(el), left: Math.round(r.left), w: Math.round(r.width), pos: cs.position, clippedBy: a ? desc(a).slice(0, 40) : null }); }
    const direct = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (direct && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) push('clippedText', desc(el), { el: desc(el), scrollW: el.scrollWidth, clientW: el.clientWidth, ellipsis: cs.textOverflow });
    if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) push('hscroll', desc(el), { el: desc(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
    if (direct) { const fs = parseFloat(cs.fontSize); if (fs < 12) push('smallText', desc(el), { el: desc(el), fontSize: fs }); }
    if (el.matches('a,button,input:not([type=hidden]),select,textarea,[role=button],.chip,.pill,.tab')) {
      const inline = (cs.display === 'inline') && el.closest('p,li,td,dd,small,.note,.foot,footer');
      if (!inline && (r.height < 30 || r.width < 30)) push('smallTargets', desc(el), { el: desc(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) push('brokenImgs', desc(el), { el: desc(el), src: (el.currentSrc || el.src || '').slice(-60) });
    if (/fixed|sticky/.test(cs.position) && r.height > 0 && out.fixed.length < 20) out.fixed.push({ el: desc(el).slice(0, 60), pos: cs.position, h: Math.round(r.height), top: Math.round(r.top) });
  }
  return out;
};

async function waitReady(page, ms) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});
  await page.waitForTimeout(ms);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = [];
  const pages = ONLY_PAGES || PAGES;
  const devices = ONLY_DEV ? DEVICES.filter(d => ONLY_DEV.includes(d.id)) : DEVICES;
  for (const dev of devices) {
    const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true, userAgent: dev.ua, locale: 'ko-KR', reducedMotion: 'no-preference' });
    const dir = path.join(OUT, dev.id); fs.mkdirSync(dir, { recursive: true });
    for (const pg of pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + String(e.message || e).slice(0, 160)));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
      const rec = { device: dev.id, name: dev.name, page: pg, errors };
      try {
        if (pg === 'index.html') {
          // 1) 시작 화면(게이트)
          await page.goto(BASE + 'index.html?gate', { waitUntil: 'load', timeout: 60000 });
          await waitReady(page, 2800);
          await page.screenshot({ path: path.join(dir, 'index-gate.png'), scale: 'css' });
          rec.gate = await page.evaluate(AUDIT);
          // 2) 본문 (게이트·타이포 인트로 생략)
          await page.goto(BASE + 'index.html?nogate&nointro', { waitUntil: 'load', timeout: 60000 });
          await page.waitForFunction(() => window.__sr3dReady || window.__sr3dFallbackOn, null, { timeout: 25000 }).catch(() => {});
          rec.threeD = await page.evaluate(() => ({ ready: !!window.__sr3dReady, fallback: !!window.__sr3dFallbackOn, reason: window.__sr3dFallbackReason || null }));
          await waitReady(page, 1200);
          rec.audit = await page.evaluate(AUDIT);
          rec.layoutExpanded = rec.audit.vw > dev.w + 1;
          const story = await page.evaluate(() => { const s = document.getElementById('story'); return { top: s.offsetTop, h: s.offsetHeight, vh: innerHeight }; });
          const pts = [0.05, 0.21, 0.4, 0.62, 0.8, 0.95];
          rec.storyShots = [];
          for (let i = 0; i < pts.length; i++) {
            const y = Math.round(story.top + pts[i] * (story.h - story.vh));
            await page.evaluate(y => window.scrollTo(0, y), y);
            await page.waitForTimeout(900);
            const f = `index-s${i + 1}.png`;
            await page.screenshot({ path: path.join(dir, f), scale: 'css' });
            const a = await page.evaluate(AUDIT);
            rec.storyShots.push({ p: pts[i], y, file: f, overflowRight: a.overflowRight, overflowLeft: a.overflowLeft, clippedText: a.clippedText, smallText: a.smallText, smallTargets: a.smallTargets });
          }
          // 3) 스토리 이후 본문 전체
          await page.evaluate(() => window.scrollTo(0, document.getElementById('story').offsetTop + document.getElementById('story').offsetHeight));
          await page.waitForTimeout(600);
          const afterTop = story.top + story.h;
          const docH = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.screenshot({ path: path.join(dir, 'index-after.png'), scale: 'css', fullPage: true, clip: { x: 0, y: afterTop, width: dev.w, height: Math.max(10, docH - afterTop) } });
        } else {
          await page.goto(BASE + pg, { waitUntil: 'load', timeout: 60000 });
          await waitReady(page, 1500);
          // 페이지 내 데이터 위젯 로딩 여유
          await page.waitForTimeout(800);
          rec.audit = await page.evaluate(AUDIT);
          rec.layoutExpanded = rec.audit.vw > dev.w + 1;   // 레이아웃 뷰포트가 기기 폭보다 넓음 = 실제 폰에서 축소되거나 가로로 밀림
          await page.screenshot({ path: path.join(dir, pg.replace('.html', '') + '.png'), scale: 'css', fullPage: true });
          await page.screenshot({ path: path.join(dir, pg.replace('.html', '') + '-top.png'), scale: 'css' });
        }
      } catch (e) {
        rec.fatal = String(e.message || e).slice(0, 300);
      }
      results.push(rec);
      await page.close();
      process.stdout.write(`${dev.id} ${pg} ok\n`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  // 요약: 기기 폭 넘침 · 보이는 가로 넘침 · 잘린 글 · 깨진 이미지 · 치명 오류
  const bad = results.filter(r => r.fatal || r.layoutExpanded || (r.audit && (r.audit.overflowRight.some(o => !o.clippedBy) || r.audit.clippedText.length || r.audit.brokenImgs.length)));
  for (const r of bad) console.log('CHECK', r.device, r.page, r.fatal ? 'fatal:' + r.fatal : '', r.layoutExpanded ? `layout ${r.audit.vw}px > device` : '', r.audit ? `overflow=${r.audit.overflowRight.filter(o => !o.clippedBy).length} clipped=${r.audit.clippedText.length} broken=${r.audit.brokenImgs.length}` : '');
  console.log('done', results.length, 'pages ·', bad.length, 'to check');
}
run().catch(e => { console.error(e); process.exit(1); });
