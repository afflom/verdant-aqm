/**
 * Stratum 1C — Tropical Semiring `(min, +)` & `(max, +)` Kernels (`tropical.ts`)
 * Repurposes verdant-tensor kernels k2, k7, k12 for:
 *  1. All-pairs shortest syndrome-decoding paths on parametric `[[d^2, 1, d]]` surface-code dual graphs (`k7`).
 *  2. Minimum-weight matching recovery for arbitrary odd code distances d = 3, 5, 7, 9+.
 *  3. Backward `(max, +)` causal lightcone extraction across compiled circuit DAGs.
 */

import { ONE, ZERO, extractSyndromesHelper } from './tropicalHelpers';
import {
  PauliFault,
  StabilizerPlaquetteSpec,
  buildRotatedSurfaceCode,
  extractSurfaceCodeSyndromes,
  inferSurfaceCodeDistance,
} from './stabilizer';
import { CompiledDagNode } from './types';

export const TROPICAL_INF = 1_000_000;

/**
 * Tropical (min, +) matrix multiplication: C[i, j] = min_k (A[i, k] + B[k, j])
 */
export function tropicalMinPlusGemm(a: Int32Array, b: Int32Array, n: number): Int32Array {
  const out = new Int32Array(n * n).fill(TROPICAL_INF);
  for (let i = ZERO; i < n; i += ONE) {
    for (let k = ZERO; k < n; k += ONE) {
      const aik = a[i * n + k];
      if (aik >= TROPICAL_INF) continue;
      for (let j = ZERO; j < n; j += ONE) {
        const bkj = b[k * n + j];
        if (bkj >= TROPICAL_INF) continue;
        const cand = aik + bkj;
        if (cand < out[i * n + j]) {
          out[i * n + j] = cand;
        }
      }
    }
  }
  return out;
}

/**
 * Computes all-pairs shortest distances and next-hop predecessor witness via Tropical (min, +) closure (`k7`).
 */
export function tropicalMinPlusClosureWithPaths(
  weights: Int32Array,
  nextHopInit: Int32Array,
  n: number,
): { dist: Int32Array; nextHop: Int32Array } {
  const dist = new Int32Array(weights);
  const nextHop = new Int32Array(nextHopInit);

  for (let k = ZERO; k < n; k += ONE) {
    for (let i = ZERO; i < n; i += ONE) {
      const dik = dist[i * n + k];
      if (dik >= TROPICAL_INF) continue;
      for (let j = ZERO; j < n; j += ONE) {
        const dkj = dist[k * n + j];
        if (dkj >= TROPICAL_INF) continue;
        const cand = dik + dkj;
        if (cand < dist[i * n + j]) {
          dist[i * n + j] = cand;
          nextHop[i * n + j] = nextHop[i * n + k];
        }
      }
    }
  }
  return { dist, nextHop };
}

export interface TropicalSyndromeDecodeResult {
  readonly distance: number;
  readonly recoveryFaults: PauliFault[];
  readonly residualFaults: PauliFault[];
  readonly matchedEdges: ReadonlyArray<{
    readonly kind: 'X-correction' | 'Z-correction';
    readonly fromId: string;
    readonly toId: string;
    readonly dataQubit: number;
  }>;
  readonly totalWeight: number;
  readonly postDecodeExcitedIds: string[];
  readonly logicalPreserved: boolean;
}

/**
 * Decodes X-faults (from Z-plaquette syndromes) and Z-faults (from X-plaquette syndromes)
 * on any odd-distance `[[d^2, 1, d]]` rotated surface code (`d = 3, 5, 7, 9+`)
 * using Tropical (min, +) dual-lattice shortest paths & minimum-weight pairing.
 */
