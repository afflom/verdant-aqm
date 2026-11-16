/**
 * Verdant AQM — Fast-Feedback Conformance & Unit Test Suite (`AQ-01` .. `AQ-10`)
 * Run via: npx --yes tsx --test src/aqm/aqm.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Z8_ONE,
  createInitialCyclotomicState,
  inspectCyclotomicState,
  stepCyclotomicGate,
  z8Add,
  z8Mul,
  z8MulSqrt2,
  z8MulZeta,
  z8Sub,
} from './cyclotomic';
import {
  createStitchParityBundle,
  decodeVdntSnapshotToken,
  encodeVdntSnapshotToken,
  executeCircuitRollbackSession,
  packProgressiveUorcStream,
  reconstructFromStitchShards,
} from './journal';
import {
  PLANTED_DEFECT_CATALOG,
  dispatchCoreWasmQuery,
  runAllAcceptanceVectors,
  verifyAndCompileCircuitPrism,
} from './prismKernel';
import { sha256Hex } from './sha256';
import { routePromptWithCodedSlm } from './slm';
import {
  PauliFault,
  createInitialTableau,
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
  GateKind,
  QuantumIsaErrorKind,
  StabilizerErrorKind,
} from './types';

test('AQ-01: Stratum 0 constructive powers, primes, BoundedBuffer, and FIPS SHA-256 vector', () => {
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
});

test('AQ-02 & AQ-03: Wire linearity no-cloning guard and Kahn acyclic DAG scheduler', () => {
  // Duplicate-wire CNOT(q0, q0) refused
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

  // Mutual barrier cycle refused
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

test('AQ-04: Exact cyclotomic Z[zeta_8] identities and Clifford+T norm conservation (k14)', () => {
  // zeta_8^4 == -1
  const z1 = z8MulZeta(Z8_ONE);
  const z2 = z8MulZeta(z1);
  const z3 = z8MulZeta(z2);
  const z4 = z8MulZeta(z3);
  assert.deepEqual(z4, { a: -1n, b: 0n, c: 0n, d: 0n });

  // (sqrt(2))^2 == 2
  const s1 = z8MulSqrt2(Z8_ONE);
  const s2 = z8MulSqrt2(s1);
  assert.deepEqual(s2, { a: 2n, b: 0n, c: 0n, d: 0n });
  assert.deepEqual(z8Mul(s1, s1), z8Add(Z8_ONE, Z8_ONE));
  assert.deepEqual(z8Sub(z1, z3), s1);

  // Execute H -> T -> H -> CNOT -> CZ -> Y -> S and verify exact norm conservation at every step
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
    const report = inspectCyclotomicState(state);
    assert.equal(report.conservation.normExactOne, true);
  }

  // Non-dyadic projective Born collapse on q0 followed by another Hadamard still conserves exact norm!
  const collapsed = stepCyclotomicGate(
    state,
    { id: 'm0', kind: GateKind.MEASURE, targets: [0], branchMode: 'force0' },
    0.1,
  );
  assert.equal(collapsed.measurementOutcome?.outcome, 0);
  // P(0) after H-T-H is cos^2(pi/8) = (2 + sqrt(2)) / 4 ~= 0.85355339
  assert.ok(Math.abs((collapsed.measurementOutcome?.probZero ?? 0) - 0.85355339) < 1e-6);

  const afterPostH = stepCyclotomicGate(
    collapsed.nextState,
    { id: 'h-post', kind: GateKind.H, targets: [0] },
    0.1,
  ).nextState;
  assert.equal(inspectCyclotomicState(afterPostH).conservation.normExactOne, true);
});

test('AQ-05: Gottesman-Knill F_2 symplectic tableau Bell correlations and surface-code commutativity', () => {
  let tab = createInitialTableau(2);
  tab = stepStabilizerTableau(tab, { id: 'h0', kind: GateKind.H, targets: [0] }, 0.2).nextTableau;
  tab = stepStabilizerTableau(tab, { id: 'cx', kind: GateKind.CNOT, targets: [0, 1] }, 0.2).nextTableau;
  assert.equal(verifyStabilizersCommute(tab).commutes, true);

  // Force collapse q0 -> 1; measuring q1 MUST deterministically yield 1!
  const m0 = stepStabilizerTableau(
    tab,
    { id: 'm0', kind: GateKind.MEASURE, targets: [0], branchMode: 'force1' },
    0.2,
  );
  assert.equal(m0.measurementOutcome?.outcome, 1);

  const m1 = stepStabilizerTableau(
    m0.nextTableau,
    { id: 'm1', kind: GateKind.MEASURE, targets: [1], branchMode: 'seeded' },
    0.99,
  );
  assert.equal(m1.measurementOutcome?.outcome, 1);
  assert.equal(m1.measurementOutcome?.probOne, 1);

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

  assert.equal(verifySurfaceCodeCommutativity(), true);
});

test('AQ-06: Tropical (min, +) surface-code decoder corrects all 27 single-qubit X, Y, Z faults', () => {
  const paulis: PauliFault[] = ['X', 'Y', 'Z'];
  for (let q = 0; q < 9; q += 1) {
    for (const p of paulis) {
      const faults: PauliFault[] = new Array(9).fill('I');
      faults[q] = p;
      const decoded = decodeSurfaceCodeTropical(faults);
      assert.equal(
        decoded.postDecodeExcitedIds.length,
        0,
        `Syndrome remained excited for ${p} on d${q}`,
      );
      assert.equal(
        decoded.logicalPreserved,
        true,
        `Logical state corrupted for single-qubit ${p} fault on d${q}`,
      );
    }
  }
});

test('AQ-07 & AQ-08: RollbackSession re-branching, #vdnt= URL codec, UORC chain, and Stitch 2-of-3 parity', () => {
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

  assert.equal(session.frames.length, 4);
  // Before measurement (frame 2): entangled Bell state -> q1 rz == 0, purity == 0.5
  assert.equal(session.frames[2].blochVectors[1].purity, 0.5);
  // After measurement forced to |1> (frame 3): q1 collapses to |1> -> rz == -1, purity == 1
  assert.equal(session.frames[3].blochVectors[1].rz, -1);
  assert.equal(session.frames[3].blochVectors[1].purity, 1);

  // #vdnt= snapshot round-trip and tamper detection
  const token = encodeVdntSnapshotToken({ spec: session.spec, cursor: 3 });
  const decoded = decodeVdntSnapshotToken(`#vdnt=${token}`);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.value.cursor, 3);
    assert.equal(decoded.value.spec.name, 'Bell Rollback');
  }
  const tampered = decodeVdntSnapshotToken(`${token.slice(0, -2)}ff`);
  assert.equal(tampered.ok, false);

  // Progressive UORC LOD0..LOD4 & Stitch 2-of-3 XOR parity custody
  const uorcFrames = packProgressiveUorcStream(session.spec, session.frames[3]);
  assert.equal(uorcFrames.length, 5);
  assert.equal(uorcFrames[3].lossless, true);
  assert.equal(uorcFrames[4].lossless, true);

  const bundle = createStitchParityBundle(
    uorcFrames[4].rawBytes,
    'prism/identity/4:test',
    'deadbeef',
  );
  // Drop shard 0, 1, or 2 -> all reconstruct bit-identically!
  assert.equal(reconstructFromStitchShards(bundle, [false, true, true]).integrityVerified, true);
  assert.equal(reconstructFromStitchShards(bundle, [true, false, true]).integrityVerified, true);
  assert.equal(reconstructFromStitchShards(bundle, [true, true, false]).integrityVerified, true);
  // Drop 2 shards -> refused cleanly
  assert.equal(reconstructFromStitchShards(bundle, [true, false, false]).ok, false);
});

test('AQ-09 & AQ-10: CodedSlmDirector DenialWins guard, Core-Wasm acceptance vectors, and 16x16 tile rasterizer', () => {
  const validSlm = routePromptWithCodedSlm('prepare 3-qubit GHZ state');
  assert.equal(validSlm.admitted, true);
  assert.equal(validSlm.proposedSpec.qubitCount, 3);

  const blockedSlm = routePromptWithCodedSlm('clone q0 onto q0 with duplicate wire');
  assert.equal(blockedSlm.admitted, false);
  assert.equal(blockedSlm.refusalError?.kind, QuantumIsaErrorKind.DuplicateWireReference);

  const acceptance = runAllAcceptanceVectors();
  assert.equal(acceptance.passed, acceptance.total);
  assert.equal(acceptance.total, 16);

  for (const defect of PLANTED_DEFECT_CATALOG) {
    const rep = defect.run();
    assert.equal(rep.gateTriggered, true);
    assert.ok(rep.verifierRefusalVector.startsWith('refused:'));
  }

  const tris = buildSoftwareQuantumSceneTriangles({
    sceneMode: 'bloch',
    blochVectors: [{ qubit: 0, rx: 1, ry: 0, rz: 0, purity: 1, entropyBits: 0, p1: 0.5, collapsedTo: null }],
    entanglementEdges: [],
    surfaceFaults: new Array(9).fill('I'),
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
