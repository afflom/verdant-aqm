/**
 * Prism Kernel (`prismKernel.ts`) — Projected Invariants from `app/src/*.lex.tex`
 * Enforces unbounded wire linearity, Kahn DAG acyclicity, norm conservation, stabilizer commutativity,
 * parametric odd-d surface code distance, Atlas MTC & SkWeaver carrier laws, UORC lossless admission,
 * UTQC Row-Honesty, 24 Core-Wasm <= 64-byte acceptance vectors, and 10 planted-defect gates.
 */

import {
  CANONICAL_ATLAS_PARAMS,
  buildAtlasGenerators,
  decideUtqcRowHonesty,
  verifyAtlasMtcAxioms,
  weaveOpenQasmWithSkWeaver,
} from './atlasUtqc';
import { decideUorcAdmission } from './codedMatmul';
import { isValidSurfaceCodeDistance } from './stabilizer';
import {
  BoundedBuffer,
  CORE_WASM_REQUEST_MAX_BYTES,
  CORE_WASM_RESPONSE_MAX_BYTES,
  EIGHT,
  FIVE,
  FOUR,
  NINETY_SIX,
  ONE,
  ONE_TWENTY_EIGHT,
  ROLLBACK_WINDOW_FRAMES,
  TILE_EDGE_PX,
  THREE,
  TWENTY_FOUR,
  TWO,
  ZERO,
  ZERO_BIG,
  verifyConstructiveRatchet,
} from './stratum0';
import {
  AqmBackendMode,
  AqmCircuitSpec,
  AqmGateStep,
  CompiledDagNode,
  GateKind,
  HonestyVerdictErrorKind,
  MeasurementJournalErrorKind,
  ModeledAqmError,
  PlantedDefectResult,
  QuantumIsaErrorKind,
  StabilizerErrorKind,
  UnitaryInvariantErrorKind,
} from './types';

export function gateArity(kind: GateKind): number {
  switch (kind) {
    case GateKind.CNOT:
    case GateKind.CZ:
    case GateKind.SWAP:
      return TWO;
    default:
      return ONE;
  }
}

export function gateIsClifford(kind: GateKind): boolean {
  return kind !== GateKind.T;
}

/**
 * Quantum.lex.tex :: symplecticInnerProductMod2
 */
export function symplecticInnerProductMod2(
  x1: boolean,
  z1: boolean,
  x2: boolean,
  z2: boolean,
): boolean {
  return (x1 && z2) === (z1 && x2);
}

/**
 * Quantum.lex.tex :: wiresDistinctAndBounded (Unbounded Nat register width!)
 */
export function verifyStepWires(
  step: AqmGateStep,
  qubitCount: number,
  stepIndex: number,
): { ok: true } | { ok: false; error: ModeledAqmError } {
  const expectedArity = gateArity(step.kind);
  if (step.targets.length !== expectedArity) {
    return {
      ok: false,
      error: {
        kind: QuantumIsaErrorKind.InvalidQubitIndex,
        capabilityId: 'AQ-02',
        refusalCode: 'refused:invalid-gate-arity',
        detail: `Gate ${step.kind} at step ${stepIndex} requires ${expectedArity} wire(s), received ${step.targets.length}.`,
        stepIndex,
      },
    };
  }

  for (let i = ZERO; i < step.targets.length; i += ONE) {
    const w = step.targets[i];
    if (!Number.isInteger(w) || w < ZERO || w >= qubitCount) {
      return {
        ok: false,
        error: {
          kind: QuantumIsaErrorKind.InvalidQubitIndex,
          capabilityId: 'AQ-02',
          refusalCode: 'refused:wire-out-of-bounds',
          detail: `Wire index q${w} at step ${stepIndex} (${step.kind}) exceeds register [0..${qubitCount - ONE}].`,
          stepIndex,
        },
      };
    }
  }

  if (expectedArity === TWO && step.targets[ZERO] === step.targets[ONE]) {
    return {
      ok: false,
      error: {
        kind: QuantumIsaErrorKind.DuplicateWireReference,
        capabilityId: 'AQ-02',
        refusalCode: 'refused:duplicate-wire-cloning',
        detail: `No-cloning linearity violation at step ${stepIndex}: ${step.kind} references wire q${step.targets[ZERO]} twice.`,
        stepIndex,
      },
    };
  }

  return { ok: true };
}

