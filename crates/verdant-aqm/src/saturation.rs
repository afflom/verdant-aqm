//! **Verdant AQM Host Saturation, Runtime Governor, CSR Tile Binning & Disjoint Factorization (`saturation.rs`)**
//!
//! Extrapolated from `afflom/verdant-engine` (`VE-33`, `VE-34`, `VE-35`, `VE-36`) under the permanent
//! `prism/parametric-ratchet/1` (`FI-08`) zero-constants policy (`max_engine_rust_magic_literal_count = 0`).
//! Every dimension, scale permille, watchdog ceiling, and codebook table length in this file is
//! derived constructively from `{0, 1}` (`Quantum::inv017HostResourceSaturationAndStability`).

#![forbid(unsafe_code)]

use crate::{pow2_usize, CYCLOTOMIC_RANK, EIGHT, FIVE, ONE, QUBIT_ARITY, SIX, THREE, ZERO};

/// Maximum concurrent in-flight worker frames (`1 + 1 = 2`, `VE-33`).
pub const WORKER_MAX_IN_FLIGHT_FRAMES: usize = QUBIT_ARITY;

/// Software tile edge quantum (`4 * 4 = 16`, `AQ-09`).
pub const CSR_TILE_EDGE_PIXELS: usize = CYCLOTOMIC_RANK * CYCLOTOMIC_RANK;

const EIGHT_U32: u32 = (1_u32 + 1_u32) * ((1_u32 + 1_u32) * (1_u32 + 1_u32));
const TEN_U32: u32 = (1_u32 + 1_u32) * (((1_u32 + 1_u32) * (1_u32 + 1_u32)) + 1_u32);
const FIFTEEN_U64: u64 = ((1_u64 + 1_u64 + 1_u64) * (((1_u64 + 1_u64) * (1_u64 + 1_u64)) + 1_u64));

/// Hoisted `Grid<16> x Grid<16>` codebook product lookup table length (`2^8 = 256`, `VE-35`).
pub const CODEBOOK_PRODUCT_LUT_SIZE: usize = pow2_usize(EIGHT_U32);

/// Constructive `1000` permille identity governor scale (`10 * 10 * 10`).
pub const GOVERNOR_IDENTITY_SCALE_PERMILLE: u32 = TEN_U32 * TEN_U32 * TEN_U32;

/// Constructive `850` permille mild frame-shed governor scale (`1000 - 150`).
pub const GOVERNOR_MILD_SHED_PERMILLE: u32 =
    GOVERNOR_IDENTITY_SCALE_PERMILLE - ((FIFTEEN_U64 as u32) * TEN_U32);

/// Constructive `700` permille heavy frame-shed governor scale (`1000 - 300`).
pub const GOVERNOR_HEAVY_SHED_PERMILLE: u32 =
    GOVERNOR_IDENTITY_SCALE_PERMILLE - (((1_u32 + 1_u32 + 1_u32) * TEN_U32) * TEN_U32);

/// Deadlock-free worker RPC watchdog ceiling (`15 * 1000 = 15000` ms, `VE-35`).
pub const WORKER_RPC_WATCHDOG_MILLIS: u64 =
    FIFTEEN_U64 * ((TEN_U32 as u64) * (TEN_U32 as u64) * (TEN_U32 as u64));

/// Total Verdant container capability organs (`8`, `Subsystems.lex.tex`).
pub const CONTAINER_ORGAN_COUNT: usize = EIGHT;

/// Verdant host container capability organ (`cybernetics.rs` parity).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContainerOrgan {
    WasmCore,
    OffscreenCanvas,
    ServiceWorker,
    AudioWorklet,
    OpfsStorage,
    WebCryptoPrismId,
    BroadcastChannel,
    WorkerPool,
}

impl ContainerOrgan {
    pub const ALL: [Self; CONTAINER_ORGAN_COUNT] = [
        Self::WasmCore,
        Self::OffscreenCanvas,
        Self::ServiceWorker,
        Self::AudioWorklet,
        Self::OpfsStorage,
        Self::WebCryptoPrismId,
        Self::BroadcastChannel,
        Self::WorkerPool,
    ];

