/**
 * `prism-devrel` Diataxis Guide Engine, Content Standard (`CS-01..CS-11`) Verifier,
 * and Deterministic Jupyter Notebook (`nbformat` v4.5) Builder (`src/aqm/devrelGuides.ts`).
 *
 * Modeled directly after `https://github.com/afflom/prism-devrel` (`ace153e37c7c29646f3efa6e273c3c4f8c9fb8bc`):
 *  - `model/content.json` stakeholder personas (`Kai`, `Iris`, `Otto`, `Vera`, `Wren`)
 *  - `scripts/content/standard.json` (`CS-01..CS-11` filler-free prose, no vague link text, explicit coverage)
 *  - `examples/devrel-publish-gate.prompt.json` (`Honesty::evaluateDevRelPublishGate`)
 */

import { evaluateDevRelPublishGatePrism } from './prismKernel';
import {
  NotebookCellExecutionOutput,
  executeQiskitNotebookCell,
} from './qiskitBackend';
import {
  PRISM_DEVREL_UPSTREAM_COMMIT,
  QISKIT_UPSTREAM_COMMIT,
  verifyVendoredOracleProvenance,
} from './qiskitOracle';
import { CapabilityId, DevRelGateAction } from './types';

export type DevRelPersonaId = 'Kai' | 'Iris' | 'Otto' | 'Vera' | 'Wren';
export type DiataxisKind = 'hub' | 'tutorial' | 'how-to' | 'reference' | 'explanation';

export interface DevRelPersonaSpec {
  readonly id: DevRelPersonaId;
  readonly roleTitle: string;
  readonly diataxisKind: DiataxisKind;
  readonly propName: string;
  readonly accentHex: string;
  readonly summary: string;
}

/** Exact banned filler words from `afflom/prism-devrel/scripts/content/standard.json` (`CS-10`) */
export const PRISM_DEVREL_BANNED_FILLER: readonly string[] = [
  'simply',
  'just',
  'easy',
  'easily',
  'obviously',
  'seamlessly',
  'basically',
  'of course',
];

/** Exact banned vague link labels from `afflom/prism-devrel/scripts/content/standard.json` (`CS-09`) */
export const PRISM_DEVREL_VAGUE_LINKS: readonly string[] = [
  'here',
  'click here',
  'read more',
  'more',
  'this',
  'link',
  'this page',
];

export const PRISM_DEVREL_PERSONAS: Readonly<Record<DevRelPersonaId, DevRelPersonaSpec>> = {
  Wren: {
    id: 'Wren',
    roleTitle: 'Catalog & DevRel Author',
    diataxisKind: 'hub',
    propName: 'quill',
    accentHex: '#10b981',
    summary: 'Maintains zero-gap capability coverage across AQ-01..AQ-21 and enforces publish gates.',
  },
  Kai: {
    id: 'Kai',
    roleTitle: 'Quantum Newcomer',
    diataxisKind: 'tutorial',
    propName: 'terminal',
    accentHex: '#06b6d4',
    summary: 'Follows reproducible step-by-step tutorials from installation to verified circuit counts.',
  },
  Iris: {
    id: 'Iris',
    roleTitle: 'Algorithm Modeler',
    diataxisKind: 'how-to',
    propName: 'compass',
    accentHex: '#8b5cf6',
    summary: 'Migrates Qiskit workflows and scales 4,096-qubit sparse cyclotomic and stabilizer circuits.',
  },
  Otto: {
    id: 'Otto',
    roleTitle: 'SDK & Transpiler Integrator',
    diataxisKind: 'reference',
    propName: 'wrench',
    accentHex: '#f59e0b',
    summary: 'Looks up exact Target ISA arities, BackendV2 option validators, and SHA-256 provenance pins.',
  },
  Vera: {
    id: 'Vera',
    roleTitle: 'Verification & Security Auditor',
    diataxisKind: 'explanation',
    propName: 'magnifier',
    accentHex: '#ec4899',
    summary: 'Audits algebraic exactness proofs, external oracle hashes, and Honesty.lex.tex claim boundaries.',
  },
};

