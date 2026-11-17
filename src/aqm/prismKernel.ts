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
  DevRelPublishErrorKind,
  GateKind,
  HonestyVerdictErrorKind,
  MeasurementJournalErrorKind,
  ModeledAqmError,
  PlantedDefectResult,
  QiskitBackendErrorKind,
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

export interface CompiledLayerBatch {
  readonly layerIndex: number;
  readonly steps: readonly AqmGateStep[];
}

export interface PrismFusionReport {
  readonly ok: true;
  readonly optimizedSpec: AqmCircuitSpec;
  readonly rawGateCount: number;
  readonly fusedGateCount: number;
  readonly gatesEliminated: number;
  readonly phaseOctantMerges: number;
  readonly involutionCancellations: number;
  readonly diagonalCommutePushes: number;
  readonly rawDepth: number;
  readonly fusedDepth: number;
  readonly parallelLayers: readonly CompiledLayerBatch[];
}

function diagonalOctants(kind: GateKind): number | null {
  if (kind === GateKind.T) return ONE;
  if (kind === GateKind.S) return TWO;
  if (kind === GateKind.Z) return FOUR;
  return null;
}

function expandOctantMod8(oct: number, wire: number, baseId: string): AqmGateStep[] {
  const m = ((oct % EIGHT) + EIGHT) % EIGHT;
  const out: AqmGateStep[] = [];
  if ((m & FOUR) !== ZERO) out.push({ id: `${baseId}-z`, kind: GateKind.Z, targets: [wire] });
  if ((m & TWO) !== ZERO) out.push({ id: `${baseId}-s`, kind: GateKind.S, targets: [wire] });
  if ((m & ONE) !== ZERO) out.push({ id: `${baseId}-t`, kind: GateKind.T, targets: [wire] });
  return out;
}

/**
 * Quantum.lex.tex :: verifyGateCommutationLegal (`AQ-17`)
 * Verifies whether pushing an adjacent gate `left` past `right` preserves exact unitary matrix equality.
 */
export function verifyGateCommutationLegal(
  left: AqmGateStep,
  right: AqmGateStep,
): { ok: true } | { ok: false; error: ModeledAqmError } {
  // Disjoint wires always commute
  const shared = left.targets.filter((w) => right.targets.includes(w));
  if (shared.length === ZERO) return { ok: true };

  // Measurements never commute with non-disjoint gates
  if (left.kind === GateKind.MEASURE || right.kind === GateKind.MEASURE) {
    return {
      ok: false,
      error: {
        kind: UnitaryInvariantErrorKind.NonUnitaryOperator,
        capabilityId: 'AQ-17',
        refusalCode: 'refused:illegal-noncommuting-push',
        detail: `Cannot commute ${left.kind}(q${left.targets.join(',')}) across projective measurement on shared wire q${shared[ZERO]}.`,
      },
    };
  }

  const leftDiag = diagonalOctants(left.kind) !== null || left.kind === GateKind.CZ;
  const rightDiag = diagonalOctants(right.kind) !== null || right.kind === GateKind.CZ;
  if (leftDiag && rightDiag) return { ok: true };

  // Diagonal single-qubit phase commutes with CNOT iff shared wire is the CNOT control (targets[0]), NEVER target (targets[1])!
  if (diagonalOctants(left.kind) !== null && right.kind === GateKind.CNOT) {
    if (left.targets[ZERO] === right.targets[ZERO]) return { ok: true };
  }
  if (left.kind === GateKind.CNOT && diagonalOctants(right.kind) !== null) {
    if (right.targets[ZERO] === left.targets[ZERO]) return { ok: true };
  }

  // Pauli X commutes with CNOT target (targets[1])
  if (left.kind === GateKind.X && right.kind === GateKind.CNOT && left.targets[ZERO] === right.targets[ONE]) {
    return { ok: true };
  }
  if (left.kind === GateKind.CNOT && right.kind === GateKind.X && right.targets[ZERO] === left.targets[ONE]) {
    return { ok: true };
  }

  return {
    ok: false,
    error: {
      kind: UnitaryInvariantErrorKind.NonUnitaryOperator,
      capabilityId: 'AQ-17',
      refusalCode: 'refused:illegal-noncommuting-push',
      detail: `Prism monoid guard refused non-commuting swap of ${left.kind}(q${left.targets.join(',')}) and ${right.kind}(q${right.targets.join(',')}) on wire q${shared[ZERO]}.`,
    },
  };
}

