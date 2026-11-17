/**
 * Verdant AQM — Authoritative Domain Types & Modeled Error Taxonomies (R3, R5)
 */

export enum GateKind {
  H = 'H',
  S = 'S',
  T = 'T',
  X = 'X',
  Y = 'Y',
  Z = 'Z',
  CNOT = 'CNOT',
  CZ = 'CZ',
  SWAP = 'SWAP',
  MEASURE = 'MEASURE',
}

export enum AqmBackendMode {
  CyclotomicExact = 'CyclotomicExact',
  ExactMps = 'ExactMps',
  StabilizerTableau = 'StabilizerTableau',
  AtlasHolospace = 'AtlasHolospace',
}

export enum QuantumIsaErrorKind {
  InvalidQubitIndex = 'QuantumIsaError::InvalidQubitIndex',
  DuplicateWireReference = 'QuantumIsaError::DuplicateWireReference',
  CyclicCircuitDag = 'QuantumIsaError::CyclicCircuitDag',
  PayloadExceedsBoundedBuffer = 'QuantumIsaError::PayloadExceedsBoundedBuffer',
}

export enum UnitaryInvariantErrorKind {
  NonUnitaryOperator = 'UnitaryInvariantError::NonUnitaryOperator',
  NormConservationViolated = 'UnitaryInvariantError::NormConservationViolated',
  WireLinearityBroken = 'UnitaryInvariantError::WireLinearityBroken',
}

export enum StabilizerErrorKind {
  NonCliffordInTableauMode = 'StabilizerError::NonCliffordInTableauMode',
  AnticommutingStabilizerGenerator = 'StabilizerError::AnticommutingStabilizerGenerator',
  EvenSurfaceCodeDistance = 'StabilizerError::EvenSurfaceCodeDistance',
}

export enum AtlasBraidErrorKind {
  NonDiscreteAngleOnCliffordCarrier = 'AtlasBraidError::NonDiscreteAngleOnCliffordCarrier',
  MtcAxiomResidualExceeded = 'AtlasBraidError::MtcAxiomResidualExceeded',
  InvalidAtlasCoordinateProduct = 'AtlasBraidError::InvalidAtlasCoordinateProduct',
}

export enum MeasurementJournalErrorKind {
  SeedOrOutcomeMissing = 'MeasurementJournalError::SeedOrOutcomeMissing',
  CollapsedRegisterWrite = 'MeasurementJournalError::CollapsedRegisterWrite',
}

export enum HonestyVerdictErrorKind {
  RefuseUnanchoredSomeTrue = 'HonestyVerdict::RefuseUnanchoredSomeTrue',
  RefuseBenchMarkedAsProof = 'HonestyVerdict::RefuseBenchMarkedAsProof',
  RefuseMissingDefectGate = 'HonestyVerdict::RefuseMissingDefectGate',
  RefuseLossyUorcChallenger = 'UorcAdmissionError::RefuseLossyReconstruction',
}

export enum QiskitBackendErrorKind {
  ArbitraryClassicalQubitCapImposed = 'QiskitBackendError::ArbitraryClassicalQubitCapImposed',
  InvalidShotsOptionBounds = 'QiskitBackendError::InvalidShotsOptionBounds',
  UnsupportedTargetInstruction = 'QiskitBackendError::UnsupportedTargetInstruction',
  MalformedPauliObservableArity = 'QiskitBackendError::MalformedPauliObservableArity',
}

export enum DevRelPublishErrorKind {
  RefuseMisstatedOrUnverified = 'DevRelPublishOutcome::RefuseMisstatedOrUnverified',
  RegenerateFromPinnedSubject = 'DevRelPublishOutcome::RegenerateFromPinnedSubject',
}

export enum UorcWireErrorKind {
  MissingUorcMagic = 'UorcWireError::MissingUorcMagic',
  SealDigestMismatch = 'UorcWireError::SealDigestMismatch',
  UnsealedPostBootPayload = 'UorcWireError::UnsealedPostBootPayload',
  CorruptedCodedBundle = 'UorcWireError::CorruptedCodedBundle',
}

