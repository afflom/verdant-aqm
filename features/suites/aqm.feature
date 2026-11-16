Feature: Verdant Abstract Quantum Machine (AQM) Prism Conformance

  Scenario: AQ-01 Constructive Stratum 0 powers of two and BoundedBuffer limits
    Given Stratum 0 derives powers of two constructively from {0, 1}
    When evaluating a 4-qubit Hilbert dimension and Core-Wasm request envelope
    Then Hilbert dimension equals 16 and request maximum equals 64 bytes with zero magic literals
    And oversized payloads exceeding BoundedBuffer return QuantumIsaError::PayloadExceedsBoundedBuffer

  Scenario: AQ-02 Wire linearity and no-cloning refusal on duplicate wire CNOT
    Given a 4-qubit register specification
    When validating CNOT(q0, q1) versus planted defect CNOT(q0, q0)
    Then CNOT(q0, q1) passes wiresDistinctAndBounded
    And CNOT(q0, q0) is refused with QuantumIsaError::DuplicateWireReference

  Scenario: AQ-03 Kahn circuit DAG topological ordering and cycle refusal
    Given a multi-layer quantum circuit instruction sequence
    When compiling acyclic gate layers versus a planted cyclic dependency
    Then acyclic layers schedule deterministically with causal parentLayer < layerIndex
    And cyclic dependencies are refused with QuantumIsaError::CyclicCircuitDag

  Scenario: AQ-04 Exact cyclotomic Z[zeta_8]/(sqrt(2))^k state vector and l2 norm conservation
    Given a 3-qubit GHZ+T circuit over exact cyclotomic amplitudes
    When contracting Hadamard, T, and CNOT operators
    Then every step preserves scaled probability mass sum |alpha_i|^2 = 1 bit-identically
    And planted non-unitary operators are refused with UnitaryInvariantError::NormConservationViolated

  Scenario: AQ-05 Gottesman-Knill F_2 symplectic tableau and surface-code syndrome commutativity
    Given a 9-data-qubit rotated surface-code lattice over F_2
    When extracting X and Z stabilizer plaquettes and injecting a Pauli X fault
    Then all stabilizer generators pairwise commute under symplectic inner product
    And non-Clifford T gates in tableau mode are refused with StabilizerError::NonCliffordInTableauMode

  Scenario: AQ-06 Tropical (min, +) syndrome decoding and (max, +) causal lightcones
    Given an excited surface-code syndrome pattern on the 3D lattice
    When executing tropical (min, +) shortest-path closure
    Then the minimum-weight recovery operator clears all syndrome excitations

  Scenario: AQ-07 Journaled Born-rule collapse, 64-frame rollback, and #vdnt= snapshot round-trip
    Given a Bell pair circuit with seeded projective measurement
    When stepping through measurement collapse, rolling back, and re-branching the outcome
    Then SHA-256 DeterministicInputJournal restores exact pre-collapse cyclotomic amplitudes
    And #vdnt= snapshot URLs decode to bit-identical machine state

  Scenario: AQ-08 Progressive UORC-SHA256-CHAIN-v1 LOD0..LOD4 and 2-of-3 Stitch XOR parity recovery
    Given an active quantum state packed into UORC-SHA256-CHAIN-v1
    When sharding into 3 Stitch fragments and dropping any 1 fragment
    Then 2 remaining fragments reconstruct the bit-exact UORC chain and verify SHA-256 integrity

  Scenario: AQ-09 Invariant-guarded 4-bit CodedSlmDirector natural-language proposal routing
    Given natural-language operator prompts routed through 4-bit nibble coded_gemm
    When proposing "prepare 3-qubit GHZ state" versus "clone q0 onto q0"
    Then valid proposals admit verified AQM gate sequences
    And cloning proposals are blocked under DenialWins with UnitaryInvariantError::WireLinearityBroken
