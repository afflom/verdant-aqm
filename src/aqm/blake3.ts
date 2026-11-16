/**
 * Stratum 0 / Stratum 5 — Pure-TypeScript BLAKE3 Cryptographic Hash & Hologram v4 Content-Addressing (`blake3.ts`)
 * Implements the official BLAKE3 specification (IV, message word permutation, 7-round G mixing,
 * 1024-byte chunk states, binary Merkle parent chaining) with zero external runtime dependencies.
 * Matches `prism-code/src/blake3.mjs` byte-for-byte for `.holo` v4 archives and `blake3:<64hex>` kappa IDs.
 */

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const MSG_PERMUTATION = new Uint8Array([
  2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8,
]);

const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;

const BLOCK_LEN = 64;
const CHUNK_LEN = 1024;

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function g(
  state: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
  mx: number,
  my: number,
): void {
  state[a] = (state[a] + state[b] + mx) >>> 0;
  state[d] = rotr32(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotr32(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b] + my) >>> 0;
  state[d] = rotr32(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotr32(state[b] ^ state[c], 7);
}

function roundFn(state: Uint32Array, m: Uint32Array): void {
  g(state, 0, 4, 8, 12, m[0], m[1]);
  g(state, 1, 5, 9, 13, m[2], m[3]);
  g(state, 2, 6, 10, 14, m[4], m[5]);
  g(state, 3, 7, 11, 15, m[6], m[7]);
  g(state, 0, 5, 10, 15, m[8], m[9]);
  g(state, 1, 6, 11, 12, m[10], m[11]);
  g(state, 2, 7, 8, 13, m[12], m[13]);
  g(state, 3, 4, 9, 14, m[14], m[15]);
}

function permute(m: Uint32Array): Uint32Array {
  const permuted = new Uint32Array(16);
  for (let i = 0; i < 16; i += 1) {
    permuted[i] = m[MSG_PERMUTATION[i]];
  }
  return permuted;
}

function compress(
  chainingValue: Uint32Array,
  blockWords: Uint32Array,
  counter: bigint,
  blockLen: number,
  flags: number,
): Uint32Array {
  const state = new Uint32Array(16);
  state.set(chainingValue, 0);
  state.set(IV.subarray(0, 4), 8);
  state[12] = Number(counter & 0xffffffffn) >>> 0;
  state[13] = Number((counter >> 32n) & 0xffffffffn) >>> 0;
  state[14] = blockLen >>> 0;
  state[15] = flags >>> 0;

  let block: Uint32Array = new Uint32Array(blockWords);
  roundFn(state, block);
  block = permute(block);
  roundFn(state, block);
  block = permute(block);
  roundFn(state, block);
  block = permute(block);
  roundFn(state, block);
  block = permute(block);
  roundFn(state, block);
  block = permute(block);
  roundFn(state, block);
  block = permute(block);
  roundFn(state, block);

  for (let i = 0; i < 8; i += 1) {
    state[i] = (state[i] ^ state[i + 8]) >>> 0;
    state[i + 8] = (state[i + 8] ^ chainingValue[i]) >>> 0;
  }
  return state;
}

function wordsFromLittleEndianBytes(bytes: Uint8Array): Uint32Array {
  const words = new Uint32Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >>> 2] = (words[i >>> 2] | (bytes[i] << ((i & 3) * 8))) >>> 0;
  }
  return words;
}

interface OutputNode {
  inputChainingValue: Uint32Array;
  blockWords: Uint32Array;
  counter: bigint;
  blockLen: number;
  flags: number;
}

function outputChainingValue(out: OutputNode): Uint32Array {
  return compress(
    out.inputChainingValue,
    out.blockWords,
    out.counter,
    out.blockLen,
    out.flags,
  ).subarray(0, 8);
}

function outputRootBytes(out: OutputNode, outLen = 32): Uint8Array {
  const result = new Uint8Array(outLen);
  let outputBlockCounter = 0n;
  let offset = 0;
  while (offset < outLen) {
    const words = compress(
      out.inputChainingValue,
      out.blockWords,
      outputBlockCounter,
      out.blockLen,
      out.flags | ROOT,
    );
    for (let w = 0; w < 16 && offset < outLen; w += 1) {
      const word = words[w];
      for (let b = 0; b < 4 && offset < outLen; b += 1) {
        result[offset] = (word >>> (b * 8)) & 0xff;
        offset += 1;
      }
    }
    outputBlockCounter += 1n;
  }
  return result;
}

