import React from 'react';
import {
  PauliFault,
  SURFACE_CODE_DATA_COORDS,
  SURFACE_CODE_PLAQUETTES,
  extractSurfaceCodeSyndromes,
  verifySurfaceCodeCommutativity,
} from '../aqm/stabilizer';
import { TropicalSyndromeDecodeResult } from '../aqm/tropical';

interface SurfaceCodePanelProps {
  faults: readonly PauliFault[];
  activeBrush: PauliFault;
  lastDecode: TropicalSyndromeDecodeResult | null;
  onSetBrush: (brush: PauliFault) => void;
  onInjectFaultAt: (qubitIdx: number, fault?: PauliFault) => void;
  onRunTropicalDecode: () => void;
  onApplyRecovery: () => void;
  onClearLattice: () => void;
  onOpenIn3D: () => void;
}

export const SurfaceCodePanel: React.FC<SurfaceCodePanelProps> = ({
  faults,
  activeBrush,
  lastDecode,
  onSetBrush,
  onInjectFaultAt,
  onRunTropicalDecode,
  onApplyRecovery,
  onClearLattice,
  onOpenIn3D,
}) => {
  const syn = extractSurfaceCodeSyndromes(faults);
  const commutes = verifySurfaceCodeCommutativity();
  const weight = faults.filter((f) => f !== 'I').length;

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Rotated [[9, 1, 3]] Surface-Code Lattice & Tropical Syndrome Decoder
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            <span>9 Data Qubits</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>4 X-Stabilizers + 4 Z-Stabilizers</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{commutes ? 'Symplectic Inner Product Verified' : 'Commutativity Broken'}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Active Fault Weight {weight}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenIn3D}
            className="h-10 px-4 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Inspect Lattice in 3D Studio
          </button>
          <button
            type="button"
            onClick={onRunTropicalDecode}
            className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            Decode Syndromes via Tropical (min, +)
          </button>
          <button
            type="button"
            onClick={onClearLattice}
            className="h-10 px-3.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Clear Faults
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive 2D Topological Surface-Code Plaquette Diagram */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Interactive Pauli Fault Injection Map
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select a Pauli fault brush and click any data qubit node (d0–d8) to toggle errors.
              </p>
            </div>

            <div
              className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              role="group"
              aria-label="Pauli fault brush"
            >
              {(['X', 'Z', 'Y', 'I'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onSetBrush(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeBrush === p
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {p === 'I' ? 'Clear (I)' : `Inject ${p}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-center py-2">
            <svg
              viewBox="-240 -220 480 440"
              className="w-full max-w-[460px] h-auto"
              role="img"
              aria-label="Rotated d=3 surface code plaquette lattice"
            >
              {/* Stabilizer Plaquettes */}
              {SURFACE_CODE_PLAQUETTES.map((plaq) => {
                const isExcited = syn.excitedIds.includes(plaq.id);
                const cx = plaq.centerX * 105;
                const cy = plaq.centerZ * 105;
                const isBoundary = plaq.dataQubits.length === 2;
                const fill =
                  plaq.kind === 'X'
                    ? isExcited
                      ? 'rgba(245, 158, 11, 0.36)'
                      : 'rgba(14, 116, 144, 0.20)'
                    : isExcited
                      ? 'rgba(244, 63, 94, 0.36)'
                      : 'rgba(4, 120, 87, 0.20)';
                const stroke =
                  plaq.kind === 'X'
                    ? isExcited
                      ? '#f59e0b'
                      : '#0891b2'
                    : isExcited
                      ? '#f43f5e'
                      : '#10b981';

                const w = isBoundary && (plaq.id === 'Z0' || plaq.id === 'Z3') ? 52 : 98;
                const h = isBoundary && (plaq.id === 'X1' || plaq.id === 'X2') ? 52 : 98;

                return (
                  <g key={plaq.id}>
                    <rect
                      x={cx - w / 2}
                      y={cy - h / 2}
                      width={w}
                      height={h}
                      rx={10}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isExcited ? 2.5 : 1.3}
                    />
                    <text
                      x={cx}
                      y={cy + 4}
                      textAnchor="middle"
                      fill={isExcited ? '#ffffff' : '#94a3b8'}
                      fontSize={12}
                      fontWeight={600}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {plaq.id} {isExcited ? '!' : ''}
                    </text>
                  </g>
                );
              })}

              {/* Data Qubit Nodes d0..d8 */}
              {SURFACE_CODE_DATA_COORDS.map((dq) => {
                const f = faults[dq.id] ?? 'I';
                const rec = lastDecode?.recoveryFaults[dq.id] ?? 'I';
                const x = dq.x * 105;
                const y = dq.z * 105;
                const fill =
                  f === 'I'
                    ? '#1e293b'
                    : f === 'X'
                      ? '#be123c'
                      : f === 'Z'
                        ? '#0369a1'
                        : '#b45309';
                const stroke =
                  rec !== 'I'
                    ? '#34d399'
                    : f === 'I'
                      ? '#64748b'
                      : '#f8fafc';

                return (
                  <g
                    key={dq.id}
                    onClick={() => onInjectFaultAt(dq.id, activeBrush)}
                    className="cursor-pointer"
                  >
                    {rec !== 'I' && (
                      <circle
                        cx={x}
                        cy={y}
                        r={28}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    )}
                    <circle cx={x} cy={y} r={21} fill={fill} stroke={stroke} strokeWidth={2} />
                    <text
                      x={x}
                      y={y - 2}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      d{dq.id}
                    </text>
                    <text
                      x={x}
                      y={y + 11}
                      textAnchor="middle"
                      fill="#cbd5e1"
                      fontSize={10}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {f === 'I' ? '·' : f}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Accessible Native Button Grid for Screen Readers & Snapshot Clicks */}
          <div className="grid grid-cols-3 sm:grid-cols-9 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            {SURFACE_CODE_DATA_COORDS.map((dq) => {
              const f = faults[dq.id] ?? 'I';
              return (
                <button
                  key={dq.id}
                  type="button"
                  onClick={() => onInjectFaultAt(dq.id, activeBrush)}
                  aria-label={`Data qubit d${dq.id} current fault ${f}`}
                  className={`h-11 rounded-lg border font-mono text-xs tabular-nums transition-colors ${
                    f === 'I'
                      ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      : 'bg-rose-600/15 border-rose-500 text-rose-700 dark:text-rose-300 font-semibold'
                  }`}
                >
                  d{dq.id}:{f}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Syndrome Telemetry & Tropical (min, +) Recovery Report */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Syndrome Extraction & Logical Observable Parity
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Excited Stabilizers
                </div>
                <div className="mt-1 text-lg font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {syn.excitedIds.length === 0 ? 'None (Clean)' : syn.excitedIds.join(', ')}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Raw Logical Parity
                </div>
                <div className="mt-1 text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
                  X̄: {syn.logicalXFlipped ? '▲ Flipped' : '● Intact'} · Z̄: {syn.logicalZFlipped ? '▲ Flipped' : '● Intact'}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Z-plaquettes (Z0–Z3) detect anticommuting X bit-flip components; X-plaquettes (X0–X3) detect anticommuting Z phase-flip components. Y faults excite both sectors simultaneously.
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Tropical (min, +) Minimum-Weight Recovery
              </h2>
              {lastDecode && (
                <span
                  className={`text-xs font-mono ${
                    lastDecode.logicalPreserved
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {lastDecode.logicalPreserved
                    ? '● Logical Qubit Protected'
                    : '✖ Distance Exceeded (Logical Error)'}
                </span>
              )}
            </div>

            {!lastDecode ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inject one or more Pauli faults on d0–d8, then click &ldquo;Decode Syndromes via Tropical (min, +)&rdquo; to compute shortest dual-lattice recovery chains (`k7` TropicalMinPlusClosure).
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-slate-500">Matched Path Weight</div>
                    <div className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {lastDecode.totalWeight} hop(s)
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Post-Decode Syndromes</div>
                    <div className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {lastDecode.postDecodeExcitedIds.length === 0
                        ? '0 excited'
                        : lastDecode.postDecodeExcitedIds.join(', ')}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-500">
                    Proposed Recovery Operator
                  </div>
                  <div className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {lastDecode.recoveryFaults
                      .map((r, idx) => (r !== 'I' ? `${r}(d${idx})` : null))
                      .filter(Boolean)
                      .join(' ⊗ ') || 'Identity (no recovery needed)'}
                  </div>
                </div>

                {lastDecode.matchedEdges.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-slate-500">
                      Dual-Lattice Shortest Path Edges
                    </div>
                    <ul className="space-y-1 text-xs font-mono text-slate-700 dark:text-slate-300">
                      {lastDecode.matchedEdges.map((edge, i) => (
                        <li key={i}>
                          {edge.kind}: {edge.fromId} → {edge.toId} via d{edge.dataQubit}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onApplyRecovery}
                  className="w-full h-10 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                >
                  Apply Recovery Operator to Lattice
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
