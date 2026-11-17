/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Moon,
  Play,
  RotateCcw,
  SkipBack,
  StepForward,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  decodeVdntSnapshotToken,
  encodeUorcSnapshotToken,
  executeCircuitRollbackSession,
} from './aqm/journal';
import {
  AqmSlmProposalResult,
  CANONICAL_CIRCUIT_PRESETS,
  CyberneticObserverLoop,
  routePromptWithCodedSlm,
} from './aqm/slm';
import { quantumAudio } from './aqm/sonification';
import { PauliFault, extractSurfaceCodeSyndromes } from './aqm/stabilizer';
import { TropicalSyndromeDecodeResult, decodeSurfaceCodeTropical } from './aqm/tropical';
import { AqmCircuitSpec } from './aqm/types';
import {
  CameraPresetId,
  QuantumViewport3D,
  StudioSceneMode,
} from './components/QuantumViewport3D';

const AtlasMegascalePanel = lazy(() =>
  import('./components/AtlasMegascalePanel').then((m) => ({ default: m.AtlasMegascalePanel })),
);
const CircuitRollbackPanel = lazy(() =>
  import('./components/CircuitRollbackPanel').then((m) => ({ default: m.CircuitRollbackPanel })),
);
const PrismVerifierPanel = lazy(() =>
  import('./components/PrismVerifierPanel').then((m) => ({ default: m.PrismVerifierPanel })),
);
const QiskitNotebookPanel = lazy(() =>
  import('./components/QiskitNotebookPanel').then((m) => ({ default: m.QiskitNotebookPanel })),
);
const SurfaceCodePanel = lazy(() =>
  import('./components/SurfaceCodePanel').then((m) => ({ default: m.SurfaceCodePanel })),
);

type ActiveWorkspace = 'studio' | 'qiskit' | 'circuit' | 'atlas-qec' | 'verifier';

