import React, { useEffect, useRef, useState } from 'react';
import quantumLexSource from '@/app/src/Quantum.lex.tex?raw';
import rustLibSource from '@/crates/verdant-aqm/src/lib.rs?raw';
import gherkinSuiteSource from '@/features/suites/aqm.feature?raw';
import modelIdsSource from '@/model/ids.toml?raw';
import {
  CORE_WASM_ACCEPTANCE_VECTORS,
  PLANTED_DEFECT_CATALOG,
  dispatchCoreWasmQuery,
  runAllAcceptanceVectors,
} from '../aqm/prismKernel';
import { AQM_STRATA_CERTIFICATES, CORE_WASM_REQUEST_MAX_BYTES } from '../aqm/stratum0';
import { PlantedDefectResult } from '../aqm/types';

type ArtifactTab = 'lexlean' | 'ids' | 'gherkin' | 'rust' | 'w5h';

export const PrismVerifierPanel: React.FC = () => {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(1);
  const pendingRef = useRef(
    new Map<number, (resp: { ok: boolean; value?: unknown; error?: string }) => void>(),
  );

  const [workerIdentity, setWorkerIdentity] = useState<{
    contract: string;
    verified: boolean;
    attestation: string;
    ratchetSummary: string;
  } | null>(null);

  const [queryInput, setQueryInput] = useState('aqm:summary');
  const [queryOutput, setQueryOutput] = useState(() => dispatchCoreWasmQuery('aqm:summary'));
  const [acceptanceReport, setAcceptanceReport] = useState(() => runAllAcceptanceVectors());
  const [activeDefect, setActiveDefect] = useState<{
    id: string;
    result: PlantedDefectResult;
  } | null>(null);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('lexlean');

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../aqm/verifierWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
        const cb = pendingRef.current.get(ev.data.id);
        if (cb) {
          pendingRef.current.delete(ev.data.id);
          cb(ev.data);
        }
      };

      const initId = reqIdRef.current++;
      pendingRef.current.set(initId, (resp) => {
        if (resp.ok && resp.value) {
          setWorkerIdentity(
            resp.value as {
              contract: string;
              verified: boolean;
              attestation: string;
              ratchetSummary: string;
            },
          );
        }
      });
      worker.postMessage({ id: initId, kind: 'init' });
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

  const queryByteLen = new TextEncoder().encode(queryInput).byteLength;

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Prism Formal Law & Isolated Core-Wasm Verifier
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 font-mono tabular-nums">
            <span>{workerIdentity?.contract ?? 'hologram:guest/core-wasm@1'}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Request Ceiling {CORE_WASM_REQUEST_MAX_BYTES}B</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>
              Acceptance {acceptanceReport.passed}/{acceptanceReport.total} Passed
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunAcceptance}
          className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
        >
          Re-Run All 16 Worker Acceptance Vectors
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Core-Wasm Query Console & Planted Defect Gate Bench */}
        <div className="lg:col-span-6 space-y-6">
          <form
            onSubmit={handleDispatchQuery}
            className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Core-Wasm Verifier Query Dispatch
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
                placeholder="e.g. aqm:summary, aqm:unitary, aqm:defect:cloning"
                className="flex-1 h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                Verify Query
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CORE_WASM_ACCEPTANCE_VECTORS.slice(0, 10).map((vec) => (
                <button
                  key={vec.request}
                  type="button"
                  onClick={() => {
                    setQueryInput(vec.request);
                    callVerifierWorker(
                      { kind: 'dispatch', request: vec.request },
                      () => dispatchCoreWasmQuery(vec.request),
                      (res) => setQueryOutput(res),
                    );
                  }}
                  className="px-2.5 py-1 rounded text-xs font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-500 whitespace-nowrap"
                >
                  {vec.request}
                </button>
              ))}
            </div>

            <div className="p-3 rounded-lg bg-slate-950 text-emerald-300 font-mono text-xs break-all border border-slate-800">
              {queryOutput}
            </div>
          </form>

          {/* Planted Defect Gate Bench (AGENTS.md Section "Gate quality" & Prompt 4.5) */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Planted Defect Gate Verification (R5 Negative Refusals)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                In Prism, a gate is evidence only after a planted defect demonstrates that it can fail and cleanly restore.
              </p>
            </div>

            <div className="space-y-2">
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

        {/* Right: Authoritative LexLean, TOML, Gherkin, Rust & W5H Stratum Explorer */}
        <div className="lg:col-span-6 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Authoritative Prism Model & Stratum Artifacts
            </h2>
            <div
              className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              role="tablist"
              aria-label="Prism specification files"
            >
              {(
                [
                  ['lexlean', 'Quantum.lex.tex'],
                  ['ids', 'model/ids.toml'],
                  ['gherkin', 'aqm.feature'],
                  ['rust', 'verdant-aqm/lib.rs'],
                  ['w5h', '8 Strata W5H'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={artifactTab === key}
                  onClick={() => setArtifactTab(key)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    artifactTab === key
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {artifactTab === 'w5h' ? (
            <div className="space-y-2.5 max-h-[540px] overflow-y-auto">
              {AQM_STRATA_CERTIFICATES.map((cert) => (
                <div
                  key={cert.stratum}
                  className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 text-xs"
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
            <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed overflow-auto max-h-[540px] border border-slate-800">
              {artifactTab === 'lexlean'
                ? quantumLexSource
                : artifactTab === 'ids'
                  ? modelIdsSource
                  : artifactTab === 'gherkin'
                    ? gherkinSuiteSource
                    : rustLibSource}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