export interface DiataxisGuideMeta {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: DiataxisKind;
  readonly persona: DevRelPersonaId;
  readonly defaultSummary: string;
}

export const DIATAXIS_GUIDE_META: readonly DiataxisGuideMeta[] = [
  {
    id: 'hub',
    title: 'Documentation Hub & Capability Ledger',
    path: 'docs/index.md',
    kind: 'hub',
    persona: 'Wren',
    defaultSummary:
      'Complete Diataxis map and AQ-01..AQ-21 capability coverage index for verdant-aqm and qiskit-verdant-aqm.',
  },
  {
    id: 'tutorial-quickstart',
    title: 'Tutorial: First Unbounded Qiskit Circuit',
    path: 'docs/tutorials/01-quickstart-qiskit-backend.md',
    kind: 'tutorial',
    persona: 'Kai',
    defaultSummary:
      'Step-by-step walkthrough constructing a 3-qubit GHZ+T circuit on VerdantAqmBackend and evaluating EstimatorV2.',
  },
  {
    id: 'howto-megascale',
    title: 'How-To: 4,096q Megascale & Aer Migration',
    path: 'docs/how-to/unbounded-megascale-and-aer-migration.md',
    kind: 'how-to',
    persona: 'Iris',
    defaultSummary:
      'Migrate BasicSimulator/AerSimulator code and execute 4,096-qubit cat states and 2,048-qubit stabilizer rings.',
  },
  {
    id: 'reference-api',
    title: 'Reference: BackendV2, Target ISA & Primitives',
    path: 'docs/reference/qiskit-backend-v2-and-primitives-api.md',
    kind: 'reference',
    persona: 'Otto',
    defaultSummary:
      '28-instruction Target table, BackendV2 option validators, little-endian bitstring rules, and upstream.toml hashes.',
  },
  {
    id: 'explanation-prism',
    title: 'Explanation: Substrates & Honesty Gates',
    path: 'docs/explanation/prism-substrates-and-honesty-gates.md',
    kind: 'explanation',
    persona: 'Vera',
    defaultSummary:
      'Architectural explanation of algebraic substrates, external Qiskit oracle locks, and Honesty.lex.tex boundaries.',
  },
];

export const ALL_CAPABILITY_IDS: readonly CapabilityId[] = [
  'AQ-01', 'AQ-02', 'AQ-03', 'AQ-04', 'AQ-05', 'AQ-06', 'AQ-07',
  'AQ-08', 'AQ-09', 'AQ-10', 'AQ-11', 'AQ-12', 'AQ-13', 'AQ-14',
  'AQ-15', 'AQ-16', 'AQ-17', 'AQ-18', 'AQ-19', 'AQ-20', 'AQ-21',
];

export interface NotebookCellSpec {
  readonly id: string;
  readonly cellType: 'markdown' | 'code';
  readonly title: string;
  readonly source: string;
}

export interface CanonicalNotebookSpec {
  readonly id: string;
  readonly fileName: string;
  readonly title: string;
  readonly persona: DevRelPersonaId;
  readonly capabilityIds: readonly CapabilityId[];
  readonly summary: string;
  readonly cells: readonly NotebookCellSpec[];
}