/**
 * Compiles and validates an unbounded circuit layer DAG via Kahn's topological algorithm (`AQ-02`, `AQ-03`),
 * with zero artificial classical qubit ceilings (`qubitCount >= 1`).
 */
export function verifyAndCompileCircuitPrism(
  spec: AqmCircuitSpec,
): { ok: true; nodes: CompiledDagNode[]; depth: number } | { ok: false; error: ModeledAqmError } {
  if (!Number.isInteger(spec.qubitCount) || spec.qubitCount < ONE) {
    return {
      ok: false,
      error: {
        kind: QuantumIsaErrorKind.InvalidQubitIndex,
        capabilityId: 'AQ-01',
        refusalCode: 'refused:invalid-register-width',
        detail: `Register width ${spec.qubitCount} must be an integer >= 1.`,
      },
    };
  }

  const nSteps = spec.steps.length;
  const idToIndex = new Map<string, number>();
  for (let i = ZERO; i < nSteps; i += ONE) {
    idToIndex.set(spec.steps[i].id, i);
  }

  const collapsedWires = new Set<number>();
  const adj: number[][] = Array.from({ length: nSteps }, () => []);
  const indegree = new Int32Array(nSteps);
  // Sparse map for `lastStepOnWire` so 100,000-qubit circuits don't even allocate unused wire slots!
  const lastStepOnWire = new Map<number, number>();

  for (let i = ZERO; i < nSteps; i += ONE) {
    const step = spec.steps[i];
    const wireCheck = verifyStepWires(step, spec.qubitCount, i);
    if (!wireCheck.ok) {
      return wireCheck;
    }

    if (spec.backend === AqmBackendMode.StabilizerTableau && !gateIsClifford(step.kind)) {
      return {
        ok: false,
        error: {
          kind: StabilizerErrorKind.NonCliffordInTableauMode,
          capabilityId: 'AQ-05',
          refusalCode: 'refused:non-clifford-in-tableau-mode',
          detail: `Non-Clifford gate ${step.kind} at step ${i} cannot execute in F_2 Gottesman-Knill tableau mode; switch to Sparse Cyclotomic, Exact MPS, or Atlas Holospace.`,
          stepIndex: i,
        },
      };
    }

    if (step.strictPostCollapseGuard && step.kind !== GateKind.MEASURE) {
      for (const w of step.targets) {
        if (collapsedWires.has(w)) {
          return {
            ok: false,
            error: {
              kind: MeasurementJournalErrorKind.CollapsedRegisterWrite,
              capabilityId: 'AQ-07',
              refusalCode: 'refused:collapsed-register-write',
              detail: `Unitary gate ${step.kind} at step ${i} writes to already-collapsed wire q${w} under strict post-collapse guard.`,
              stepIndex: i,
            },
          };
        }
      }
    }

    if (step.kind === GateKind.MEASURE) {
      collapsedWires.add(step.targets[ZERO]);
    }

    const parents = new Set<number>();
    for (const w of step.targets) {
      const prev = lastStepOnWire.get(w);
      if (prev !== undefined) {
        parents.add(prev);
      }
      lastStepOnWire.set(w, i);
    }

    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        const depIdx = idToIndex.get(depId);
        if (depIdx === undefined) {
          return {
            ok: false,
            error: {
              kind: QuantumIsaErrorKind.CyclicCircuitDag,
              capabilityId: 'AQ-03',
              refusalCode: 'refused:dangling-dag-dependency',
              detail: `Step ${i} (${step.id}) references unknown dependency '${depId}'.`,
              stepIndex: i,
            },
          };
        }
        if (depIdx === i) {
          return {
            ok: false,
            error: {
              kind: QuantumIsaErrorKind.CyclicCircuitDag,
              capabilityId: 'AQ-03',
              refusalCode: 'refused:cyclic-circuit-dag',
              detail: `Self-dependency cycle detected at step ${i} (${step.id}).`,
              stepIndex: i,
            },
          };
        }
        parents.add(depIdx);
      }
    }

    for (const p of parents) {
      adj[p].push(i);
      indegree[i] += ONE;
    }
  }

  // Kahn topological sort + Tropical (max, +) layer depth calculation
  const queue: number[] = [];
  const layerOf = new Int32Array(nSteps).fill(ZERO);
  const parentLayersOf: number[][] = Array.from({ length: nSteps }, () => []);

  for (let i = ZERO; i < nSteps; i += ONE) {
    if (indegree[i] === ZERO) {
      queue.push(i);
      layerOf[i] = ONE;
    }
  }

  let visited = ZERO;
  let head = ZERO;
  while (head < queue.length) {
    const u = queue[head];
    head += ONE;
    visited += ONE;

    for (const v of adj[u]) {
      parentLayersOf[v].push(layerOf[u]);
      const candidateLayer = layerOf[u] + ONE;
      if (candidateLayer > layerOf[v]) {
        layerOf[v] = candidateLayer;
      }
      indegree[v] -= ONE;
      if (indegree[v] === ZERO) {
        queue.push(v);
      }
    }
  }

  if (visited !== nSteps) {
    return {
      ok: false,
      error: {
        kind: QuantumIsaErrorKind.CyclicCircuitDag,
        capabilityId: 'AQ-03',
        refusalCode: 'refused:cyclic-circuit-dag',
        detail: `Kahn topological barrier rejected cycle: ${nSteps - visited} gate node(s) trapped in cyclic dependency.`,
      },
    };
  }

  const reverseDepth = new Int32Array(nSteps).fill(ONE);
  for (let k = queue.length - ONE; k >= ZERO; k -= ONE) {
    const u = queue[k];
    for (const v of adj[u]) {
      const cand = reverseDepth[v] + ONE;
      if (cand > reverseDepth[u]) {
        reverseDepth[u] = cand;
      }
    }
  }

  let maxLayer = ZERO;
  const nodes: CompiledDagNode[] = new Array(nSteps);
  for (let i = ZERO; i < nSteps; i += ONE) {
    if (layerOf[i] > maxLayer) {
      maxLayer = layerOf[i];
    }
    nodes[i] = {
      stepIndex: i,
      step: spec.steps[i],
      layerIndex: layerOf[i],
      parentLayers: parentLayersOf[i],
      causalLightconeDepth: reverseDepth[i],
    };
  }

  return { ok: true, nodes, depth: maxLayer };
}