    #[must_use]
    pub const fn index(self) -> usize {
        match self {
            Self::WasmCore => ZERO,
            Self::OffscreenCanvas => ONE,
            Self::ServiceWorker => QUBIT_ARITY,
            Self::AudioWorklet => THREE,
            Self::OpfsStorage => CYCLOTOMIC_RANK,
            Self::WebCryptoPrismId => FIVE,
            Self::BroadcastChannel => SIX,
            Self::WorkerPool => SIX + ONE,
        }
    }
}

/// `DenialWins` (`FK-07`) host container capability grant matrix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContainerGrantMatrix {
    host_detected: [bool; CONTAINER_ORGAN_COUNT],
    policy_denied: [bool; CONTAINER_ORGAN_COUNT],
}

impl ContainerGrantMatrix {
    #[must_use]
    pub const fn from_host_detection(host_detected: [bool; CONTAINER_ORGAN_COUNT]) -> Self {
        Self {
            host_detected,
            policy_denied: [false; CONTAINER_ORGAN_COUNT],
        }
    }

    pub fn deny(&mut self, organ: ContainerOrgan) {
        self.policy_denied[organ.index()] = true;
    }

    /// `DenialWins`: an organ is active iff detected on the host AND not denied by policy.
    #[must_use]
    pub const fn is_granted(&self, organ: ContainerOrgan) -> bool {
        let idx = organ.index();
        self.host_detected[idx] && !self.policy_denied[idx]
    }

    #[must_use]
    pub fn granted_count(&self) -> usize {
        let mut total = ZERO;
        for organ in ContainerOrgan::ALL {
            if self.is_granted(organ) {
                total += ONE;
            }
        }
        total
    }
}

/// Host compute-lane saturation plan with zero hardcoded concurrency ceiling (`inv017`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HostSaturationPlan {
    pub detected_cores: usize,
    pub work_units: usize,
    pub active_lanes: usize,
    pub base_units_per_lane: usize,
    pub remainder_lanes: usize,
}

impl HostSaturationPlan {
    /// Saturates all available logical host cores up to `work_units` with zero artificial cap.
    #[must_use]
    pub fn saturate(detected_cores: usize, work_units: usize) -> Self {
        let cores = if detected_cores == ZERO { ONE } else { detected_cores };
        if work_units == ZERO {
            return Self {
                detected_cores: cores,
                work_units: ZERO,
                active_lanes: ZERO,
                base_units_per_lane: ZERO,
                remainder_lanes: ZERO,
            };
        }
        let active_lanes = if cores <= work_units { cores } else { work_units };
        let base_units_per_lane = work_units / active_lanes;
        let remainder_lanes = work_units % active_lanes;
        Self {
            detected_cores: cores,
            work_units,
            active_lanes,
            base_units_per_lane,
            remainder_lanes,
        }
    }

    /// Returns the deterministic `[start, end)` work slice assigned to `lane_index`.
    #[must_use]
    pub const fn lane_range(&self, lane_index: usize) -> (usize, usize) {
        if lane_index >= self.active_lanes {
            return (self.work_units, self.work_units);
        }
        let extra_before = if lane_index < self.remainder_lanes {
            lane_index
        } else {
            self.remainder_lanes
        };
        let start = lane_index * self.base_units_per_lane + extra_before;
        let width = self.base_units_per_lane
            + if lane_index < self.remainder_lanes {
                ONE
            } else {
                ZERO
            };
        (start, start + width)
    }

    #[must_use]
    pub const fn is_optimal(&self) -> bool {
        if self.work_units == ZERO {
            return self.active_lanes == ZERO;
        }
        let expected = if self.detected_cores <= self.work_units {
            self.detected_cores
        } else {
            self.work_units
        };
        self.active_lanes == expected && self.active_lanes >= ONE
    }
}

/// `OntologicalRuntimeGovernor` (`VE-33` / `VE-35` runtime stability & adaptive load governor).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OntologicalRuntimeGovernor;