export const CANONICAL_NOTEBOOK_SPECS: readonly CanonicalNotebookSpec[] = [
  {
    id: 'nb-01-quickstart',
    fileName: '01_quickstart_verdant_qiskit_backend.ipynb',
    title: '01 · Unbounded Qiskit BackendV2 Quickstart & Gate Fusion',
    persona: 'Kai',
    capabilityIds: ['AQ-02', 'AQ-03', 'AQ-17', 'AQ-19'],
    summary:
      'Constructs Bell and 3-qubit GHZ+T circuits on VerdantAqmBackend, demonstrates Z_8 T^9 -> T gate fusion, and verifies multi-register little-endian counts.',
    cells: [
      {
        id: 'nb01-md1',
        cellType: 'markdown',
        title: 'Overview',
        source: [
          '# 01 · Unbounded Qiskit `BackendV2` Quickstart (`qiskit-verdant-aqm`)',
          '',
          'This notebook executes standard `QuantumCircuit` workloads through `VerdantAqmBackend` (`AQ-19`) with exact $\\mathbb{Z}[\\zeta_8]/\\sqrt{2}^k$ cyclotomic amplitudes (`AQ-03`) and $\\mathbb{Z}_8$ phase-monoid gate fusion (`AQ-17`).',
        ].join('\n'),
      },
      {
        id: 'nb01-code1',
        cellType: 'code',
        title: '3-Qubit GHZ + T^9 Octant Fusion',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit_verdant_aqm import VerdantAqmBackend',
          '',
          'qc = QuantumCircuit(3, 3, name="ghz_octant_fusion")',
          'qc.h(0)',
          'qc.cx(0, 1)',
          'qc.cx(1, 2)',
          'for k in range(9):',
          '    qc.t(2)',
          'qc.measure([0, 1, 2], [0, 1, 2])',
          '',
          'backend = VerdantAqmBackend(shots=1024, seed_simulator=42)',
          'result = backend.run(qc).result()',
          'counts = result.get_counts()',
        ].join('\n'),
      },
      {
        id: 'nb01-code2',
        cellType: 'code',
        title: 'Multi-Register OpenQASM 2.0 Bit-Ordering Parity',
        source: [
          'OPENQASM 2.0;',
          'include "qelib1.inc";',
          'qreg q0[3];',
          'qreg q1[3];',
          'creg c0[3];',
          'creg c1[3];',
          'h q0[0];',
          'cx q0[0], q0[1];',
          'cx q0[1], q0[2];',
          'x q1[2];',
          'measure q0 -> c0;',
          'measure q1 -> c1;',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'nb-02-megascale',
    fileName: '02_megascale_4096q_cat_stabilizer_and_toffoli.ipynb',
    title: '02 · Zero-Limit 4,096q Cat+T, 2,048q Stabilizer & Toffoli',
    persona: 'Iris',
    capabilityIds: ['AQ-03', 'AQ-04', 'AQ-14', 'AQ-19'],
    summary:
      'Runs a 4,096-qubit Clifford+T cat circuit in Sparse Z[zeta_8], a 2,048-qubit Clifford ring in StabilizerTableau, and exact 3-qubit CCX/CSWAP logic.',
    cells: [
      {
        id: 'nb02-md1',
        cellType: 'markdown',
        title: 'Bypassing Classical 2^n Qubit Ceilings',
        source: [
          '# 02 · Megascale 4,096-Qubit Cat+$T$ & 2,048-Qubit Stabilizer Execution',
          '',
          '`VerdantAqmBackend` sets `num_qubits = None` and routes structured circuits to `StabilizerTableau` (`AQ-04`) or `BigInt`-indexed `CyclotomicExact` (`AQ-03`) without dense $2^n$ state-vector allocation.',
        ].join('\n'),
      },
      {
        id: 'nb02-code1',
        cellType: 'code',
        title: '4,096-Qubit Clifford+T Cat State (2 Active Sparse Kets)',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit_verdant_aqm import VerdantAqmBackend',
          '',
          'n = 4096',
          'cat = QuantumCircuit(n, 2, name="cat_4096q_octant")',
          'cat.h(0)',
          'for q in range(n - 1):',
          '    cat.cx(q, q + 1)',
          'cat.t(0)',
          'cat.t(4095)',
          'cat.measure([0, 4095], [0, 1])',
          '',
          'backend = VerdantAqmBackend(shots=1024, seed_simulator=2026)',
          'result = backend.run(cat).result()',
        ].join('\n'),
      },
      {
        id: 'nb02-code2',
        cellType: 'code',
        title: '2,048-Qubit Clifford Stabilizer Ring (Packed 32-bit Bit-Planes)',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit_verdant_aqm import VerdantAqmBackend',
          '',
          'n = 2048',
          'stab = QuantumCircuit(n, 2, name="stabilizer_2048q")',
          'stab.h(0)',
          'for q in range(n - 1):',
          '    stab.cx(q, q + 1)',
          'stab.s(0)',
          'stab.sdg(0)',
          'stab.measure([0, 2047], [0, 1])',
          '',
          'backend = VerdantAqmBackend(shots=512, seed_simulator=77)',
          'result = backend.run(stab).result()',
        ].join('\n'),
      },
      {
        id: 'nb02-code3',
        cellType: 'code',
        title: 'Exact 3-Qubit Toffoli (CCX) & Fredkin (CSWAP) Reversible Synthesis',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit_verdant_aqm import VerdantAqmBackend',
          '',
          'rev = QuantumCircuit(4, 4, name="toffoli_fredkin_exact")',
          'rev.h(0)',
          'rev.x(1)',
          'rev.ccx(0, 1, 2)',
          'rev.cswap(2, 1, 3)',
          'rev.measure([0, 1, 2, 3], [0, 1, 2, 3])',
          '',
          'backend = VerdantAqmBackend(shots=1024, seed_simulator=99)',
          'result = backend.run(rev).result()',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'nb-03-primitives-v2',
    fileName: '03_primitives_v2_vqe_pauli_estimator_and_oracle.ipynb',
    title: '03 · Primitives V2: Exact VQE SparsePauliOp Estimator & Sampler',
    persona: 'Vera',
    capabilityIds: ['AQ-16', 'AQ-20', 'AQ-21'],
    summary:
      'Evaluates analytical precision=0.0 Heisenberg & VQE SparsePauliOp expectations via VerdantAqmEstimatorV2 and shot-sampled BitArrays via VerdantAqmSamplerV2.',
    cells: [
      {
        id: 'nb03-md1',
        cellType: 'markdown',
        title: 'Exact Analytical Primitives V2',
        source: [
          '# 03 · Qiskit Primitives V2 (`VerdantAqmEstimatorV2` & `VerdantAqmSamplerV2`)',
          '',
          'Computes analytical `<psi | H | psi>` expectation values at `precision=0.0` (`AQ-20`) across continuous `ry`, `rz`, and `rzz` variational ansatze without finite-shot variance.',
        ].join('\n'),
      },
      {
        id: 'nb03-code1',
        cellType: 'code',
        title: 'Singlet Heisenberg Hamiltonian <XX + YY + ZZ> = -3.000000000000',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit.quantum_info import SparsePauliOp',
          'from qiskit_verdant_aqm import VerdantAqmEstimatorV2',
          '',
          'singlet = QuantumCircuit(2, name="heisenberg_singlet")',
          'singlet.x(0)',
          'singlet.x(1)',
          'singlet.h(0)',
          'singlet.cx(0, 1)',
          '',
          'hamiltonian = SparsePauliOp.from_list([("XX", 1.0), ("YY", 1.0), ("ZZ", 1.0)])',
          'estimator = VerdantAqmEstimatorV2(precision=0.0)',
          'job = estimator.run([(singlet, hamiltonian)])',
        ].join('\n'),
      },
      {
        id: 'nb03-code2',
        cellType: 'code',
        title: 'Continuous Parameterized VQE Ansatz (ry + cx + rzz)',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit.circuit import Parameter',
          'from qiskit.quantum_info import SparsePauliOp',
          'from qiskit_verdant_aqm import VerdantAqmEstimatorV2',
          '',
          'theta = Parameter("theta")',
          'phi = Parameter("phi")',
          'ansatz = QuantumCircuit(2, name="vqe_ising_ansatz")',
          'ansatz.ry(theta, 0)',
          'ansatz.cx(0, 1)',
          'ansatz.rzz(phi, 0, 1)',
          '',
          'obs = SparsePauliOp.from_list([("ZI", 1.0), ("ZZ", 0.5), ("XX", -0.5)])',
          'estimator = VerdantAqmEstimatorV2(precision=0.0)',
          'job = estimator.run([(ansatz, obs, [-1.1427, 0.7319])])',
        ].join('\n'),
      },
      {
        id: 'nb03-code3',
        cellType: 'code',
        title: 'SamplerV2 BitArray Execution on Continuous Euler Gate U(pi/2, 0, pi)',
        source: [
          'from qiskit import QuantumCircuit',
          'from qiskit_verdant_aqm import VerdantAqmSamplerV2',
          '',
          'qc = QuantumCircuit(2, 2, name="sampler_v2_euler")',
          'qc.u(pi / 2, 0, pi, 0)',
          'qc.cx(0, 1)',
          'qc.measure_all()',
          '',
          'sampler = VerdantAqmSamplerV2(shots=1024, seed=101)',
          'pub_res = sampler.run([qc]).result()[0]',
        ].join('\n'),
      },
    ],
  },
];