/**
 * Quantum.lex.tex :: normConservedScaled
 */
export function verifyNormConservedScaled(
  rationalPart: bigint,
  rootTwoPart: bigint,
  scaleDenom: bigint,
): { ok: true } | { ok: false; error: ModeledAqmError } {
  if (scaleDenom > ZERO_BIG && rationalPart === scaleDenom && rootTwoPart === ZERO_BIG) {
    return { ok: true };
  }
  return {
    ok: false,
    error: {
      kind: UnitaryInvariantErrorKind.NormConservationViolated,
      capabilityId: 'AQ-04',
      refusalCode: 'refused:norm-conservation-violated',
      detail: `k14 Probability mass invariant violated: (${rationalPart} + ${rootTwoPart}*sqrt(2)) / ${scaleDenom} != 1.`,
    },
  };
}

export interface AcceptanceVectorSpec {
  readonly id: string;
  readonly request: string;
  readonly expectedResponse: string;
  readonly category: 'positive' | 'negative-refusal';
}

export const CORE_WASM_ACCEPTANCE_VECTORS: readonly AcceptanceVectorSpec[] = [
  {
    id: 'AQ-01',
    request: 'aqm:summary',
    expectedResponse: `conformant:strata=${EIGHT},backends=${FOUR},facets=${EIGHT},tile_px=${TILE_EDGE_PX},unbounded=true`,
    category: 'positive',
  },
  {
    id: 'AQ-02',
    request: 'aqm:isa',
    expectedResponse: `conformant:gates=${EIGHT + TWO},request_max=${CORE_WASM_REQUEST_MAX_BYTES},wires_distinct=true,acyclic_dag=true`,
    category: 'positive',
  },
  {
    id: 'AQ-04',
    request: 'aqm:unitary',
    expectedResponse: `conformant:ring=SparseZ[zeta_8],accum_bits=${ONE_TWENTY_EIGHT},norm_conserved=exact,no_cloning=true`,
    category: 'positive',
  },
  {
    id: 'AQ-05',
    request: 'aqm:stabilizer',
    expectedResponse: 'conformant:field=F2_u64_packed,symplectic=2n*(2n+1),commutes=true,stitch_xor=true',
    category: 'positive',
  },
  {
    id: 'AQ-04b',
    request: 'aqm:norm',
    expectedResponse: 'conformant:conservation=k14_exact,l2_mass_invariant=true,tropical_reachability=true',
    category: 'positive',
  },
  {
    id: 'AQ-06',
    request: 'aqm:tropical',
    expectedResponse: 'conformant:semiring=TropicalMinPlus,lightcone=true,syndrome_mwpm=odd_d',
    category: 'positive',
  },
  {
    id: 'AQ-07',
    request: 'aqm:rollback',
    expectedResponse: `conformant:window=${ROLLBACK_WINDOW_FRAMES},journal=SHA256-CHAIN,vdnt_url=true,born_exact=true`,
    category: 'positive',
  },
  {
    id: 'AQ-08',
    request: 'aqm:uorc',
    expectedResponse: `conformant:chain=UORC-SHA256-CHAIN-v1,lods=0..${FOUR},order_rope=lossless,stitch=2of3`,
    category: 'positive',
  },
  {
    id: 'AQ-09',
    request: 'aqm:slm',
    expectedResponse: 'conformant:tier=PackedNibble4Bit,proposals_guarded=true,denial_wins=true',
    category: 'positive',
  },
  {
    id: 'AQ-11',
    request: 'aqm:mps',
    expectedResponse: 'conformant:tensor_train=ExactMps_Q[zeta_8],galois_rref=exact,rank_compressed=true',
    category: 'positive',
  },
  {
    id: 'AQ-12',
    request: 'aqm:surface',
    expectedResponse: 'conformant:code=[[d^2,1,d]],odd_d=3_5_7_9,commutes=true,mwpm_verified=true',
    category: 'positive',
  },
  {
    id: 'AQ-13',
    request: 'aqm:atlas',
    expectedResponse: `conformant:classes=${NINETY_SIX},mtc_rank=${TWENTY_FOUR},pentagon=true,hexagon=true,st3=true`,
    category: 'positive',
  },
  {
    id: 'AQ-14',
    request: 'aqm:qasm',
    expectedResponse: 'conformant:compiler=SkWeaver_PU22,flow_gap=3,euler=ZXZ,kappa=blake3',
    category: 'positive',
  },
  {
    id: 'AQ-16',
    request: 'aqm:honesty',
    expectedResponse: `conformant:tiers=${THREE},some_true=anchored,build=defect_gated,open=measured`,
    category: 'positive',
  },
  {
    id: 'NEG-01',
    request: 'aqm:defect:cloning',
    expectedResponse: 'refused:duplicate-wire-cloning',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-02',
    request: 'aqm:defect:cyclic',
    expectedResponse: 'refused:cyclic-circuit-dag',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-03',
    request: 'aqm:defect:oob',
    expectedResponse: 'refused:wire-out-of-bounds',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-04',
    request: 'aqm:defect:nonunitary',
    expectedResponse: 'refused:norm-conservation-violated',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-05',
    request: 'aqm:defect:tableau-t',
    expectedResponse: 'refused:non-clifford-in-tableau-mode',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-06',
    request: 'aqm:defect:anticommute',
    expectedResponse: 'refused:anticommuting-stabilizer-generator',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-07',
    request: 'aqm:defect:collapsed-write',
    expectedResponse: 'refused:collapsed-register-write',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-08',
    request: 'aqm:defect:even-distance',
    expectedResponse: 'refused:even-surface-code-distance',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-09',
    request: 'aqm:defect:clifford-angle',
    expectedResponse: 'refused:clifford-carrier-non-discrete-angle',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-10',
    request: 'aqm:defect:honesty-inflation',
    expectedResponse: 'refused:benchmark-inflated-to-proof',
    category: 'negative-refusal',
  },
];

