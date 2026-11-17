/**
 * Verdant AQM — Complete Prism Conformance & Unit Test Suite (`AQ-01` .. `AQ-18`)
 * Run via: npx --yes tsx --test src/aqm/aqm.test.ts
 */

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assemblePagesSite } from '../../bootstrap/assemble-pages';
import { generateAllJupyterNotebooks } from '../../bootstrap/generate-notebooks';
import { buildPrecacheManifest } from '../../bootstrap/precache';
import {
  auditParametricRatchetOnDisk,
  loadDiskRatchetWorkspace,
} from '../../bootstrap/ratchet-gate';
import { verifyAssembledPagesSite } from '../../bootstrap/weight-gate';
import { computeInputKappa } from '../../ci/kappa-cache';

import {
  CANONICAL_ATLAS_PARAMS,
  PARAMETRIC_CHECK_ATLAS_PARAMS,
  buildAtlasGenerators,
  createInitialAtlasState,
  decideUtqcRowHonesty,
  executeAtlasHolospaceBatch,
  inspectAtlasState,
  stepAtlasHolospace,
  verifyAtlasMtcAxioms,
  weaveOpenQasmWithSkWeaver,
} from './atlasUtqc';
import { blake3Hex, blake3Kappa } from './blake3';
import {
  contractGridCodebook,
  contractPackedNibbles,
  contractSparseRuns,
  decideMatmulCodedAdmission,
  decideUorcAdmission,
  packGrid16Nibbles,
} from './codedMatmul';
import {
  Z8_ONE,
  computeExactTotalNormSqSparse,
  createInitialCyclotomicState,
  executeCyclotomicBatch,
  inspectCyclotomicState,
  stepCyclotomicGate,
  z8Add,
  z8Mul,
  z8MulSqrt2,
  z8MulZeta,
  z8Sub,
} from './cyclotomic';
import {
  buildVerdantAqmHoloArchive,
  instantiateHoloCoreWasmGuest,
  parseAndVerifyHoloV4Archive,
  runHoloCoreWasmGuest,
  runWasmPacked4Gemv,
  runWasmSymplecticCommute,
} from './holoGuest';
import {
  createStitchParityBundle,
  decodeVdntSnapshotToken,
  encodeUorcSnapshotToken,
  encodeVdntSnapshotToken,
  executeCircuitRollbackSession,
  packProgressiveUorcStream,
  reconstructFromStitchShards,
} from './journal';
import {
  createInitialExactMps,
  getMpsBondDimensions,
  inspectExactMpsState,
  stepExactMpsGate,
} from './mps';
import {
  CANONICAL_NOTEBOOK_SPECS,
  DIATAXIS_GUIDE_META,
  PRISM_DEVREL_BANNED_FILLER,
  PRISM_DEVREL_VAGUE_LINKS,
  runDevRelContentAndPublishGateAudit,
} from './devrelGuides';
import {
  CORE_WASM_ACCEPTANCE_VECTORS,
  PLANTED_DEFECT_CATALOG,
  dispatchCoreWasmQuery,
  evaluateDevRelPublishGatePrism,
  optimizeCircuitPrismMonoid,
  runAllAcceptanceVectors,
  verifyAndCompileCircuitPrism,
  verifyGateCommutationLegal,
} from './prismKernel';
import {
  LOCKED_UPSTREAM_ORACLE_FILES,
  runAuthoritativeQiskitOracleSuite,
} from './qiskitOracle';
import { sha256Hex } from './sha256';
import { routePromptWithCodedSlm } from './slm';
import {
  PauliFault,
  columnPlanesToSymplecticTableau,
  createInitialTableau,
  executeStabilizerBatch,
  stepStabilizerTableau,
  verifyStabilizersCommute,
  verifySurfaceCodeCommutativity,
} from './stabilizer';
import {
  BoundedBuffer,
  CORE_WASM_REQUEST_MAX_BYTES,
  TILE_EDGE_PX,
  nthPrimeConstructive,
  pow2Constructive,
  verifyConstructiveRatchet,
} from './stratum0';
import {
  buildSoftwareQuantumSceneTriangles,
  rasterizeQuantumSceneTiles,
} from './tileRasterizer';
import { decodeSurfaceCodeTropical } from './tropical';
import {
  AqmBackendMode,
  AtlasBraidErrorKind,
  GateKind,
  HonestyVerdictErrorKind,
  QuantumIsaErrorKind,
  StabilizerErrorKind,
} from './types';

test('AQ-01: Stratum 0 constructive powers, primes, BoundedBuffer, FIPS SHA-256, and BLAKE3 vectors', () => {
  const ratchet = verifyConstructiveRatchet();
  assert.equal(ratchet.valid, true);
  assert.equal(pow2Constructive(4), 16);
  assert.equal(pow2Constructive(6), CORE_WASM_REQUEST_MAX_BYTES);
  assert.equal(nthPrimeConstructive(0), 2);
  assert.equal(nthPrimeConstructive(4), 11);

  const okBuf = BoundedBuffer.fromUtf8('aqm:summary', CORE_WASM_REQUEST_MAX_BYTES);
  assert.equal(okBuf.ok, true);

  const overBuf = BoundedBuffer.fromBytes(new Uint8Array(65), CORE_WASM_REQUEST_MAX_BYTES);
  assert.equal(overBuf.ok, false);
  assert.equal(dispatchCoreWasmQuery(new Uint8Array(65)), 'invalid request');

  // Official NIST FIPS 180-4 SHA-256 test vector for "abc"
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );

  // Official BLAKE3 empty-input test vector
  assert.equal(
    blake3Hex(new Uint8Array(0)),
    'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
  );
  assert.equal(blake3Kappa('verdant-aqm').length, 71);
  assert.ok(blake3Kappa('verdant-aqm').startsWith('blake3:'));
});

test('AQ-02 & AQ-03: Wire linearity no-cloning guard, unbounded register admission, and Kahn DAG', () => {
  const cloneCheck = verifyAndCompileCircuitPrism({
    name: 'clone-test',
    description: 'Duplicate wire',
    qubitCount: 2,
    seed: 1,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [{ id: 'c0', kind: GateKind.CNOT, targets: [0, 0] }],
  });
  assert.equal(cloneCheck.ok, false);
  if (!cloneCheck.ok) {
    assert.equal(cloneCheck.error.kind, QuantumIsaErrorKind.DuplicateWireReference);
  }

  // Zero classical qubit ceiling: 1,024-qubit circuit compiles cleanly!
  const megascaleCheck = verifyAndCompileCircuitPrism({
    name: 'megascale-1024',
    description: '1024-qubit GHZ head/tail',
    qubitCount: 1024,
    seed: 1,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 'h0', kind: GateKind.H, targets: [0] },
      { id: 'cx-last', kind: GateKind.CNOT, targets: [0, 1023] },
      { id: 't-last', kind: GateKind.T, targets: [1023] },
    ],
  });
  assert.equal(megascaleCheck.ok, true);

  const cycleCheck = verifyAndCompileCircuitPrism({
    name: 'cycle-test',
    description: 'Cyclic barrier',
    qubitCount: 2,
    seed: 1,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 'g0', kind: GateKind.H, targets: [0], dependsOn: ['g1'] },
      { id: 'g1', kind: GateKind.X, targets: [1], dependsOn: ['g0'] },
    ],
  });
  assert.equal(cycleCheck.ok, false);
  if (!cycleCheck.ok) {
    assert.equal(cycleCheck.error.kind, QuantumIsaErrorKind.CyclicCircuitDag);
  }
});