export enum ParametricRatchetErrorKind {
  WeakenedNonZeroCeiling = 'ParametricRatchetError::WeakenedNonZeroCeiling',
  OntologyRootViolation = 'ParametricRatchetError::OntologyRootViolation',
  UngroundedLexModule = 'ParametricRatchetError::UngroundedLexModule',
  MagicLiteralDetected = 'ParametricRatchetError::MagicLiteralDetected',
  ClassicalChoiceDetected = 'ParametricRatchetError::ClassicalChoiceDetected',
}

export type CapabilityId =
  | 'AQ-01'
  | 'AQ-02'
  | 'AQ-03'
  | 'AQ-04'
  | 'AQ-05'
  | 'AQ-06'
  | 'AQ-07'
  | 'AQ-08'
  | 'AQ-09'
  | 'AQ-10'
  | 'AQ-11'
  | 'AQ-12'
  | 'AQ-13'
  | 'AQ-14'
  | 'AQ-15'
  | 'AQ-16'
  | 'AQ-17'
  | 'AQ-18'
  | 'AQ-19'
  | 'AQ-20'
  | 'AQ-21'
  | 'AQ-22'
  | 'AQ-23';

export type DevRelGateAction = 'publish' | 'regenerate' | 'refuse';

export type ModeledAqmErrorKind =
  | QuantumIsaErrorKind
  | UnitaryInvariantErrorKind
  | StabilizerErrorKind
  | AtlasBraidErrorKind
  | MeasurementJournalErrorKind
  | HonestyVerdictErrorKind
  | QiskitBackendErrorKind
  | DevRelPublishErrorKind
  | UorcWireErrorKind
  | ParametricRatchetErrorKind;

export interface ModeledAqmError {
  readonly kind: ModeledAqmErrorKind;
  readonly capabilityId: string;
  readonly refusalCode: string;
  readonly detail: string;
  readonly stepIndex?: number;
}

export type ForcedCollapseBranch = 'seeded' | 'force0' | 'force1';

export interface AqmGateStep {
  readonly id: string;
  readonly kind: GateKind;
  readonly targets: readonly number[];
  /** Optional explicit dependency step IDs for DAG barrier verification */
  readonly dependsOn?: readonly string[];
  /** Optional branch selection for MEASURE instructions */
  readonly branchMode?: ForcedCollapseBranch;
  /** Allow unitary gates after measurement when explicitly re-preparing; false triggers CollapsedRegisterWrite guard if strict */
  readonly strictPostCollapseGuard?: boolean;
}

export interface AqmCircuitSpec {
  readonly name: string;
  readonly description: string;
  readonly qubitCount: number;
  readonly seed: number;
  readonly backend: AqmBackendMode;
  readonly steps: readonly AqmGateStep[];
}

export interface CompiledDagNode {
  readonly stepIndex: number;
  readonly step: AqmGateStep;
  readonly layerIndex: number;
  readonly parentLayers: readonly number[];
  readonly causalLightconeDepth: number;
}

export interface BlochVector {
  readonly qubit: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly purity: number;
  readonly entropyBits: number;
  readonly p1: number;
  readonly collapsedTo: 0 | 1 | null;
}

export interface EntanglementEdge {
  readonly qubitA: number;
  readonly qubitB: number;
  readonly correlationStrength: number;
}

export interface BasisAmplitudeSummary {
  readonly basisIndex: number;
  readonly bitstring: string;
  readonly exactFormula: string;
  readonly real: number;
  readonly imag: number;
  readonly probability: number;
  readonly phaseRad: number;
}

export interface CodedGemmTelemetry {
  readonly tierName: string;
  readonly nonZeroRuns: number;
  readonly denseEquivalentOps: number;
  readonly codedOpsExecuted: number;
  readonly zeroScratchVerified: boolean;
}

export interface ConservationReport {
  readonly rationalNumerator: string;
  readonly rootTwoCoefficient: string;
  readonly scaleDenominator: string;
  readonly normExactOne: boolean;
  readonly bijectiveWiresVerified: boolean;
  readonly tropicalTerminalReachable: boolean;
}

export interface PlantedDefectResult {
  readonly defectId: string;
  readonly title: string;
  readonly capabilityId: string;
  readonly plantedDescription: string;
  readonly gateTriggered: boolean;
  readonly error: ModeledAqmError;
  readonly verifierRefusalVector: string;
  readonly restoredPassVector: string;
}
