import React, { useMemo, useState } from 'react';
import { Download, Play, Plus, RotateCcw } from 'lucide-react';

import qiskitWorkflowRaw from '@/.github/workflows/qiskit.yml?raw';
import rawExplanationMd from '@/docs/explanation/prism-substrates-and-honesty-gates.md?raw';
import rawHowToMd from '@/docs/how-to/unbounded-megascale-and-aer-migration.md?raw';
import rawHubMd from '@/docs/index.md?raw';
import rawReferenceMd from '@/docs/reference/qiskit-backend-v2-and-primitives-api.md?raw';
import rawTutorialMd from '@/docs/tutorials/01-quickstart-qiskit-backend.md?raw';
import pyProjectTomlRaw from '@/python/qiskit-verdant-aqm/pyproject.toml?raw';
import pyReadmeRaw from '@/python/qiskit-verdant-aqm/README.md?raw';
import pyBackendRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/backend.py?raw';
import pyPrimitivesRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/primitives.py?raw';
import pyProviderRaw from '@/python/qiskit-verdant-aqm/qiskit_verdant_aqm/provider.py?raw';
import pyTestOracleRaw from '@/python/qiskit-verdant-aqm/tests/test_qiskit_oracle.py?raw';
import upstreamTomlRaw from '@/upstream.toml?raw';
import rawVendorContent from '@/vendor/qiskit-oracle/content.json?raw';
import rawVendorGate from '@/vendor/qiskit-oracle/devrel-publish-gate.prompt.json?raw';
import rawVendorStandard from '@/vendor/qiskit-oracle/standard.json?raw';
import rawVendorEstimator from '@/vendor/qiskit-oracle/test_backend_estimator_v2.py?raw';
import rawVendorSampler from '@/vendor/qiskit-oracle/test_backend_sampler_v2.py?raw';
import rawVendorBackendV2 from '@/vendor/qiskit-oracle/test_backend_v2.py?raw';
import rawVendorBasicSim from '@/vendor/qiskit-oracle/test_basic_simulator.py?raw';

import {
  CANONICAL_NOTEBOOK_SPECS,
  DIATAXIS_GUIDE_META,
  DevRelPersonaId,
  NotebookCellSpec,
  PRISM_DEVREL_PERSONAS,
  buildJupyterNotebookJson,
  runDevRelContentAndPublishGateAudit,
} from '../aqm/devrelGuides';
import {
  NotebookCellExecutionOutput,
  QISKIT_TARGET_ISA,
  executeQiskitNotebookCell,
} from '../aqm/qiskitBackend';
import {
  AuthoritativeQiskitOracleReport,
  runAuthoritativeQiskitOracleSuite,
} from '../aqm/qiskitOracle';
import { AqmCircuitSpec } from '../aqm/types';

interface QiskitNotebookPanelProps {
  onLoadCircuitIntoStudio: (spec: AqmCircuitSpec) => void;
}

type QiskitWorkspaceSubTab = 'notebooks' | 'oracle' | 'sdk-docs';

const VENDORED_ORACLE_PAYLOADS: Readonly<Record<string, string>> = {
  'test_backend_v2.py': rawVendorBackendV2,
  'test_basic_simulator.py': rawVendorBasicSim,
  'test_backend_sampler_v2.py': rawVendorSampler,
  'test_backend_estimator_v2.py': rawVendorEstimator,
  'devrel-publish-gate.prompt.json': rawVendorGate,
  'standard.json': rawVendorStandard,
  'content.json': rawVendorContent,
};

const GUIDE_MARKDOWN_MAP: Readonly<Record<string, string>> = {
  'docs/index.md': rawHubMd,
  'docs/tutorials/01-quickstart-qiskit-backend.md': rawTutorialMd,
  'docs/how-to/unbounded-megascale-and-aer-migration.md': rawHowToMd,
  'docs/reference/qiskit-backend-v2-and-primitives-api.md': rawReferenceMd,
  'docs/explanation/prism-substrates-and-honesty-gates.md': rawExplanationMd,
};