test('AQ-04: Unbounded Sparse Z[zeta_8] identities, 1,024-qubit GHZ+T cat state, and k14 norm conservation', () => {
  const z1 = z8MulZeta(Z8_ONE);
  const z2 = z8MulZeta(z1);
  const z3 = z8MulZeta(z2);
  const z4 = z8MulZeta(z3);
  assert.deepEqual(z4, { a: -1n, b: 0n, c: 0n, d: 0n });

  const s1 = z8MulSqrt2(Z8_ONE);
  const s2 = z8MulSqrt2(s1);
  assert.deepEqual(s2, { a: 2n, b: 0n, c: 0n, d: 0n });
  assert.deepEqual(z8Mul(s1, s1), z8Add(Z8_ONE, Z8_ONE));
  assert.deepEqual(z8Sub(z1, z3), s1);

  // 3-qubit Clifford+T + non-dyadic Born collapse
  let state = createInitialCyclotomicState(3);
  const steps = [
    { id: '0', kind: GateKind.H, targets: [0] },
    { id: '1', kind: GateKind.T, targets: [0] },
    { id: '2', kind: GateKind.H, targets: [0] },
    { id: '3', kind: GateKind.CNOT, targets: [0, 1] },
    { id: '4', kind: GateKind.CZ, targets: [1, 2] },
    { id: '5', kind: GateKind.Y, targets: [2] },
    { id: '6', kind: GateKind.S, targets: [1] },
  ];
  for (const step of steps) {
    state = stepCyclotomicGate(state, step, 0.25).nextState;
    assert.equal(inspectCyclotomicState(state).conservation.normExactOne, true);
  }

  const collapsed = stepCyclotomicGate(
    state,
    { id: 'm0', kind: GateKind.MEASURE, targets: [0], branchMode: 'force0' },
    0.1,
  );
  assert.ok(Math.abs((collapsed.measurementOutcome?.probZero ?? 0) - 0.85355339) < 1e-6);

  // 1,024-qubit Sparse Z[zeta_8] GHZ + T cat state (zero dense 2^1024 allocation!)
  let cat1024 = createInitialCyclotomicState(1024);
  cat1024 = stepCyclotomicGate(cat1024, { id: 'h0', kind: GateKind.H, targets: [0] }, 0.5).nextState;
  for (let i = 0; i < 1023; i += 1) {
    cat1024 = stepCyclotomicGate(
      cat1024,
      { id: `cx-${i}`, kind: GateKind.CNOT, targets: [i, i + 1] },
      0.5,
    ).nextState;
  }
  cat1024 = stepCyclotomicGate(
    cat1024,
    { id: 't1023', kind: GateKind.T, targets: [1023] },
    0.5,
  ).nextState;
  assert.equal(cat1024.support.size, 2);
  const catReport = inspectCyclotomicState(cat1024);
  assert.equal(catReport.conservation.normExactOne, true);
  assert.equal(catReport.blochVectors[0].purity, 0.5);
  assert.equal(catReport.blochVectors[1023].purity, 0.5);
});

test('AQ-12: Exact Q(zeta_8) Galois-norm RREF Matrix Product State (ExactMps) on 64 non-Clifford qubits', () => {
  // Compare 4-qubit non-Clifford circuit Bloch observables between CyclotomicExact and ExactMps
  const testSteps = [
    { id: 's0', kind: GateKind.H, targets: [0] },
    { id: 's1', kind: GateKind.T, targets: [0] },
    { id: 's2', kind: GateKind.CNOT, targets: [0, 1] },
    { id: 's3', kind: GateKind.H, targets: [1] },
    { id: 's4', kind: GateKind.CZ, targets: [1, 2] },
    { id: 's5', kind: GateKind.T, targets: [2] },
    { id: 's6', kind: GateKind.CNOT, targets: [2, 3] },
  ];
  let cyc = createInitialCyclotomicState(4);
  let mps = createInitialExactMps(4);
  for (const st of testSteps) {
    cyc = stepCyclotomicGate(cyc, st, 0.3).nextState;
    mps = stepExactMpsGate(mps, st, 0.3).nextState;
  }
  const cycObs = inspectCyclotomicState(cyc).blochVectors;
  const mpsObs = inspectExactMpsState(mps).blochVectors;
  for (let q = 0; q < 4; q += 1) {
    assert.ok(Math.abs(cycObs[q].rx - mpsObs[q].rx) < 1e-9);
    assert.ok(Math.abs(cycObs[q].ry - mpsObs[q].ry) < 1e-9);
    assert.ok(Math.abs(cycObs[q].rz - mpsObs[q].rz) < 1e-9);
  }

  // 64-qubit non-Clifford cascade in ExactMps with bounded Schmidt bond rank
  let mps64 = createInitialExactMps(64);
  for (let i = 0; i < 64; i += 4) {
    mps64 = stepExactMpsGate(mps64, { id: `h-${i}`, kind: GateKind.H, targets: [i] }, 0.5).nextState;
    mps64 = stepExactMpsGate(mps64, { id: `t-${i}`, kind: GateKind.T, targets: [i] }, 0.5).nextState;
    mps64 = stepExactMpsGate(
      mps64,
      { id: `cx-${i}`, kind: GateKind.CNOT, targets: [i, i + 1] },
      0.5,
    ).nextState;
  }
  const bonds = getMpsBondDimensions(mps64);
  assert.equal(Math.max(...bonds), 2);
});