export function decodeSurfaceCodeTropical(
  currentFaults: readonly PauliFault[],
  explicitDistance?: number,
): TropicalSyndromeDecodeResult {
  const d = inferSurfaceCodeDistance(currentFaults.length, explicitDistance);
  const patch = buildRotatedSurfaceCode(d);
  const dataCount = patch.dataQubitCount;
  const syn = extractSurfaceCodeSyndromes(currentFaults, d);

  const zPlaqs = patch.plaquettes.filter((p) => p.kind === 'Z');
  const xPlaqs = patch.plaquettes.filter((p) => p.kind === 'X');

  const decodeSector = (
    plaqs: readonly StabilizerPlaquetteSpec[],
    excitedFlags: readonly boolean[],
    corrLabel: 'X-correction' | 'Z-correction',
  ) => {
    const boundaryIdx = plaqs.length;
    const nodeCount = boundaryIdx + ONE;

    const weights = new Int32Array(nodeCount * nodeCount).fill(TROPICAL_INF);
    const edgeQubit = new Int32Array(nodeCount * nodeCount).fill(-ONE);
    const nextHopInit = new Int32Array(nodeCount * nodeCount).fill(-ONE);

    for (let i = ZERO; i < nodeCount; i += ONE) {
      weights[i * nodeCount + i] = ZERO;
      nextHopInit[i * nodeCount + i] = i;
    }

    // Each data qubit q in 0..d^2-1 touches 2 plaquettes (interior dual edge) or 1 plaquette (rough/smooth boundary edge)
    for (let q = ZERO; q < dataCount; q += ONE) {
      const touching: number[] = [];
      for (let pIdx = ZERO; pIdx < plaqs.length; pIdx += ONE) {
        if (plaqs[pIdx].dataQubits.includes(q)) {
          touching.push(pIdx);
        }
      }
      if (touching.length === ONE + ONE) {
        const u = touching[ZERO];
        const v = touching[ONE];
        if (ONE < weights[u * nodeCount + v]) {
          weights[u * nodeCount + v] = ONE;
          weights[v * nodeCount + u] = ONE;
          edgeQubit[u * nodeCount + v] = q;
          edgeQubit[v * nodeCount + u] = q;
          nextHopInit[u * nodeCount + v] = v;
          nextHopInit[v * nodeCount + u] = u;
        }
      } else if (touching.length === ONE) {
        const u = touching[ZERO];
        if (ONE < weights[u * nodeCount + boundaryIdx]) {
          weights[u * nodeCount + boundaryIdx] = ONE;
          weights[boundaryIdx * nodeCount + u] = ONE;
          edgeQubit[u * nodeCount + boundaryIdx] = q;
          edgeQubit[boundaryIdx * nodeCount + u] = q;
          nextHopInit[u * nodeCount + boundaryIdx] = boundaryIdx;
          nextHopInit[boundaryIdx * nodeCount + u] = u;
        }
      }
    }

    const { dist, nextHop } = tropicalMinPlusClosureWithPaths(weights, nextHopInit, nodeCount);

    const defects: number[] = [];
    for (let i = ZERO; i < plaqs.length; i += ONE) {
      if (excitedFlags[i]) defects.push(i);
    }

    const bestPairings = extractSyndromesHelper(defects, boundaryIdx, dist, nodeCount);
    const flippedQubits = new Uint8Array(dataCount);
    const edgesUsed: Array<{
      kind: 'X-correction' | 'Z-correction';
      fromId: string;
      toId: string;
      dataQubit: number;
    }> = [];

    for (const [startNode, endNode] of bestPairings.pairs) {
      let cur = startNode;
      while (cur !== endNode) {
        const nxt = nextHop[cur * nodeCount + endNode];
        if (nxt < ZERO || nxt === cur) break;
        const dq = edgeQubit[cur * nodeCount + nxt];
        if (dq >= ZERO) {
          flippedQubits[dq] ^= ONE;
          edgesUsed.push({
            kind: corrLabel,
            fromId: cur === boundaryIdx ? 'Boundary' : plaqs[cur].id,
            toId: nxt === boundaryIdx ? 'Boundary' : plaqs[nxt].id,
            dataQubit: dq,
          });
        }
        cur = nxt;
      }
    }

    return { flippedQubits, edgesUsed, cost: bestPairings.cost };
  };

  const xDecode = decodeSector(zPlaqs, syn.zSyndromes, 'X-correction');
  const zDecode = decodeSector(xPlaqs, syn.xSyndromes, 'Z-correction');

  const composePauli = (a: PauliFault, b: PauliFault): PauliFault => {
    const ax = a === 'X' || a === 'Y' ? ONE : ZERO;
    const az = a === 'Z' || a === 'Y' ? ONE : ZERO;
    const bx = b === 'X' || b === 'Y' ? ONE : ZERO;
    const bz = b === 'Z' || b === 'Y' ? ONE : ZERO;
    const rx = ax ^ bx;
    const rz = az ^ bz;
    if (rx === ZERO && rz === ZERO) return 'I';
    if (rx === ONE && rz === ZERO) return 'X';
    if (rx === ZERO && rz === ONE) return 'Z';
    return 'Y';
  };

  const recoveryFaults: PauliFault[] = new Array(dataCount);
  const residualFaults: PauliFault[] = new Array(dataCount);
  for (let q = ZERO; q < dataCount; q += ONE) {
    const rx = xDecode.flippedQubits[q];
    const rz = zDecode.flippedQubits[q];
    const rec: PauliFault =
      rx === ZERO && rz === ZERO ? 'I' : rx === ONE && rz === ZERO ? 'X' : rx === ZERO ? 'Z' : 'Y';
    recoveryFaults[q] = rec;
    residualFaults[q] = composePauli(currentFaults[q] ?? 'I', rec);
  }

  const postSyn = extractSurfaceCodeSyndromes(residualFaults, d);
  return {
    distance: d,
    recoveryFaults,
    residualFaults,
    matchedEdges: [...xDecode.edgesUsed, ...zDecode.edgesUsed],
    totalWeight: xDecode.cost + zDecode.cost,
    postDecodeExcitedIds: postSyn.excitedIds,
    logicalPreserved:
      postSyn.excitedIds.length === ZERO && !postSyn.logicalXFlipped && !postSyn.logicalZFlipped,
  };
}

/**
 * Computes the backward causal lightcone (all gate indices in the past causal cone of `targetWire`
 * up to `maxStepExclusive`) via Tropical `(max, +)` reverse reachability.
 */
export function computeBackwardLightcone(
  nodes: readonly CompiledDagNode[],
  targetWire: number,
  maxStepExclusive: number,
): Set<number> {
  const activeWires = new Set<number>([targetWire]);
  const coneSteps = new Set<number>();
  const upper = Math.min(nodes.length, maxStepExclusive);

  for (let i = upper - ONE; i >= ZERO; i -= ONE) {
    const step = nodes[i].step;
    let touches = false;
    for (const w of step.targets) {
      if (activeWires.has(w)) {
        touches = true;
        break;
      }
    }
    if (touches) {
      coneSteps.add(i);
      for (const w of step.targets) {
        activeWires.add(w);
      }
    }
  }
  return coneSteps;
}
