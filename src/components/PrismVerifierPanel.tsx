import React, { useEffect, useRef, useState } from 'react';
import architectureLexSource from '@/app/src/Architecture.lex.tex?raw';
import complianceLexSource from '@/app/src/Compliance.lex.tex?raw';
import designLexSource from '@/app/src/Design.lex.tex?raw';
import featuresLexSource from '@/app/src/Features.lex.tex?raw';
import honestyLexSource from '@/app/src/Honesty.lex.tex?raw';
import qualityLexSource from '@/app/src/Quality.lex.tex?raw';
import quantumLexSource from '@/app/src/Quantum.lex.tex?raw';
import securityLexSource from '@/app/src/Security.lex.tex?raw';
import conformanceSource from '@/CONFORMANCE.md?raw';
import rustLibSource from '@/crates/verdant-aqm/src/lib.rs?raw';
import gherkinSuiteSource from '@/features/suites/aqm.feature?raw';
import advantageFeatureSource from '@/features/targets/advantage.feature?raw';
import modelIdsSource from '@/model/ids.toml?raw';
import modelLedgerSource from '@/model/ledger.toml?raw';
import pagesWorkflowSource from '@/.github/workflows/pages.yml?raw';
import siteAppJsonSource from '@/site/app.json?raw';
import kappaCacheSource from '@/ci/kappa-cache.ts?raw';
import precacheScriptSource from '@/bootstrap/precache.ts?raw';
import serviceWorkerSource from '@/public/sw.js?raw';
import upstreamTomlSource from '@/upstream.toml?raw';
import {
  buildVerdantAqmHoloArchive,
  runWasmPacked4Gemv,
  runWasmSymplecticCommute,
  runWasmTropicalClosure,
} from '../aqm/holoGuest';
import { AqmFrameSnapshot } from '../aqm/journal';
import {
  CORE_WASM_ACCEPTANCE_VECTORS,
  PLANTED_DEFECT_CATALOG,
  dispatchCoreWasmQuery,
  runAllAcceptanceVectors,
} from '../aqm/prismKernel';
import {
  evaluateParametricRatchet,
  verifyParametricRatchetPlantedDefects,
} from '../aqm/ratchet';
import {
  BUNDLED_RATCHET_WORKSPACE,
  foundationBytesLexRaw,
  ontologyRootLexRaw,
  ratchetTomlRaw,
  rustUorcRaw,
} from '../aqm/ratchetBundle';
import { AQM_STRATA_CERTIFICATES, CORE_WASM_REQUEST_MAX_BYTES } from '../aqm/stratum0';
import { AqmCircuitSpec, PlantedDefectResult } from '../aqm/types';
import { WorkerHoloBootSummary } from '../aqm/verifierWorker';
import { CustodyUorcPanel } from './CustodyUorcPanel';

interface PrismVerifierPanelProps {
  spec: AqmCircuitSpec;
  activeFrame: AqmFrameSnapshot | null;
  activeLod: number;
  onSelectLod: (lod: number) => void;
}

type PrismSubView = 'holo-wasm' | 'facets' | 'custody' | 'pages';

