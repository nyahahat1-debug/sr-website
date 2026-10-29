// 계산기 → 문의 폼으로 넘기는 "구조화된 계산 조건" (사람이 읽는 요약문 ?calc= 와 별도로 ?calcd= 에 싣는다)
//   · 개인정보는 들어가지 않는다 (용량·가정값·결과·시세 기준뿐).
//   · 받는 쪽(contact-prefill.js)은 스키마·타입·범위를 검사하고, 같은 모델로 다시 계산해 결과가 일치할 때만 받아들인다.
//     요약 문자열에서 숫자를 역추출하지 않는다 — 구조화 원본이 없으면 요약만 전달된다.
//   · 클라이언트 계산 결과는 참고용 추정이며 확정 견적·보장 수익이 아니다 (disclaimer 필드로 함께 전달).
import { ASSUMPTIONS, MODEL_VERSION, compute } from './model.js';

export const CALC_SCHEMA = 'sr-calc/1';
export const CALC_DISCLAIMER = '홈페이지 계산기의 참고용 추정값 · 확정 견적·보장 수익 아님';
const RESULT_KEYS = ['year1GenKwh', 'year1SavingKrw', 'year1SaleKrw', 'capexKrw', 'opexKrw', 'paybackYears', 'simplePaybackYears', 'npvKrw', 'irr'];
const BASES = ['avg365', 'avg30', 'today', 'manual'];
export const CALCD_MAX = 2000;   // URL 파라미터 길이 상한

/** 계산 결과 r(compute), 가정값 a, 입력 input, 시세 정보 market({basis, updated, applied}) 로 구조화 레코드를 만든다 */
export function calcRecord({ r, a, input, market, edited, now }) {
  if (!r || !r.ok) return null;
  const assumptions = {}; for (const d of ASSUMPTIONS) assumptions[d.key] = a[d.key];
  const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  return {
    schema: CALC_SCHEMA, model: MODEL_VERSION, computedAt: (now || new Date()).toISOString(),
    mode: r.mode, capacityKw: r.capacityKw, tariffId: input && input.tariffId ? String(input.tariffId) : null,
    assumptions,
    assumptionSource: { edited: Number.isFinite(edited) ? edited : 0, demo: !(Number.isFinite(edited) && edited > 0) },
    market: market ? { basis: BASES.includes(market.basis) ? market.basis : 'manual', updated: market.updated ? String(market.updated).slice(0, 10) : null, applied: Array.isArray(market.applied) ? market.applied.slice(0, 4) : [] } : null,
    result: {
      year1GenKwh: num(r.year1.gen), year1SavingKrw: num(r.year1.saving), year1SaleKrw: num(r.year1.sale), capexKrw: num(r.capex), opexKrw: num(r.opex),
      paybackYears: num(r.paybackYears), simplePaybackYears: num(r.simplePaybackYears), npvKrw: num(r.npv), irr: num(r.irr),
    },
    disclaimer: CALC_DISCLAIMER,
  };
}

/** 스키마·타입·범위 검사. 문제 목록(빈 배열이면 정상) */
export function validateCalc(o) {
  const err = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['객체 아님'];
  if (o.schema !== CALC_SCHEMA) err.push('schema');
  if (typeof o.model !== 'string' || o.model.length > 40) err.push('model');
  if (typeof o.computedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(o.computedAt)) err.push('computedAt');
  if (!['self', 'sell'].includes(o.mode)) err.push('mode');
  if (!(typeof o.capacityKw === 'number' && o.capacityKw > 0 && o.capacityKw <= 100000)) err.push('capacityKw');
  if (o.tariffId != null && !(typeof o.tariffId === 'string' && /^[a-z0-9-]{2,16}$/.test(o.tariffId))) err.push('tariffId');
  if (!o.assumptions || typeof o.assumptions !== 'object') err.push('assumptions');
  else for (const d of ASSUMPTIONS) { const v = o.assumptions[d.key]; if (!(typeof v === 'number' && Number.isFinite(v) && v >= d.min && v <= d.max)) err.push('assumptions.' + d.key); }
  if (o.market != null) {
    if (typeof o.market !== 'object' || !BASES.includes(o.market.basis)) err.push('market.basis');
    if (o.market && o.market.updated != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.market.updated))) err.push('market.updated');
  }
  if (!o.result || typeof o.result !== 'object') err.push('result');
  else for (const k of RESULT_KEYS) { const v = o.result[k]; if (!(v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e15))) err.push('result.' + k); }
  return err;
}

/** 같은 모델로 다시 계산해 결과가 일치하는지 (0.5% 허용) */
export function verifyCalc(o) {
  const errs = validateCalc(o); if (errs.length) return { ok: false, errors: errs };
  const r = compute({ mode: o.mode, capacityKw: o.capacityKw, tariffId: o.tariffId || undefined }, { ...o.assumptions });
  if (!r.ok) return { ok: false, errors: ['재계산 실패'] };
  const close = (x, y) => (x == null && y == null) || (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= 0.005 * Math.max(1, Math.abs(y)));
  const bad = [];
  if (!close(o.result.year1GenKwh, r.year1.gen)) bad.push('year1GenKwh');
  if (!close(o.result.year1SavingKrw, r.year1.saving)) bad.push('year1SavingKrw');
  if (!close(o.result.year1SaleKrw, r.year1.sale)) bad.push('year1SaleKrw');
  if (!close(o.result.capexKrw, r.capex)) bad.push('capexKrw');
  if (!close(o.result.paybackYears, r.paybackYears)) bad.push('paybackYears');
  return bad.length ? { ok: false, errors: bad.map(k => '재계산 불일치: ' + k) } : { ok: true, errors: [], recomputed: r };
}

// ── URL 안전 인코딩 (UTF-8 → base64url)
export function encodeCalc(o) {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** 디코드 + 검사. 실패하면 null (요약 문자열만 쓰게 된다) */
export function decodeCalc(s) {
  if (typeof s !== 'string' || !s || s.length > CALCD_MAX || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return validateCalc(o).length ? null : o;
  } catch (e) { return null; }
}
