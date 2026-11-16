import React, { useState } from 'react';
import { ExecutedRollbackSession } from '../aqm/journal';
import { gateArity, gateIsClifford } from '../aqm/prismKernel';
import { CANONICAL_CIRCUIT_PRESETS } from '../aqm/slm';
import { computeBackwardLightcone } from '../aqm/tropical';
import {
  AqmBackendMode,
  AqmCircuitSpec,
  AqmGateStep,
  ForcedCollapseBranch,
  GateKind,
  ModeledAqmError,
} from '../aqm/types';

interface CircuitRollbackPanelProps {
  spec: AqmCircuitSpec;
  session: ExecutedRollbackSession | null;
  compileError: ModeledAqmError | null;
  cursor: number;
  selectedWire: number;
  onUpdateSpec: (next: AqmCircuitSpec, nextCursor?: number) => void;
  onSetCursor: (cursor: number) => void;
  onSelectWire: (wire: number) => void;
}

const ALL_GATES: readonly GateKind[] = [
  GateKind.H,
  GateKind.S,
  GateKind.T,
  GateKind.X,
  GateKind.Y,
  GateKind.Z,
  GateKind.CNOT,
  GateKind.CZ,
  GateKind.SWAP,
  GateKind.MEASURE,
];

const BACKEND_LABELS: Record<AqmBackendMode, string> = {
  [AqmBackendMode.CyclotomicExact]: 'Sparse Z[ζ₈]',
  [AqmBackendMode.ExactMps]: 'Exact MPS Q(ζ₈)',
  [AqmBackendMode.StabilizerTableau]: '64-Bit F₂ Tableau',
  [AqmBackendMode.AtlasHolospace]: 'Atlas Braid',
};

const STANDARD_WIRE_COUNTS = [2, 3, 4, 6, 12, 32, 64, 96, 128];

