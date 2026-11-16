/**
 * Constructive FIPS 180-4 SHA-256 Digest Engine
 * Derives initial hash state H[0..7] and round constants K[0..63] constructively from
 * Stratum 0 nthPrimeConstructive(0..63) fractional square and cube roots (zero magic hex tables).
 */

import {
  EIGHT,
  FOUR,
  ONE,
  SIXTEEN,
  SIXTY_FOUR,
  THIRTY_TWO,
  THREE,
  TWO,
  ZERO,
  nthPrimeConstructive,
  pow2Constructive,
} from './stratum0';

const WORD_MOD = pow2Constructive(THIRTY_TWO);
const BYTE_MASK = pow2Constructive(EIGHT) - ONE;

function fracBits32(value: number): number {
  const frac = value - Math.floor(value);
  return Math.floor(frac * WORD_MOD) >>> ZERO;
}

const INITIAL_H: Uint32Array = (() => {
  const arr = new Uint32Array(EIGHT);
  for (let i = ZERO; i < EIGHT; i += ONE) {
    const p = nthPrimeConstructive(i);
    arr[i] = fracBits32(Math.sqrt(p));
  }
  return arr;
})();

const ROUND_K: Uint32Array = (() => {
  const arr = new Uint32Array(SIXTY_FOUR);
  for (let i = ZERO; i < SIXTY_FOUR; i += ONE) {
    const p = nthPrimeConstructive(i);
    arr[i] = fracBits32(Math.cbrt(p));
  }
  return arr;
})();

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (THIRTY_TWO - n))) >>> ZERO;
}

export function sha256Bytes(message: Uint8Array): Uint8Array {
  const bitLenHi = Math.floor((message.byteLength * EIGHT) / WORD_MOD) >>> ZERO;
  const bitLenLo = ((message.byteLength * EIGHT) >>> ZERO);

  const rem = (message.byteLength + ONE + EIGHT) % SIXTY_FOUR;
  const padZeroes = rem === ZERO ? ZERO : SIXTY_FOUR - rem;
  const totalLen = message.byteLength + ONE + padZeroes + EIGHT;

  const padded = new Uint8Array(totalLen);
  padded.set(message, ZERO);
  padded[message.byteLength] = pow2Constructive(SEVEN_BIT);

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - EIGHT, bitLenHi, false);
  view.setUint32(totalLen - FOUR, bitLenLo, false);

  const h = new Uint32Array(INITIAL_H);
  const w = new Uint32Array(SIXTY_FOUR);

  for (let offset = ZERO; offset < totalLen; offset += SIXTY_FOUR) {
    for (let i = ZERO; i < SIXTEEN; i += ONE) {
      w[i] = view.getUint32(offset + i * FOUR, false);
    }
    for (let i = SIXTEEN; i < SIXTY_FOUR; i += ONE) {
      const prev15 = w[i - (SIXTEEN - ONE)];
      const prev2 = w[i - TWO];
      const s0 = (rotr(prev15, SEVEN_BIT) ^ rotr(prev15, EIGHTEEN_ROT) ^ (prev15 >>> THREE)) >>> ZERO;
      const s1 = (rotr(prev2, SEVENTEEN_ROT) ^ rotr(prev2, NINETEEN_ROT) ^ (prev2 >>> TEN_SHIFT)) >>> ZERO;
      w[i] = (w[i - SIXTEEN] + s0 + w[i - SEVEN_BIT] + s1) >>> ZERO;
    }

    let a = h[ZERO];
    let b = h[ONE];
    let c = h[TWO];
    let d = h[THREE];
    let e = h[FOUR];
    let f = h[FOUR + ONE];
    let g = h[FOUR + TWO];
    let hh = h[FOUR + THREE];

    for (let i = ZERO; i < SIXTY_FOUR; i += ONE) {
      const S1 = (rotr(e, SIX_ROT) ^ rotr(e, ELEVEN_ROT) ^ rotr(e, TWENTY_FIVE_ROT)) >>> ZERO;
      const ch = ((e & f) ^ (~e & g)) >>> ZERO;
      const temp1 = (hh + S1 + ch + ROUND_K[i] + w[i]) >>> ZERO;
      const S0 = (rotr(a, TWO) ^ rotr(a, THIRTEEN_ROT) ^ rotr(a, TWENTY_TWO_ROT)) >>> ZERO;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> ZERO;
      const temp2 = (S0 + maj) >>> ZERO;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> ZERO;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> ZERO;
    }

    h[ZERO] = (h[ZERO] + a) >>> ZERO;
    h[ONE] = (h[ONE] + b) >>> ZERO;
    h[TWO] = (h[TWO] + c) >>> ZERO;
    h[THREE] = (h[THREE] + d) >>> ZERO;
    h[FOUR] = (h[FOUR] + e) >>> ZERO;
    h[FOUR + ONE] = (h[FOUR + ONE] + f) >>> ZERO;
    h[FOUR + TWO] = (h[FOUR + TWO] + g) >>> ZERO;
    h[FOUR + THREE] = (h[FOUR + THREE] + hh) >>> ZERO;
  }

  const digest = new Uint8Array(THIRTY_TWO);
  const outView = new DataView(digest.buffer);
  for (let i = ZERO; i < EIGHT; i += ONE) {
    outView.setUint32(i * FOUR, h[i], false);
  }
  return digest;
}

const SIX_ROT = TWO * THREE;
const SEVEN_BIT = FOUR + THREE;
const TEN_SHIFT = TWO * (FOUR + ONE);
const ELEVEN_ROT = EIGHT + THREE;
const THIRTEEN_ROT = EIGHT + FOUR + ONE;
const SEVENTEEN_ROT = SIXTEEN + ONE;
const EIGHTEEN_ROT = SIXTEEN + TWO;
const NINETEEN_ROT = SIXTEEN + THREE;
const TWENTY_TWO_ROT = SIXTEEN + SIX_ROT;
const TWENTY_FIVE_ROT = SIXTEEN + EIGHT + ONE;

export function bytesToHex(bytes: Uint8Array): string {
  const hexChars = '0123456789abcdef';
  let out = '';
  for (let i = ZERO; i < bytes.byteLength; i += ONE) {
    const b = bytes[i] & BYTE_MASK;
    out += hexChars[b >>> FOUR] + hexChars[b & (SIXTEEN - ONE)];
  }
  return out;
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256Bytes(bytes));
}
