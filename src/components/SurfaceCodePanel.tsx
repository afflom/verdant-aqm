import React from 'react';
import {
  PauliFault,
  buildRotatedSurfaceCode,
  extractSurfaceCodeSyndromes,
  verifySurfaceCodeCommutativity,
} from '../aqm/stabilizer';
import { TropicalSyndromeDecodeResult } from '../aqm/tropical';

interface SurfaceCodePanelProps {
  distance: 3 | 5 | 7 | 9 | 11;
  faults: readonly PauliFault[];
  activeBrush: PauliFault;
  lastDecode: TropicalSyndromeDecodeResult | null;
  onChangeDistance: (d: 3 | 5 | 7 | 9 | 11) => void;
  onSetBrush: (brush: PauliFault) => void;
  onInjectFaultAt: (qubitIdx: number, fault?: PauliFault) => void;
  onInjectMultiFaultPreset: () => void;
  onRunTropicalDecode: () => void;
  onApplyRecovery: () => void;
  onClearLattice: () => void;
  onOpenIn3D: () => void;
}

export const SurfaceCodePanel: React.FC<SurfaceCodePanelProps> = ({
  distance,
  faults,
  activeBrush,
  lastDecode,
  onChangeDistance,
  onSetBrush,
  onInjectFaultAt,
  onInjectMultiFaultPreset,
  onRunTropicalDecode,
  onApplyRecovery,
  onClearLattice,
  onOpenIn3D,
}) => {
  const patch = buildRotatedSurfaceCode(distance);
  const syn = extractSurfaceCodeSyndromes(faults, distance);
  const commutes = verifySurfaceCodeCommutativity(distance);
  const weight = faults.filter((f) => f !== 'I').length;
  const correctableFloor = Math.floor((distance - 1) / 2);

  // Scale SVG lattice spacing cleanly for any odd distance d in {3, 5, 7, 9}
  const cellSpacing = 320 / distance;
  const nodeRadius = Math.max(10, Math.round(21 * (3 / distance)));
  const fontSizeMain = distance <= 5 ? 11 : 8.5;

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Parametric [[{patch.dataQubitCount}, 1, {distance}]] Rotated Surface-Code & Tropical Decoder
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            <span>{patch.dataQubitCount} Data Qubits</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{patch.plaquettes.length} Stabilizers</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Guarantees Weight ≤ {correctableFloor}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{commutes ? 'Symplectic Inner Product Verified' : 'Commutativity Broken'}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Active Weight {weight}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Odd Code Distance Selector */}
          <div
            className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800"
            role="group"
            aria-label="Rotated surface code odd distance"
          >
            {([3, 5, 7, 9, 11] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onChangeDistance(d)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                  distance === d
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                d={d} ({d * d}q)
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onInjectMultiFaultPreset}
            className="h-10 px-3.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Inject Weight-{correctableFloor} Fault
          </button>

          <button
            type="button"
            onClick={onOpenIn3D}
            className="h-10 px-3.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Inspect in 3D Studio
          </button>

          <button
            type="button"
            onClick={onRunTropicalDecode}
            className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            Decode via Tropical (min, +)
          </button>

          <button
            type="button"
            onClick={onClearLattice}
            className="h-10 px-3 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive 2D Topological Surface-Code Plaquette Diagram */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Interactive d={distance} Pauli Fault Injection Map
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select a Pauli brush and click any data qubit node (d0–d{patch.dataQubitCount - 1}) to toggle errors.
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
              viewBox="-240 -230 480 460"
              className="w-full max-w-[490px] h-auto"
              role="img"
              aria-label={`Rotated d=${distance} surface code plaquette lattice`}
            >
              {patch.plaquettes.map((plaq) => {
                const isExcited = syn.excitedIds.includes(plaq.id);
                const cx = plaq.centerX * cellSpacing;
                const cy = plaq.centerZ * cellSpacing;
                const fill =
                  plaq.kind === 'X'
                    ? isExcited
                      ? 'rgba(245, 158, 11, 0.38)'
                      : 'rgba(14, 116, 144, 0.20)'
                    : isExcited
                      ? 'rgba(244, 63, 94, 0.38)'
                      : 'rgba(4, 120, 87, 0.20)';
                const stroke =
                  plaq.kind === 'X'
                    ? isExcited
                      ? '#f59e0b'
                      : '#0891b2'
                    : isExcited
                      ? '#f43f5e'
                      : '#10b981';

                const fullBox = cellSpacing * 0.92;
                const halfBox = cellSpacing * 0.48;
                const w =
                  plaq.boundaryOrientation === 'left' || plaq.boundaryOrientation === 'right'
                    ? halfBox
                    : fullBox;
                const h =
                  plaq.boundaryOrientation === 'top' || plaq.boundaryOrientation === 'bottom'
                    ? halfBox
                    : fullBox;

                return (
                  <g key={plaq.id}>
                    <rect
                      x={cx - w / 2}
                      y={cy - h / 2}
                      width={w}
                      height={h}
                      rx={Math.max(5, 10 * (3 / distance))}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isExcited ? 2.4 : 1.2}
                    />
                    {distance <= 7 && (
                      <text
                        x={cx}
                        y={cy + 3}
                        textAnchor="middle"
                        fill={isExcited ? '#ffffff' : '#94a3b8'}
                        fontSize={distance <= 5 ? 11 : 8}
                        fontWeight={600}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {plaq.id}
                        {isExcited ? '!' : ''}
                      </text>
                    )}
                  </g>
                );
              })}

              {patch.dataCoords.map((dq) => {
                const f = faults[dq.id] ?? 'I';
                const rec = lastDecode?.recoveryFaults[dq.id] ?? 'I';
                const x = dq.x * cellSpacing;
                const y = dq.z * cellSpacing;
                const fill =
                  f === 'I'
                    ? '#1e293b'
                    : f === 'X'
                      ? '#be123c'
                      : f === 'Z'
                        ? '#0369a1'
                        : '#b45309';
                const stroke =
                  rec !== 'I' ? '#34d399' : f === 'I' ? '#64748b' : '#f8fafc';

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
                        r={nodeRadius + 5}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    )}
                    <circle cx={x} cy={y} r={nodeRadius} fill={fill} stroke={stroke} strokeWidth={1.8} />
                    <text
                      x={x}
                      y={y + (distance <= 5 ? -1 : 3)}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize={fontSizeMain}
                      fontWeight={600}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {distance <= 5 ? `d${dq.id}` : f === 'I' ? dq.id : f}
                    </text>
                    {distance <= 5 && (
                      <text
                        x={x}
                        y={y + 10}
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize={9}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {f === 'I' ? '·' : f}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Accessible Native Button Grid */}
          <div className="max-h-48 overflow-y-auto grid grid-cols-5 sm:grid-cols-9 gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            {patch.dataCoords.map((dq) => {
              const f = faults[dq.id] ?? 'I';
              return (
                <button
                  key={dq.id}
                  type="button"
                  onClick={() => onInjectFaultAt(dq.id, activeBrush)}
                  aria-label={`Data qubit d${dq.id} current fault ${f}`}
                  className={`h-9 rounded-lg border font-mono text-[11px] tabular-nums transition-colors ${
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
                  Excited Stabilizers ({syn.excitedIds.length})
                </div>
                <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {syn.excitedIds.length === 0 ? 'None (Clean)' : syn.excitedIds.join(', ')}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Raw Logical Parity
                </div>
                <div className="mt-1 text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
                  X̄: {syn.logicalXFlipped ? 'Flipped' : 'Intact'} · Z̄:{' '}
                  {syn.logicalZFlipped ? 'Flipped' : 'Intact'}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Rotated [[{patch.dataQubitCount}, 1, {distance}]] code corrects arbitrary multi-qubit Pauli chains of weight ≤ ⌊({distance}−1)/2⌋ = {correctableFloor} via exact tropical (min, +) defect-and-boundary matching.
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
                    ? 'Logical Qubit Protected'
                    : 'Distance Exceeded (Logical Error)'}
                </span>
              )}
            </div>

            {!lastDecode ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inject one or more Pauli faults (or click &ldquo;Inject Weight-{correctableFloor} Fault&rdquo;), then click &ldquo;Decode via Tropical (min, +)&rdquo; to compute shortest dual-lattice recovery chains (`k7` TropicalMinPlusClosure).
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-slate-500">Matched Weight</div>
                    <div className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {lastDecode.totalWeight} hop(s)
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Post-Decode</div>
                    <div className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {lastDecode.postDecodeExcitedIds.length === 0
                        ? '0 excited'
                        : lastDecode.postDecodeExcitedIds.join(', ')}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Wasm k7 Closure</div>
                    <div className="mt-0.5 text-base font-semibold text-emerald-600 dark:text-emerald-400">
                      {lastDecode.wasmAccelerated
                        ? `${lastDecode.wasmRelaxations} relax`
                        : 'JS fallback'}
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
                  <div className="space-y-1 max-h-36 overflow-y-auto">
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