test('AQ-05 & AQ-06: 256-qubit BigUint64Array Tableau and parametric d=3,5,7 Surface-Code Tropical QEC', () => {
  // 256-qubit Clifford ring in word-packed F_2 tableau
  let tab256 = createInitialTableau(256);
  for (let i = 0; i < 256; i += 1) {
    tab256 = stepStabilizerTableau(tab256, { id: `h-${i}`, kind: GateKind.H, targets: [i] }, 0.5)
      .nextTableau;
  }
  for (let i = 0; i < 256; i += 1) {
    tab256 = stepStabilizerTableau(
      tab256,
      { id: `cz-${i}`, kind: GateKind.CZ, targets: [i, (i + 1) % 256] },
      0.5,
    ).nextTableau;
  }
  assert.equal(tab256.wordsPerRow, 4);
  assert.equal(verifyStabilizersCommute(tab256).commutes, true);

  // T-gate refused in StabilizerTableau mode
  const tRefused = verifyAndCompileCircuitPrism({
    name: 't-tab',
    description: 'Refuse T in tableau',
    qubitCount: 2,
    seed: 1,
    backend: AqmBackendMode.StabilizerTableau,
    steps: [{ id: 't', kind: GateKind.T, targets: [0] }],
  });
  assert.equal(tRefused.ok, false);
  if (!tRefused.ok) {
    assert.equal(tRefused.error.kind, StabilizerErrorKind.NonCliffordInTableauMode);
  }

  // Parametric rotated surface-code commutativity for odd distances d = 3, 5, 7, 9
  for (const d of [3, 5, 7, 9]) {
    assert.equal(verifySurfaceCodeCommutativity(d), true);
  }
  assert.equal(verifySurfaceCodeCommutativity(4), false);

  // d=3 corrects all 27 single-qubit X, Y, Z faults
  const paulis: PauliFault[] = ['X', 'Y', 'Z'];
  for (let q = 0; q < 9; q += 1) {
    for (const p of paulis) {
      const faults: PauliFault[] = new Array(9).fill('I');
      faults[q] = p;
      const decoded = decodeSurfaceCodeTropical(faults, 3);
      assert.equal(decoded.postDecodeExcitedIds.length, 0);
      assert.equal(decoded.logicalPreserved, true);
    }
  }

  // d=5 [[25, 1, 5]] corrects weight-2 faults!
  const faultsD5: PauliFault[] = new Array(25).fill('I');
  faultsD5[6] = 'X';
  faultsD5[18] = 'Z';
  const decodedD5 = decodeSurfaceCodeTropical(faultsD5, 5);
  assert.equal(decodedD5.postDecodeExcitedIds.length, 0);
  assert.equal(decodedD5.logicalPreserved, true);
});

test('AQ-11: uor-matmul zero-decode kernels (Grid<16>, Packed<Grid<16>,2>, Runs<Grid<16>,16>) & uorc gate', () => {
  const codebook: bigint[] = [
    -8n, -6n, -5n, -4n, -3n, -2n, -1n, 0n, 1n, 2n, 3n, 4n, 5n, 6n, 8n, 12n,
  ];
  const grid = contractGridCodebook({
    m: 2,
    k: 4,
    n: 2,
    codebook,
    lhsIndices: new Uint8Array([15, 8, 7, 0, 14, 13, 2, 1]),
    rhsIndices: new Uint8Array([15, 0, 8, 14, 7, 7, 1, 15]),
  });
  assert.equal(grid.denseFloatAllocs, 0);
  assert.equal(grid.out[0], 12n * 12n + 1n * 1n + 0n * 0n + (-8n) * (-6n));

  const packed = contractPackedNibbles({
    m: 1,
    k: 4,
    n: 1,
    codebook,
    lhsPackedRows: [packGrid16Nibbles([15, 8, 7, 0])],
    rhsPackedCols: [packGrid16Nibbles([15, 8, 7, 1])],
  });
  assert.equal(packed.out[0], 12n * 12n + 1n * 1n + 0n * 0n + (-8n) * (-6n));

  const runs = contractSparseRuns({
    m: 16,
    codebook,
    lhsRows: Array.from({ length: 16 }, (_, r) => [{ col: r, codeIdx: 15 }]),
    ketSupport: new Map([[3, 14]]),
  });
  assert.equal(runs.outSupport.get(3), 12n * 8n);
  assert.equal(runs.activeTermsVisited, 1);

  assert.equal(
    decideMatmulCodedAdmission({
      accumBits: 64,
      requiredAccumBits: 96,
      intermediateFloatDecode: false,
      exactChecksumMatches: true,
    }).admitted,
    false,
  );

  const sample = new Uint8Array([1, 2, 3, 4]);
  assert.equal(
    decideUorcAdmission({
      originalBytes: sample,
      reconstructedBytes: sample,
      orderPreserved: true,
      incumbentBytes: 128,
      challengerBytes: 96,
    }).admitted,
    true,
  );
});

test('AQ-13, AQ-14 & AQ-16: UOR Atlas MTC axioms, OpenQASM SkWeaver synthesis, and Row-Honesty gate', () => {
  const gen96 = buildAtlasGenerators(CANONICAL_ATLAS_PARAMS);
  assert.equal(gen96.ok, true);
  if (gen96.ok) {
    assert.equal(gen96.summary.nClasses, 96);
    assert.equal(gen96.summary.carrierBytes, 768);
    assert.equal(gen96.summary.sigmaOrder, 4);
    assert.equal(gen96.summary.tauOrder, 8);
    assert.equal(gen96.summary.muOrder, 2);
  }

  const mtc96 = verifyAtlasMtcAxioms(CANONICAL_ATLAS_PARAMS);
  assert.ok(mtc96.maxResidual < 1e-12);
  assert.equal(mtc96.centralChargeMod8, 5);

  const mtc30 = verifyAtlasMtcAxioms(PARAMETRIC_CHECK_ATLAS_PARAMS);
  assert.ok(mtc30.maxResidual < 1e-12);

  // OpenQASM 2.0 SkWeaver synthesis on Certified22 (rz, rx, ry) vs refusal on Clifford
  const qasm = `OPENQASM 2.0; qreg q[3]; h q[0]; rz(pi/5) q[0]; rx(pi/7) q[1]; ry(pi/3) q[2]; cx q[0], q[1];`;
  const woven = weaveOpenQasmWithSkWeaver(qasm, 'Certified22', 0.02);
  assert.equal(woven.ok, true);
  if (woven.ok) {
    assert.ok(woven.maxProjectiveResidual < 0.02, `Expected < 0.02, got ${woven.maxProjectiveResidual}`);
    assert.equal(woven.segments.length, 5);
  }
  const cliffRefused = weaveOpenQasmWithSkWeaver(qasm, 'Clifford', 0.02);
  assert.equal(cliffRefused.ok, false);
  if (!cliffRefused.ok) {
    assert.equal(cliffRefused.error.kind, AtlasBraidErrorKind.NonDiscreteAngleOnCliffordCarrier);
  }

  // 2,048-qubit Atlas periodic braid with BLAKE3 kappa elision
  let atl = createInitialAtlasState(2048);
  const kCache = new Set<string>();
  for (let s = 0; s < 32; s += 1) {
    atl = stepAtlasHolospace(atl, { id: `s-${s}`, kind: GateKind.T, targets: [s] }, kCache).nextState;
  }
  assert.ok(atl.elidedStepHits >= 24); // order(tau) == 8 -> repeats after 8 steps!

  // UTQC Row-Honesty gate refuses promoting empirical benchmark to some-true
  const dishonest = decideUtqcRowHonesty({
    claimedTier: 'some-true',
    hasCitationAnchor: true,
    isEmpiricalBenchmarkOnly: true,
    hasPlantedDefectRefusal: true,
  });
  assert.equal(dishonest.ok, false);
  if (!dishonest.ok) {
    assert.equal(dishonest.error.kind, HonestyVerdictErrorKind.RefuseBenchMarkedAsProof);
  }
});

