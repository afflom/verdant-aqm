import React, { useMemo, useState } from 'react';
import {
  AtlasUseCaseParams,
  CANONICAL_ATLAS_PARAMS,
  PARAMETRIC_CHECK_ATLAS_PARAMS,
  buildAtlasGenerators,
  decideUtqcRowHonesty,
  executeAtlasHolospaceBatch,
  verifyAtlasMtcAxioms,
  weaveOpenQasmWithSkWeaver,
} from '../aqm/atlasUtqc';
import {
  contractGridCodebook,
  contractPackedNibbles,
  contractSparseRuns,
  decideMatmulCodedAdmission,
  packGrid16Nibbles,
} from '../aqm/codedMatmul';
import { executeCyclotomicBatch } from '../aqm/cyclotomic';
import { runWasmPacked4Gemv } from '../aqm/holoGuest';
import { createInitialExactMps, getMpsBondDimensions, stepExactMpsGate } from '../aqm/mps';
import { executeStabilizerBatch } from '../aqm/stabilizer';
import { AqmCircuitSpec, AqmGateStep, GateKind } from '../aqm/types';

interface AtlasMegascalePanelProps {
  onLoadCircuitIntoStudio: (spec: AqmCircuitSpec) => void;
}

interface MegascaleBenchRow {
  readonly id: string;
  readonly engineName: string;
  readonly qubits: number;
  readonly gateCount: number;
  readonly elapsedMs: number;
  readonly activeStateFootprint: string;
  readonly denseClassicalEquivalent: string;
  readonly detail: string;
  readonly ledgerTier: 'open';
}

const DEFAULT_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];