const cyberneticLoop = new CyberneticObserverLoop();

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [workspace, setWorkspace] = useState<ActiveWorkspace>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('workspace');
      const valid: readonly ActiveWorkspace[] = [
        'studio',
        'qiskit',
        'circuit',
        'atlas-qec',
        'verifier',
      ];
      if (q && (valid as readonly string[]).includes(q)) {
        return q as ActiveWorkspace;
      }
      const h = window.location.hash.replace(/^#/, '');
      if ((valid as readonly string[]).includes(h)) {
        return h as ActiveWorkspace;
      }
    }
    return 'studio';
  });
  const [atlasQecMode, setAtlasQecMode] = useState<'atlas' | 'qec'>('atlas');

  // Initialize from #uorc= (or legacy #vdnt=) URL hash if present, else canonical 3-Qubit GHZ + T manifold
  const initialBoot = useMemo(() => {
    if (typeof window !== 'undefined' && /^#(uorc|vdnt)=/.test(window.location.hash)) {
      const parsed = decodeVdntSnapshotToken(window.location.hash);
      if (parsed.ok) {
        return parsed.value;
      }
    }
    const preset = CANONICAL_CIRCUIT_PRESETS[0];
    return { spec: preset, cursor: preset.steps.length };
  }, []);

  const [spec, setSpec] = useState<AqmCircuitSpec>(initialBoot.spec);
  const [cursor, setCursor] = useState<number>(initialBoot.cursor);
  const [selectedWire, setSelectedWire] = useState<number>(0);

  // 3D Studio controls
  const [sceneMode, setSceneMode] = useState<StudioSceneMode>('bloch');
  const [renderBackend, setRenderBackend] = useState<'webgl2' | 'tile16'>('webgl2');
  const [showTileGrid, setShowTileGrid] = useState<boolean>(true);
  const [lod, setLod] = useState<number>(3);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('bench');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);

  // Parametric Surface-Code QEC state (d in {3, 5, 7, 9, 11}, synced between 3D Studio and QEC workspace)
  const [surfaceDistance, setSurfaceDistance] = useState<3 | 5 | 7 | 9 | 11>(3);
  const [surfaceFaults, setSurfaceFaults] = useState<PauliFault[]>(() => {
    const init = new Array<PauliFault>(9).fill('I');
    init[4] = 'X';
    return init;
  });
  const [faultBrush, setFaultBrush] = useState<PauliFault>('X');
  const [lastTropicalDecode, setLastTropicalDecode] =
    useState<TropicalSyndromeDecodeResult | null>(null);

  // CodedSlmDirector prompt state
  const [slmPrompt, setSlmPrompt] = useState<string>('');
  const [slmFeedback, setSlmFeedback] = useState<AqmSlmProposalResult | null>(null);

  // Shareable #vdnt= snapshot banner
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const [saliencePotentials, setSaliencePotentials] = useState<readonly number[]>(() =>
    cyberneticLoop.snapshot(),
  );

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Keyboard shortcut 'H' for Collapsible Cinema/Zen Dock in Studio view
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === 'h' || ev.key === 'H') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sessionOutcome = useMemo(() => executeCircuitRollbackSession(spec), [spec]);
  const validSession = sessionOutcome.ok ? sessionOutcome : null;
  const compileError = sessionOutcome.ok ? null : sessionOutcome.error;

  const [cachedValidSession, setCachedValidSession] = useState(validSession);
  useEffect(() => {
    if (validSession) {
      setCachedValidSession(validSession);
    }
  }, [validSession]);

  const activeSession = validSession ?? cachedValidSession;
  const activeFrame = useMemo(() => {
    if (!activeSession || activeSession.frames.length === 0) return null;
    const idx = Math.max(0, Math.min(cursor, activeSession.frames.length - 1));
    return activeSession.frames[idx];
  }, [activeSession, cursor]);

  const surfaceSyndromes = useMemo(
    () => extractSurfaceCodeSyndromes(surfaceFaults, surfaceDistance),
    [surfaceFaults, surfaceDistance],
  );

  const handleUpdateSpec = (nextSpec: AqmCircuitSpec, nextCursor?: number) => {
    setSpec(nextSpec);
    const targetCursor = nextCursor !== undefined ? nextCursor : nextSpec.steps.length;
    setCursor(targetCursor);
    if (selectedWire >= nextSpec.qubitCount) {
      setSelectedWire(0);
    }
  };

  const handleSetCursorWithAudio = (nextCursor: number) => {
    setCursor(nextCursor);
    if (activeSession && activeSession.frames[nextCursor]) {
      const f = activeSession.frames[nextCursor];
      quantumAudio.chimeQuantumState(f.blochVectors, f.basisAmplitudes, 0);
    }
  };

  const handleSelectWire = (wire: number) => {
    setSelectedWire(wire);
    setSaliencePotentials(cyberneticLoop.stepFocus(wire % 8));
  };

  const handleChangeSurfaceDistance = (nextD: 3 | 5 | 7 | 9 | 11) => {
    setSurfaceDistance(nextD);
    const total = nextD * nextD;
    const fresh = new Array<PauliFault>(total).fill('I');
    fresh[Math.floor(total / 2)] = 'X';
    setSurfaceFaults(fresh);
    setLastTropicalDecode(null);
  };

  const handleInjectMultiFaultPreset = () => {
    const t = Math.floor((surfaceDistance - 1) / 2);
    const total = surfaceDistance * surfaceDistance;
    const next = new Array<PauliFault>(total).fill('I');
    // Place t well-separated interior faults guaranteed within [[d^2, 1, d]] recovery radius
    for (let k = 0; k < t; k += 1) {
      const row = Math.min(surfaceDistance - 2, 1 + k * 2);
      const col = Math.min(surfaceDistance - 2, 1 + ((k * 2) % Math.max(1, surfaceDistance - 2)));
      next[row * surfaceDistance + col] = k % 2 === 0 ? 'X' : 'Z';
    }
    setSurfaceFaults(next);
    setLastTropicalDecode(null);
  };

  const handleInjectFaultAt = (qubitIdx: number, explicitBrush?: PauliFault) => {
    setSurfaceFaults((prev) => {
      const next = prev.slice();
      if (explicitBrush !== undefined) {
        next[qubitIdx] = prev[qubitIdx] === explicitBrush ? 'I' : explicitBrush;
      } else {
        const order: PauliFault[] = ['I', 'X', 'Z', 'Y'];
        const curIdx = order.indexOf(prev[qubitIdx]);
        next[qubitIdx] = order[(curIdx + 1) % order.length];
      }
      const syn = extractSurfaceCodeSyndromes(next, surfaceDistance);
      quantumAudio.chimeQuantumState(
        activeFrame?.blochVectors ?? [],
        activeFrame?.basisAmplitudes ?? [],
        syn.excitedIds.length,
      );
      return next;
    });
    setLastTropicalDecode(null);
    setSaliencePotentials(cyberneticLoop.stepFocus(qubitIdx % 8));
  };

  const handleRunTropicalDecode = () => {
    const decoded = decodeSurfaceCodeTropical(surfaceFaults, surfaceDistance);
    setLastTropicalDecode(decoded);
  };

  const handleApplyRecovery = () => {
    if (!lastTropicalDecode) return;
    setSurfaceFaults(lastTropicalDecode.residualFaults.slice());
    setLastTropicalDecode(null);
  };

  const handleShareSnapshot = () => {
    try {
      const token = encodeUorcSnapshotToken({ spec, cursor });
      const hashUrl = `#uorc=${token}`;
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', hashUrl);
        const fullUrl = `${window.location.origin}${window.location.pathname}${hashUrl}`;
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(fullUrl).catch(() => {});
        }
      }
      setSnapshotNotice(`UORC snapshot sealed to URL (${token.slice(0, 22)}...)`);
      window.setTimeout(() => setSnapshotNotice(null), 4500);
    } catch (err) {
      setSnapshotNotice(err instanceof Error ? err.message : 'UORC snapshot exceeds URL ceiling');
      window.setTimeout(() => setSnapshotNotice(null), 4500);
    }
  };

  const handleSlmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slmPrompt.trim()) return;
    const res = routePromptWithCodedSlm(slmPrompt);
    setSlmFeedback(res);
    if (res.admitted) {
      handleUpdateSpec(res.proposedSpec, res.proposedSpec.steps.length);
      setSceneMode('bloch');
    }
  };

  const toggleAudio = () => {
    const next = quantumAudio.setEnabled(!audioEnabled);
    setAudioEnabled(next);
    if (next && activeFrame) {
      quantumAudio.chimeQuantumState(
        activeFrame.blochVectors,
        activeFrame.basisAmplitudes,
        surfaceSyndromes.excitedIds.length,
      );
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#080C12] dark:text-slate-100"
      data-workspace={workspace}
    >
      {/* Top Bar Contract: Strictly 1 row, 3 zones separated by gap-8 */}
      <header className="h-14 px-6 flex items-center justify-between gap-8 border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0B1018] shrink-0 z-30">
        {/* Zone 1: Single wordmark */}
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            setWorkspace('studio');
          }}
          className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
        >
          Verdant AQM
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Primary workspaces"
          className="flex items-center gap-5 sm:gap-7 overflow-x-auto text-sm font-medium text-slate-600 dark:text-slate-400"
        >
          {(
            [
              ['studio', 'Studio 3D'],
              ['qiskit', 'Qiskit & Notebooks'],
              ['circuit', 'Circuit & MPS'],
              ['atlas-qec', 'Atlas & QEC'],
              ['verifier', 'Prism & Holo'],
            ] as const
          ).map(([id, label]) => {
            const active = workspace === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setWorkspace(id)}
                className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-emerald-500 text-slate-900 dark:text-white font-semibold'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={handleShareSnapshot}
            className="h-9 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            Share #uorc= State
          </button>
        </div>
      </header>

      {/* Secondary Instrument Telemetry Ribbon */}
      <div className="px-6 py-2 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/80 dark:bg-[#0D131D] text-xs font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{spec.name}</span>
          <span aria-hidden="true">·</span>
          <span>
            {spec.qubitCount}q · Frame {cursor}/{spec.steps.length}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {activeFrame?.conservation.normExactOne
              ? `Norm ${activeFrame.conservation.rationalNumerator}/${activeFrame.conservation.scaleDenominator}`
              : 'Norm Check Required'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            QEC [[{surfaceDistance * surfaceDistance},1,{surfaceDistance}]]:{' '}
            {surfaceSyndromes.excitedIds.length === 0
              ? 'Clean'
              : surfaceSyndromes.excitedIds.join(',')}
          </span>
          <span aria-hidden="true" className="hidden xl:inline">·</span>
          <span className="hidden xl:inline text-slate-500">
            LIF q{selectedWire} Salience {saliencePotentials[selectedWire % 8] ?? 0}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {snapshotNotice && (
            <span role="status" className="text-emerald-700 dark:text-emerald-400">
              {snapshotNotice}
            </span>
          )}
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="h-7 px-2.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Stage */}
      <main className="flex-1 relative">
        {workspace === 'studio' && (
          <div className="relative w-full h-[calc(100vh-6.25rem)] min-h-[580px] overflow-hidden">
            <QuantumViewport3D
              sceneMode={sceneMode}
              renderBackend={renderBackend}
              showTileGrid={showTileGrid}
              lod={lod}
              cameraPreset={cameraPreset}
              blochVectors={activeFrame?.blochVectors ?? []}
              entanglementEdges={activeFrame?.entanglementEdges ?? []}
              basisAmplitudes={activeFrame?.basisAmplitudes ?? []}
              dagNodes={activeSession?.dagNodes ?? []}
              stepCursor={cursor}
              selectedWire={selectedWire}
              surfaceFaults={surfaceFaults}
              decodedEdges={lastTropicalDecode?.matchedEdges ?? []}
              onSelectWire={handleSelectWire}
              onCycleDataQubitFault={(dq) => handleInjectFaultAt(dq)}
            />

            {/* Unobtrusive Top-Left Spatial Spec Overlay */}
            <div className="absolute top-4 left-5 z-10 pointer-events-none max-w-md">
              <div className="text-xs font-mono text-slate-300 bg-[#0B1018]/92 border border-slate-800 px-3.5 py-2 rounded-lg space-y-0.5">
                <div className="font-sans text-sm font-semibold text-slate-100">
                  {sceneMode === 'bloch'
                    ? `3D Bloch Manifold (${spec.qubitCount}q · ${spec.backend})`
                    : sceneMode === 'surface-code'
                      ? `Rotated [[${surfaceDistance * surfaceDistance}, 1, ${surfaceDistance}]] Surface-Code Lattice`
                      : `3D Causal Circuit & Tropical Lightcone (${spec.qubitCount}q)`}
                </div>
                <div className="text-slate-400">
                  {sceneMode === 'bloch' && activeFrame?.blochVectors[selectedWire]
                    ? `Selected q${selectedWire} · ⟨X⟩=${(Math.abs(activeFrame.blochVectors[selectedWire].rx) < 1e-9 ? 0 : activeFrame.blochVectors[selectedWire].rx).toFixed(2)} ⟨Y⟩=${(Math.abs(activeFrame.blochVectors[selectedWire].ry) < 1e-9 ? 0 : activeFrame.blochVectors[selectedWire].ry).toFixed(2)} ⟨Z⟩=${(Math.abs(activeFrame.blochVectors[selectedWire].rz) < 1e-9 ? 0 : activeFrame.blochVectors[selectedWire].rz).toFixed(2)} · Purity ${activeFrame.blochVectors[selectedWire].purity.toFixed(2)}`
                    : sceneMode === 'surface-code'
                      ? `Click any data pillar d0–d${surfaceDistance * surfaceDistance - 1} to cycle faults · Excited: ${surfaceSyndromes.excitedIds.join(', ') || 'None'}`
                      : `Selected q${selectedWire} · Backward (max, +) causal cone highlighted`}
                </div>
              </div>
            </div>

            {/* Unified Collapsible Bottom Control Dock (Zero backdrop-filter over WebGL!) */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(980px,95vw)]">
              <div className="flex justify-center mb-1.5">
                <button
                  type="button"
                  onClick={() => setDockCollapsed((c) => !c)}
                  className="h-8 px-3.5 rounded-lg bg-[#0F1622] text-slate-200 border border-slate-700 hover:border-emerald-500 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  {dockCollapsed ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Show Controls (H)</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Hide Controls (H)</span>
                    </>
                  )}
                </button>
              </div>

              {!dockCollapsed && (
                <div className="rounded-xl bg-[#0D1420]/96 border border-slate-800 p-3.5 shadow-2xl space-y-3 text-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div
                      className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800"
                      role="group"
                      aria-label="3D scene mode"
                    >
                      {(
                        [
                          ['bloch', 'Bloch Manifold'],
                          ['surface-code', 'Surface Code 3D'],
                          ['lightcone', 'Causal Lightcone'],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSceneMode(id)}
                          className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            sceneMode === id
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-300 hover:text-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {sceneMode === 'surface-code' ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label="3D surface code distance"
                          value={surfaceDistance}
                          onChange={(e) =>
                            handleChangeSurfaceDistance(
                              Number(e.target.value) as 3 | 5 | 7 | 9 | 11,
                            )
                          }
                          className="h-8 px-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                        >
                          <option value={3}>d=3 (9q)</option>
                          <option value={5}>d=5 (25q)</option>
                          <option value={7}>d=7 (49q)</option>
                          <option value={9}>d=9 (81q)</option>
                          <option value={11}>d=11 (121q)</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleRunTropicalDecode}
                          className="h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                        >
                          Decode Lattice
                        </button>
                        {lastTropicalDecode && (
                          <button
                            type="button"
                            onClick={handleApplyRecovery}
                            className="h-8 px-3 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 whitespace-nowrap shrink-0"
                          >
                            Apply Recovery
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSurfaceFaults(
                              new Array<PauliFault>(surfaceDistance * surfaceDistance).fill('I'),
                            );
                            setLastTropicalDecode(null);
                          }}
                          className="h-8 px-2.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                        >
                          Clear Faults
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Reset circuit to ground state"
                          onClick={() => handleSetCursorWithAudio(0)}
                          disabled={cursor === 0}
                          className="h-8 px-2.5 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-40 hover:border-slate-500 flex items-center gap-1 text-xs whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset</span>
                        </button>
                        <button
                          type="button"
                          aria-label="Step back one gate"
                          onClick={() => handleSetCursorWithAudio(Math.max(0, cursor - 1))}
                          disabled={cursor === 0}
                          className="h-8 px-2.5 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-40 hover:border-slate-500 flex items-center gap-1 text-xs whitespace-nowrap shrink-0"
                        >
                          <SkipBack className="w-3.5 h-3.5" />
                          <span>Back</span>
                        </button>
                        <button
                          type="button"
                          aria-label="Step forward one gate"
                          onClick={() =>
                            handleSetCursorWithAudio(Math.min(spec.steps.length, cursor + 1))
                          }
                          disabled={cursor >= spec.steps.length}
                          className="h-8 px-3 rounded-lg bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-500 flex items-center gap-1 text-xs font-semibold whitespace-nowrap shrink-0"
                        >
                          <StepForward className="w-3.5 h-3.5" />
                          <span>Step</span>
                        </button>
                        <button
                          type="button"
                          aria-label="Run all gates"
                          onClick={() => handleSetCursorWithAudio(spec.steps.length)}
                          disabled={cursor >= spec.steps.length}
                          className="h-8 px-2.5 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-40 hover:border-slate-500 flex items-center gap-1 text-xs whitespace-nowrap shrink-0"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Run All</span>
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        aria-label="Progressive UORC Level of Detail"
                        value={lod}
                        onChange={(e) => setLod(Number(e.target.value))}
                        className="h-8 px-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                      >
                        <option value={0}>LOD0 Proxy</option>
                        <option value={1}>LOD1 Graph</option>
                        <option value={2}>LOD2 Towers</option>
                        <option value={3}>LOD3 Lossless</option>
                        <option value={4}>LOD4 Ultra</option>
                      </select>

                      <button
                        type="button"
                        onClick={() =>
                          setRenderBackend((r) => (r === 'webgl2' ? 'tile16' : 'webgl2'))
                        }
                        className={`h-8 px-2.5 rounded-lg text-xs font-mono border transition-colors whitespace-nowrap shrink-0 ${
                          renderBackend === 'tile16'
                            ? 'bg-cyan-700 border-cyan-400 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                        }`}
                      >
                        {renderBackend === 'webgl2' ? 'WebGL2 PBR' : '16x16 Tile PBR'}
                      </button>

                      {renderBackend === 'tile16' && (
                        <button
                          type="button"
                          onClick={() => setShowTileGrid((g) => !g)}
                          className="h-8 px-2 rounded-lg text-xs font-mono bg-slate-900 border border-slate-700 text-slate-300 whitespace-nowrap shrink-0"
                        >
                          {showTileGrid ? 'Grid On' : 'Grid Off'}
                        </button>
                      )}

                      <select
                        aria-label="Camera preset"
                        value={cameraPreset}
                        onChange={(e) => setCameraPreset(e.target.value as CameraPresetId)}
                        className="h-8 px-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200"
                      >
                        <option value="bench">Camera: Bench</option>
                        <option value="overhead">Camera: Overhead</option>
                        <option value="macro">Camera: Macro</option>
                      </select>

                      <button
                        type="button"
                        onClick={toggleAudio}
                        aria-pressed={audioEnabled}
                        aria-label={
                          audioEnabled ? 'Mute modal quantum audio' : 'Enable modal quantum audio'
                        }
                        className={`h-8 px-2.5 rounded-lg border text-xs flex items-center gap-1 whitespace-nowrap shrink-0 ${
                          audioEnabled
                            ? 'bg-emerald-700 border-emerald-400 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        {audioEnabled ? (
                          <Volume2 className="w-3.5 h-3.5" />
                        ) : (
                          <VolumeX className="w-3.5 h-3.5" />
                        )}
                        <span>{audioEnabled ? 'Audio On' : 'Audio Off'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Invariant-Guarded 4-Bit CodedSlmDirector Prompt Bar */}
                  <form
                    onSubmit={handleSlmSubmit}
                    className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/90"
                  >
                    <label
                      htmlFor="slm-director-input"
                      className="text-xs font-mono text-slate-400 shrink-0"
                    >
                      4-bit SLM Co-Pilot:
                    </label>
                    <input
                      id="slm-director-input"
                      type="text"
                      value={slmPrompt}
                      onChange={(e) => setSlmPrompt(e.target.value)}
                      placeholder='Try "64-qubit sparse cat state", "32-qubit mps cascade", "96-qubit atlas braid", or "clone q0 onto q0"'
                      className="flex-1 min-w-[220px] h-8 px-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500"
                    />
                    <button
                      type="submit"
                      className="h-8 px-3 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-emerald-600 text-white border border-slate-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      Propose Circuit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const p = 'clone q0 onto q0';
                        setSlmPrompt(p);
                        setSlmFeedback(routePromptWithCodedSlm(p));
                      }}
                      className="h-8 px-2.5 rounded-lg text-xs font-mono bg-slate-900 hover:bg-rose-950 text-slate-300 border border-slate-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      Test Cloning Guard
                    </button>
                  </form>

                  {slmFeedback && (
                    <div
                      role="status"
                      className={`text-xs font-mono px-3 py-1.5 rounded bg-slate-950 border ${
                        slmFeedback.admitted
                          ? 'border-emerald-800 text-emerald-300'
                          : 'border-rose-800 text-rose-300'
                      }`}
                    >
                      {slmFeedback.admitted
                        ? `Admitted (${slmFeedback.matchedTitle} · coded_gemm=${slmFeedback.codedGemmScore}) — Prism invariants verified.`
                        : `Denied by Prism Guard (${slmFeedback.refusalError?.kind}) — ${slmFeedback.refusalError?.detail}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <Suspense
          fallback={
            <div className="max-w-[1380px] mx-auto px-6 py-10 text-xs font-mono text-slate-500 dark:text-slate-400">
              Loading workspace module…
            </div>
          }
        >
          {workspace === 'qiskit' && (
            <QiskitNotebookPanel
              onLoadCircuitIntoStudio={(compiledSpec) => {
                handleUpdateSpec(compiledSpec, compiledSpec.steps.length);
                setSceneMode('bloch');
                setWorkspace('studio');
              }}
            />
          )}

          {workspace === 'circuit' && (
            <CircuitRollbackPanel
              spec={spec}
              session={validSession}
              compileError={compileError}
              cursor={cursor}
              selectedWire={selectedWire}
              onUpdateSpec={handleUpdateSpec}
              onSetCursor={handleSetCursorWithAudio}
              onSelectWire={handleSelectWire}
            />
          )}

          {workspace === 'atlas-qec' && (
            <div className="space-y-2">
              <div className="max-w-[1380px] mx-auto px-6 pt-5 flex items-center justify-between gap-4">
                <div
                  className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800"
                  role="tablist"
                  aria-label="Atlas and Surface Code QEC sub-views"
                >
                  {(
                    [
                      ['atlas', 'UOR Atlas UTQC & 4,096q Megascale'],
                      ['qec', 'Rotated Surface-Code QEC (d=3..11)'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={atlasQecMode === id}
                      onClick={() => setAtlasQecMode(id)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        atlasQecMode === id
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {atlasQecMode === 'atlas' ? (
                <AtlasMegascalePanel
                  onLoadCircuitIntoStudio={(compiledSpec) => {
                    handleUpdateSpec(compiledSpec, compiledSpec.steps.length);
                    setSceneMode('bloch');
                    setWorkspace('studio');
                  }}
                />
              ) : (
                <SurfaceCodePanel
                  distance={surfaceDistance}
                  faults={surfaceFaults}
                  activeBrush={faultBrush}
                  lastDecode={lastTropicalDecode}
                  onChangeDistance={handleChangeSurfaceDistance}
                  onSetBrush={setFaultBrush}
                  onInjectFaultAt={handleInjectFaultAt}
                  onInjectMultiFaultPreset={handleInjectMultiFaultPreset}
                  onRunTropicalDecode={handleRunTropicalDecode}
                  onApplyRecovery={handleApplyRecovery}
                  onClearLattice={() => {
                    setSurfaceFaults(
                      new Array<PauliFault>(surfaceDistance * surfaceDistance).fill('I'),
                    );
                    setLastTropicalDecode(null);
                  }}
                  onOpenIn3D={() => {
                    setSceneMode('surface-code');
                    setWorkspace('studio');
                  }}
                />
              )}
            </div>
          )}

          {workspace === 'verifier' && (
            <PrismVerifierPanel
              spec={spec}
              activeFrame={activeFrame}
              activeLod={lod}
              onSelectLod={(nextLod) => {
                setLod(nextLod);
                setWorkspace('studio');
              }}
            />
          )}
        </Suspense>
      </main>
    </div>
  );
}
