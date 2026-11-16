/**
 * Constructive helpers for Tropical minimum-weight syndrome matching across parametric
 * odd-distance `[[d^2, 1, d]]` surface-code lattices (`tropicalHelpers.ts`).
 *
 * Uses exact branch-and-bound minimum-weight matching for <= 10 excited defects and
 * sorted shortest-path greedy defect/boundary pairing for dense fault patterns (> 10 defects).
 */

import { FOUR, NINE, ONE, TEN, TWO, ZERO } from './stratum0';

export { NINE, ONE, ZERO };
export const SURFACE_CODE_PLAQUETTES_COUNT_HALF = FOUR;

export function extractSyndromesHelper(
  defects: readonly number[],
  boundaryIdx: number,
  dist: Int32Array,
  nodeCount: number,
): { cost: number; pairs: Array<[number, number]> } {
  if (defects.length === ZERO) {
    return { cost: ZERO, pairs: [] };
  }

  // Fast greedy minimum-weight tropical matching when defect count > 10 (large d=7,9 dense faults)
  if (defects.length > TEN) {
    const unmatched = new Set<number>(defects);
    const candidates: Array<{ u: number; v: number; w: number; isBoundary: boolean }> = [];
    for (let i = ZERO; i < defects.length; i += ONE) {
      const u = defects[i];
      candidates.push({
        u,
        v: boundaryIdx,
        w: dist[u * nodeCount + boundaryIdx],
        isBoundary: true,
      });
      for (let j = i + ONE; j < defects.length; j += ONE) {
        const v = defects[j];
        candidates.push({
          u,
          v,
          w: dist[u * nodeCount + v],
          isBoundary: false,
        });
      }
    }
    // Sort by per-defect normalized weight (pair of 2 defects at weight w costs w/2 per defect vs boundary w)
    candidates.sort((a, b) => {
      const effA = a.isBoundary ? a.w : a.w / TWO;
      const effB = b.isBoundary ? b.w : b.w / TWO;
      return effA - effB;
    });

    let totalCost = ZERO;
    const pairs: Array<[number, number]> = [];
    for (const cand of candidates) {
      if (unmatched.size === ZERO) break;
      if (cand.isBoundary) {
        if (unmatched.has(cand.u)) {
          unmatched.delete(cand.u);
          totalCost += cand.w;
          pairs.push([cand.u, boundaryIdx]);
        }
      } else if (unmatched.has(cand.u) && unmatched.has(cand.v)) {
        unmatched.delete(cand.u);
        unmatched.delete(cand.v);
        totalCost += cand.w;
        pairs.push([cand.u, cand.v]);
      }
    }
    return { cost: totalCost, pairs };
  }

  // Exact branch-and-bound minimum-weight matching for <= 10 defects (covers all weight <= 4 faults on d=3,5,7,9!)
  let globalBestCost = 1_000_000_000;
  let globalBestPairs: Array<[number, number]> = [];

  function dfs(
    remaining: readonly number[],
    accCost: number,
    accPairs: Array<[number, number]>,
  ): void {
    if (accCost >= globalBestCost) return;
    if (remaining.length === ZERO) {
      globalBestCost = accCost;
      globalBestPairs = accPairs.slice();
      return;
    }

    const first = remaining[ZERO];
    const restAfterFirst = remaining.slice(ONE);

    // Try pairing `first` with another excited defect first (often tighter upper bound)
    for (let k = ONE; k < remaining.length; k += ONE) {
      const partner = remaining[k];
      const w = dist[first * nodeCount + partner];
      const nextRem = restAfterFirst.filter((_, idx) => idx !== k - ONE);
      accPairs.push([first, partner]);
      dfs(nextRem, accCost + w, accPairs);
      accPairs.pop();
    }

    // Try matching `first` directly to the rough/smooth Boundary
    const bWeight = dist[first * nodeCount + boundaryIdx];
    accPairs.push([first, boundaryIdx]);
    dfs(restAfterFirst, accCost + bWeight, accPairs);
    accPairs.pop();
  }

  dfs(defects, ZERO, []);
  return { cost: globalBestCost, pairs: globalBestPairs };
}