const PYTHON_SDK_FILES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly downloadName: string;
  readonly content: string;
}> = [
  {
    key: 'pyproject',
    label: 'pyproject.toml',
    downloadName: 'pyproject.toml',
    content: pyProjectTomlRaw,
  },
  {
    key: 'backend',
    label: 'qiskit_verdant_aqm/backend.py',
    downloadName: 'backend.py',
    content: pyBackendRaw,
  },
  {
    key: 'primitives',
    label: 'qiskit_verdant_aqm/primitives.py',
    downloadName: 'primitives.py',
    content: pyPrimitivesRaw,
  },
  {
    key: 'provider',
    label: 'qiskit_verdant_aqm/provider.py',
    downloadName: 'provider.py',
    content: pyProviderRaw,
  },
  {
    key: 'oracle-test',
    label: 'tests/test_qiskit_oracle.py',
    downloadName: 'test_qiskit_oracle.py',
    content: pyTestOracleRaw,
  },
  {
    key: 'upstream',
    label: 'upstream.toml',
    downloadName: 'upstream.toml',
    content: upstreamTomlRaw,
  },
  {
    key: 'workflow',
    label: '.github/workflows/qiskit.yml',
    downloadName: 'qiskit.yml',
    content: qiskitWorkflowRaw,
  },
  {
    key: 'readme',
    label: 'python/README.md',
    downloadName: 'README.md',
    content: pyReadmeRaw,
  },
];

/** Faceted geometric prism avatar modeled after `afflom/prism-devrel/scripts/content/guides.mjs` */
const PrismPersonaGlyph: React.FC<{ personaId: DevRelPersonaId }> = ({ personaId }) => {
  const spec = PRISM_DEVREL_PERSONAS[personaId];
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
    >
      <polygon points="16,2 29,10 29,22 16,30 3,22 3,10" fill={spec.accentHex} fillOpacity="0.18" stroke={spec.accentHex} strokeWidth="1.5" />
      <polygon points="16,2 29,10 16,16" fill={spec.accentHex} fillOpacity="0.38" />
      <polygon points="3,10 16,16 16,30 3,22" fill={spec.accentHex} fillOpacity="0.26" />
      <circle cx="16" cy="16" r="3" fill={spec.accentHex} />
    </svg>
  );
};