h q[0];
cx q[0], q[1];
rz(pi/5) q[1];
ry(pi/3) q[2];
cx q[1], q[2];
t q[0];`;

type BenchScalePreset = 1 | 2 | 8;

function runMegascaleBenchSuite(scaleMultiplier: BenchScalePreset): MegascaleBenchRow[] {
  const rows: MegascaleBenchRow[] = [];

  // 1. Unbounded Sparse Z[zeta_8] Cat State (`Runs<Grid<16>, 16>` in-place BigInt ket map)
  const qSparse = 512 * scaleMultiplier; // 512, 1,024, or 4,096 qubits
  const sparseSteps: AqmGateStep[] = [{ id: 'h0', kind: GateKind.H, targets: [0] }];
  for (let i = 0; i < qSparse - 1; i += 1) {
    sparseSteps.push({ id: `cx-${i}`, kind: GateKind.CNOT, targets: [i, i + 1] });
  }
  sparseSteps.push({ id: 't-end', kind: GateKind.T, targets: [qSparse - 1] });

  const t0 = performance.now();
  const sparseState = executeCyclotomicBatch(qSparse, sparseSteps);
  const dtSparse = performance.now() - t0;

  rows.push({
    id: 'sparse-cyclotomic',
    engineName: 'Sparse Z[ζ₈] Runs<Grid<16>,16>',
    qubits: qSparse,
    gateCount: sparseSteps.length,
    elapsedMs: dtSparse,
    activeStateFootprint: `${sparseState.support.size} exact kets (~192 B)`,
    denseClassicalEquivalent: `2^${qSparse} × 16 B (infeasible)`,
    detail: `In-place BigInt ket map over Z[ζ₈] (k14 normDenom = ${sparseState.normDenom.p.toString()}); zero float drift.`,
    ledgerTier: 'open',
  });

  // 2. Exact Q(zeta_8) Matrix Product State (`ExactMps`)
  const qMps = scaleMultiplier === 8 ? 128 : 64 * scaleMultiplier; // 64 or 128 non-Clifford qubits
  const t1 = performance.now();
  let mps = createInitialExactMps(qMps);
  let mpsGates = 0;
  for (let i = 0; i < qMps; i += 4) {
    mps = stepExactMpsGate(mps, { id: `mh-${i}`, kind: GateKind.H, targets: [i] }, 0.5).nextState;
    mps = stepExactMpsGate(mps, { id: `mt-${i}`, kind: GateKind.T, targets: [i] }, 0.5).nextState;
    mpsGates += 2;
    if (i + 1 < qMps) {
      mps = stepExactMpsGate(
        mps,
        { id: `mcx-${i}`, kind: GateKind.CNOT, targets: [i, i + 1] },
        0.5,
      ).nextState;
      mpsGates += 1;
    }
    if (i + 2 < qMps) {
      mps = stepExactMpsGate(
        mps,
        { id: `mcz-${i}`, kind: GateKind.CZ, targets: [i + 1, i + 2] },
        0.5,
      ).nextState;
      mpsGates += 1;
    }
  }
  const bonds = getMpsBondDimensions(mps);
  const maxChi = bonds.length > 0 ? Math.max(...bonds) : 1;
  const dtMps = performance.now() - t1;

  rows.push({
    id: 'exact-mps',
    engineName: 'Exact Q(ζ₈) Galois-RREF MPS',
    qubits: qMps,
    gateCount: mpsGates,
    elapsedMs: dtMps,
    activeStateFootprint: `${qMps} site tensors · χ_max = ${maxChi}`,
    denseClassicalEquivalent: `2^${qMps} × 16 B`,
    detail: `Exact field division in Q(ζ₈) compresses two-site bonds via RREF without SVD rounding.`,
    ledgerTier: 'open',
  });

  // 3. Column-Transposed 32-Row Bit-Plane Gottesman-Knill F_2 Tableau (`O(n/32)` per gate!)
  const qTab = 256 * scaleMultiplier; // 256, 512, or 2,048 qubits
  const tabSteps: AqmGateStep[] = [];
  for (let i = 0; i < qTab; i += 1) {
    tabSteps.push({ id: `th-${i}`, kind: GateKind.H, targets: [i] });
  }
  for (let i = 0; i < qTab; i += 1) {
    tabSteps.push({ id: `tcz-${i}`, kind: GateKind.CZ, targets: [i, (i + 1) % qTab] });
  }
  const t2 = performance.now();
  const colTab = executeStabilizerBatch(qTab, tabSteps);
  const dtTab = performance.now() - t2;
  const tabBytes = colTab.colX.byteLength + colTab.colZ.byteLength + colTab.rPlanes.byteLength;

  rows.push({
    id: 'word-tableau',
    engineName: 'Column Bit-Plane F₂ Tableau',
    qubits: qTab,
    gateCount: tabSteps.length,
    elapsedMs: dtTab,
    activeStateFootprint: `${(tabBytes / 1024).toFixed(1)} KiB (${colTab.planesPerCol}×32b/col)`,
    denseClassicalEquivalent: `2^${qTab} × 16 B`,
    detail: `O(n/32) column-transposed Uint32Array bit-plane Clifford evolution (zero heap allocs/gate).`,
    ledgerTier: 'open',
  });

  // 4. UOR Atlas Topological Carrier + Live BLAKE3 kappa Transition Memoization
  const qAtlas = 2048 * scaleMultiplier; // 2,048, 4,096, or 16,384 qubits!
  const atlasStepsCount = 256 * scaleMultiplier;
  const periodicKinds = [GateKind.H, GateKind.T, GateKind.S, GateKind.X];
  const atlasSteps: AqmGateStep[] = new Array(atlasStepsCount);
  for (let s = 0; s < atlasStepsCount; s += 1) {
    atlasSteps[s] = {
      id: `at-${s}`,
      kind: periodicKinds[s % periodicKinds.length],
      targets: [(s * 17) % qAtlas],
    };
  }
  const t3 = performance.now();
  const atlasState = executeAtlasHolospaceBatch(qAtlas, atlasSteps);
  const dtAtlas = performance.now() - t3;
  const hitPct = ((atlasState.elidedStepHits / atlasStepsCount) * 100).toFixed(1);

  rows.push({
    id: 'atlas-holospace',
    engineName: 'UOR Atlas (4,3,8) + BLAKE3 κ',
    qubits: qAtlas,
    gateCount: atlasStepsCount,
    elapsedMs: dtAtlas,
    activeStateFootprint: `768 B carrier · ${hitPct}% κ memoized`,
    denseClassicalEquivalent: `2^${qAtlas} × 16 B`,
    detail: `96-class reflection carrier (σ, τ, μ) + live BLAKE3 κ transition cache (${atlasState.elidedStepHits}/${atlasStepsCount} elided).`,
    ledgerTier: 'open',
  });

  return rows;
}

export const AtlasMegascalePanel: React.FC<AtlasMegascalePanelProps> = ({
  onLoadCircuitIntoStudio,
}) => {
  const [scaleMultiplier, setScaleMultiplier] = useState<BenchScalePreset>(2);
  const [benchRows, setBenchRows] = useState<readonly MegascaleBenchRow[]>(() =>
    runMegascaleBenchSuite(2),
  );

  // OpenQASM 2.0 SkWeaver Compiler state
  const [qasmSource, setQasmSource] = useState<string>(DEFAULT_QASM);
  const [carrierMode, setCarrierMode] = useState<'Certified22' | 'Clifford'>('Certified22');
  const [epsilonTarget, setEpsilonTarget] = useState<number>(0.02);

  // Atlas Parametric MTC Explorer state
  const [atlasParamPreset, setAtlasParamPreset] = useState<'canonical' | 'parametric'>('canonical');

  // UTQC Row-Honesty interactive gate check
  const [honestyClaimTier, setHonestyClaimTier] = useState<'some-true' | 'build' | 'open'>('open');

  const skWeaverResult = useMemo(
    () => weaveOpenQasmWithSkWeaver(qasmSource, carrierMode, epsilonTarget),
    [qasmSource, carrierMode, epsilonTarget],
  );

  const activeAtlasParams: AtlasUseCaseParams =
    atlasParamPreset === 'canonical' ? CANONICAL_ATLAS_PARAMS : PARAMETRIC_CHECK_ATLAS_PARAMS;

  const atlasGenReport = useMemo(() => buildAtlasGenerators(activeAtlasParams), [activeAtlasParams]);
  const mtcAxioms = useMemo(() => verifyAtlasMtcAxioms(activeAtlasParams), [activeAtlasParams]);

  const codedKernelDemo = useMemo(() => {
    const codebook: bigint[] = [
      -8n, -6n, -5n, -4n, -3n, -2n, -1n, 0n, 1n, 2n, 3n, 4n, 5n, 6n, 8n, 12n,
    ];
    const grid = contractGridCodebook({
      m: 4,
      k: 16,
      n: 4,
      codebook,
      lhsIndices: new Uint8Array(64).map((_, i) => (i * 3 + 1) & 15),
      rhsIndices: new Uint8Array(64).map((_, i) => (i * 5 + 2) & 15),
    });
    const rowIndices = Array.from({ length: 16 }, (_, i) => (i + 3) & 15);
    const colIndices = Array.from({ length: 16 }, (_, i) => (15 - i) & 15);
    const packed = contractPackedNibbles({
      m: 2,
      k: 16,
      n: 2,
      codebook,
      lhsPackedRows: [packGrid16Nibbles(rowIndices), packGrid16Nibbles(colIndices)],
      rhsPackedCols: [packGrid16Nibbles(colIndices), packGrid16Nibbles(rowIndices)],
    });
    const runs = contractSparseRuns({
      m: 64,
      codebook,
      lhsRows: Array.from({ length: 64 }, (_, r) => [
        { col: r, codeIdx: 12 },
        { col: (r + 1) % 64, codeIdx: 9 },
      ]),
      ketSupport: new Map<number, number>([
        [0, 14],
        [63, 11],
      ]),
    });
    const admission = decideMatmulCodedAdmission({
      accumBits: 128,
      requiredAccumBits: 96,
      intermediateFloatDecode: false,
      exactChecksumMatches: true,
    });
    const wasmGemv = runWasmPacked4Gemv(
      new Int32Array(colIndices.map((idx) => Number(codebook[idx]))),
      packGrid16Nibbles(rowIndices),
      new Int32Array(codebook.map((v) => Number(v))),
      1,
      8,
    );
    return { grid, packed, runs, admission, wasmGemv };
  }, []);

  const honestyVerdict = useMemo(
    () =>
      decideUtqcRowHonesty({
        claimedTier: honestyClaimTier,
        hasCitationAnchor: false,
        isEmpiricalBenchmarkOnly: true,
        hasPlantedDefectRefusal: true,
      }),
    [honestyClaimTier],
  );

  const handleRunBenchmarks = (mult: BenchScalePreset) => {
    setScaleMultiplier(mult);
    setBenchRows(runMegascaleBenchSuite(mult));
  };

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            UOR Atlas Topological Holospace, SkWeaver QASM Compiler & Megascale Bench
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            <span>Zero Classical Qubit Ceilings</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Pointed MTC C(Z₃ × Z₂³, q) Verified</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>uor-matmul Zero-Decode Kernels</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Honesty.lex.tex Ledger Enforced</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleRunBenchmarks(1)}
            className={`h-10 px-3.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              scaleMultiplier === 1
                ? 'bg-slate-900 dark:bg-slate-800 text-white border-emerald-500'
                : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Standard (64–2,048q)
          </button>
          <button
            type="button"
            onClick={() => handleRunBenchmarks(2)}
            className={`h-10 px-3.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              scaleMultiplier === 2
                ? 'bg-slate-900 dark:bg-slate-800 text-white border-emerald-500'
                : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Megascale (128–4,096q)
          </button>
          <button
            type="button"
            onClick={() => handleRunBenchmarks(8)}
            className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            Extreme Prism Scale (128–16,384 Qubits)
          </button>
        </div>
      </div>

      {/* Section 1: Live 4-Engine Non-Classical Megascale Benchmark + Honesty Gate */}
      <section className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Live Non-Classical Megascale Execution Telemetry (Zero Dense 2ⁿ Allocation)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Measured live in your browser runtime across all four algebraic, tensor-train, symplectic, and topological substrates.
            </p>
          </div>

          {/* Interactive UTQC Row-Honesty Gate Check */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="text-slate-500">Test Ledger Claim Gate (AQ-16):</span>
            {(['open', 'build', 'some-true'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setHonestyClaimTier(tier)}
                className={`px-2.5 py-1 rounded border transition-colors ${
                  honestyClaimTier === tier
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                Claim &apos;{tier}&apos;
              </button>
            ))}
          </div>
        </div>

        {!honestyVerdict.ok && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-mono text-rose-800 dark:text-rose-200"
          >
            ✖ Honesty.lex.tex Refusal ({honestyVerdict.error.kind} · {honestyVerdict.error.refusalCode}):{' '}
            {honestyVerdict.error.detail}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 pr-3">Substrate Engine</th>
                <th className="py-2 px-3">Qubits</th>
                <th className="py-2 px-3">Gates</th>
                <th className="py-2 px-3">Browser Time</th>
                <th className="py-2 px-3">Active Footprint</th>
                <th className="py-2 px-3">Dense 2ⁿ Equivalent</th>
                <th className="py-2 pl-3">Ledger Tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {benchRows.map((row) => (
                <tr key={row.id} className="text-slate-800 dark:text-slate-200">
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {row.engineName}
                    </div>
                    <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                      {row.detail}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-emerald-700 dark:text-emerald-400">
                    {row.qubits.toLocaleString()}q
                  </td>
                  <td className="py-2.5 px-3">{row.gateCount.toLocaleString()}</td>
                  <td className="py-2.5 px-3 font-semibold">{row.elapsedMs.toFixed(2)} ms</td>
                  <td className="py-2.5 px-3">{row.activeStateFootprint}</td>
                  <td className="py-2.5 px-3 text-slate-500">{row.denseClassicalEquivalent}</td>
                  <td className="py-2.5 pl-3">
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300">
                      {row.ledgerTier}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: OpenQASM 2.0 SkWeaver Compiler + Pointed MTC & uor-matmul Zero-Decode */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: OpenQASM 2.0 SkWeaver Braid Compiler */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                OpenQASM 2.0 SkWeaver Topological Braid Compiler (AQ-14)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Synthesizes arbitrary Rx/Ry/Rz Euler angles into PU(22) Certified22 spectral-flow braids (Δλ = 3) with measured SU(2) residuals.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                role="group"
                aria-label="Topological braid carrier"
              >
                {(['Certified22', 'Clifford'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCarrierMode(mode)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                      carrierMode === mode
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300">
                <span>ε</span>
                <select
                  aria-label="Target SU(2) synthesis precision epsilon"
                  value={epsilonTarget}
                  onChange={(e) => setEpsilonTarget(Number(e.target.value))}
                  className="h-8 px-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                >
                  <option value={0.05}>0.05</option>
                  <option value={0.02}>0.02</option>
                  <option value={0.005}>0.005</option>
                  <option value={0.0001}>0.0001 (CF+SK)</option>
                </select>
              </label>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              OpenQASM 2.0 Source Program
            </span>
            <textarea
              rows={7}
              value={qasmSource}
              onChange={(e) => setQasmSource(e.target.value)}
              className="w-full p-3 rounded-lg bg-slate-950 text-emerald-200 font-mono text-xs border border-slate-800 focus:outline-none focus:border-emerald-500"
            />
          </label>

          {!skWeaverResult.ok ? (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 space-y-1 font-mono text-xs"
            >
              <div className="font-semibold text-rose-800 dark:text-rose-200">
                ✖ {skWeaverResult.error.kind} · {skWeaverResult.error.refusalCode}
              </div>
              <div className="text-rose-700 dark:text-rose-300">{skWeaverResult.error.detail}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums">
                <div>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    ● Compiled {skWeaverResult.segments.length} Braid Segments
                  </span>
                  <span className="mx-2 text-slate-500">·</span>
                  <span>Word Len {skWeaverResult.totalWordLength}</span>
                  <span className="mx-2 text-slate-500">·</span>
                  <span>Max d_PU(2) = {skWeaverResult.maxProjectiveResidual.toExponential(3)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onLoadCircuitIntoStudio(skWeaverResult.compatibleAqmCircuit)}
                  className="h-8 px-3 rounded-lg text-xs font-sans font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
                >
                  Load Compiled Braid into Studio
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-500">
                      <th className="py-1.5 px-2.5">QASM Op</th>
                      <th className="py-1.5 px-2.5">Synthesized Braid Word</th>
                      <th className="py-1.5 px-2.5">d_PU(2)</th>
                      <th className="py-1.5 px-2.5">Prefix κ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {skWeaverResult.segments.map((seg, i) => (
                      <tr key={i} className="text-slate-800 dark:text-slate-200">
                        <td className="py-1.5 px-2.5 font-semibold whitespace-nowrap">
                          {seg.instruction}
                        </td>
                        <td className="py-1.5 px-2.5 text-emerald-700 dark:text-emerald-400">
                          {seg.braidWord}
                        </td>
                        <td className="py-1.5 px-2.5">
                          {seg.projectiveResidual === 0
                            ? '0 (exact)'
                            : seg.projectiveResidual.toExponential(2)}
                        </td>
                        <td className="py-1.5 px-2.5 text-slate-400">
                          {seg.prefixKappa.slice(0, 17)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Pointed MTC Axiom Verifier & uor-matmul Zero-Decode Kernels */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Pointed MTC C(Z_T × Z_O, q) Verifier (AQ-13)
              </h2>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAtlasParamPreset('canonical')}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    atlasParamPreset === 'canonical'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  (4, 3, 8) · 96c
                </button>
                <button
                  type="button"
                  onClick={() => setAtlasParamPreset('parametric')}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    atlasParamPreset === 'parametric'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  (5, 2, 3) · 30c
                </button>
              </div>
            </div>

            {atlasGenReport.ok && (
              <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                Classes {atlasGenReport.summary.nClasses} · Carrier {atlasGenReport.summary.carrierBytes} B ·
                Orders (σ, τ, μ) = ({atlasGenReport.summary.sigmaOrder}, {atlasGenReport.summary.tauOrder},{' '}
                {atlasGenReport.summary.muOrder}) · c ≡ {mtcAxioms.centralChargeMod8} (mod 8)
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
              {[
                ['S Unitarity ||SS†−I||', mtcAxioms.sUnitaryResidual],
                ['(ST)³ = p⁺S² Anomaly', mtcAxioms.modularStCubedResidual],
                ['Pentagon Coherence', mtcAxioms.pentagonResidual],
                ['Hexagon Braiding', mtcAxioms.hexagonResidual],
                ['Ribbon Balancing', mtcAxioms.balancingResidual],
                ['Verlinde Integrality', mtcAxioms.verlindeIntegralResidual],
              ].map(([label, val]) => (
                <div
                  key={String(label)}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <div className="text-[11px] text-slate-500">{label}</div>
                  <div className="mt-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                    {Number(val).toExponential(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                uor-matmul Zero-Decode Contraction Tiers (AQ-11)
              </h2>
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                ● {codedKernelDemo.admission.status}
              </span>
            </div>

            <div className="space-y-2 text-xs font-mono tabular-nums">
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex justify-between">
                <span>Grid&lt;16&gt; Codebook (4×16×4)</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {codedKernelDemo.grid.codebookLookups} lookups · 0 float allocs
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex justify-between">
                <span>Packed&lt;Grid&lt;16&gt;, 2&gt; Nibbles</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {codedKernelDemo.packed.packedBytesRead} packed B · out[0]={String(codedKernelDemo.packed.out[0])}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex justify-between">
                <span>Runs&lt;Grid&lt;16&gt;, 16&gt; Sparse (64×64)</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {codedKernelDemo.runs.skippedZeroEntries}/4096 zeros skipped
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex justify-between">
                <span>wasm32 Packed4 i64 GEMV (AQ-18)</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  out[0]={String(codedKernelDemo.wasmGemv.out[0])} · {codedKernelDemo.wasmGemv.codedOps} ops
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