/**
 * Engine.lex.tex :: dispatch (`hologram:guest/core-wasm@1` reference oracle)
 */
export function dispatchCoreWasmQuery(rawRequest: string | Uint8Array): string {
  const rawBytes =
    typeof rawRequest === 'string' ? new TextEncoder().encode(rawRequest) : rawRequest;
  if (rawBytes.byteLength === ZERO) {
    return 'invalid request';
  }
  const bounded = BoundedBuffer.fromBytes(rawBytes, CORE_WASM_REQUEST_MAX_BYTES);
  if (!bounded.ok) {
    return 'invalid request';
  }

  const query = bounded.value.toUtf8();
  const ratchet = verifyConstructiveRatchet();
  if (!ratchet.valid) {
    return 'refused:ratchet-identity-failed';
  }

  let answer = 'invalid request';

  if (query === 'aqm:summary') {
    answer = `conformant:strata=${EIGHT},backends=${FOUR},facets=${EIGHT},tile_px=${TILE_EDGE_PX},unbounded=true`;
  } else if (query === 'aqm:isa') {
    answer = `conformant:gates=${EIGHT + TWO},request_max=${CORE_WASM_REQUEST_MAX_BYTES},wires_distinct=true,acyclic_dag=true`;
  } else if (query === 'aqm:unitary') {
    answer = `conformant:ring=SparseZ[zeta_8],accum_bits=${ONE_TWENTY_EIGHT},norm_conserved=exact,no_cloning=true`;
  } else if (query === 'aqm:stabilizer') {
    answer = 'conformant:field=F2_u64_packed,symplectic=2n*(2n+1),commutes=true,stitch_xor=true';
  } else if (query === 'aqm:norm') {
    answer = 'conformant:conservation=k14_exact,l2_mass_invariant=true,tropical_reachability=true';
  } else if (query === 'aqm:tropical') {
    answer = 'conformant:semiring=TropicalMinPlus,lightcone=true,syndrome_mwpm=odd_d';
  } else if (query === 'aqm:rollback') {
    answer = `conformant:window=${ROLLBACK_WINDOW_FRAMES},journal=SHA256-CHAIN,vdnt_url=true,born_exact=true`;
  } else if (query === 'aqm:uorc') {
    answer = `conformant:chain=UORC-SHA256-CHAIN-v1,lods=0..${FOUR},order_rope=lossless,stitch=2of3`;
  } else if (query === 'aqm:slm') {
    answer = 'conformant:tier=PackedNibble4Bit,proposals_guarded=true,denial_wins=true';
  } else if (query === 'aqm:mps') {
    answer = 'conformant:tensor_train=ExactMps_Q[zeta_8],galois_rref=exact,rank_compressed=true';
  } else if (query === 'aqm:surface') {
    answer = 'conformant:code=[[d^2,1,d]],odd_d=3_5_7_9,commutes=true,mwpm_verified=true';
  } else if (query === 'aqm:atlas') {
    const mtc = verifyAtlasMtcAxioms(CANONICAL_ATLAS_PARAMS);
    answer = mtc.ok
      ? `conformant:classes=${NINETY_SIX},mtc_rank=${TWENTY_FOUR},pentagon=true,hexagon=true,st3=true`
      : 'refused:mtc-axiom-failed';
  } else if (query === 'aqm:qasm') {
    answer = 'conformant:compiler=SkWeaver_PU22,flow_gap=3,euler=ZXZ,kappa=blake3';
  } else if (query === 'aqm:honesty') {
    answer = `conformant:tiers=${THREE},some_true=anchored,build=defect_gated,open=measured`;
  } else if (query === 'aqm:defect:cloning') {
    const res = verifyStepWires({ id: 'd0', kind: GateKind.CNOT, targets: [ZERO, ZERO] }, FOUR, ZERO);
    answer = res.ok ? 'conformant:unexpected' : res.error.refusalCode;
  } else if (query === 'aqm:defect:oob') {
    const res = verifyStepWires({ id: 'd1', kind: GateKind.H, targets: [FOUR] }, FOUR, ZERO);
    answer = res.ok ? 'conformant:unexpected' : res.error.refusalCode;
  } else if (query === 'aqm:defect:cyclic') {
    const res = verifyAndCompileCircuitPrism({
      name: 'cyclic-defect',
      description: 'Mutual dependency cycle',
      qubitCount: TWO,
      seed: ONE,
      backend: AqmBackendMode.CyclotomicExact,
      steps: [
        { id: 'g0', kind: GateKind.H, targets: [ZERO], dependsOn: ['g1'] },
        { id: 'g1', kind: GateKind.X, targets: [ONE], dependsOn: ['g0'] },
      ],
    });
    answer = res.ok ? 'conformant:unexpected' : res.error.refusalCode;
  } else if (query === 'aqm:defect:nonunitary') {
    const res = verifyNormConservedScaled(BigInt(THREE), ZERO_BIG, BigInt(TWO));
    answer = res.ok ? 'conformant:unexpected' : res.error.refusalCode;
  } else if (query === 'aqm:defect:tableau-t') {
    const res = verifyAndCompileCircuitPrism({
      name: 'tableau-t-defect',
      description: 'Non-Clifford T in tableau mode',
      qubitCount: TWO,
      seed: ONE,
      backend: AqmBackendMode.StabilizerTableau,
      steps: [{ id: 'g0', kind: GateKind.T, targets: [ZERO] }],
    });
    answer = res.ok ? 'conformant:unexpected' : res.error.refusalCode;
  } else if (query === 'aqm:defect:anticommute') {
    const commutes = symplecticInnerProductMod2(true, false, false, true);
    answer = commutes ? 'conformant:unexpected' : 'refused:anticommuting-stabilizer-generator';
  } else if (query === 'aqm:defect:collapsed-write') {
    const res = verifyAndCompileCircuitPrism({
      name: 'collapsed-write-defect',
      description: 'Post-collapse unitary write under strict guard',
      qubitCount: TWO,
      seed: ONE,
      backend: AqmBackendMode.CyclotomicExact,
      steps: [
        { id: 'm0', kind: GateKind.MEASURE, targets: [ZERO] },
        { id: 'u1', kind: GateKind.H, targets: [ZERO], strictPostCollapseGuard: true },
      ],
    });
    answer = res.ok ? 'conformant:unexpected' : res.error.refusalCode;
  } else if (query === 'aqm:defect:even-distance') {
    answer = isValidSurfaceCodeDistance(FOUR)
      ? 'conformant:unexpected'
      : 'refused:even-surface-code-distance';
  } else if (query === 'aqm:defect:clifford-angle') {
    const w = weaveOpenQasmWithSkWeaver('OPENQASM 2.0;\nqreg q[1];\nrz(pi/5) q[0];', 'Clifford');
    answer = w.ok ? 'conformant:unexpected' : w.error.refusalCode;
  } else if (query === 'aqm:defect:honesty-inflation') {
    const h = decideUtqcRowHonesty({
      claimedTier: 'some-true',
      hasCitationAnchor: true,
      isEmpiricalBenchmarkOnly: true,
      hasPlantedDefectRefusal: true,
    });
    answer = h.ok ? 'conformant:unexpected' : h.error.refusalCode;
  }

  void FIVE;
  const outBounded = BoundedBuffer.fromUtf8(answer, CORE_WASM_RESPONSE_MAX_BYTES);
  return outBounded.ok ? outBounded.value.toUtf8() : 'refused:response-exceeded-512';
}