export const CircuitRollbackPanel: React.FC<CircuitRollbackPanelProps> = ({
  spec,
  session,
  compileError,
  cursor,
  selectedWire,
  onUpdateSpec,
  onSetCursor,
  onSelectWire,
}) => {
  const [newGate, setNewGate] = useState<GateKind>(GateKind.H);
  const [wireA, setWireA] = useState<number>(0);
  const [wireB, setWireB] = useState<number>(1);
  const [branchChoice, setBranchChoice] = useState<ForcedCollapseBranch>('seeded');
  const [wireWindowStart, setWireWindowStart] = useState<number>(0);

  const activeFrame =
    session && session.frames.length > 0
      ? session.frames[Math.min(cursor, session.frames.length - 1)]
      : null;

  const lightconeSet = session
    ? computeBackwardLightcone(session.dagNodes, selectedWire, cursor)
    : new Set<number>();

  const handleAppendGate = (e: React.FormEvent) => {
    e.preventDefault();
    const arity = gateArity(newGate);
    const targets = arity === 2 ? [wireA, wireB] : [wireA];
    const nextStep: AqmGateStep = {
      id: `step-${Date.now()}-${spec.steps.length}`,
      kind: newGate,
      targets,
      branchMode: newGate === GateKind.MEASURE ? branchChoice : undefined,
    };
    const nextSteps = [...spec.steps, nextStep];
    onUpdateSpec({ ...spec, steps: nextSteps }, nextSteps.length);
  };

  const handleRemoveStep = (idx: number) => {
    const nextSteps = spec.steps.filter((_, i) => i !== idx);
    onUpdateSpec({ ...spec, steps: nextSteps }, Math.min(cursor, nextSteps.length));
  };

  const handleChangeBranch = (stepIdx: number, mode: ForcedCollapseBranch) => {
    const nextSteps = spec.steps.map((s, idx) =>
      idx === stepIdx ? { ...s, branchMode: mode } : s,
    );
    onUpdateSpec({ ...spec, steps: nextSteps }, cursor);
  };

  const handleChangeQubits = (nextQubits: number) => {
    const filteredSteps = spec.steps.filter((s) => s.targets.every((t) => t < nextQubits));
    onUpdateSpec(
      { ...spec, qubitCount: nextQubits, steps: filteredSteps },
      Math.min(cursor, filteredSteps.length),
    );
    if (wireA >= nextQubits) setWireA(0);
    if (wireB >= nextQubits) setWireB(Math.min(1, nextQubits - 1));
    setWireWindowStart(0);
  };

  const handleSwitchBackend = (backend: AqmBackendMode) => {
    onUpdateSpec({ ...spec, backend }, cursor);
  };

  const maxLayer = session ? Math.max(1, session.dagDepth) : Math.max(1, spec.steps.length);
  const wireOptions = STANDARD_WIRE_COUNTS.includes(spec.qubitCount)
    ? STANDARD_WIRE_COUNTS
    : [...STANDARD_WIRE_COUNTS, spec.qubitCount].sort((a, b) => a - b);

  // Paginated 16-wire focus window for large-scale registers
  const visibleWireCap = 16;
  const clampedStart = Math.max(
    0,
    Math.min(wireWindowStart, Math.max(0, spec.qubitCount - visibleWireCap)),
  );
  const visibleWireCount = Math.min(visibleWireCap, spec.qubitCount - clampedStart);
  const visibleStepsCap = Math.min(spec.steps.length, 48);

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-6 space-y-6">
      {/* Preset & Register Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Unbounded Circuit DAG, Exact MPS & Rollback Journal
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            <span>{spec.qubitCount} Qubits</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{BACKEND_LABELS[spec.backend]}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Kahn DAG Depth {maxLayer}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Seed {spec.seed}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800"
            role="group"
            aria-label="Execution backend"
          >
            {(
              [
                AqmBackendMode.CyclotomicExact,
                AqmBackendMode.ExactMps,
                AqmBackendMode.StabilizerTableau,
                AqmBackendMode.AtlasHolospace,
              ] as const
            ).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleSwitchBackend(mode)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  spec.backend === mode
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {BACKEND_LABELS[mode]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <span>Preset</span>
            <select
              aria-label="Load canonical quantum circuit preset"
              value=""
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (!Number.isNaN(idx) && CANONICAL_CIRCUIT_PRESETS[idx]) {
                  const preset = CANONICAL_CIRCUIT_PRESETS[idx];
                  setWireWindowStart(0);
                  onUpdateSpec(preset, preset.steps.length);
                }
              }}
              className="h-9 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs"
            >
              <option value="" disabled>
                Select preset...
              </option>
              {CANONICAL_CIRCUIT_PRESETS.map((p, idx) => (
                <option key={p.name} value={idx}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <span>Wires</span>
            <select
              aria-label="Register qubit width"
              value={spec.qubitCount}
              onChange={(e) => handleChangeQubits(Number(e.target.value))}
              className="h-9 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs font-mono tabular-nums"
            >
              {wireOptions.map((n) => (
                <option key={n} value={n}>
                  {n} qubits
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Modeled Prism Refusal Alert */}
      {compileError && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="text-sm font-semibold text-rose-800 dark:text-rose-200 font-mono">
              ✖ {compileError.kind} · {compileError.refusalCode}
            </div>
            <p className="text-xs text-rose-700 dark:text-rose-300">{compileError.detail}</p>
          </div>
          {spec.steps.length > 0 && (
            <button
              type="button"
              onClick={() => handleRemoveStep(spec.steps.length - 1)}
              className="px-3.5 py-2 rounded-lg text-xs font-medium bg-rose-700 text-white hover:bg-rose-600 transition-colors whitespace-nowrap shrink-0"
            >
              Remove Offending Instruction
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Gate Composer + Rollback Transport + Interactive SVG Circuit */}
        <div className="lg:col-span-7 space-y-6">
          <form
            onSubmit={handleAppendGate}
            className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Append Gate Instruction
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Wire linearity & Kahn DAG checked on append
              </span>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                <span>Operator</span>
                <select
                  aria-label="Gate operator"
                  value={newGate}
                  onChange={(e) => setNewGate(e.target.value as GateKind)}
                  className="block h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs"
                >
                  {ALL_GATES.map((g) => (
                    <option key={g} value={g}>
                      {g} {!gateIsClifford(g) ? '(Clifford+T)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                <span>{gateArity(newGate) === 2 ? 'Control / Wire A' : 'Target Wire'}</span>
                <select
                  aria-label="Primary target wire"
                  value={wireA}
                  onChange={(e) => setWireA(Number(e.target.value))}
                  className="block h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs tabular-nums"
                >
                  {Array.from({ length: spec.qubitCount }, (_, i) => (
                    <option key={i} value={i}>
                      q{i}
                    </option>
                  ))}
                </select>
              </label>

              {gateArity(newGate) === 2 && (
                <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Target / Wire B</span>
                  <select
                    aria-label="Secondary target wire"
                    value={wireB}
                    onChange={(e) => setWireB(Number(e.target.value))}
                    className="block h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs tabular-nums"
                  >
                    {Array.from({ length: spec.qubitCount }, (_, i) => (
                      <option key={i} value={i}>
                        q{i}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {newGate === GateKind.MEASURE && (
                <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Collapse Branch</span>
                  <select
                    aria-label="Measurement collapse branch mode"
                    value={branchChoice}
                    onChange={(e) => setBranchChoice(e.target.value as ForcedCollapseBranch)}
                    className="block h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="seeded">Seeded Born Draw</option>
                    <option value="force0">Force Branch |0⟩</option>
                    <option value="force1">Force Branch |1⟩</option>
                  </select>
                </label>
              )}

              <button
                type="submit"
                className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                Append Gate
              </button>

              <button
                type="button"
                onClick={() => onUpdateSpec({ ...spec, steps: [] }, 0)}
                className="h-10 px-3.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Clear Circuit
              </button>
            </div>
          </form>

          {/* Prism Algebraic Monoid Gate-Fusion & Involution Canonicalizer (AQ-17) */}
          {session && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Prism Monoid Gate-Fusion &amp; Involution Pass (AQ-17)
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  <span>
                    {session.fusionReport.rawGateCount} → {session.fusionReport.fusedGateCount} gates
                  </span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span>
                    Depth {session.fusionReport.rawDepth} → {session.fusionReport.fusedDepth}
                  </span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {session.fusionReport.gatesEliminated} eliminated ({session.fusionReport.phaseOctantMerges} Z₈ merges, {session.fusionReport.involutionCancellations} involutions)
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const q0 = 0;
                    const q1 = Math.min(1, spec.qubitCount - 1);
                    const base = Date.now();
                    const extra: AqmGateStep[] =
                      spec.backend === AqmBackendMode.StabilizerTableau
                        ? [
                            { id: `pr-${base}-0`, kind: GateKind.S, targets: [q0] },
                            ...(q1 !== q0
                              ? [{ id: `pr-${base}-1`, kind: GateKind.CZ, targets: [q0, q1] }]
                              : []),
                            { id: `pr-${base}-2`, kind: GateKind.S, targets: [q0] },
                            { id: `pr-${base}-3`, kind: GateKind.Z, targets: [q0] },
                            { id: `pr-${base}-4`, kind: GateKind.H, targets: [q1] },
                            { id: `pr-${base}-5`, kind: GateKind.H, targets: [q1] },
                          ]
                        : [
                            { id: `pr-${base}-0`, kind: GateKind.T, targets: [q0] },
                            ...(q1 !== q0
                              ? [{ id: `pr-${base}-1`, kind: GateKind.CZ, targets: [q0, q1] }]
                              : []),
                            { id: `pr-${base}-2`, kind: GateKind.T, targets: [q0] },
                            { id: `pr-${base}-3`, kind: GateKind.S, targets: [q0] },
                            { id: `pr-${base}-4`, kind: GateKind.Z, targets: [q0] },
                            { id: `pr-${base}-5`, kind: GateKind.H, targets: [q1] },
                            { id: `pr-${base}-6`, kind: GateKind.H, targets: [q1] },
                          ];
                    const nextSteps = [...spec.steps, ...extra];
                    onUpdateSpec({ ...spec, steps: nextSteps }, nextSteps.length);
                  }}
                  className="h-9 px-3 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  Plant Redundant Gates
                </button>
                <button
                  type="button"
                  disabled={session.fusionReport.gatesEliminated === 0}
                  onClick={() =>
                    onUpdateSpec(
                      session.fusionReport.optimizedSpec,
                      session.fusionReport.optimizedSpec.steps.length,
                    )
                  }
                  className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
                >
                  Apply Prism Fusion
                </button>
              </div>
            </div>
          )}

          {/* Interactive SVG Topological Circuit & Tropical Causal Lightcone Diagram */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Topological Circuit & Tropical Causal Lightcone
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click any wire label (q{selectedWire} active) to trace its backward (max, +) causal lightcone up to frame {cursor}.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {spec.qubitCount > visibleWireCap && (
                  <div className="flex items-center gap-1 mr-1 text-xs font-mono">
                    <button
                      type="button"
                      disabled={clampedStart === 0}
                      onClick={() => setWireWindowStart(Math.max(0, clampedStart - visibleWireCap))}
                      className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                    >
                      ◀ Wires
                    </button>
                    <span className="text-slate-500">
                      q{clampedStart}–q{clampedStart + visibleWireCount - 1}
                    </span>
                    <button
                      type="button"
                      disabled={clampedStart + visibleWireCap >= spec.qubitCount}
                      onClick={() =>
                        setWireWindowStart(
                          Math.min(spec.qubitCount - visibleWireCap, clampedStart + visibleWireCap),
                        )
                      }
                      className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                    >
                      Wires ▶
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onSetCursor(0)}
                  disabled={cursor === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Reset |0⟩⊗ⁿ
                </button>
                <button
                  type="button"
                  onClick={() => onSetCursor(Math.max(0, cursor - 1))}
                  disabled={cursor === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Step Back
                </button>
                <button
                  type="button"
                  onClick={() => onSetCursor(Math.min(spec.steps.length, cursor + 1))}
                  disabled={cursor >= spec.steps.length}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-500 whitespace-nowrap shrink-0"
                >
                  Step Forward
                </button>
                <button
                  type="button"
                  onClick={() => onSetCursor(spec.steps.length)}
                  disabled={cursor >= spec.steps.length}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Run All
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${Math.max(580, 110 + visibleStepsCap * 64)} ${visibleWireCount * 44 + 28}`}
                className="w-full min-w-[540px] h-auto"
                role="img"
                aria-label="Quantum circuit diagram with rollback cursor"
              >
                <line
                  x1={74 + Math.min(cursor, visibleStepsCap) * 64}
                  y1={8}
                  x2={74 + Math.min(cursor, visibleStepsCap) * 64}
                  y2={visibleWireCount * 44 + 18}
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />

                {Array.from({ length: visibleWireCount }, (_, localIdx) => {
                  const q = clampedStart + localIdx;
                  const y = 28 + localIdx * 44;
                  const isSel = q === selectedWire;
                  return (
                    <g
                      key={q}
                      onClick={() => onSelectWire(q)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={6}
                        y={y - 13}
                        width={56}
                        height={26}
                        rx={6}
                        fill={isSel ? '#065f46' : '#1e293b'}
                        stroke={isSel ? '#34d399' : '#334155'}
                      />
                      <text
                        x={34}
                        y={y + 4}
                        textAnchor="middle"
                        fill={isSel ? '#ecfdf5' : '#cbd5e1'}
                        fontSize={11}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        q{q} |0⟩
                      </text>
                      <line
                        x1={62}
                        y1={y}
                        x2={Math.max(560, 96 + visibleStepsCap * 64)}
                        y2={y}
                        stroke={isSel ? '#10b981' : '#475569'}
                        strokeWidth={isSel ? 2 : 1.25}
                      />
                    </g>
                  );
                })}

                {spec.steps.slice(0, visibleStepsCap).map((step, idx) => {
                  const x = 106 + idx * 64;
                  const executed = idx < cursor;
                  const inCone = lightconeSet.has(idx);
                  const w0 = step.targets[0] ?? 0;
                  const inWin0 = w0 >= clampedStart && w0 < clampedStart + visibleWireCount;
                  const w1 = step.targets[1] ?? w0;
                  const inWin1 = w1 >= clampedStart && w1 < clampedStart + visibleWireCount;
                  if (!inWin0 && !inWin1) return null;

                  const local0 = Math.max(0, Math.min(visibleWireCount - 1, w0 - clampedStart));
                  const y0 = 28 + local0 * 44;
                  const strokeCol =
                    step.kind === GateKind.MEASURE
                      ? '#f59e0b'
                      : inCone
                        ? '#34d399'
                        : executed
                          ? '#38bdf8'
                          : '#64748b';
                  const fillCol =
                    step.kind === GateKind.MEASURE
                      ? '#451a03'
                      : inCone
                        ? '#064e3b'
                        : executed
                          ? '#0c4a6e'
                          : '#0f172a';

                  if (step.targets.length === 2) {
                    const local1 = Math.max(0, Math.min(visibleWireCount - 1, w1 - clampedStart));
                    const y1 = 28 + local1 * 44;
                    return (
                      <g key={step.id} onClick={() => onSetCursor(idx + 1)} className="cursor-pointer">
                        <line x1={x} y1={y0} x2={x} y2={y1} stroke={strokeCol} strokeWidth={2.2} />
                        {inWin0 && <circle cx={x} cy={y0} r={5.5} fill={strokeCol} />}
                        {inWin1 && (
                          <>
                            <circle cx={x} cy={y1} r={13} fill={fillCol} stroke={strokeCol} strokeWidth={1.8} />
                            <text
                              x={x}
                              y={y1 + 4}
                              textAnchor="middle"
                              fill="#f8fafc"
                              fontSize={10}
                              fontFamily="IBM Plex Mono, monospace"
                            >
                              {step.kind === GateKind.CNOT ? '⊕' : step.kind}
                            </text>
                          </>
                        )}
                      </g>
                    );
                  }

                  return (
                    <g key={step.id} onClick={() => onSetCursor(idx + 1)} className="cursor-pointer">
                      <rect
                        x={x - 17}
                        y={y0 - 15}
                        width={34}
                        height={30}
                        rx={6}
                        fill={fillCol}
                        stroke={strokeCol}
                        strokeWidth={1.8}
                      />
                      <text
                        x={x}
                        y={y0 + 4}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize={11}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {step.kind === GateKind.MEASURE ? 'M' : step.kind}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {spec.steps.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                Circuit is empty (register in ground state |0⟩⊗ⁿ). Append a gate or pick a preset above.
              </p>
            ) : (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  SHA-256 Journal Steps ({spec.steps.length} total) & Measurement Branch Controls
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800/80">
                  {spec.steps.slice(0, 160).map((step, idx) => {
                    const jEntry = session?.journal[idx];
                    const isActive = idx < cursor;
                    return (
                      <div
                        key={step.id}
                        className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span
                            className={
                              isActive
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : 'text-slate-400'
                            }
                          >
                            #{String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="text-slate-900 dark:text-slate-100 font-medium">
                            {step.kind}({step.targets.map((w) => `q${w}`).join(', ')})
                          </span>
                          {jEntry?.measurement && (
                            <span className="text-amber-600 dark:text-amber-400">
                              → |{jEntry.measurement.outcome}⟩ (P₀=
                              {(jEntry.measurement.probZero * 100).toFixed(1)}%)
                            </span>
                          )}
                          {jEntry && (
                            <span className="text-slate-400 hidden sm:inline">
                              sha256:{jEntry.chainDigest.slice(0, 10)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {step.kind === GateKind.MEASURE && (
                            <select
                              aria-label={`Re-branch measurement outcome for step ${idx + 1}`}
                              value={step.branchMode ?? 'seeded'}
                              onChange={(e) =>
                                handleChangeBranch(idx, e.target.value as ForcedCollapseBranch)
                              }
                              className="h-7 px-2 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                            >
                              <option value="seeded">Seeded Draw</option>
                              <option value="force0">Force |0⟩</option>
                              <option value="force1">Force |1⟩</option>
                            </select>
                          )}
                          <button
                            type="button"
                            aria-label={`Jump to frame ${idx + 1}`}
                            onClick={() => onSetCursor(idx + 1)}
                            className="px-2 py-1 rounded text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Inspect
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete step ${idx + 1} ${step.kind}`}
                            onClick={() => handleRemoveStep(idx)}
                            className="px-2 py-1 rounded text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Exact State / MPS / Tableau / Atlas Telemetry */}
        <div className="lg:col-span-5 space-y-6">
          {activeFrame && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  k14 Norm Conservation & Tensor Bond Ranks
                </h2>
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                  {activeFrame.conservation.normExactOne ? '● Exact Norm = 1' : '✖ Violated'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Scaled Probability Mass
                  </div>
                  <div className="mt-0.5 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 break-all">
                    {activeFrame.conservation.rationalNumerator} /{' '}
                    {activeFrame.conservation.scaleDenominator}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Bond / Carrier Rank χ
                  </div>
                  <div className="mt-0.5 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 truncate">
                    [{activeFrame.mpsBondDimensions.slice(0, 8).join(', ')}
                    {activeFrame.mpsBondDimensions.length > 8 ? ', …' : ''}]
                  </div>
                </div>
              </div>

              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                Frame #{activeFrame.cursor} Chain Tip · {activeFrame.chainDigest}
              </div>
            </div>
          )}

          {activeFrame && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Single-Qubit Reduced Bloch Coordinates
                </h2>
                <span className="text-xs font-mono text-slate-500">
                  Showing q{clampedStart}–q{clampedStart + visibleWireCount - 1}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-1.5 pr-2">Wire</th>
                      <th className="py-1.5 px-2">⟨X⟩</th>
                      <th className="py-1.5 px-2">⟨Y⟩</th>
                      <th className="py-1.5 px-2">⟨Z⟩</th>
                      <th className="py-1.5 px-2">Purity</th>
                      <th className="py-1.5 pl-2">P(|1⟩)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {activeFrame.blochVectors
                      .slice(clampedStart, clampedStart + visibleWireCount)
                      .map((bv) => (
                        <tr
                          key={bv.qubit}
                          onClick={() => onSelectWire(bv.qubit)}
                          className={`cursor-pointer ${
                            bv.qubit === selectedWire
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <td className="py-1.5 pr-2 font-semibold">q{bv.qubit}</td>
                          <td className="py-1.5 px-2">
                            {(Math.abs(bv.rx) < 1e-9 ? 0 : bv.rx).toFixed(3)}
                          </td>
                          <td className="py-1.5 px-2">
                            {(Math.abs(bv.ry) < 1e-9 ? 0 : bv.ry).toFixed(3)}
                          </td>
                          <td className="py-1.5 px-2">
                            {(Math.abs(bv.rz) < 1e-9 ? 0 : bv.rz).toFixed(3)}
                          </td>
                          <td className="py-1.5 px-2">{bv.purity.toFixed(3)}</td>
                          <td className="py-1.5 pl-2">{(bv.p1 * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeFrame && activeFrame.basisAmplitudes.length > 0 && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Active Sparse Kets / Carrier Channels
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {activeFrame.cyclotomic
                    ? `${activeFrame.cyclotomic.support.size} exact ket(s) in 2^${spec.qubitCount}`
                    : `${activeFrame.basisAmplitudes.length} channel(s)`}
                </span>
              </div>

              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-1.5 pr-2">Basis</th>
                      <th className="py-1.5 px-2">Representation</th>
                      <th className="py-1.5 px-2">Prob</th>
                      <th className="py-1.5 pl-2">Phase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {activeFrame.basisAmplitudes
                      .filter((a) => a.probability > 1e-8)
                      .map((amp) => {
                        const shortKet =
                          amp.bitstring.length > 16
                            ? `${amp.bitstring.slice(0, 8)}…${amp.bitstring.slice(-6)}`
                            : amp.bitstring;
                        return (
                          <tr key={`${amp.basisIndex}-${amp.bitstring}`} className="text-slate-800 dark:text-slate-200">
                            <td className="py-1.5 pr-2 font-semibold">|{shortKet}⟩</td>
                            <td className="py-1.5 px-2 text-emerald-700 dark:text-emerald-400">
                              {amp.exactFormula}
                            </td>
                            <td className="py-1.5 px-2">{(amp.probability * 100).toFixed(2)}%</td>
                            <td className="py-1.5 pl-2">
                              {((amp.phaseRad * 180) / Math.PI).toFixed(1)}°
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeFrame && spec.backend === AqmBackendMode.StabilizerTableau && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Active F₂ Stabilizer Generators (Word-Packed)
                </h2>
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                  {activeFrame.stabilizersCommute ? '● Pairwise Commuting' : '✖ Anticommuting'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs tabular-nums max-h-64 overflow-y-auto">
                {activeFrame.stabilizerGenerators.map((gen, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 truncate"
                  >
                    S{idx}: {gen}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
