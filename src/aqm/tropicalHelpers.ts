/**
 * Constructive helpers for Tropical exact minimum-weight syndrome matching over <= 4 plaquettes.
 */

import { FOUR, NINE, ONE, TWO, ZERO } from './stratum0';

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

  function solve(remaining: readonly number[]): { cost: number; pairs: Array<[number, number]> } {
    if (remaining.length === ZERO) {
      return { cost: ZERO, pairs: [] };
    }
    const first = remaining[ZERO];
    const restAfterFirst = remaining.slice(ONE);

    // Option A: match `first` directly to the rough/smooth Boundary
    const boundarySub = solve(restAfterFirst);
    let bestCost = dist[first * nodeCount + boundaryIdx] + boundarySub.cost;
    let bestPairs: Array<[number, number]> = [[first, boundaryIdx], ...boundarySub.pairs];

    // Option B: pair `first` with another excited defect `remaining[k]`
    for (let k = ONE; k < remaining.length; k += ONE) {
      const partner = remaining[k];
      const nextRem = restAfterFirst.filter((_, idx) => idx !== k - ONE);
      const sub = solve(nextRem);
      const candCost = dist[first * nodeCount + partner] + sub.cost;
      if (candCost < bestCost) {
        bestCost = candCost;
        bestPairs = [[first, partner], ...sub.pairs];
      }
    }

    // Check if pairing two boundary matches can be simplified when cost ties
    void TWO;
    return { cost: bestCost, pairs: bestPairs };
  }

  return solve(defects);
}