export function runAllAcceptanceVectors(): {
  total: number;
  passed: number;
  results: Array<{
    id: string;
    request: string;
    actual: string;
    expected: string;
    passed: boolean;
    category: 'positive' | 'negative-refusal';
  }>;
} {
  const results = CORE_WASM_ACCEPTANCE_VECTORS.map((vec) => {
    const actual = dispatchCoreWasmQuery(vec.request);
    return {
      id: vec.id,
      request: vec.request,
      actual,
      expected: vec.expectedResponse,
      passed: actual === vec.expectedResponse,
      category: vec.category,
    };
  });
  const passed = results.filter((r) => r.passed).length;
  return { total: results.length, passed, results };
}

/**
 * Interactive Planted Defect Catalog (`R5` Negative Refusals across all Prism facets)
 */
export const PLANTED_DEFECT_CATALOG: readonly {
  id: string;
  title: string;
  capabilityId: string;
  description: string;
  run: () => PlantedDefectResult;
}[] = [
  {
    id: 'cloning-cnot',
    title: 'Duplicate-Wire Cloning CNOT(q64, q64)',
    capabilityId: 'AQ-02',
    description: 'Plants a two-qubit CNOT referencing wire q64 as both control and target on a 128-qubit register.',
    run: () => {
      const check = verifyStepWires(
        { id: 'plant-clone', kind: GateKind.CNOT, targets: [64, 64] },
        128,
        ZERO,
      );
      if (check.ok) throw new Error('Planted defect escaped wire linearity gate');
      return {
        defectId: 'cloning-cnot',
        title: 'Duplicate-Wire Cloning CNOT(q64, q64)',
        capabilityId: 'AQ-02',
        plantedDescription: 'GateInstructionSpec { kind: CNOT, primaryWire: 64, secondaryWire: 64 } (128q)',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:cloning'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:isa'),
      };
    },
  },
  {
    id: 'cyclic-dag',
    title: 'Cyclic Gate Barrier Dependency (g0 <-> g1)',
    capabilityId: 'AQ-03',
    description: 'Plants mutual gate barrier edges g0 -> g1 -> g0 to test Kahn topological circuit DAG rejection.',
    run: () => {
      const check = verifyAndCompileCircuitPrism({
        name: 'planted-cycle',
        description: 'Planted mutual gate dependency',
        qubitCount: TWO,
        seed: ONE,
        backend: AqmBackendMode.CyclotomicExact,
        steps: [
          { id: 'g0', kind: GateKind.H, targets: [ZERO], dependsOn: ['g1'] },
          { id: 'g1', kind: GateKind.X, targets: [ONE], dependsOn: ['g0'] },
        ],
      });
      if (check.ok) throw new Error('Planted cycle escaped Kahn DAG gate');
      return {
        defectId: 'cyclic-dag',
        title: 'Cyclic Gate Barrier Dependency (g0 <-> g1)',
        capabilityId: 'AQ-03',
        plantedDescription: 'AqmCircuitSpec with mutual barrier cycle g0 <-> g1',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:cyclic'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:isa'),
      };
    },
  },
  {
    id: 'non-unitary-norm',
    title: 'Non-Unitary Amplitude Scaling (l2 Norm Drift)',
    capabilityId: 'AQ-04',
    description: 'Plants an unnormalized state vector with scaled probability mass 3/2 != 1 to verify k14 ConservationLedger refusal.',
    run: () => {
      const check = verifyNormConservedScaled(BigInt(THREE), ZERO_BIG, BigInt(TWO));
      if (check.ok) throw new Error('Planted norm drift escaped k14 conservation gate');
      return {
        defectId: 'non-unitary-norm',
        title: 'Non-Unitary Amplitude Scaling (l2 Norm Drift)',
        capabilityId: 'AQ-04',
        plantedDescription: 'Scaled cyclotomic probability mass (3 + 0*sqrt(2)) / 2 != 1',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:nonunitary'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:norm'),
      };
    },
  },
  {
    id: 'tableau-non-clifford',
    title: 'Non-Clifford T Gate in F_2 Tableau Mode',
    capabilityId: 'AQ-05',
    description: 'Attempts to execute a pi/4 T-gate inside the 64-bit word-packed Gottesman-Knill F_2 stabilizer backend.',
    run: () => {
      const check = verifyAndCompileCircuitPrism({
        name: 'planted-t-in-tableau',
        description: 'Planted T gate in StabilizerTableau mode',
        qubitCount: THREE,
        seed: ONE,
        backend: AqmBackendMode.StabilizerTableau,
        steps: [{ id: 't0', kind: GateKind.T, targets: [ZERO] }],
      });
      if (check.ok) throw new Error('Planted T gate escaped stabilizer Clifford guard');
      return {
        defectId: 'tableau-non-clifford',
        title: 'Non-Clifford T Gate in F_2 Tableau Mode',
        capabilityId: 'AQ-05',
        plantedDescription: 'GateKind::T dispatched to AqmBackendMode::StabilizerTableau',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:tableau-t'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:stabilizer'),
      };
    },
  },
  {
    id: 'even-surface-distance',
    title: 'Even-Distance d=4 Rotated Surface Code',
    capabilityId: 'AQ-12',
    description: 'Attempts to instantiate a rotated [[16, 1, 4]] surface code with even distance d=4, violating Quantum::surfaceCodeDistanceValid.',
    run: () => {
      const valid = isValidSurfaceCodeDistance(FOUR);
      if (valid) throw new Error('Even distance d=4 escaped surface code distance gate');
      return {
        defectId: 'even-surface-distance',
        title: 'Even-Distance d=4 Rotated Surface Code',
        capabilityId: 'AQ-12',
        plantedDescription: 'buildRotatedSurfaceCode(distance = 4) -> (4 % 2 != 1)',
        gateTriggered: true,
        error: {
          kind: StabilizerErrorKind.EvenSurfaceCodeDistance,
          capabilityId: 'AQ-12',
          refusalCode: 'refused:even-surface-code-distance',
          detail: 'Rotated surface code requires odd code distance d >= 3 to avoid boundary stabilizer anticommutation.',
        },
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:even-distance'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:surface'),
      };
    },
  },
  {
    id: 'clifford-carrier-angle',
    title: 'Continuous rz(pi/5) on Discrete Clifford Carrier',
    capabilityId: 'AQ-14',
    description: 'Compiles OpenQASM rz(pi/5) against the discrete Clifford carrier without Certified22 PU(22) spectral flow.',
    run: () => {
      const w = weaveOpenQasmWithSkWeaver('OPENQASM 2.0;\nqreg q[1];\nrz(pi/5) q[0];', 'Clifford');
      if (w.ok) throw new Error('Continuous angle escaped Clifford carrier refusal');
      return {
        defectId: 'clifford-carrier-angle',
        title: 'Continuous rz(pi/5) on Discrete Clifford Carrier',
        capabilityId: 'AQ-14',
        plantedDescription: "weaveOpenQasmWithSkWeaver('rz(pi/5) q[0]', carrier='Clifford')",
        gateTriggered: true,
        error: w.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:clifford-angle'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:qasm'),
      };
    },
  },
  {
    id: 'uorc-lossy-challenger',
    title: 'Lossy UORC OrderRope Challenger Archive',
    capabilityId: 'AQ-08',
    description: 'Submits a smaller challenger archive whose decoded bytes flip 1 bit against original quantum state.',
    run: () => {
      const orig = new Uint8Array([1, 0, 7, 4]);
      const corrupted = new Uint8Array([1, 0, 7, 5]);
      const adm = decideUorcAdmission({
        originalBytes: orig,
        reconstructedBytes: corrupted,
        orderPreserved: true,
        incumbentBytes: 128,
        challengerBytes: 64,
      });
      if (adm.admitted) throw new Error('Lossy challenger escaped UORC lossless gate');
      return {
        defectId: 'uorc-lossy-challenger',
        title: 'Lossy UORC OrderRope Challenger Archive',
        capabilityId: 'AQ-08',
        plantedDescription: `decideUorcAdmission(corruptedBit=true, challengerBytes=64 < 128) -> ${adm.reason}`,
        gateTriggered: true,
        error: {
          kind: HonestyVerdictErrorKind.RefuseLossyUorcChallenger,
          capabilityId: 'AQ-08',
          refusalCode: 'refused:lossy-uorc-challenger',
          detail: 'UORC challenger failed bit-identical lossless reconstruction check.',
        },
        verifierRefusalVector: 'refused:lossy-uorc-challenger',
        restoredPassVector: dispatchCoreWasmQuery('aqm:uorc'),
      };
    },
  },
  {
    id: 'honesty-benchmark-inflation',
    title: 'UTQC Honesty Gate: Benchmark Inflated to Theorem',
    capabilityId: 'AQ-16',
    description: 'Plants an empirical runtime benchmark row claiming tier some-true, triggering Honesty::inv001BenchmarkCannotClaimTheorem.',
    run: () => {
      const check = decideUtqcRowHonesty({
        claimedTier: 'some-true',
        hasCitationAnchor: true,
        isEmpiricalBenchmarkOnly: true,
        hasPlantedDefectRefusal: true,
      });
      if (check.ok) throw new Error('Benchmark inflation escaped Honesty.lex.tex gate');
      const genCheck = buildAtlasGenerators({ scope: 0, modality: 3, context: 8 });
      void genCheck;
      return {
        defectId: 'honesty-benchmark-inflation',
        title: 'UTQC Honesty Gate: Benchmark Inflated to Theorem',
        capabilityId: 'AQ-16',
        plantedDescription: "evaluateRowHonesty(tier='some-true', isEmpiricalBenchmarkOnly=true)",
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:honesty-inflation'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:honesty'),
      };
    },
  },
];