const ARTIFACT_FILES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly content: string;
}> = [
  { key: 'ontology', label: 'Ontology/Model.lex.tex', content: ontologyRootLexRaw },
  { key: 'bytes', label: 'Foundation/Bytes.lex.tex', content: foundationBytesLexRaw },
  { key: 'quantum', label: 'Quantum.lex.tex', content: quantumLexSource },
  { key: 'architecture', label: 'Architecture.lex.tex', content: architectureLexSource },
  { key: 'design', label: 'Design.lex.tex', content: designLexSource },
  { key: 'features', label: 'Features.lex.tex', content: featuresLexSource },
  { key: 'security', label: 'Security.lex.tex', content: securityLexSource },
  { key: 'quality', label: 'Quality.lex.tex', content: qualityLexSource },
  { key: 'compliance', label: 'Compliance.lex.tex', content: complianceLexSource },
  { key: 'honesty', label: 'Honesty.lex.tex', content: honestyLexSource },
  { key: 'ratchet', label: 'model/parametric-ratchet.toml', content: ratchetTomlRaw },
  { key: 'conformance', label: 'CONFORMANCE.md', content: conformanceSource },
  { key: 'upstream', label: 'upstream.toml', content: upstreamTomlSource },
  { key: 'ids', label: 'model/ids.toml', content: modelIdsSource },
  { key: 'ledger', label: 'model/ledger.toml', content: modelLedgerSource },
  { key: 'gherkin', label: 'aqm.feature', content: gherkinSuiteSource },
  { key: 'advantage', label: 'advantage.feature', content: advantageFeatureSource },
  { key: 'rust', label: 'verdant-aqm/lib.rs', content: rustLibSource },
  { key: 'rust-uorc', label: 'verdant-aqm/uorc.rs', content: rustUorcRaw },
];