export const QiskitNotebookPanel: React.FC<QiskitNotebookPanelProps> = ({
  onLoadCircuitIntoStudio,
}) => {
  const [subTab, setSubTab] = useState<QiskitWorkspaceSubTab>('notebooks');
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>(
    CANONICAL_NOTEBOOK_SPECS[0].id,
  );

  // Editable per-notebook cell list + execution state
  const [cellsByNotebook, setCellsByNotebook] = useState<Record<string, NotebookCellSpec[]>>(() => {
    const init: Record<string, NotebookCellSpec[]> = {};
    for (const nb of CANONICAL_NOTEBOOK_SPECS) {
      init[nb.id] = nb.cells.map((c) => ({ ...c }));
    }
    return init;
  });

  const [outputsByCell, setOutputsByCell] = useState<Record<string, NotebookCellExecutionOutput>>(
    () => {
      const init: Record<string, NotebookCellExecutionOutput> = {};
      for (const nb of CANONICAL_NOTEBOOK_SPECS) {
        const built = buildJupyterNotebookJson(nb);
        Object.assign(init, built.cellOutputs);
      }
      return init;
    },
  );

  const [oracleReport, setOracleReport] = useState<AuthoritativeQiskitOracleReport>(() =>
    runAuthoritativeQiskitOracleSuite(VENDORED_ORACLE_PAYLOADS),
  );
  const [selectedGuideId, setSelectedGuideId] = useState<string>('hub');
  const [selectedSdkKey, setSelectedSdkKey] = useState<string>('pyproject');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const devrelAudit = useMemo(
    () => runDevRelContentAndPublishGateAudit(GUIDE_MARKDOWN_MAP, VENDORED_ORACLE_PAYLOADS),
    [],
  );

  const activeNotebookSpec =
    CANONICAL_NOTEBOOK_SPECS.find((n) => n.id === selectedNotebookId) ??
    CANONICAL_NOTEBOOK_SPECS[0];
  const activeCells = cellsByNotebook[activeNotebookSpec.id] ?? activeNotebookSpec.cells;

  const handleUpdateCellSource = (cellId: string, nextSource: string) => {
    setCellsByNotebook((prev) => ({
      ...prev,
      [activeNotebookSpec.id]: (prev[activeNotebookSpec.id] ?? []).map((c) =>
        c.id === cellId ? { ...c, source: nextSource } : c,
      ),
    }));
  };

  const handleRunSingleCell = (cell: NotebookCellSpec) => {
    if (cell.cellType !== 'code') return;
    const out = executeQiskitNotebookCell(cell.source);
    setOutputsByCell((prev) => ({ ...prev, [cell.id]: out }));
  };

  const handleRunAllCells = () => {
    const nextOutputs: Record<string, NotebookCellExecutionOutput> = {};
    let ranCount = 0;
    for (const cell of activeCells) {
      if (cell.cellType === 'code') {
        nextOutputs[cell.id] = executeQiskitNotebookCell(cell.source);
        ranCount += 1;
      }
    }
    setOutputsByCell((prev) => ({ ...prev, ...nextOutputs }));
    setStatusBanner(`Executed ${ranCount} code cells on VerdantAqmBackend`);
    window.setTimeout(() => setStatusBanner(null), 3500);
  };

  const handleResetNotebook = () => {
    const orig = CANONICAL_NOTEBOOK_SPECS.find((n) => n.id === activeNotebookSpec.id);
    if (!orig) return;
    setCellsByNotebook((prev) => ({
      ...prev,
      [orig.id]: orig.cells.map((c) => ({ ...c })),
    }));
    const built = buildJupyterNotebookJson(orig);
    setOutputsByCell((prev) => ({ ...prev, ...built.cellOutputs }));
    setStatusBanner(`Restored canonical cells for ${orig.fileName}`);
    window.setTimeout(() => setStatusBanner(null), 3500);
  };

  const handleAddCodeCell = () => {
    const newId = `${activeNotebookSpec.id}-custom-${Date.now()}`;
    const templateSource = [
      'from qiskit import QuantumCircuit',
      'from qiskit_verdant_aqm import VerdantAqmBackend',
      '',
      'qc = QuantumCircuit(4, 4, name="custom_cat_4q")',
      'qc.h(0)',
      'for q in range(3):',
      '    qc.cx(q, q + 1)',
      'qc.t(3)',
      'qc.measure([0, 1, 2, 3], [0, 1, 2, 3])',
      '',
      'backend = VerdantAqmBackend(shots=1024, seed_simulator=42)',
      'result = backend.run(qc).result()',
    ].join('\n');
    const cell: NotebookCellSpec = {
      id: newId,
      cellType: 'code',
      title: 'Custom Qiskit Experiment',
      source: templateSource,
    };
    setCellsByNotebook((prev) => ({
      ...prev,
      [activeNotebookSpec.id]: [...(prev[activeNotebookSpec.id] ?? []), cell],
    }));
    setOutputsByCell((prev) => ({
      ...prev,
      [newId]: executeQiskitNotebookCell(templateSource),
    }));
  };

  const handleDownloadIpynb = () => {
    const customSpec = {
      ...activeNotebookSpec,
      cells: activeCells,
    };
    const built = buildJupyterNotebookJson(customSpec);
    const payload = `${JSON.stringify(built.notebook, null, 2)}\n`;
    const blob = new Blob([payload], { type: 'application/x-ipynb+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = activeNotebookSpec.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusBanner(`Exported ${activeNotebookSpec.fileName} (nbformat v4.5)`);
    window.setTimeout(() => setStatusBanner(null), 3500);
  };

  const handleDownloadTextFile = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusBanner(`Exported ${fileName}`);
    window.setTimeout(() => setStatusBanner(null), 3500);
  };

  const activeGuideMeta =
    DIATAXIS_GUIDE_META.find((g) => g.id === selectedGuideId) ?? DIATAXIS_GUIDE_META[0];
  const activeGuideMarkdown = GUIDE_MARKDOWN_MAP[activeGuideMeta.path] ?? '';
  const activeSdkFile =
    PYTHON_SDK_FILES.find((f) => f.key === selectedSdkKey) ?? PYTHON_SDK_FILES[0];

  let codeCellCounter = 0;

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-5 space-y-6">
      {/* Header & Sub-Workspace Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Production Qiskit BackendV2, Jupyter Lab & External Validation Oracle
          </h1>
          <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
            <span>qiskit-verdant-aqm@0.3.0</span>
            <span aria-hidden="true"> · </span>
            <span>num_qubits=None (Unbounded)</span>
            <span aria-hidden="true"> · </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              ● Oracle {oracleReport.passedCount}/{oracleReport.totalCount} PASS
            </span>
            <span aria-hidden="true"> · </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              ● DevRel Gate: {devrelAudit.gateVerdict} ({devrelAudit.coveredCapabilities.length}/21 AQ IDs)
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {statusBanner && (
            <span role="status" className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
              {statusBanner}
            </span>
          )}
          <div
            className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800"
            role="tablist"
            aria-label="Qiskit and DevRel views"
          >
            {(
              [
                ['notebooks', 'Jupyter Notebook Lab (.ipynb)'],
                ['oracle', 'Authoritative Qiskit Oracle (16)'],
                ['sdk-docs', 'Python SDK & Diataxis Guides'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={subTab === id}
                onClick={() => setSubTab(id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  subTab === id
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TAB 1: INTERACTIVE JUPYTER NOTEBOOK LAB */}
      {subTab === 'notebooks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Rail: Canonical Notebooks & Persona Metadata */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Published Jupyter Notebooks (nbformat v4.5)
              </div>
              <div className="space-y-2">
                {CANONICAL_NOTEBOOK_SPECS.map((nb) => {
                  const selected = nb.id === activeNotebookSpec.id;
                  const persona = PRISM_DEVREL_PERSONAS[nb.persona];
                  return (
                    <button
                      key={nb.id}
                      type="button"
                      onClick={() => setSelectedNotebookId(nb.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors space-y-1.5 ${
                        selected
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/25 border-emerald-500'
                          : 'bg-slate-50 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <PrismPersonaGlyph personaId={nb.persona} />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {nb.title}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {persona.id} · {persona.roleTitle} · {nb.capabilityIds.join(', ')}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {nb.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Live Kernel Execution Contract
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Every code cell executes directly against <code className="font-mono">VerdantAqmBackend</code>,{' '}
                <code className="font-mono">VerdantAqmSamplerV2</code>, and{' '}
                <code className="font-mono">VerdantAqmEstimatorV2</code> with zero dense{' '}
                <code className="font-mono">2^n</code> qubit ceiling. Edit Qiskit Python or OpenQASM 2.0 cells and re-run in real time.
              </p>
              <div className="pt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Local CLI: jupyter lab notebooks/{activeNotebookSpec.fileName}
              </div>
            </div>
          </aside>

          {/* Main Stage: Jupyter Cells */}
          <section className="lg:col-span-8 space-y-4">
            {/* Notebook Toolbar */}
            <div className="p-3.5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate">
                notebooks/{activeNotebookSpec.fileName} · Kernel: Python 3 (qiskit-verdant-aqm)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunAllCells}
                  className="h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Run All Cells</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddCodeCell}
                  className="h-8 px-2.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-emerald-500 flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Cell</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetNotebook}
                  className="h-8 px-2.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-slate-500 flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadIpynb}
                  className="h-8 px-3 rounded-lg text-xs font-semibold border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .ipynb</span>
                </button>
              </div>
            </div>

            {/* Cell List */}
            <div className="space-y-4">
              {activeCells.map((cell) => {
                if (cell.cellType === 'markdown') {
                  return (
                    <div
                      key={cell.id}
                      className="p-4 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-1.5"
                    >
                      <div className="text-[11px] font-mono text-slate-400">
                        Markdown · {cell.title}
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                        {cell.source}
                      </pre>
                    </div>
                  );
                }

                codeCellCounter += 1;
                const execIndex = codeCellCounter;
                const out = outputsByCell[cell.id];

                return (
                  <div
                    key={cell.id}
                    className="rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 overflow-hidden"
                  >
                    {/* Cell Header */}
                    <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          In [{execIndex}]:
                        </span>{' '}
                        <span>{cell.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {out?.studioSpec && (
                          <button
                            type="button"
                            onClick={() => onLoadCircuitIntoStudio(out.studioSpec!)}
                            className="h-7 px-2.5 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500 whitespace-nowrap shrink-0"
                          >
                            Open in 3D Studio
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRunSingleCell(cell)}
                          className="h-7 px-2.5 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <Play className="w-3 h-3" />
                          <span>Run Cell</span>
                        </button>
                      </div>
                    </div>

                    {/* Editable Code Input */}
                    <div className="p-3 bg-slate-950">
                      <textarea
                        aria-label={`Notebook code cell ${execIndex}: ${cell.title}`}
                        value={cell.source}
                        onChange={(e) => handleUpdateCellSource(cell.id, e.target.value)}
                        rows={Math.max(4, Math.min(16, cell.source.split('\n').length + 1))}
                        spellCheck={false}
                        className="w-full bg-transparent text-slate-100 font-mono text-xs leading-relaxed focus:outline-none resize-y"
                      />
                    </div>

                    {/* Execution Output (`Out [n]:`) */}
                    {out && (
                      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1018] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                          <span
                            className={
                              out.ok
                                ? 'text-cyan-700 dark:text-cyan-400 font-semibold'
                                : 'text-rose-600 dark:text-rose-400 font-semibold'
                            }
                          >
                            Out [{execIndex}]: {out.ok ? 'COMPLETED' : 'ERROR'}
                          </span>
                          {out.metadata && (
                            <span className="text-slate-500 dark:text-slate-400">
                              {out.metadata.substrate} · {out.metadata.numQubits.toLocaleString()}q ·{' '}
                              {out.metadata.activeKets} active kets ·{' '}
                              {out.metadata.elapsedMs.toFixed(2)} ms
                            </span>
                          )}
                        </div>

                        {out.ok ? (
                          <>
                            <pre className="p-3 rounded-lg bg-slate-900 text-emerald-300 font-mono text-xs leading-relaxed overflow-x-auto border border-slate-800">
                              {out.stdoutLines.join('\n')}
                            </pre>

                            {/* Counts Histogram Bars */}
                            {out.counts && Object.keys(out.counts).length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  Measured Bitstring Distribution (Little-Endian Qiskit Convention)
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {Object.entries(out.counts)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 8)
                                    .map(([bitstr, cnt]) => {
                                      const totalShots = Object.values(out.counts!).reduce(
                                        (s, v) => s + v,
                                        0,
                                      );
                                      const pct = totalShots > 0 ? (cnt / totalShots) * 100 : 0;
                                      return (
                                        <div
                                          key={bitstr}
                                          className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 font-mono text-xs tabular-nums"
                                        >
                                          <div className="flex justify-between">
                                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                                              |{bitstr}⟩
                                            </span>
                                            <span className="text-slate-600 dark:text-slate-400">
                                              {cnt} ({pct.toFixed(1)}%)
                                            </span>
                                          </div>
                                          <div className="h-1.5 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                            <div
                                              className="h-full bg-emerald-500"
                                              style={{ width: `${Math.min(100, pct)}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            )}

                            {/* Expectations Table */}
                            {out.expectations && out.expectations.length > 0 && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-xs tabular-nums">
                                {out.expectations.map((expItem) => (
                                  <div
                                    key={expItem.label}
                                    className="p-2.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                                  >
                                    <span className="text-slate-600 dark:text-slate-400 truncate">
                                      {expItem.label}
                                    </span>
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                      {expItem.value.toFixed(8)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 font-mono text-xs">
                            ✖ {out.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: AUTHORITATIVE EXTERNAL QISKIT VALIDATION ORACLE */}
      {subTab === 'oracle' && (
        <div className="space-y-6">
          {/* Provenance Summary & Re-Run Trigger */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Authoritative External Qiskit Validation Oracle (upstream.toml)
                </h2>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  Qiskit/qiskit@{oracleReport.qiskitCommit.slice(0, 12)} · afflom/prism-devrel@
                  {oracleReport.prismDevrelCommit.slice(0, 12)} ·{' '}
                  {oracleReport.totalElapsedMs.toFixed(1)} ms total
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setOracleReport(runAuthoritativeQiskitOracleSuite(VENDORED_ORACLE_PAYLOADS))
                }
                className="h-9 px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                Re-Run All {oracleReport.totalCount} Qiskit Oracle Suites
              </button>
            </div>

            {/* SHA-256 Locked Upstream Authority Files */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pr-4">Vendored File</th>
                    <th className="py-2 pr-4">Upstream Authority & Path</th>
                    <th className="py-2 pr-4">Bytes</th>
                    <th className="py-2 pr-4">FIPS 180-4 SHA-256</th>
                    <th className="py-2">Integrity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70">
                  {oracleReport.provenanceFiles.map((f) => (
                    <tr key={f.fileName}>
                      <td className="py-2 pr-4 font-semibold text-slate-900 dark:text-slate-100">
                        {f.fileName}
                      </td>
                      <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                        {f.authority} · {f.upstreamPath}
                      </td>
                      <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                        {f.actualBytes.toLocaleString()} B
                      </td>
                      <td className="py-2 pr-4 text-slate-500">
                        {f.actualSha256.slice(0, 24)}…
                      </td>
                      <td className="py-2">
                        <span
                          className={
                            f.verified
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : 'text-rose-600 dark:text-rose-400 font-semibold'
                          }
                        >
                          {f.verified ? '● SHA-256 Verified' : '✖ Mismatch'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 16 Behavioral Qiskit Conformance Cases */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              BackendV2, BasicSimulator, SamplerV2 & EstimatorV2 Conformance Results ({oracleReport.passedCount}/{oracleReport.totalCount})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Oracle Case & Upstream Suite</th>
                    <th className="py-2 pr-3">Substrate</th>
                    <th className="py-2 pr-3">Diagnostic Summary</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70">
                  {oracleReport.cases.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {c.id} · {c.capabilityId}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {c.upstreamTestName}
                        </div>
                        <div className="text-[11px] text-slate-500">{c.upstreamSource}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-cyan-700 dark:text-cyan-400 whitespace-nowrap">
                        {c.substrateUsed}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-slate-600 dark:text-slate-300 max-w-md">
                        {c.detail}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span
                          className={
                            c.passed
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : 'text-rose-600 dark:text-rose-400 font-semibold'
                          }
                        >
                          {c.passed ? `● PASS (${c.elapsedMs.toFixed(1)}ms)` : '✖ FAIL'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 28-Instruction Target ISA Table */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                VerdantAqmTarget Global ISA ({QISKIT_TARGET_ISA.length} Operations · qargs = None · All-to-All)
              </h2>
              <span className="text-xs font-mono text-slate-500">
                Zero SWAP insertion during qiskit.transpile(qc, backend=VerdantAqmBackend())
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs font-mono">
              {QISKIT_TARGET_ISA.map((op) => (
                <div
                  key={op.name}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-0.5"
                >
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {op.name}{' '}
                    <span className="text-slate-500 font-normal">
                      ({op.numQubits === 'variadic' ? 'N' : `${op.numQubits}q`})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate" title={op.description}>
                    {op.isClifford
                      ? 'Clifford'
                      : op.isExactCyclotomic
                        ? 'Z[ζ₈] Exact'
                        : `Param (${op.numParams})`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: COMMERCIAL PYTHON SDK & PRISM-DEVREL DIATAXIS GUIDES */}
      {subTab === 'sdk-docs' && (
        <div className="space-y-6">
          {/* prism-devrel Publish Gate Scorecard */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  prism-devrel Content Standard (CS-01..CS-11) & Honesty Publish Gate
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Evaluates Honesty::evaluateDevRelPublishGate(uncovered, undeclared, unverifiedNotebooks, pin) live across all 5 Diataxis guides and 3 notebooks.
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                ● Verdict: {devrelAudit.gateVerdict.toUpperCase()} (AQ-21)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">Capability Coverage</div>
                <div className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                  {devrelAudit.coveredCapabilities.length} / 21 (uncovered={devrelAudit.uncoveredCapabilities.length})
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">CS-10 Banned Filler Words</div>
                <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                  {devrelAudit.fillerViolations.length} violations
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">CS-09 Vague Link Labels</div>
                <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                  {devrelAudit.vagueLinkViolations.length} violations
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">Upstream Oracle Pin</div>
                <div className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                  {devrelAudit.upstreamPinStatus} (7/7 SHA-256)
                </div>
              </div>
            </div>
          </div>

          {/* Two-Column Diataxis Reader + Commercial Python SDK Inspector */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Diataxis Guides with Faceted Persona Cards */}
            <div className="lg:col-span-6 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Diataxis Documentation Suite (/docs/*)
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadTextFile(
                      activeGuideMeta.path.split('/').pop() ?? 'guide.md',
                      activeGuideMarkdown,
                    )
                  }
                  className="h-7 px-2.5 rounded text-xs font-mono border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500 whitespace-nowrap shrink-0"
                >
                  Export .md
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DIATAXIS_GUIDE_META.map((g) => {
                  const persona = PRISM_DEVREL_PERSONAS[g.persona];
                  const active = g.id === activeGuideMeta.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGuideId(g.id)}
                      className={`p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition-colors ${
                        active
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/25 border-emerald-500'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                      }`}
                    >
                      <PrismPersonaGlyph personaId={g.persona} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {g.title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          {persona.id} · {g.kind}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed overflow-auto max-h-[520px] border border-slate-800 whitespace-pre-wrap">
                {activeGuideMarkdown}
              </pre>
            </div>

            {/* Right: Commercial Python Distribution (`python/qiskit-verdant-aqm/`) */}
            <div className="lg:col-span-6 p-5 rounded-xl bg-white dark:bg-[#0F1622] border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Commercial Python Distribution (python/qiskit-verdant-aqm)
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    pip install -e ./python/qiskit-verdant-aqm · Apache-2.0 · PEP 621
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadTextFile(activeSdkFile.downloadName, activeSdkFile.content)
                  }
                  className="h-7 px-2.5 rounded text-xs font-mono border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white whitespace-nowrap shrink-0"
                >
                  Download {activeSdkFile.downloadName}
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {PYTHON_SDK_FILES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedSdkKey(item.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                      selectedSdkKey === item.key
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-500'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed overflow-auto max-h-[520px] border border-slate-800">
                {activeSdkFile.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