export interface JupyterNbformatDocument {
  readonly nbformat: 4;
  readonly nbformat_minor: 5;
  readonly metadata: {
    readonly kernelspec: {
      readonly display_name: string;
      readonly language: 'python';
      readonly name: string;
    };
    readonly language_info: {
      readonly name: 'python';
      readonly version: string;
    };
    readonly verdant_aqm: {
      readonly persona: DevRelPersonaId;
      readonly capabilities: readonly CapabilityId[];
      readonly prism_devrel_commit: string;
      readonly qiskit_oracle_commit: string;
    };
  };
  readonly cells: ReadonlyArray<Record<string, unknown>>;
}

/** Builds a deterministic valid Jupyter `nbformat` v4.5 `.ipynb` JSON object with pre-executed outputs */
export function buildJupyterNotebookJson(spec: CanonicalNotebookSpec): {
  notebook: JupyterNbformatDocument;
  allCellsSucceeded: boolean;
  cellOutputs: Readonly<Record<string, NotebookCellExecutionOutput>>;
} {
  let execCounter = 1;
  let allCellsSucceeded = true;
  const cellOutputs: Record<string, NotebookCellExecutionOutput> = {};

  const builtCells = spec.cells.map((cell) => {
    const sourceLines = cell.source.split('\n').map((line, idx, arr) =>
      idx < arr.length - 1 ? `${line}\n` : line,
    );

    if (cell.cellType === 'markdown') {
      return {
        id: cell.id,
        cell_type: 'markdown',
        metadata: { title: cell.title },
        source: sourceLines,
      };
    }

    const out = executeQiskitNotebookCell(cell.source);
    cellOutputs[cell.id] = out;
    if (!out.ok) allCellsSucceeded = false;

    const count = execCounter++;
    const streamText = out.stdoutLines.map((l) => `${l}\n`);
    const richPayload: Record<string, unknown> = {
      'text/plain': out.stdoutLines.join('\n'),
      'application/vnd.verdant.aqm+json': {
        counts: out.counts ?? null,
        probabilities: out.probabilities ?? null,
        expectations: out.expectations ?? null,
        metadata: out.metadata ?? null,
      },
    };

    return {
      id: cell.id,
      cell_type: 'code',
      execution_count: count,
      metadata: { title: cell.title },
      source: sourceLines,
      outputs: out.ok
        ? [
            {
              output_type: 'stream',
              name: 'stdout',
              text: streamText,
            },
            {
              output_type: 'execute_result',
              execution_count: count,
              data: richPayload,
              metadata: {},
            },
          ]
        : [
            {
              output_type: 'error',
              ename: 'VerdantAqmError',
              evalue: out.error ?? 'Cell execution failed',
              traceback: [out.error ?? 'Cell execution failed'],
            },
          ],
    };
  });

  return {
    notebook: {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          display_name: 'Python 3 (qiskit-verdant-aqm)',
          language: 'python',
          name: 'python3',
        },
        language_info: {
          name: 'python',
          version: '3.10',
        },
        verdant_aqm: {
          persona: spec.persona,
          capabilities: spec.capabilityIds,
          prism_devrel_commit: PRISM_DEVREL_UPSTREAM_COMMIT,
          qiskit_oracle_commit: QISKIT_UPSTREAM_COMMIT,
        },
      },
      cells: builtCells,
    },
    allCellsSucceeded,
    cellOutputs,
  };
}