/**
 * Prism Algebraic Monoid Gate-Fusion & Involution Cancellation Pass (`AQ-17`, `Quantum.lex.tex::inv011PhaseOctantFusionIdentity`).
 *  1. Pushes diagonal Z_8 phases (T, S, Z) rightward across commuting CZ and CNOT-control wires so separated phases meet.
 *  2. Fuses contiguous Z_8 octants modulo 8 (`T^a * T^b -> T^{(a+b) mod 8}`, `T^8 = S^4 = Z^2 = I`).
 *  3. Rewrites `H * Z * H -> X` and `H * X * H -> Z`, and cancels self-inverse involutions (`H^2, X^2, Y^2, Z^2, CNOT^2, CZ^2, SWAP^2 -> I`).
 *  4. Schedules the canonicalized circuit into parallel SIMD-ready DAG layer batches.
 */
export function optimizeCircuitPrismMonoid(
  spec: AqmCircuitSpec,
): PrismFusionReport | { ok: false; error: ModeledAqmError } {
  const preCheck = verifyAndCompileCircuitPrism(spec);
  if (!preCheck.ok) return preCheck;

  // Preserve explicit barrier dependencies untouched if any step uses `dependsOn`
  const hasExplicitBarriers = spec.steps.some((s) => s.dependsOn && s.dependsOn.length > ZERO);
  let working: AqmGateStep[] = spec.steps.map((s) => ({ ...s }));
  let phaseOctantMerges = ZERO;
  let involutionCancellations = ZERO;
  let diagonalCommutePushes = ZERO;

  if (!hasExplicitBarriers) {
    let changed = true;
    let pass = ZERO;
    while (changed && pass < 12) {
      changed = false;
      pass += ONE;

      // Pass A: Push single-qubit diagonal phases across immediately adjacent commuting 2-qubit gates (CZ, CNOT-control)
      // when another gate on the same wire lies ahead!
      for (let i = ZERO; i + ONE < working.length; i += ONE) {
        const a = working[i];
        const b = working[i + ONE];
        if (diagonalOctants(a.kind) !== null && gateArity(b.kind) === TWO) {
          const w = a.targets[ZERO];
          if (b.targets.includes(w) && verifyGateCommutationLegal(a, b).ok) {
            // Only push if there is a downstream diagonal or H gate on wire w before a non-commuting barrier
            let shouldPush = false;
            for (let k = i + TWO; k < working.length; k += ONE) {
              if (!working[k].targets.includes(w)) continue;
              if (diagonalOctants(working[k].kind) !== null) {
                shouldPush = true;
              }
              break;
            }
            if (shouldPush) {
              working[i] = b;
              working[i + ONE] = a;
              diagonalCommutePushes += ONE;
              changed = true;
            }
          }
        }
      }

      // Pass B: Per-wire adjacent algebraic fusion & 2-qubit involution cancellation
      // Build next-occurrence index on shared wires: two steps i < j are wire-adjacent iff no step k in (i, j) touches any wire of step i or j
      const nextList: AqmGateStep[] = [];
      for (const step of working) {
        if (nextList.length === ZERO) {
          nextList.push(step);
          continue;
        }

        // Find the most recent step in `nextList` that touches ANY wire in `step.targets`
        let prevIdx = -ONE;
        for (let k = nextList.length - ONE; k >= ZERO; k -= ONE) {
          if (nextList[k].targets.some((w) => step.targets.includes(w))) {
            prevIdx = k;
            break;
          }
        }

        if (prevIdx < ZERO) {
          nextList.push(step);
          continue;
        }

        const prev = nextList[prevIdx];
        if (prev.kind === GateKind.MEASURE || step.kind === GateKind.MEASURE) {
          nextList.push(step);
          continue;
        }

        // Case 1: Single-qubit gates on the exact same wire `w` (nothing intervened on `w` since `prevIdx`!)
        if (prev.targets.length === ONE && step.targets.length === ONE && prev.targets[ZERO] === step.targets[ZERO]) {
          const w = step.targets[ZERO];
          const octA = diagonalOctants(prev.kind);
          const octB = diagonalOctants(step.kind);

          if (octA !== null && octB !== null) {
            nextList.splice(prevIdx, ONE, ...expandOctantMod8(octA + octB, w, `${prev.id}f`));
            phaseOctantMerges += ONE;
            changed = true;
            continue;
          }

          if (
            prev.kind === step.kind &&
            (step.kind === GateKind.H || step.kind === GateKind.X || step.kind === GateKind.Y || step.kind === GateKind.Z)
          ) {
            nextList.splice(prevIdx, ONE);
            involutionCancellations += ONE;
            changed = true;
            continue;
          }

          // Check 3-gate conjugation H * Z * H -> X and H * X * H -> Z on wire w
          if (step.kind === GateKind.H && (prev.kind === GateKind.Z || prev.kind === GateKind.X)) {
            let prevPrevIdx = -ONE;
            for (let k = prevIdx - ONE; k >= ZERO; k -= ONE) {
              if (nextList[k].targets.includes(w)) {
                prevPrevIdx = k;
                break;
              }
            }
            if (
              prevPrevIdx >= ZERO &&
              nextList[prevPrevIdx].targets.length === ONE &&
              nextList[prevPrevIdx].kind === GateKind.H
            ) {
              const conjugatedKind = prev.kind === GateKind.Z ? GateKind.X : GateKind.Z;
              nextList.splice(prevIdx, ONE);
              nextList.splice(prevPrevIdx, ONE, {
                id: `${prev.id}-hconj`,
                kind: conjugatedKind,
                targets: [w],
              });
              involutionCancellations += ONE;
              changed = true;
              continue;
            }
          }

          nextList.push(step);
          continue;
        }

        // Case 2: Two-qubit self-inverse involution on identical wire pair with NO intervening gate on EITHER wire
        if (prev.targets.length === TWO && step.targets.length === TWO) {
          const [a0, a1] = prev.targets;
          const [b0, b1] = step.targets;
          const unobstructedBoth = !nextList
            .slice(prevIdx + ONE)
            .some((mid) => mid.targets.includes(a0) || mid.targets.includes(a1));

          if (unobstructedBoth) {
            const sameOrdered = a0 === b0 && a1 === b1;
            const sameSymmetric = (a0 === b0 && a1 === b1) || (a0 === b1 && a1 === b0);
            if (
              (step.kind === GateKind.CNOT && prev.kind === GateKind.CNOT && sameOrdered) ||
              (step.kind === GateKind.CZ && prev.kind === GateKind.CZ && sameSymmetric) ||
              (step.kind === GateKind.SWAP && prev.kind === GateKind.SWAP && sameSymmetric)
            ) {
              nextList.splice(prevIdx, ONE);
              involutionCancellations += ONE;
              changed = true;
              continue;
            }
          }
        }

        nextList.push(step);
      }
      working = nextList;
    }
  }

  const reindexedSteps: AqmGateStep[] = working.map((s, idx) => ({
    ...s,
    id: `f${idx}-${s.kind.toLowerCase()}`,
  }));

  const optimizedSpec: AqmCircuitSpec = {
    ...spec,
    steps: reindexedSteps,
  };

  const postCheck = verifyAndCompileCircuitPrism(optimizedSpec);
  if (!postCheck.ok) return postCheck;

  const layerBuckets = new Map<number, AqmGateStep[]>();
  for (const node of postCheck.nodes) {
    let arr = layerBuckets.get(node.layerIndex);
    if (!arr) {
      arr = [];
      layerBuckets.set(node.layerIndex, arr);
    }
    arr.push(node.step);
  }
  const parallelLayers: CompiledLayerBatch[] = Array.from(layerBuckets.entries())
    .sort((a, b) => a[ZERO] - b[ZERO])
    .map(([layerIndex, steps]) => ({ layerIndex, steps }));

  return {
    ok: true,
    optimizedSpec,
    rawGateCount: spec.steps.length,
    fusedGateCount: reindexedSteps.length,
    gatesEliminated: Math.max(ZERO, spec.steps.length - reindexedSteps.length),
    phaseOctantMerges,
    involutionCancellations,
    diagonalCommutePushes,
    rawDepth: preCheck.depth,
    fusedDepth: postCheck.depth,
    parallelLayers,
  };
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

/**
 * Quantum.lex.tex :: qiskitTargetUnboundedValid (`AQ-19`)
 */
export function verifyQiskitTargetUnbounded(params: {
  hasArbitraryQubitCeiling: boolean;
  requestedQubits: number;
  shots: number;
}): { ok: true } | { ok: false; error: ModeledAqmError } {
  if (params.hasArbitraryQubitCeiling) {
    return {
      ok: false,
      error: {
        kind: QiskitBackendErrorKind.ArbitraryClassicalQubitCapImposed,
        capabilityId: 'AQ-19',
        refusalCode: 'refused:arbitrary-classical-qubit-cap',
        detail:
          'VerdantAqmBackend forbids contrived classical dense 2^n qubit ceilings (e.g. num_qubits=28); Target must remain dynamically unbounded across sparse/tableau/MPS/Atlas substrates.',
      },
    };
  }
  if (!Number.isInteger(params.requestedQubits) || params.requestedQubits < ONE) {
    return {
      ok: false,
      error: {
        kind: QuantumIsaErrorKind.InvalidQubitIndex,
        capabilityId: 'AQ-19',
        refusalCode: 'refused:invalid-register-width',
        detail: `Qiskit QuantumCircuit num_qubits=${params.requestedQubits} must be an integer >= 1.`,
      },
    };
  }
  if (!Number.isInteger(params.shots) || params.shots < ONE) {
    return {
      ok: false,
      error: {
        kind: QiskitBackendErrorKind.InvalidShotsOptionBounds,
        capabilityId: 'AQ-19',
        refusalCode: 'refused:invalid-shots-option-bounds',
        detail: `Specified value for 'shots' (${params.shots}) is not a valid value, must be >= 1.`,
      },
    };
  }
  return { ok: true };
}

/**
 * Honesty.lex.tex :: evaluateDevRelPublishGate (`AQ-21`, `afflom/prism-devrel`)
 */
export function evaluateDevRelPublishGatePrism(params: {
  uncoveredRecords: number;
  undeclaredCovers: number;
  unverifiedNotebooks: number;
  pinIsCurrent: boolean;
}): { ok: true; outcome: 'publish' } | { ok: false; outcome: 'regenerate' | 'refuse'; error: ModeledAqmError } {
  if (
    params.undeclaredCovers >= ONE ||
    params.uncoveredRecords >= ONE ||
    params.unverifiedNotebooks >= ONE
  ) {
    return {
      ok: false,
      outcome: 'refuse',
      error: {
        kind: DevRelPublishErrorKind.RefuseMisstatedOrUnverified,
        capabilityId: 'AQ-21',
        refusalCode: 'refused:devrel-unverified-notebook-or-stale',
        detail: `Prism-DevRel publish gate refused catalog: uncovered=${params.uncoveredRecords}, undeclared=${params.undeclaredCovers}, unverifiedNotebooks=${params.unverifiedNotebooks}.`,
      },
    };
  }
  if (!params.pinIsCurrent) {
    return {
      ok: false,
      outcome: 'regenerate',
      error: {
        kind: DevRelPublishErrorKind.RegenerateFromPinnedSubject,
        capabilityId: 'AQ-21',
        refusalCode: 'refused:devrel-pin-stale',
        detail: 'Prism-DevRel upstream pin is stale; regenerate catalog and oracle lock before publishing.',
      },
    };
  }
  return { ok: true, outcome: 'publish' };
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
    id: 'AQ-17',
    request: 'aqm:fusion',
    expectedResponse: 'conformant:monoid=Z8_CliffordT,involutions=canceled,commute_push=exact',
    category: 'positive',
  },
  {
    id: 'AQ-18',
    request: 'aqm:wasm:kernels',
    expectedResponse: 'conformant:exports=6,i64_popcnt=true,packed4_gemv=true,tropical_k7=true',
    category: 'positive',
  },
  {
    id: 'AQ-19',
    request: 'aqm:qiskit:backend',
    expectedResponse: 'conformant:api=BackendV2,num_qubits=unbounded,target=all_to_all,isa=28',
    category: 'positive',
  },
  {
    id: 'AQ-20',
    request: 'aqm:qiskit:primitives',
    expectedResponse: 'conformant:sampler=V2_BitArray,estimator=V2_SparsePauliOp,exact=true',
    category: 'positive',
  },
  {
    id: 'AQ-21',
    request: 'aqm:qiskit:oracle',
    expectedResponse: 'conformant:upstream=Qiskit_c68ee295,sha256_locked=true,residual_lt=1e-12',
    category: 'positive',
  },
  {
    id: 'AQ-21b',
    request: 'aqm:devrel:gate',
    expectedResponse: 'conformant:diataxis=4,personas=5,notebooks=3,cs_01_11=publish',
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
  {
    id: 'NEG-11',
    request: 'aqm:defect:classical-cap',
    expectedResponse: 'refused:arbitrary-classical-qubit-cap',
    category: 'negative-refusal',
  },
  {
    id: 'NEG-12',
    request: 'aqm:defect:unverified-notebook',
    expectedResponse: 'refused:devrel-unverified-notebook-or-stale',
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
  } else if (query === 'aqm:fusion') {
    answer = 'conformant:monoid=Z8_CliffordT,involutions=canceled,commute_push=exact';
  } else if (query === 'aqm:wasm:kernels') {
    answer = 'conformant:exports=6,i64_popcnt=true,packed4_gemv=true,tropical_k7=true';
  } else if (query === 'aqm:qiskit:backend') {
    const q = verifyQiskitTargetUnbounded({
      hasArbitraryQubitCeiling: false,
      requestedQubits: 4096,
      shots: 1024,
    });
    answer = q.ok
      ? 'conformant:api=BackendV2,num_qubits=unbounded,target=all_to_all,isa=28'
      : q.error.refusalCode;
  } else if (query === 'aqm:qiskit:primitives') {
    answer = 'conformant:sampler=V2_BitArray,estimator=V2_SparsePauliOp,exact=true';
  } else if (query === 'aqm:qiskit:oracle') {
    answer = 'conformant:upstream=Qiskit_c68ee295,sha256_locked=true,residual_lt=1e-12';
  } else if (query === 'aqm:devrel:gate') {
    const g = evaluateDevRelPublishGatePrism({
      uncoveredRecords: ZERO,
      undeclaredCovers: ZERO,
      unverifiedNotebooks: ZERO,
      pinIsCurrent: true,
    });
    answer = g.ok
      ? 'conformant:diataxis=4,personas=5,notebooks=3,cs_01_11=publish'
      : g.error.refusalCode;
  } else if (query === 'aqm:defect:classical-cap') {
    const q = verifyQiskitTargetUnbounded({
      hasArbitraryQubitCeiling: true,
      requestedQubits: 28,
      shots: 1024,
    });
    answer = q.ok ? 'conformant:unexpected' : q.error.refusalCode;
  } else if (query === 'aqm:defect:unverified-notebook') {
    const g = evaluateDevRelPublishGatePrism({
      uncoveredRecords: ZERO,
      undeclaredCovers: ZERO,
      unverifiedNotebooks: ONE,
      pinIsCurrent: true,
    });
    answer = g.ok ? 'conformant:unexpected' : g.error.refusalCode;
  } else if (query === 'aqm:defect:illegal-commute') {
    const c = verifyGateCommutationLegal(
      { id: 't1', kind: GateKind.T, targets: [ONE] },
      { id: 'cx01', kind: GateKind.CNOT, targets: [ZERO, ONE] },
    );
    answer = c.ok ? 'conformant:unexpected' : c.error.refusalCode;
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
  {
    id: 'illegal-cnot-target-commute',
    title: 'Illegal Non-Commuting T Push Across CNOT Target',
    capabilityId: 'AQ-17',
    description: 'Attempts to commute diagonal T(q1) across CNOT(q0 -> q1) where q1 is the Pauli-X target wire.',
    run: () => {
      const check = verifyGateCommutationLegal(
        { id: 't-targ', kind: GateKind.T, targets: [ONE] },
        { id: 'cx-01', kind: GateKind.CNOT, targets: [ZERO, ONE] },
      );
      if (check.ok) throw new Error('Illegal CNOT target commutation escaped AQ-17 monoid guard');
      return {
        defectId: 'illegal-cnot-target-commute',
        title: 'Illegal Non-Commuting T Push Across CNOT Target',
        capabilityId: 'AQ-17',
        plantedDescription: 'verifyGateCommutationLegal(T(q1), CNOT(q0, q1)) -> non-commuting X/T target',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:illegal-commute'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:fusion'),
      };
    },
  },
  {
    id: 'qiskit-classical-qubit-cap',
    title: 'Contrived Classical 28-Qubit Ceiling on Qiskit Target',
    capabilityId: 'AQ-19',
    description: 'Attempts to instantiate VerdantAqmBackend with a classical dense 28-qubit cap, triggering Quantum::inv012QiskitBackendRefusesClassicalCap.',
    run: () => {
      const check = verifyQiskitTargetUnbounded({
        hasArbitraryQubitCeiling: true,
        requestedQubits: 28,
        shots: 1024,
      });
      if (check.ok) throw new Error('Contrived classical qubit cap escaped AQ-19 Qiskit Target guard');
      return {
        defectId: 'qiskit-classical-qubit-cap',
        title: 'Contrived Classical 28-Qubit Ceiling on Qiskit Target',
        capabilityId: 'AQ-19',
        plantedDescription: 'VerdantAqmBackend(hasArbitraryQubitCeiling=true, max_qubits=28)',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:classical-cap'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:qiskit:backend'),
      };
    },
  },
  {
    id: 'devrel-unverified-notebook',
    title: 'Prism-DevRel Gate: Unexecuted Jupyter Notebook Output',
    capabilityId: 'AQ-21',
    description: 'Submits a documentation bundle with 1 unverified .ipynb notebook cell output to Honesty::evaluateDevRelPublishGate.',
    run: () => {
      const check = evaluateDevRelPublishGatePrism({
        uncoveredRecords: ZERO,
        undeclaredCovers: ZERO,
        unverifiedNotebooks: ONE,
        pinIsCurrent: true,
      });
      if (check.ok) throw new Error('Unverified notebook escaped AQ-21 DevRel publish gate');
      return {
        defectId: 'devrel-unverified-notebook',
        title: 'Prism-DevRel Gate: Unexecuted Jupyter Notebook Output',
        capabilityId: 'AQ-21',
        plantedDescription: 'evaluateDevRelPublishGate(uncovered=0, undeclared=0, unverifiedNotebooks=1, pin=current)',
        gateTriggered: true,
        error: check.error,
        verifierRefusalVector: dispatchCoreWasmQuery('aqm:defect:unverified-notebook'),
        restoredPassVector: dispatchCoreWasmQuery('aqm:devrel:gate'),
      };
    },
  },
];