test('AQ-07, AQ-08, AQ-09, AQ-10 & AQ-15: Rollback, Stitch parity, and REAL wasm32 Hologram v4 guest', async () => {
  const session = executeCircuitRollbackSession({
    name: 'Bell Rollback',
    description: 'Bell collapse test',
    qubitCount: 2,
    seed: 42,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 's0', kind: GateKind.H, targets: [0] },
      { id: 's1', kind: GateKind.CNOT, targets: [0, 1] },
      { id: 's2', kind: GateKind.MEASURE, targets: [0], branchMode: 'force1' },
    ],
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;

  const token = encodeVdntSnapshotToken({ spec: session.spec, cursor: 3 });
  assert.equal(decodeVdntSnapshotToken(`#vdnt=${token}`).ok, true);

  const uorcFrames = packProgressiveUorcStream(session.spec, session.frames[3]);
  const bundle = createStitchParityBundle(uorcFrames[4].rawBytes, 'prism/identity/4:test', 'beef');
  assert.equal(reconstructFromStitchShards(bundle, [false, true, true]).integrityVerified, true);

  assert.equal(routePromptWithCodedSlm('clone q0 onto q0').admitted, false);
  assert.equal(runAllAcceptanceVectors().passed, 36);
  assert.equal(PLANTED_DEFECT_CATALOG.length, 13);
  for (const defect of PLANTED_DEFECT_CATALOG) {
    assert.equal(defect.run().gateTriggered, true);
  }

  // Build, parse, BLAKE3-verify, WebAssembly.compile, and execute REAL zero-import wasm32 VerdantAqm.holo v4 guest!
  const holo = buildVerdantAqmHoloArchive();
  const verified = await parseAndVerifyHoloV4Archive(holo.archiveBytes);
  assert.equal(verified.valid, true);
  assert.equal(verified.version, 4);
  assert.equal(verified.manifestLength, 356);
  assert.equal(verified.zeroImportsVerified, true);
  assert.equal(verified.exportedSymbols.length, 6);

  const guest = await instantiateHoloCoreWasmGuest(verified.wasmBytes);
  for (const vec of CORE_WASM_ACCEPTANCE_VECTORS) {
    const out = runHoloCoreWasmGuest(guest, vec.request);
    assert.equal(out, vec.expectedResponse, `Wasm guest mismatch on '${vec.request}'`);
  }
  assert.equal(runHoloCoreWasmGuest(guest, new Uint8Array(65)), 'invalid request');

  // Software 16x16 tile rasterizer on d=5 surface code
  const tris = buildSoftwareQuantumSceneTriangles({
    sceneMode: 'surface-code',
    blochVectors: [],
    entanglementEdges: [],
    surfaceFaults: new Array<PauliFault>(25).fill('I'),
    lod: 3,
  });
  const raster = rasterizeQuantumSceneTiles({
    width: 320,
    height: 192,
    yawRad: 0.4,
    pitchRad: 0.3,
    distance: 6.5,
    triangles: tris,
    showTileGrid: true,
  });
  assert.equal(raster.telemetry.tileEdgePx, TILE_EDGE_PX);
  assert.ok(raster.telemetry.activeTiles > 0);
});