function parentOutput(
  leftChildCv: Uint32Array,
  rightChildCv: Uint32Array,
  keyWords: Uint32Array,
  flags: number,
): OutputNode {
  const blockWords = new Uint32Array(16);
  blockWords.set(leftChildCv, 0);
  blockWords.set(rightChildCv, 8);
  return {
    inputChainingValue: keyWords,
    blockWords,
    counter: 0n,
    blockLen: BLOCK_LEN,
    flags: PARENT | flags,
  };
}

class ChunkState {
  chainingValue: Uint32Array;
  chunkCounter: bigint;
  block: Uint8Array;
  blockLen: number;
  blocksCompressed: number;
  flags: number;

  constructor(keyWords: Uint32Array, chunkCounter: bigint, flags: number) {
    this.chainingValue = new Uint32Array(keyWords);
    this.chunkCounter = chunkCounter;
    this.block = new Uint8Array(BLOCK_LEN);
    this.blockLen = 0;
    this.blocksCompressed = 0;
    this.flags = flags;
  }

  len(): number {
    return BLOCK_LEN * this.blocksCompressed + this.blockLen;
  }

  startFlag(): number {
    return this.blocksCompressed === 0 ? CHUNK_START : 0;
  }

  update(input: Uint8Array): void {
    let offset = 0;
    while (offset < input.length) {
      if (this.blockLen === BLOCK_LEN) {
        const blockWords = wordsFromLittleEndianBytes(this.block);
        this.chainingValue = compress(
          this.chainingValue,
          blockWords,
          this.chunkCounter,
          BLOCK_LEN,
          this.flags | this.startFlag(),
        ).subarray(0, 8);
        this.blocksCompressed += 1;
        this.block = new Uint8Array(BLOCK_LEN);
        this.blockLen = 0;
      }
      const want = BLOCK_LEN - this.blockLen;
      const take = Math.min(want, input.length - offset);
      this.block.set(input.subarray(offset, offset + take), this.blockLen);
      this.blockLen += take;
      offset += take;
    }
  }

  output(): OutputNode {
    const blockWords = wordsFromLittleEndianBytes(this.block);
    return {
      inputChainingValue: this.chainingValue,
      blockWords,
      counter: this.chunkCounter,
      blockLen: this.blockLen,
      flags: this.flags | this.startFlag() | CHUNK_END,
    };
  }
}

export function blake3(input: Uint8Array | string, outLen = 32): Uint8Array {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const keyWords = new Uint32Array(IV);
  const flags = 0;
  let chunkState = new ChunkState(keyWords, 0n, flags);
  const cvStack: Uint32Array[] = [];

  const pushStack = (cv: Uint32Array) => {
    cvStack.push(cv);
  };
  const popStack = (): Uint32Array => {
    const top = cvStack.pop();
    if (!top) throw new Error('BLAKE3 empty CV stack');
    return top;
  };

  const addChunkChainingValue = (newCv: Uint32Array, totalChunks: bigint) => {
    let cv = newCv;
    let chunks = totalChunks;
    while ((chunks & 1n) === 0n) {
      cv = outputChainingValue(parentOutput(popStack(), cv, keyWords, flags));
      chunks >>= 1n;
    }
    pushStack(cv);
  };

  let offset = 0;
  while (offset < bytes.length) {
    if (chunkState.len() === CHUNK_LEN) {
      const chunkCv = outputChainingValue(chunkState.output());
      const totalChunks = chunkState.chunkCounter + 1n;
      addChunkChainingValue(chunkCv, totalChunks);
      chunkState = new ChunkState(keyWords, totalChunks, flags);
    }
    const want = CHUNK_LEN - chunkState.len();
    const take = Math.min(want, bytes.length - offset);
    chunkState.update(bytes.subarray(offset, offset + take));
    offset += take;
  }

  let output = chunkState.output();
  let parentNodesRemaining = cvStack.length;
  while (parentNodesRemaining > 0) {
    parentNodesRemaining -= 1;
    output = parentOutput(
      cvStack[parentNodesRemaining],
      outputChainingValue(output),
      keyWords,
      flags,
    );
  }
  return outputRootBytes(output, outLen);
}

export function blake3Hex(input: Uint8Array | string): string {
  const digest = blake3(input, 32);
  let hex = '';
  for (let i = 0; i < digest.length; i += 1) {
    hex += digest[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Returns the 71-byte Hologram v4 / UOR content-addressed label `blake3:<64hex>`.
 */
export function blake3Kappa(input: Uint8Array | string): string {
  return `blake3:${blake3Hex(input)}`;
}