impl OntologicalRuntimeGovernor {
    #[must_use]
    pub const fn recommend_scale_permille(
        frame_time_micros: u64,
        target_budget_micros: u64,
    ) -> u32 {
        if frame_time_micros <= target_budget_micros {
            GOVERNOR_IDENTITY_SCALE_PERMILLE
        } else if frame_time_micros <= target_budget_micros * (1_u64 + 1_u64) {
            GOVERNOR_MILD_SHED_PERMILLE
        } else {
            GOVERNOR_HEAVY_SHED_PERMILLE
        }
    }

    #[must_use]
    pub const fn epoch_elision_admissible(
        synced_epoch: u64,
        current_epoch: u64,
        force_rebuild: bool,
    ) -> bool {
        !force_rebuild && synced_epoch == current_epoch
    }

    #[must_use]
    pub const fn worker_in_flight_admissible(in_flight_frames: usize) -> bool {
        in_flight_frames <= WORKER_MAX_IN_FLIGHT_FRAMES
    }

    #[must_use]
    pub const fn watchdog_within_bound(elapsed_millis: u64, max_timeout_millis: u64) -> bool {
        elapsed_millis <= max_timeout_millis
    }

    #[must_use]
    pub const fn gpu_context_healthy(context_lost: bool, dimensions_valid: bool) -> bool {
        !context_lost && dimensions_valid
    }
}

/// Flat Compressed Sparse Row (`CSR`) `16x16` screen-tile bin structure (`VE-35`, zero nested `Vec`s).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CsrTileBins {
    pub total_tiles: usize,
    pub counts: Vec<usize>,
    pub offsets: Vec<usize>,
    pub tri_indices: Vec<usize>,
}

impl CsrTileBins {
    /// Builds flat CSR tile bins from `(tri_index, min_tx, max_tx, min_ty, max_ty)` bounds in two linear passes.
    #[must_use]
    pub fn build(
        tiles_x: usize,
        tiles_y: usize,
        tri_tile_spans: &[(usize, usize, usize, usize, usize)],
    ) -> Self {
        let total_tiles = tiles_x * tiles_y;
        let mut counts = vec![ZERO; total_tiles];
        for &(_tri_idx, min_tx, max_tx, min_ty, max_ty) in tri_tile_spans {
            let mut ty = min_ty;
            while ty <= max_ty && ty < tiles_y {
                let mut tx = min_tx;
                while tx <= max_tx && tx < tiles_x {
                    counts[ty * tiles_x + tx] += ONE;
                    tx += ONE;
                }
                ty += ONE;
            }
        }

        let mut offsets = vec![ZERO; total_tiles + ONE];
        let mut running = ZERO;
        let mut t = ZERO;
        while t < total_tiles {
            offsets[t] = running;
            running += counts[t];
            t += ONE;
        }
        offsets[total_tiles] = running;

        let mut cursors = offsets[..total_tiles].to_vec();
        let mut tri_indices = vec![ZERO; running];
        for &(tri_idx, min_tx, max_tx, min_ty, max_ty) in tri_tile_spans {
            let mut ty = min_ty;
            while ty <= max_ty && ty < tiles_y {
                let mut tx = min_tx;
                while tx <= max_tx && tx < tiles_x {
                    let tile_id = ty * tiles_x + tx;
                    let slot = cursors[tile_id];
                    tri_indices[slot] = tri_idx;
                    cursors[tile_id] = slot + ONE;
                    tx += ONE;
                }
                ty += ONE;
            }
        }

        Self {
            total_tiles,
            counts,
            offsets,
            tri_indices,
        }
    }

    /// Verifies `csrTilePrefixMonotonic`: `offsets[t] + counts[t] == offsets[t + 1]` for every tile `t`.
    #[must_use]
    pub fn verify_monotonic(&self) -> bool {
        if self.offsets.len() != self.total_tiles + ONE || self.counts.len() != self.total_tiles {
            return false;
        }
        let mut t = ZERO;
        while t < self.total_tiles {
            if self.offsets[t] + self.counts[t] != self.offsets[t + ONE] {
                return false;
            }
            t += ONE;
        }
        self.offsets[self.total_tiles] == self.tri_indices.len()
    }
}