export interface DevRelContentAuditReport {
  readonly fillerViolations: ReadonlyArray<{ source: string; word: string }>;
  readonly vagueLinkViolations: ReadonlyArray<{ source: string; label: string }>;
  readonly coveredCapabilities: readonly CapabilityId[];
  readonly uncoveredCapabilities: readonly CapabilityId[];
  readonly unverifiedNotebooks: number;
  readonly undeclaredClaims: number;
  readonly upstreamPinStatus: 'current' | 'stale';
  readonly gateVerdict: DevRelGateAction;
  readonly gateOk: boolean;
}

/**
 * Audits Diataxis Markdown guides and Jupyter notebooks against `afflom/prism-devrel`'s
 * `standard.json` (`CS-01..CS-11`) and `devrel-publish-gate.prompt.json`.
 */
export function runDevRelContentAndPublishGateAudit(
  guideMarkdownByPath: Readonly<Record<string, string>>,
  oracleRawPayloads?: Readonly<Record<string, string | Uint8Array>>,
): DevRelContentAuditReport {
  const fillerViolations: Array<{ source: string; word: string }> = [];
  const vagueLinkViolations: Array<{ source: string; label: string }> = [];

  const stripFencedCode = (md: string): string =>
    md.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');

  const checkMarkdownProse = (sourceId: string, md: string) => {
    const proseOnly = stripFencedCode(md);
    for (const word of PRISM_DEVREL_BANNED_FILLER) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(proseOnly)) {
        fillerViolations.push({ source: sourceId, word });
      }
    }
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(proseOnly)) !== null) {
      const lbl = m[1].trim().toLowerCase();
      if (PRISM_DEVREL_VAGUE_LINKS.includes(lbl)) {
        vagueLinkViolations.push({ source: sourceId, label: m[1] });
      }
    }
  };

  const combinedCorpusParts: string[] = [];
  for (const meta of DIATAXIS_GUIDE_META) {
    const md = guideMarkdownByPath[meta.path] ?? '';
    checkMarkdownProse(meta.path, md);
    combinedCorpusParts.push(md);
  }

  let unverifiedNotebooks = 0;
  for (const nbSpec of CANONICAL_NOTEBOOK_SPECS) {
    for (const cell of nbSpec.cells) {
      if (cell.cellType === 'markdown') {
        checkMarkdownProse(`${nbSpec.fileName}#${cell.id}`, cell.source);
        combinedCorpusParts.push(cell.source);
      }
    }
    const built = buildJupyterNotebookJson(nbSpec);
    if (!built.allCellsSucceeded) {
      unverifiedNotebooks += 1;
    }
  }

  const fullText = combinedCorpusParts.join('\n');
  const coveredCapabilities = ALL_CAPABILITY_IDS.filter((cap) => fullText.includes(cap));
  const uncoveredCapabilities = ALL_CAPABILITY_IDS.filter((cap) => !fullText.includes(cap));

  const provenance = verifyVendoredOracleProvenance(oracleRawPayloads);
  const upstreamPinStatus: 'current' | 'stale' = provenance.every((p) => p.verified)
    ? 'current'
    : 'stale';

  const undeclaredClaims = fillerViolations.length + vagueLinkViolations.length;
  const gateEval = evaluateDevRelPublishGatePrism({
    uncoveredRecords: uncoveredCapabilities.length,
    undeclaredCovers: undeclaredClaims,
    unverifiedNotebooks,
    pinIsCurrent: upstreamPinStatus === 'current',
  });

  return {
    fillerViolations,
    vagueLinkViolations,
    coveredCapabilities,
    uncoveredCapabilities,
    unverifiedNotebooks,
    undeclaredClaims,
    upstreamPinStatus,
    gateVerdict: gateEval.outcome,
    gateOk: gateEval.ok && gateEval.outcome === 'publish',
  };
}