test('AQ-17 & AQ-18: Prism Monoid Gate-Fusion, Zero-Import wasm32 Compute Kernels, and 16,384q Extreme Scale', () => {
  // 1. AQ-17 Prism Monoid Gate-Fusion & Involution Cancellation + Unitary Equivalence
  const unoptimizedSpec = {
    name: 'Unfused Clifford+T',
    description: 'Contains commuting diagonal pushes, Z_8 octant wrap, and H^2 involution',
    qubitCount: 2,
    seed: 7,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 'u0', kind: GateKind.H, targets: [0] },
      { id: 'u1', kind: GateKind.CNOT, targets: [0, 1] },
      { id: 'u2', kind: GateKind.T, targets: [0] },
      { id: 'u3', kind: GateKind.CZ, targets: [0, 1] },
      { id: 'u4', kind: GateKind.T, targets: [0] },
      { id: 'u5', kind: GateKind.S, targets: [0] },
      { id: 'u6', kind: GateKind.Z, targets: [0] },
      { id: 'u7', kind: GateKind.H, targets: [1] },
      { id: 'u8', kind: GateKind.H, targets: [1] },
    ],
  };
  const fused = optimizeCircuitPrismMonoid(unoptimizedSpec);
  assert.equal(fused.ok, true);
  if (!fused.ok) return;
  assert.equal(fused.gatesEliminated, 6);
  assert.equal(fused.fusedGateCount, 3);

  const rawState = executeCyclotomicBatch(2, unoptimizedSpec.steps);
  const fusedState = executeCyclotomicBatch(2, fused.optimizedSpec.steps);
  assert.deepEqual(rawState.normDenom, fusedState.normDenom);
  assert.deepEqual(Array.from(rawState.support.entries()), Array.from(fusedState.support.entries()));

  // Illegal commutation guard: T(q1) across CNOT(q0, q1) target is refused!
  const illegalSwap = verifyGateCommutationLegal(
    { id: 't1', kind: GateKind.T, targets: [1] },
    { id: 'cx01', kind: GateKind.CNOT, targets: [0, 1] },
  );
  assert.equal(illegalSwap.ok, false);

  // 2. AQ-18 Zero-Import wasm32 Compute Kernels (Symplectic i64.popcnt, Packed4 GEMV, Tropical k7 d=11)
  const x1 = new BigUint64Array([0b1011n, 0n]);
  const z1 = new BigUint64Array([0b0100n, 0n]);
  const x2 = new BigUint64Array([0b0100n, 0n]);
  const z2 = new BigUint64Array([0b0001n, 0n]);
  // Inner product: popcnt((1011 & 0001) ^ (0100 & 0100)) = popcnt(0001 ^ 0100) = 2 (even -> commutes!)
  assert.equal(runWasmSymplecticCommute(x1, z1, x2, z2), true);
  // Flip bit 1 in z2 so anti-commuting overlap is 3 (odd -> anti-commutes!)
  assert.equal(runWasmSymplecticCommute(x1, z1, x2, new BigUint64Array([0b0011n, 0n])), false);

  const grid16 = new Int32Array([-8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8, 12]);
  const act = new Int32Array([12, 1, 0, -6]);
  const nibs = packGrid16Nibbles([15, 8, 7, 0]);
  const wasmGemv = runWasmPacked4Gemv(act, nibs, grid16, 1, 2);
  assert.equal(wasmGemv.out[0], 193n);
  assert.equal(wasmGemv.codedOps, 4);

  // d=11 [[121, 1, 11]] Surface Code commutativity + weight-5 fault correction via Wasm Tropical (min, +)
  assert.equal(verifySurfaceCodeCommutativity(11), true);
  const faultsD11: PauliFault[] = new Array(121).fill('I');
  faultsD11[13] = 'X';
  faultsD11[37] = 'Z';
  faultsD11[60] = 'Y';
  faultsD11[84] = 'X';
  faultsD11[107] = 'Z';
  const decodedD11 = decodeSurfaceCodeTropical(faultsD11, 11);
  assert.equal(decodedD11.wasmAccelerated, true);
  assert.equal(decodedD11.postDecodeExcitedIds.length, 0);
  assert.equal(decodedD11.logicalPreserved, true);

  // 3. Bit-for-bit parity of ColumnBitPlaneTableau vs row-packed SymplecticTableau + 2,048q batch
  const cliffSteps = [
    { id: 'c0', kind: GateKind.H, targets: [0] },
    { id: 'c1', kind: GateKind.S, targets: [0] },
    { id: 'c2', kind: GateKind.CNOT, targets: [0, 33] },
    { id: 'c3', kind: GateKind.CZ, targets: [33, 63] },
    { id: 'c4', kind: GateKind.Y, targets: [63] },
    { id: 'c5', kind: GateKind.SWAP, targets: [0, 63] },
  ];
  let refTab = createInitialTableau(64);
  for (const st of cliffSteps) {
    refTab = stepStabilizerTableau(refTab, st, 0.5).nextTableau;
  }
  const planeTab = columnPlanesToSymplecticTableau(executeStabilizerBatch(64, cliffSteps));
  assert.deepEqual(planeTab.xWords, refTab.xWords);
  assert.deepEqual(planeTab.zWords, refTab.zWords);
  assert.deepEqual(planeTab.r, refTab.r);

  const bigCliffSteps = [];
  for (let i = 0; i < 2048; i += 1) {
    bigCliffSteps.push({ id: `bh-${i}`, kind: GateKind.H, targets: [i] });
    bigCliffSteps.push({ id: `bcx-${i}`, kind: GateKind.CNOT, targets: [i, (i + 1) % 2048] });
  }
  const tab2048 = executeStabilizerBatch(2048, bigCliffSteps);
  assert.equal(tab2048.n, 2048);
  assert.equal(tab2048.planesPerCol, 128);

  // 4. 4,096-qubit Sparse Z[zeta_8] GHZ+T Cat State batch with exact k14 norm = 1
  const cat4096Steps = [{ id: 'gh0', kind: GateKind.H, targets: [0] }];
  for (let i = 0; i < 4095; i += 1) {
    cat4096Steps.push({ id: `gcx-${i}`, kind: GateKind.CNOT, targets: [i, i + 1] });
  }
  cat4096Steps.push({ id: 'gt-last', kind: GateKind.T, targets: [4095] });
  const cat4096 = executeCyclotomicBatch(4096, cat4096Steps);
  assert.equal(cat4096.support.size, 2);
  const norm4096 = computeExactTotalNormSqSparse(cat4096.support);
  assert.deepEqual(norm4096, cat4096.normDenom);

  // 5. 16,384-qubit UOR Atlas Holospace batch + CF+Solovay-Kitaev SkWeaver epsilon = 0.0001
  const atlasSteps = [];
  for (let i = 0; i < 2048; i += 1) {
    atlasSteps.push({ id: `at-${i}`, kind: GateKind.T, targets: [(i * 7) % 16384] });
  }
  const atlas16k = executeAtlasHolospaceBatch(16384, atlasSteps);
  assert.equal(atlas16k.qubitCount, 16384);
  assert.ok(atlas16k.elidedStepHits >= 2040);
  assert.equal(inspectAtlasState(atlas16k).conservation.normExactOne, true);

  const qasmSk = `OPENQASM 2.0; qreg q[3]; rz(pi/5) q[0]; rx(pi/7) q[1]; ry(pi/11) q[2];`;
  const wovenSk = weaveOpenQasmWithSkWeaver(qasmSk, 'Certified22', 0.0001);
  assert.equal(wovenSk.ok, true);
  if (wovenSk.ok) {
    assert.ok(
      wovenSk.maxProjectiveResidual < 1e-4,
      `Expected CF+SK residual < 1e-4, got ${wovenSk.maxProjectiveResidual}`,
    );
  }
});