/// Union-Find Disjoint Wire Factorizer for arbitrary-scale tensor-product quantum circuits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisjointCircuitPartition {
    pub num_qubits: usize,
    pub active_components: Vec<Vec<usize>>,
    pub max_component_qubits: usize,
}

impl DisjointCircuitPartition {
    #[must_use]
    pub fn from_gate_wires(num_qubits: usize, gate_wires: &[&[usize]]) -> Self {
        let mut parent: Vec<usize> = (ZERO..num_qubits).collect();
        let mut rank = vec![ZERO; num_qubits];
        let mut active = vec![false; num_qubits];

        fn find_root(parent: &mut [usize], mut x: usize) -> usize {
            while parent[x] != x {
                let gp = parent[parent[x]];
                parent[x] = gp;
                x = gp;
            }
            x
        }

        for wires in gate_wires {
            if wires.is_empty() {
                continue;
            }
            let first = wires[ZERO];
            if first >= num_qubits {
                continue;
            }
            active[first] = true;
            let mut idx = ONE;
            while idx < wires.len() {
                let w = wires[idx];
                if w < num_qubits {
                    active[w] = true;
                    let ra = find_root(&mut parent, first);
                    let rb = find_root(&mut parent, w);
                    if ra != rb {
                        if rank[ra] < rank[rb] {
                            parent[ra] = rb;
                        } else if rank[ra] > rank[rb] {
                            parent[rb] = ra;
                        } else {
                            parent[rb] = ra;
                            rank[ra] += ONE;
                        }
                    }
                }
                idx += ONE;
            }
        }

        let mut root_to_comp: Vec<Option<usize>> = vec![None; num_qubits];
        let mut active_components: Vec<Vec<usize>> = Vec::new();
        let mut q = ZERO;
        while q < num_qubits {
            if active[q] {
                let r = find_root(&mut parent, q);
                let comp_idx = match root_to_comp[r] {
                    Some(c) => c,
                    None => {
                        let c = active_components.len();
                        active_components.push(Vec::new());
                        root_to_comp[r] = Some(c);
                        c
                    }
                };
                active_components[comp_idx].push(q);
            }
            q += ONE;
        }

        let mut max_component_qubits = ZERO;
        for comp in &active_components {
            if comp.len() > max_component_qubits {
                max_component_qubits = comp.len();
            }
        }

        Self {
            num_qubits,
            active_components,
            max_component_qubits,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_saturation_and_governor_laws_hold() {
        let plan = HostSaturationPlan::saturate(16, 50);
        assert_eq!(plan.active_lanes, 16);
        assert!(plan.is_optimal());
        assert_eq!(plan.lane_range(0), (0, 4));
        assert_eq!(plan.lane_range(15), (47, 50));

        assert_eq!(CODEBOOK_PRODUCT_LUT_SIZE, 256);
        assert_eq!(GOVERNOR_IDENTITY_SCALE_PERMILLE, 1000);
        assert_eq!(GOVERNOR_MILD_SHED_PERMILLE, 850);
        assert_eq!(GOVERNOR_HEAVY_SHED_PERMILLE, 700);
        assert_eq!(WORKER_RPC_WATCHDOG_MILLIS, 15_000);
    }

    #[test]
    fn csr_tile_bins_and_disjoint_partition_exact() {
        let bins = CsrTileBins::build(4, 4, &[(0, 0, 1, 0, 1), (1, 1, 2, 1, 2)]);
        assert!(bins.verify_monotonic());
        assert_eq!(bins.tri_indices.len(), 8);

        let part = DisjointCircuitPartition::from_gate_wires(1000, &[&[0, 1], &[500, 501], &[998, 999]]);
        assert_eq!(part.active_components.len(), 3);
        assert_eq!(part.max_component_qubits, 2);
    }
}