export const PrismVerifierPanel: React.FC<PrismVerifierPanelProps> = ({
  spec,
  activeFrame,
  activeLod,
  onSelectLod,
}) => {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(1);
  const pendingRef = useRef(
    new Map<number, (resp: { ok: boolean; value?: unknown; error?: string }) => void>(),
  );

  const [subView, setSubView] = useState<PrismSubView>('holo-wasm');
  const [workerIdentity, setWorkerIdentity] = useState<WorkerHoloBootSummary | null>(null);
  const [queryInput, setQueryInput] = useState('aqm:summary');
  const [queryOutput, setQueryOutput] = useState(() => dispatchCoreWasmQuery('aqm:summary'));
  const [acceptanceReport, setAcceptanceReport] = useState<{
    passed: number;
    total: number;
    executedViaWasmGuest?: boolean;
  }>(() => runAllAcceptanceVectors());
  const [activeDefect, setActiveDefect] = useState<{
    id: string;
    result: PlantedDefectResult;
  } | null>(null);
  const [artifactKey, setArtifactKey] = useState<string>('quantum');
  const [pagesDocKey, setPagesDocKey] = useState<'workflow' | 'appjson' | 'kappa' | 'sw' | 'precache'>('workflow');
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../aqm/verifierWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      worker.onmessage = (
        ev: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>,
      ) => {
        const cb = pendingRef.current.get(ev.data.id);
        if (cb) {
          pendingRef.current.delete(ev.data.id);
          cb(ev.data);
        }
      };

      const initId = reqIdRef.current++;
      pendingRef.current.set(initId, (resp) => {
        if (resp.ok && resp.value) {
          setWorkerIdentity(resp.value as WorkerHoloBootSummary);
        }
      });
      worker.postMessage({ id: initId, kind: 'init' });

      const accId = reqIdRef.current++;
      pendingRef.current.set(accId, (resp) => {
        if (resp.ok && resp.value) {
          setAcceptanceReport(
            resp.value as { passed: number; total: number; executedViaWasmGuest?: boolean },
          );
        }
      });
      worker.postMessage({ id: accId, kind: 'acceptance' });
    } catch {
      workerRef.current = null;
    }

    return () => {
      worker?.terminate();
      workerRef.current = null;
    };
  }, []);

  const callVerifierWorker = <T,>(
    payload: Record<string, unknown>,
    fallback: () => T,
    onDone: (val: T) => void,
  ) => {
    const w = workerRef.current;
    if (!w) {
      onDone(fallback());
      return;
    }
    const id = reqIdRef.current++;
    pendingRef.current.set(id, (resp) => {
      if (resp.ok && resp.value !== undefined) {
        onDone(resp.value as T);
      } else {
        onDone(fallback());
      }
    });
    w.postMessage({ id, ...payload });
  };

  const handleDispatchQuery = (e: React.FormEvent) => {
    e.preventDefault();
    callVerifierWorker(
      { kind: 'dispatch', request: queryInput },
      () => dispatchCoreWasmQuery(queryInput),
      (res) => setQueryOutput(res),
    );
  };

  const handleRunAcceptance = () => {
    callVerifierWorker(
      { kind: 'acceptance' },
      () => runAllAcceptanceVectors(),
      (rep) => setAcceptanceReport(rep),
    );
  };

  const handlePlantDefect = (defectId: string) => {
    const entry = PLANTED_DEFECT_CATALOG.find((d) => d.id === defectId);
    if (!entry) return;
    callVerifierWorker(
      { kind: 'plant-defect', defectId },
      () => entry.run(),
      (res) => setActiveDefect({ id: defectId, result: res }),
    );
  };

  const handleDownloadHoloArchive = () => {
    const built = buildVerdantAqmHoloArchive('VerdantAqm@0.3.0:10-modules:AQ-01..AQ-23');
    const copyBuf = new ArrayBuffer(built.archiveBytes.byteLength);
    new Uint8Array(copyBuf).set(built.archiveBytes);
    const blob = new Blob([copyBuf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'VerdantAqm.holo';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadStatus(
      `Exported VerdantAqm.holo (${built.archiveBytes.byteLength} B · blake3:${built.archiveFingerprint.slice(0, 16)}…)`,
    );
  };

  const wasmKernelParity = React.useMemo(() => {
    const x1 = new BigUint64Array([0b1011n, 0n]);
    const z1 = new BigUint64Array([0b0110n, 0n]);
    const x2 = new BigUint64Array([0b1100n, 0n]);
    const z2 = new BigUint64Array([0b0011n, 0n]);
    const commOk = runWasmSymplecticCommute(x1, z1, x2, z2) === false;

    const gemv = runWasmPacked4Gemv(
      new Int32Array([12, 1, 0, -6]),
      new Uint8Array([(8 << 4) | 15, (0 << 4) | 7]),
      new Int32Array([-8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8, 12]),
      1,
      2,
    );
    const gemvOk = gemv.out[0] === 193n;

    const inf = 1_000_000;
    const w = new Int32Array([0, 1, inf, 1, 0, 1, inf, 1, 0]);
    const hop = new Int32Array([0, 1, -1, 0, 1, 2, -1, 1, 2]);
    const trop = runWasmTropicalClosure(w, hop, 3);
    const tropOk = trop.dist[2] === 2 && trop.nextHop[2] === 1;

    return { commOk, gemvOut: gemv.out[0], gemvOk, tropDist02: trop.dist[2], tropOk };
  }, []);

  const ratchetAudit = React.useMemo(() => {
    const report = evaluateParametricRatchet(BUNDLED_RATCHET_WORKSPACE);
    const planted = verifyParametricRatchetPlantedDefects(BUNDLED_RATCHET_WORKSPACE);
    return { report, planted };
  }, []);

  const queryByteLen = new TextEncoder().encode(queryInput).byteLength;
  const selectedArtifact =
    ARTIFACT_FILES.find((f) => f.key === artifactKey) ?? ARTIFACT_FILES[0];

  return (
    <div className="space-y-2">
      {/* Sub-Navigation Bar */}
      <div className="max-w-[1380px] mx-auto px-6 pt-5 flex flex-wrap items-center justify-between gap-4">
        <div
          className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800"
          role="tablist"
          aria-label="Prism and Hologram sub-views"
        >
          {(
            [
              ['holo-wasm', 'Holo v4 & Core-Wasm Guest'],
              ['facets', 'All 8 Prism Facets & Model'],
              ['custody', 'UORC & Stitch Custody'],
              ['pages', 'GitHub Pages & Provenance'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={subView === id}
              onClick={() => setSubView(id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subView === id
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {downloadStatus && (
            <span role="status" className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
              {downloadStatus}
            </span>
          )}
          <button
            type="button"
            onClick={handleDownloadHoloArchive}
            className="h-9 px-3.5 rounded-lg text-xs font-semibold border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Download VerdantAqm.holo (v4)
          </button>
          <button
            type="button"
            onClick={handleRunAcceptance}
            className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            Run All {acceptanceReport.total} Wasm Vectors
          </button>
        </div>
      </div>

      {subView === 'custody' ? (
        <CustodyUorcPanel
          spec={spec}
          activeFrame={activeFrame}
          activeLod={activeLod}
          onSelectLod={onSelectLod}
        />
      ) : subView === 'pages' ? (
        (() => {
          const parsedApp = JSON.parse(siteAppJsonSource) as {
            name: string;
            live: string;
            repository: string;
            claim: string;
            theorems: ReadonlyArray<{ name: string; statement: string; where: string }>;
          };
          const pagesDocs = {
            workflow: { label: '.github/workflows/pages.yml', content: pagesWorkflowSource },
            appjson: { label: 'site/app.json', content: siteAppJsonSource },
            kappa: { label: 'ci/kappa-cache.ts', content: kappaCacheSource },
            sw: { label: 'public/sw.js', content: serviceWorkerSource },
            precache: { label: 'bootstrap/precache.ts', content: precacheScriptSource },
          } as const;
          return (
            <div className="max-w-[1380px] mx-auto px-6 py-4 space-y-6">
              <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      GitHub Pages Publishing, Input-κ Cache & SLSA Provenance (pages.yml)
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Modeled after afflom/verdant-engine: builds subpath-safe static site + verified VerdantAqm.holo v4 guest, signs SLSA provenance, and writes content-addressed precache.json.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([siteAppJsonSource], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'app.json';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                      setDownloadStatus('Exported site/app.json Prism Pages manifest');
                    }}
                    className="h-9 px-3.5 rounded-lg text-xs font-semibold border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    Export site/app.json
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500">Target Pages URL</div>
                    <div className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                      {parsedApp.live}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500">Input-Addressed Cache</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                      ghcr.io/*/prism-holo (BLAKE3 κ)
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500">Provenance Attestation</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                      attest-build-provenance@v4.2.2
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500">Offline SW Cache</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                      prism-&lt;sha256&gt; + precache.json
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Published Claim ({parsedApp.theorems.length} Pinned Theorems in site/app.json)
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 font-mono leading-relaxed">
                    {parsedApp.claim}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(pagesDocs) as Array<keyof typeof pagesDocs>).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPagesDocKey(k)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                        pagesDocKey === k
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-500'
                      }`}
                    >
                      {pagesDocs[k].label}
                    </button>
                  ))}
                </div>

                <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed overflow-auto max-h-[520px] border border-slate-800">
                  {pagesDocs[pagesDocKey].content}
                </pre>
              </div>
            </div>
          );
        })()
      ) : subView === 'facets' ? (
        <div className="max-w-[1380px] mx-auto px-6 py-4 space-y-6">
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  Complete 8-Facet Prism Specification, Conformance & Rust Runtime
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Authoritative `.lex.tex` Lean 4 facets, `CONFORMANCE.md`, `model/*.toml`, Gherkin suites, and `crates/verdant-aqm`.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setArtifactKey('w5h')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  artifactKey === 'w5h'
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                8 Strata W5H Certificates
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ARTIFACT_FILES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setArtifactKey(item.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    artifactKey === item.key
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-500'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {artifactKey === 'w5h' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {AQM_STRATA_CERTIFICATES.map((cert) => (
                  <div
                    key={cert.stratum}
                    className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 text-xs"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Stratum {cert.stratum} · {cert.who} — {cert.what}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      Invariant: {cert.whyInvariant}
                    </div>
                    <div className="font-mono text-emerald-700 dark:text-emerald-400">
                      {cert.howConstructed}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed overflow-auto max-h-[620px] border border-slate-800">
                {selectedArtifact.content}
              </pre>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-[1380px] mx-auto px-6 py-4 space-y-6">
          {/* Hologram v4 Binary Archive & Zero-Import WebAssembly.Instance Telemetry */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  Hologram v4 Binary Archive & Zero-Import wasm32 Core-Wasm Verifier (AQ-15)
                </h1>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {workerIdentity?.contract ?? 'hologram:guest/core-wasm@1'} ·{' '}
                  {acceptanceReport.executedViaWasmGuest
                    ? `WebAssembly.Instance holo_run (${acceptanceReport.passed}/${acceptanceReport.total} passed)`
                    : `${acceptanceReport.passed}/${acceptanceReport.total} passed`}
                </p>
              </div>

              <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                {workerIdentity?.zeroImportsVerified
                  ? 'Zero-Import Wasm Sandbox Verified'
                  : 'Constructive Kernel Active'}
              </span>
            </div>

            {workerIdentity && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1 text-xs font-mono tabular-nums">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500">Archive Format</div>
                  <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                    HOLO v{workerIdentity.holoVersion} · {workerIdentity.archiveBytesLength} B
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500">Compiled wasm32 Guest</div>
                  <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {workerIdentity.wasmBytesLength} B · {workerIdentity.exportedSymbols.length} exports
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500">wasm_kappa (BLAKE3)</div>
                  <div className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                    {workerIdentity.wasmKappa}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500">32B Footer Fingerprint</div>
                  <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {workerIdentity.attestation}
                  </div>
                </div>
              </div>
            )}

            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-800/80">
              <span>
                Zero-Import Exports (AQ-18): memory · holo_alloc · holo_run · wasm_symplectic_commute · wasm_coded_packed4_gemv · wasm_tropical_minplus_closure
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                {wasmKernelParity.commOk && wasmKernelParity.gemvOk && wasmKernelParity.tropOk
                  ? `Live Wasm Kernel Parity Verified (GEMV=${String(wasmKernelParity.gemvOut)}, d₀₂=${wasmKernelParity.tropDist02})`
                  : 'Kernel Parity Mismatch'}
              </span>
            </div>
          </div>

          {/* Permanent Zero-Constants Parametric Ratchet (FI-08 · prism/parametric-ratchet/1 · AQ-23) */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Permanent Zero-Constants Parametric Ratchet (FI-08 · {ratchetAudit.report.spec} · AQ-23)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>{ratchetAudit.report.groundedLexModuleCount} Grounded .lex.tex Modules</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span>{ratchetAudit.report.auditedRustFileCount} Rust Engine Sources</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span>
                    Planted Self-Checks: {ratchetAudit.planted.casesVerified}/{ratchetAudit.planted.casesVerified}{' '}
                    {ratchetAudit.planted.allCaughtAndRestored ? 'Caught & Restored' : 'Failed'}
                  </span>
                </p>
              </div>
              <div
                className={`text-xs font-mono tabular-nums font-semibold ${
                  ratchetAudit.report.ok
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {ratchetAudit.report.ok
                  ? 'All 6 Zero Ceilings Locked (0 / 0)'
                  : `${ratchetAudit.report.violations.length} Ratchet Violation(s)`}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono tabular-nums">
              {[
                [
                  'Ontology > 1',
                  ratchetAudit.report.counts.ontologyRootLiteralGtOneCount,
                  ratchetAudit.report.ceilings.max_ontology_root_literal_gt_one_count,
                ],
                [
                  'Ontology String',
                  ratchetAudit.report.counts.ontologyRootStringFieldCount,
                  ratchetAudit.report.ceilings.max_ontology_root_string_field_count,
                ],
                [
                  'Classical.choice',
                  ratchetAudit.report.counts.classicalChoiceCount,
                  ratchetAudit.report.ceilings.max_classical_choice_count,
                ],
                [
                  'Ungrounded Lex',
                  ratchetAudit.report.counts.ungroundedLexModuleCount,
                  ratchetAudit.report.ceilings.max_ungrounded_lex_module_count,
                ],
                [
                  'Domain Lex > 1',
                  ratchetAudit.report.counts.domainLexMagicLiteralCount,
                  ratchetAudit.report.ceilings.max_domain_lex_magic_literal_count,
                ],
                [
                  'Rust Engine > 1',
                  ratchetAudit.report.counts.engineRustMagicLiteralCount,
                  ratchetAudit.report.ceilings.max_engine_rust_magic_literal_count,
                ],
              ].map(([label, actual, ceiling]) => (
                <div
                  key={String(label)}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <div className="text-slate-500 truncate">{label}</div>
                  <div className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    {actual} / {ceiling}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Wasm holo_run Query Dispatch */}
            <form
              onSubmit={handleDispatchQuery}
              className="lg:col-span-6 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Live wasm32 holo_run(ptr, len) Query Dispatch
                </h2>
                <span
                  className={`text-xs font-mono tabular-nums ${
                    queryByteLen > CORE_WASM_REQUEST_MAX_BYTES
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500'
                  }`}
                >
                  {queryByteLen} / {CORE_WASM_REQUEST_MAX_BYTES} UTF-8 bytes
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="Core-Wasm verification query"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="e.g. aqm:summary, aqm:atlas:mtc, aqm:holo:v4"
                  className="flex-1 h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
                >
                  Execute holo_run
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {[
                  'aqm:eval:wire:128:0,127',
                  'aqm:eval:wire:128:64,64',
                  'aqm:eval:surface:7',
                  'aqm:eval:phase:5,7',
                  'aqm:eval:qiskit:0,1000000,1024',
                  ...CORE_WASM_ACCEPTANCE_VECTORS.map((v) => v.request),
                ].map((reqStr) => (
                  <button
                    key={reqStr}
                    type="button"
                    onClick={() => {
                      setQueryInput(reqStr);
                      callVerifierWorker(
                        { kind: 'dispatch', request: reqStr },
                        () => dispatchCoreWasmQuery(reqStr),
                        (res) => setQueryOutput(res),
                      );
                    }}
                    className="px-2.5 py-1 rounded text-xs font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-500 whitespace-nowrap"
                  >
                    {reqStr}
                  </button>
                ))}
              </div>

              <div className="p-3.5 rounded-lg bg-slate-950 text-emerald-300 font-mono text-xs break-all border border-slate-800">
                {queryOutput}
              </div>
            </form>

            {/* Right: All 9 Planted Defect Gates */}
            <div className="lg:col-span-6 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Planted Defect Gate Verification (R5 Negative Refusals · {PLANTED_DEFECT_CATALOG.length} Gates)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Every gate proves both refusal on planted violation and clean restoration on fix.
                </p>
              </div>

              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {PLANTED_DEFECT_CATALOG.map((defect) => {
                  const isSelected = activeDefect?.id === defect.id;
                  return (
                    <div
                      key={defect.id}
                      className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {defect.capabilityId} · {defect.title}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {defect.description}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Plant defect ${defect.capabilityId}: ${defect.title}`}
                          onClick={() => handlePlantDefect(defect.id)}
                          className="h-9 px-3 rounded-lg text-xs font-medium bg-slate-900 dark:bg-slate-800 text-white border border-slate-700 hover:border-emerald-500 transition-colors whitespace-nowrap shrink-0"
                        >
                          Plant Defect
                        </button>
                      </div>

                      {isSelected && activeDefect && (
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 font-mono text-xs">
                          <div className="text-amber-400 font-semibold">
                            ▲ Gate Triggered · {activeDefect.result.error.kind}
                          </div>
                          <div className="text-slate-300">
                            Planted: {activeDefect.result.plantedDescription}
                          </div>
                          <div className="text-rose-400">
                            Diagnostic: {activeDefect.result.verifierRefusalVector} —{' '}
                            {activeDefect.result.error.detail}
                          </div>
                          <div className="text-emerald-400">
                            Restored: {activeDefect.result.restoredPassVector}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