test('GitHub Pages publishing pipeline: pages.yml, site/app.json, input-kappa cache, precache.json & weight-gate', async () => {
  // 1. Deterministic prism/input-kappa/1 BLAKE3 digest across app, model, crates, src/aqm
  const k1 = computeInputKappa(['app', 'model', 'crates', 'src/aqm']);
  const k2 = computeInputKappa(['app', 'model', 'crates', 'src/aqm']);
  assert.equal(k1.kappa, k2.kappa);
  assert.ok(k1.kappa.startsWith('blake3:'));
  assert.equal(k1.kappa.length, 71);
  assert.ok(k1.files >= 20);

  // 2. Verify .github/workflows/pages.yml pins commit SHAs & SLSA attestation + deploy-pages
  const pagesYml = readFileSync('.github/workflows/pages.yml', 'utf8');
  assert.ok(pagesYml.includes('actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8'));
  assert.ok(pagesYml.includes('actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d'));
  assert.ok(pagesYml.includes('actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9'));
  assert.ok(pagesYml.includes('actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346'));

  // 3. Assemble complete GitHub Pages bundle in an isolated temp directory, build precache.json, and pass weight-gate
  const scratchDir = mkdtempSync(join(tmpdir(), 'verdant-aqm-pages-'));
  try {
    writeFileSync(
      join(scratchDir, 'index.html'),
      '<!doctype html><html lang="en"><head><link rel="stylesheet" href="./assets/app.css"></head><body><script type="module" src="./assets/index.js"></script></body></html>',
    );
    copyFileSync('public/sw.js', join(scratchDir, 'sw.js'));
    copyFileSync('public/favicon.svg', join(scratchDir, 'favicon.svg'));

    const assembled = await assemblePagesSite(scratchDir);
    assert.ok(assembled.holoBytes > 3000);
    assert.equal(assembled.archiveFingerprint.length, 64);

    const precache = buildPrecacheManifest(scratchDir);
    assert.equal(precache.version.length, 16);
    assert.ok(precache.files.some((f) => f.path === './app.holo' && f.eager === true));
    assert.ok(precache.files.some((f) => f.path === './manifest.webmanifest' && f.eager === true));

    const gate = await verifyAssembledPagesSite(scratchDir);
    assert.equal(gate.valid, true);
    assert.equal(gate.vectorsPassed, 36);
    assert.equal(gate.ratchetVerified, true);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

test('AQ-19, AQ-20 & AQ-21: Production Qiskit BackendV2, Primitives V2, Upstream Oracle & prism-devrel Notebooks', () => {
  // 1. Verify exact SHA-256 provenance of all 7 vendored Qiskit & prism-devrel files from disk
  const rawPayloads: Record<string, Uint8Array> = {};
  for (const entry of LOCKED_UPSTREAM_ORACLE_FILES) {
    rawPayloads[entry.fileName] = new Uint8Array(
      readFileSync(join('vendor/qiskit-oracle', entry.fileName)),
    );
  }

  // Verify PRISM_DEVREL_BANNED_FILLER and PRISM_DEVREL_VAGUE_LINKS match vendored standard.json byte-for-byte
  const vendoredStandard = JSON.parse(
    readFileSync('vendor/qiskit-oracle/standard.json', 'utf8'),
  ) as { fillers: string[]; vagueLinks: string[] };
  assert.deepEqual(PRISM_DEVREL_BANNED_FILLER, vendoredStandard.fillers);
  assert.deepEqual(PRISM_DEVREL_VAGUE_LINKS, vendoredStandard.vagueLinks);

  // 2. Run all 16 authoritative Qiskit BackendV2, BasicSimulator, SamplerV2, and EstimatorV2 oracle cases
  const oracleReport = runAuthoritativeQiskitOracleSuite(rawPayloads);
  assert.equal(oracleReport.allProvenanceVerified, true);
  assert.equal(oracleReport.totalCount, 16);
  for (const c of oracleReport.cases) {
    assert.equal(c.passed, true, `Oracle case ${c.id} (${c.upstreamTestName}) failed: ${c.detail}`);
  }
  assert.equal(oracleReport.allPassed, true);

  // 3. Audit Diataxis Markdown guides & generate deterministic nbformat v4.5 Jupyter notebooks
  const guideMap: Record<string, string> = {};
  for (const g of DIATAXIS_GUIDE_META) {
    guideMap[g.path] = readFileSync(g.path, 'utf8');
  }
  const devrelAudit = runDevRelContentAndPublishGateAudit(guideMap, rawPayloads);
  assert.equal(devrelAudit.fillerViolations.length, 0);
  assert.equal(devrelAudit.vagueLinkViolations.length, 0);
  assert.equal(devrelAudit.uncoveredCapabilities.length, 0);
  assert.equal(devrelAudit.coveredCapabilities.length, 23);
  assert.equal(devrelAudit.unverifiedNotebooks, 0);
  assert.equal(devrelAudit.gateVerdict, 'publish');
  assert.equal(devrelAudit.gateOk, true);

  // Verify devrel-publish-gate decision totality (publish vs regenerate vs refuse)
  assert.equal(
    evaluateDevRelPublishGatePrism({
      uncoveredRecords: 0,
      undeclaredCovers: 0,
      unverifiedNotebooks: 0,
      pinIsCurrent: false,
    }).outcome,
    'regenerate',
  );
  assert.equal(
    evaluateDevRelPublishGatePrism({
      uncoveredRecords: 1,
      undeclaredCovers: 0,
      unverifiedNotebooks: 0,
      pinIsCurrent: true,
    }).outcome,
    'refuse',
  );

  // Emit /notebooks/*.ipynb and verify valid nbformat v4.5 JSON schema on disk
  const nbResult = generateAllJupyterNotebooks('notebooks');
  assert.equal(nbResult.writtenFiles.length, CANONICAL_NOTEBOOK_SPECS.length);
  for (const nbPath of nbResult.writtenFiles) {
    const parsed = JSON.parse(readFileSync(nbPath, 'utf8')) as {
      nbformat: number;
      nbformat_minor: number;
      cells: Array<{ cell_type: string; outputs?: Array<{ output_type: string }> }>;
    };
    assert.equal(parsed.nbformat, 4);
    assert.equal(parsed.nbformat_minor, 5);
    const codeCells = parsed.cells.filter((c) => c.cell_type === 'code');
    assert.ok(codeCells.length >= 2);
    for (const cc of codeCells) {
      assert.ok(cc.outputs && cc.outputs.some((o) => o.output_type === 'execute_result'));
    }
  }
});

test('AQ-22 & AQ-23: Pure UORC post-boot wire, CDMX zero-decode, Qiskit Result UORC parity & prism/parametric-ratchet/1', async () => {
  const {
    compressUorcPortable,
    contractCodedMatrixUorcBundle,
    decodeSnapshotUrlHash,
    decompressUorcPortable,
    isUorcArchive,
    packCodedMatrixToUorc,
    readUorcFromOpfsCache,
    runUorcExclusiveRuntimeAudit,
    verifyUorcTransportBoundary,
    writeUorcToOpfsCache,
  } = await import('./uorc');
  const { verifyParametricRatchetPlantedDefects } = await import('./ratchet');
  const {
    QuantumCircuitBuilder,
    VerdantAqmBackend,
    VerdantAqmResult,
  } = await import('./qiskitBackend');

  // 1. Pure UORC portable codec round-trip (both stored short & OrderRope LZ77/RLE long) + 1-bit tamper refusal
  const shortRaw = new TextEncoder().encode('aqm-short');
  const shortUorc = compressUorcPortable(shortRaw);
  assert.equal(isUorcArchive(shortUorc), true);
  const shortOpen = decompressUorcPortable(shortUorc);
  assert.equal(shortOpen.ok, true);
  if (shortOpen.ok) {
    assert.deepEqual(shortOpen.payload, shortRaw);
  }

  const repeatedRaw = new TextEncoder().encode('verdant-aqm-uorc-frame-'.repeat(64));
  const repeatedUorc = compressUorcPortable(repeatedRaw);
  assert.equal(isUorcArchive(repeatedUorc), true);
  assert.ok(repeatedUorc.byteLength < repeatedRaw.byteLength);
  const repeatedOpen = decompressUorcPortable(repeatedUorc);
  assert.equal(repeatedOpen.ok, true);
  if (repeatedOpen.ok) {
    assert.equal(repeatedOpen.strategy, 1);
    assert.deepEqual(repeatedOpen.payload, repeatedRaw);
  }

  const tampered = new Uint8Array(repeatedUorc);
  tampered[tampered.byteLength - 1] ^= 1;
  assert.equal(decompressUorcPortable(tampered).ok, false);

  // 2. Post-boot boundary enforcement (`none`) + all 3 modeled exemptions
  assert.equal(verifyUorcTransportBoundary('none', shortRaw).ok, false);
  assert.equal(verifyUorcTransportBoundary('none', shortUorc).ok, true);
  assert.equal(verifyUorcTransportBoundary('cold-boot-http-holo', shortRaw).ok, true);
  assert.equal(verifyUorcTransportBoundary('core-wasm-verifier-64b', shortRaw).ok, true);
  assert.equal(
    verifyUorcTransportBoundary('core-wasm-verifier-64b', new Uint8Array(600)).ok,
    false,
  );
  assert.equal(verifyUorcTransportBoundary('host-standard-interop', shortRaw).ok, true);

  // 3. #uorc= snapshot URL + legacy #vdnt= backward compatibility + OPFS .uorc cache
  const spec = {
    name: 'UORC Bell',
    description: 'Pure UORC snapshot test',
    qubitCount: 2,
    seed: 19,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 's0', kind: GateKind.H, targets: [0] },
      { id: 's1', kind: GateKind.CNOT, targets: [0, 1] },
    ],
  };
  const uorcTok = encodeUorcSnapshotToken({ spec, cursor: 2 });
  const decUorc = decodeSnapshotUrlHash(`#uorc=${uorcTok}`);
  assert.equal(decUorc.ok, true);
  if (decUorc.ok) {
    assert.equal(decUorc.scheme, 'uorc');
    assert.equal(decUorc.value.spec.name, 'UORC Bell');
    assert.equal(decUorc.value.cursor, 2);
  }
  const legacyVdnt = encodeVdntSnapshotToken({ spec, cursor: 1 });
  const decLegacy = decodeVdntSnapshotToken(`#vdnt=${legacyVdnt}`);
  assert.equal(decLegacy.ok, true);

  await writeUorcToOpfsCache('unit-test-bell', repeatedUorc);
  const cached = await readUorcFromOpfsCache('unit-test-bell');
  assert.equal(cached.ok, true);
  if (cached.ok) {
    assert.deepEqual(cached.payload, repeatedRaw);
  }

  // 4. Zero-decode CDMX CodedMatrix inside UORC across all 3 tiers (`grid16`, `packed-nibble`, `sparse-runs`)
  const codebook = [0n, 1n, -1n, 2n, -2n, 3n, -3n, 4n, -4n, 5n, -5n, 6n, -6n, 7n, -7n, 8n];
  const lhs = new Uint8Array([1, 3, 0, 2, 5, 0, 7, 4]);
  const rhs = new Uint8Array([3, 1, 0, 2, 1, 5, 4, 0]);
  const tiers = ['grid16', 'packed-nibble', 'sparse-runs'] as const;
  let refOut: readonly bigint[] | null = null;
  for (const tier of tiers) {
    const cdmxArchive = packCodedMatrixToUorc({
      tier,
      m: 2,
      k: 4,
      n: 2,
      codebook,
      lhsIndices: lhs,
      rhsIndices: rhs,
    });
    assert.equal(isUorcArchive(cdmxArchive), true);
    const contracted = contractCodedMatrixUorcBundle(cdmxArchive);
    assert.equal(contracted.ok, true);
    if (contracted.ok) {
      assert.equal(contracted.denseFloatAllocs, 0);
      if (!refOut) refOut = contracted.out;
      else assert.deepEqual(contracted.out, refOut);
    }
  }

  // 5. Qiskit VerdantAqmResult pure-UORC serialization round-trip
  const qc = new QuantumCircuitBuilder(3, 3, 'ghz_uorc').h(0).cx(0, 1).cx(1, 2).measure_all().build();
  const qRes = new VerdantAqmBackend({ shots: 128, seed_simulator: 42, memory: true }).run(qc).result();
  const qUorc = qRes.toUorcBytes();
  assert.equal(isUorcArchive(qUorc), true);
  const qRestored = VerdantAqmResult.fromUorcBytes(qUorc);
  assert.deepEqual(qRestored.get_counts(), qRes.get_counts());
  assert.deepEqual(qRestored.get_memory(), qRes.get_memory());

  const audit = runUorcExclusiveRuntimeAudit(spec, 2, ['d0', 'd1', 'd2']);
  assert.equal(audit.uorcExclusiveActive, true);

  // 6. Permanent zero-constants parametric ratchet (`FI-08` / `prism/parametric-ratchet/1`) on disk + 6 planted violations
  const diskRatchet = auditParametricRatchetOnDisk();
  assert.equal(diskRatchet.ok, true, `Ratchet violations: ${JSON.stringify(diskRatchet.violations)}`);
  assert.equal(diskRatchet.spec, 'prism/parametric-ratchet/1');
  assert.equal(diskRatchet.groundedLexModuleCount, 10);
  assert.ok(diskRatchet.auditedRustFileCount >= 2);
  assert.equal(diskRatchet.counts.ontologyRootLiteralGtOneCount, 0);
  assert.equal(diskRatchet.counts.ontologyRootStringFieldCount, 0);
  assert.equal(diskRatchet.counts.classicalChoiceCount, 0);
  assert.equal(diskRatchet.counts.ungroundedLexModuleCount, 0);
  assert.equal(diskRatchet.counts.domainLexMagicLiteralCount, 0);
  assert.equal(diskRatchet.counts.engineRustMagicLiteralCount, 0);

  const plantedRatchet = verifyParametricRatchetPlantedDefects(loadDiskRatchetWorkspace());
  assert.equal(plantedRatchet.allCaughtAndRestored, true);
  assert.equal(plantedRatchet.casesVerified, 6);
});

test('Zero-limits Prism & Qiskit refinement: 64q 2^64-ket ExactMps, 512q mid-circuit reset, 10,000q Clifford EstimatorV2, k=2000 Hadamard & 600-step rollback', async () => {
  const {
    QuantumCircuitBuilder,
    VerdantAqmBackend,
    VerdantAqmEstimatorV2,
    VerdantAqmSamplerV2,
    executeQiskitNotebookCell,
  } = await import('./qiskitBackend');
  const { executeCircuitRollbackSession } = await import('./journal');

  // 1. Cross-check ExactMps against CyclotomicExact at n=6 on 2^6-ket non-Clifford 1D Cluster+Octant chain
  const buildClusterOctant = (n: number) => {
    const b = new QuantumCircuitBuilder(n, 2, `cluster_octant_${n}q`);
    for (let q = 0; q < n; q += 1) {
      b.h(q).t(q);
    }
    for (let q = 0; q < n - 1; q += 1) {
      b.cz(q, q + 1);
    }
    return b;
  };

  const qc6 = buildClusterOctant(6).build();
  const estMps6 = new VerdantAqmEstimatorV2({
    backend: new VerdantAqmBackend({ substrate: 'ExactMps' }),
    defaultPrecision: 0,
  });
  const estCyc6 = new VerdantAqmEstimatorV2({
    backend: new VerdantAqmBackend({ substrate: 'CyclotomicExact' }),
    defaultPrecision: 0,
  });
  const obs6 = ['IIZXZI', 'IIZYZI', 'ZZZZZZ', 'IIIIZX'];
  const evMps6 = estMps6.run([[qc6, obs6]]).result()[0].data.evs as number[];
  const evCyc6 = estCyc6.run([[qc6, obs6]]).result()[0].data.evs as number[];
  for (let i = 0; i < obs6.length; i += 1) {
    assert.ok(
      Math.abs(evMps6[i] - evCyc6[i]) < 1e-12,
      `6q ExactMps vs CyclotomicExact mismatch on ${obs6[i]}: ${evMps6[i]} vs ${evCyc6[i]}`,
    );
  }

  // 2. 64-qubit 2^64-ket non-Clifford 1D Cluster+Octant chain auto-routes to ExactMps in BackendV2 & EstimatorV2!
  const qc64Unmeasured = buildClusterOctant(64).build();
  const autoEst = new VerdantAqmEstimatorV2({ defaultPrecision: 0 });
  // Qiskit little-endian Pauli: q=31 -> index 63-31=32, q=32 -> index 31, q=33 -> index 30
  const makeBulkPauli64 = (mid: 'X' | 'Y' | 'Z') => {
    const chars = new Array<string>(64).fill('I');
    chars[63 - 31] = 'Z';
    chars[63 - 32] = mid;
    chars[63 - 33] = 'Z';
    return chars.join('');
  };
  const invSqrt2 = Math.SQRT1_2;
  const pub64 = autoEst
    .run([
      [
        qc64Unmeasured,
        [
          makeBulkPauli64('X'),
          makeBulkPauli64('Y'),
          makeBulkPauli64('Z'),
          [
            [makeBulkPauli64('X'), invSqrt2],
            [makeBulkPauli64('Y'), invSqrt2],
          ],
        ],
      ],
    ])
    .result()[0];
  assert.equal(pub64.metadata.substrate, 'ExactMps');
  const ev64 = pub64.data.evs as number[];
  assert.ok(Math.abs(ev64[0] - invSqrt2) < 1e-12);
  assert.ok(Math.abs(ev64[1] - invSqrt2) < 1e-12);
  assert.ok(Math.abs(ev64[2] - 0) < 1e-12);
  assert.ok(Math.abs(ev64[3] - 1.0) < 1e-12);

  const qc64Measured = buildClusterOctant(64).measure([0, 63], [0, 1]).build();
  const res64 = new VerdantAqmBackend({ shots: 512, seed_simulator: 314 }).run(qc64Measured).result();
  assert.equal(res64.results[0].metadata.substrate, 'ExactMps');
  assert.equal(res64.results[0].metadata.norm_exact_one, true);
  const probs64 = res64.results[0].data.probabilities;
  // Endpoints q=0 and q=63 on a 64-site 1D cluster state are maximally mixed -> 0.25 each!
  for (const key of ['00', '01', '10', '11']) {
    assert.ok(Math.abs((probs64[key] ?? 0) - 0.25) < 1e-12, `Expected 0.25 for ${key}, got ${probs64[key]}`);
  }

  // 3. 512-qubit mid-circuit measure + reset + Clifford feedforward runs in polynomial time on StabilizerTableau!
  const mid512 = new QuantumCircuitBuilder(512, 2, 'mid_reset_512q');
  mid512.h(0);
  for (let q = 0; q < 511; q += 1) mid512.cx(q, q + 1);
  mid512.measure(0, 0); // collapses all 512 qubits to |0...0> or |1...1>
  mid512.reset(511); // deterministically resets wire 511 to |0>
  mid512.x(511); // flips wire 511 to deterministic |1>
  mid512.measure(511, 1);
  const resMid512 = new VerdantAqmBackend({ shots: 64, seed_simulator: 77 }).run(mid512).result();
  assert.equal(resMid512.results[0].metadata.substrate, 'StabilizerTableau');
  const countsMid512 = resMid512.get_counts();
  // c[1] (left char) MUST be '1' on every shot, and c[0] (right char) splits ~50/50!
  for (const k of Object.keys(countsMid512)) {
    assert.equal(k[0], '1', `Expected wire 511 after reset+X to be '1', got outcome '${k}'`);
  }
  assert.equal((countsMid512['10'] ?? 0) + (countsMid512['11'] ?? 0), 64);

  // 4. 10,000-qubit Clifford EstimatorV2 exact Heisenberg adjoint expectation + >4,096-char notebook Pauli observable!
  const n10k = 10_000;
  const qc10k = new QuantumCircuitBuilder(n10k, 0, 'ghz_10000q');
  qc10k.h(0);
  for (let q = 0; q < n10k - 1; q += 1) qc10k.cx(q, q + 1);
  qc10k.z(n10k - 1); // flips X^{\otimes n} eigenvalue from +1 to -1!
  const zzEnds10k = `Z${'I'.repeat(n10k - 2)}Z`;
  const allX10k = 'X'.repeat(n10k);
  const pub10k = autoEst.run([[qc10k.build(), [zzEnds10k, allX10k]]]).result()[0];
  assert.equal(pub10k.metadata.substrate, 'StabilizerTableau');
  assert.deepEqual(pub10k.data.evs, [1, -1]);

  // Verify executeQiskitNotebookCell parses >4,096-character Pauli observables with zero regex truncation!
  const nb5000 = executeQiskitNotebookCell(
    [
      'from qiskit import QuantumCircuit',
      'from qiskit_verdant_aqm import VerdantAqmEstimatorV2',
      'qc = QuantumCircuit(5000, name="pauli_5000q")',
      'qc.x(0)',
      'qc.x(4999)',
      'est = VerdantAqmEstimatorV2(precision=0.0)',
      `job = est.run([(qc, ["Z${'I'.repeat(4998)}Z", "Z${'I'.repeat(4999)}"])])`,
    ].join('\n'),
  );
  assert.equal(nb5000.ok, true, nb5000.error);
  assert.deepEqual(
    nb5000.expectations?.map((e) => e.value),
    [1, -1],
  );

  // 5. Deep Hadamard + T (k = 2,000 > 1,075 IEEE-754 float exponent limit) without float underflow!
  const deepHt = new QuantumCircuitBuilder(1, 1, 'deep_ht_2000');
  for (let i = 0; i < 2000; i += 1) {
    deepHt.h(0).t(0);
  }
  deepHt.measure(0, 0);
  const resDeep = new VerdantAqmBackend({
    shots: 256,
    seed_simulator: 11,
    prism_fusion: false,
    substrate: 'CyclotomicExact',
  })
    .run(deepHt)
    .result();
  assert.equal(resDeep.results[0].metadata.norm_exact_one, true);
  const probMassDeep = Object.values(resDeep.results[0].data.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(probMassDeep - 1.0) < 1e-12, `Deep Hadamard probability mass underflowed: ${probMassDeep}`);

  // 6. VerdantAqmSamplerV2 multi-parameter sweep [[0], [Math.PI]]
  const sweepQc = new QuantumCircuitBuilder(1, 1, 'sweep_ry').ry('theta', 0).measure(0, 0).build();
  const sampler = new VerdantAqmSamplerV2({ defaultShots: 50, seed: 123 });
  const sweepRes = sampler.run([[sweepQc, [[0], [Math.PI]], 50]]).result()[0];
  assert.equal(sweepRes.data.meas.num_shots, 100);
  assert.deepEqual(sweepRes.data.meas.get_counts(), { '0': 50, '1': 50 });

  // 7. Unbounded 600-step rollback journal (zero 256-step silent truncation!)
  const steps600 = Array.from({ length: 600 }, (_, idx) => ({
    id: `s-${idx}`,
    kind: idx % 2 === 0 ? GateKind.H : GateKind.T,
    targets: [idx % 2],
  }));
  const session600 = await executeCircuitRollbackSession({
    name: 'Journal 600 Steps',
    description: 'Unbounded rollback session verification',
    qubitCount: 2,
    seed: 9,
    backend: AqmBackendMode.CyclotomicExact,
    steps: steps600,
  });
  assert.equal(session600.ok, true);
  if (session600.ok) {
    assert.equal(session600.frames.length, 601);
    assert.equal(session600.journal.length, 600);
  }
});




