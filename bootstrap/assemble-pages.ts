#!/usr/bin/env node
/**
 * GitHub Pages Static Site Assembler (`bootstrap/assemble-pages.ts`)
 *
 * Mirrors `afflom/verdant-engine`'s `pages.yml` assembly step + `afflom/prism-devrel`:
 *  1. Embeds the verified `VerdantAqm.holo` v4 archive at `dist/app.holo` and `dist/VerdantAqm.holo`,
 *     plus `dist/holo-identities.json` with BLAKE3 `kappa` digests.
 *  2. Publishes the 3 verified Jupyter Notebooks (`dist/notebooks/*.ipynb`), the 5 Diataxis
 *     Markdown guides (`dist/docs/**`), and `dist/qiskit-verdant-aqm-manifest.json` (commercial
 *     Qiskit `BackendV2` + `upstream.toml` oracle provenance manifest).
 *  3. Reads `site/app.json`, adapts `repository` / `live` URLs dynamically when built in
 *     GitHub Actions (`GITHUB_REPOSITORY`, `PAGES_BASE_URL`), attaches signed SLSA build
 *     provenance (`FINGERPRINT`, `ATTESTATION_URL`), and writes `dist/app.json`.
 *  4. Generates `dist/manifest.webmanifest` (PWA Web App Manifest), `dist/llms.txt`
 *     (machine-readable Prism + Qiskit BackendV2 index), `dist/.nojekyll`, and `dist/404.html`.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAndWriteVerifiedHolo,
  computeInputKappa,
  DEFAULT_INPUTS,
  HoloIdentityRecord,
  verifyHoloArchiveComplete,
} from '../ci/kappa-cache';
import { CANONICAL_NOTEBOOK_SPECS, DIATAXIS_GUIDE_META } from '../src/aqm/devrelGuides';
import { CORE_WASM_ACCEPTANCE_VECTORS } from '../src/aqm/prismKernel';
import { QISKIT_TARGET_ISA } from '../src/aqm/qiskitBackend';
import {
  LOCKED_UPSTREAM_ORACLE_FILES,
  PRISM_DEVREL_UPSTREAM_COMMIT,
  QISKIT_UPSTREAM_COMMIT,
} from '../src/aqm/qiskitOracle';
import { generateAllJupyterNotebooks } from './generate-notebooks';

export interface AssembledPagesReport {
  readonly distDir: string;
  readonly holoBytes: number;
  readonly archiveFingerprint: string;
  readonly inputKappa: string;
  readonly liveUrl: string;
  readonly repositoryUrl: string;
}

export async function assemblePagesSite(
  distArg = 'dist',
  cwd = process.cwd(),
): Promise<AssembledPagesReport> {
  const distDir = resolve(cwd, distArg);
  mkdirSync(distDir, { recursive: true });

  // Ensure deterministic Jupyter notebooks are generated and pass `prism-devrel` publish gate
  generateAllJupyterNotebooks(join(cwd, 'notebooks'), cwd);

  const envHoloPath = process.env.HOLO ? resolve(cwd, process.env.HOLO) : null;
  let identities: HoloIdentityRecord;

  if (envHoloPath && existsSync(envHoloPath)) {
    const bytes = new Uint8Array(readFileSync(envHoloPath));
    const verified = await verifyHoloArchiveComplete(bytes);
    const { kappa: inputKappa } = computeInputKappa(DEFAULT_INPUTS, cwd);
    writeFileSync(join(distDir, 'app.holo'), bytes);
    writeFileSync(join(distDir, 'VerdantAqm.holo'), bytes);
    identities = {
      schema: 'prism/holo-identities/1',
      archive_fingerprint: verified.archiveFingerprint,
      input_kappa: inputKappa,
      wasm_kappa: verified.wasmKappa,
      requires_kappa: verified.requiresKappa,
      view_kappa: verified.viewKappa,
      archive_bytes: verified.byteLength,
      wasm_bytes: verified.wasmBytes.byteLength,
      wasm_exports: verified.exportedSymbols,
      vectors_verified: CORE_WASM_ACCEPTANCE_VECTORS.length,
    };
  } else {
    identities = await buildAndWriteVerifiedHolo(join(distDir, 'app.holo'), DEFAULT_INPUTS, cwd);
    copyFileSync(join(distDir, 'app.holo'), join(distDir, 'VerdantAqm.holo'));
  }

  writeFileSync(
    join(distDir, 'holo-identities.json'),
    `${JSON.stringify(identities, null, 2)}\n`,
  );

  // Copy verified Jupyter notebooks (`notebooks/*.ipynb`) and Diataxis guides (`docs/**`) into `dist/`
  const notebooksSrc = join(cwd, 'notebooks');
  if (existsSync(notebooksSrc)) {
    cpSync(notebooksSrc, join(distDir, 'notebooks'), { recursive: true, force: true });
  }
  const docsSrc = join(cwd, 'docs');
  if (existsSync(docsSrc)) {
    cpSync(docsSrc, join(distDir, 'docs'), { recursive: true, force: true });
  }

  // Load authoritative site/app.json and adapt repository/live/attestations for current repo
  const rawAppJson = JSON.parse(readFileSync(join(cwd, 'site/app.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  const ghRepo = process.env.GITHUB_REPOSITORY;
  const repoUrl = ghRepo
    ? `https://github.com/${ghRepo}`
    : String(rawAppJson.repository ?? 'https://github.com/afflom/verdant-aqm');

  const defaultLive = ghRepo
    ? `https://${ghRepo.split('/')[0].toLowerCase()}.github.io/${ghRepo.split('/')[1]}/`
    : String(rawAppJson.live ?? 'https://afflom.github.io/verdant-aqm/');
  const liveUrl = process.env.PAGES_BASE_URL || defaultLive;

  const fingerprint = process.env.FINGERPRINT || identities.archive_fingerprint;
  const attestationUrl =
    process.env.ATTESTATION_URL || `${repoUrl}/actions/workflows/pages.yml`;

  const attestations = (rawAppJson.attestations ?? {}) as Record<string, unknown>;
  const enrichedAppJson = {
    ...rawAppJson,
    live: liveUrl,
    repository: repoUrl,
    report: `${repoUrl}/blob/main/CONFORMANCE.md`,
    holo: {
      path: './app.holo',
      archiveFingerprint: identities.archive_fingerprint,
      inputKappa: identities.input_kappa,
      wasmKappa: identities.wasm_kappa,
      wasmExports: identities.wasm_exports,
      vectorsVerified: identities.vectors_verified,
    },
    qiskitBackend: {
      packageName: 'qiskit-verdant-aqm',
      version: '0.3.0',
      backendName: 'verdant_aqm_prism',
      numQubits: null,
      couplingMap: null,
      targetOperationsCount: QISKIT_TARGET_ISA.length,
      notebooks: CANONICAL_NOTEBOOK_SPECS.map((n) => `./notebooks/${n.fileName}`),
      docs: DIATAXIS_GUIDE_META.map((d) => `./${d.path}`),
    },
    attestations: {
      ...attestations,
      build: {
        id: fingerprint,
        url: attestationUrl,
      },
    },
  };

  writeFileSync(join(distDir, 'app.json'), `${JSON.stringify(enrichedAppJson, null, 2)}\n`);

  // Write machine-readable commercial Qiskit BackendV2 & Oracle provenance manifest
  const qiskitManifest = {
    schema: 'verdant-aqm/qiskit-backend-manifest/1',
    package: {
      name: 'qiskit-verdant-aqm',
      version: '0.3.0',
      license: 'Apache-2.0',
      entryPoint: 'qiskit_verdant_aqm:VerdantAqmBackend',
      provider: 'qiskit_verdant_aqm:VerdantAqmProvider',
      primitives: [
        'qiskit_verdant_aqm:VerdantAqmSamplerV2',
        'qiskit_verdant_aqm:VerdantAqmEstimatorV2',
      ],
    },
    target: {
      numQubits: null,
      couplingMap: null,
      operations: QISKIT_TARGET_ISA.map((op) => ({
        name: op.name,
        numQubits: op.numQubits,
        numParams: op.numParams,
        isClifford: op.isClifford,
        isExactCyclotomic: op.isExactCyclotomic,
      })),
    },
    upstreamOracle: {
      qiskitCommit: QISKIT_UPSTREAM_COMMIT,
      prismDevrelCommit: PRISM_DEVREL_UPSTREAM_COMMIT,
      lockedFiles: LOCKED_UPSTREAM_ORACLE_FILES,
    },
    notebooks: CANONICAL_NOTEBOOK_SPECS.map((nb) => ({
      fileName: nb.fileName,
      url: `${liveUrl}notebooks/${nb.fileName}`,
      persona: nb.persona,
      capabilities: nb.capabilityIds,
    })),
    guides: DIATAXIS_GUIDE_META.map((g) => ({
      title: g.title,
      path: g.path,
      url: `${liveUrl}${g.path}`,
      kind: g.kind,
      persona: g.persona,
    })),
  };
  writeFileSync(
    join(distDir, 'qiskit-verdant-aqm-manifest.json'),
    `${JSON.stringify(qiskitManifest, null, 2)}\n`,
  );

  // Write W3C Web App Manifest (`dist/manifest.webmanifest`)
  const webManifest = {
    name: String(rawAppJson.name ?? 'Verdant AQM'),
    short_name: String(rawAppJson.shortName ?? 'VerdantAQM'),
    description: String(rawAppJson.purpose ?? ''),
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#080C12',
    theme_color: '#080C12',
    icons: [
      {
        src: './favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  };
  writeFileSync(
    join(distDir, 'manifest.webmanifest'),
    `${JSON.stringify(webManifest, null, 2)}\n`,
  );

  // Write `dist/llms.txt` (machine-readable Prism + Qiskit BackendV2 specification summary)
  const totalVecs = CORE_WASM_ACCEPTANCE_VECTORS.length;
  const llmsTxt = [
    `# ${String(rawAppJson.name ?? 'Verdant AQM')}`,
    '',
    `> ${String(rawAppJson.purpose ?? '')}`,
    '',
    `- Live GitHub Pages App: ${liveUrl}`,
    `- Repository: ${repoUrl}`,
    `- Conformance Matrix: ${repoUrl}/blob/main/CONFORMANCE.md`,
    `- Portable Hologram v4 Guest: ${liveUrl}app.holo (blake3:${identities.archive_fingerprint})`,
    `- Commercial Qiskit Package: python/qiskit-verdant-aqm (qiskit-verdant-aqm@0.3.0, BackendV2 + SamplerV2 + EstimatorV2)`,
    `- Qiskit Manifest: ${liveUrl}qiskit-verdant-aqm-manifest.json`,
    `- Wasm Zero-Import Exports (6): ${identities.wasm_exports.join(', ')}`,
    `- Pinned Core-Wasm Acceptance Vectors: ${identities.vectors_verified}/${totalVecs}`,
    '',
    '## Published Jupyter Notebooks (nbformat v4.5)',
    ...CANONICAL_NOTEBOOK_SPECS.map(
      (nb) => `- ${liveUrl}notebooks/${nb.fileName} — ${nb.title} (${nb.persona})`,
    ),
    '',
    '## Diataxis Documentation (prism-devrel CS-01..CS-11)',
    ...DIATAXIS_GUIDE_META.map((g) => `- ${liveUrl}${g.path} — ${g.title} (${g.persona})`),
    '',
    '## 8 Prism Specification Facets (AQ-01..AQ-23)',
    '- app/src/Quantum.lex.tex — Wire linearity, Z[zeta_8] norm conservation, Z_8 gate-fusion monoid, F_2 bit-sliced stabilizer collapse (inv016), MTC & SkWeaver laws, Qiskit unbounded Target, pure UORC wire (VE-36), zero ratchet ceilings (FI-08)',
    '- app/src/Architecture.lex.tex — 8 constructive strata, BoundedBuffer, uor-matmul zero-decode tiers, ExactMps, Qiskit BackendV2 & Primitives V2 router',
    '- app/src/Design.lex.tex — Zero-pill discipline, Jupyter Notebook lab, prism-devrel Diataxis personas (model/content.json), 16x16 software tile rasterizer',
    '- app/src/Features.lex.tex — Capability registry AQ-01 through AQ-23',
    '- app/src/Security.lex.tex — Zero-import wasm32 sandbox, 32B SHA-256 UORC wire seal (#uorc=), upstream.toml SHA-256 oracle locks',
    `- app/src/Quality.lex.tex — ${totalVecs} pinned acceptance vectors, 13 R5 planted-defect refusal gates, 16 TS + 20 Python upstream Qiskit oracle suites`,
    '- app/src/Compliance.lex.tex — Deterministic execution without hardware QPUs or cloud secrets; PEP 621 Apache-2.0 distribution; prism/parametric-ratchet/1',
    '- app/src/Honesty.lex.tex — Strict three-tier ledger separation (some-true, build, open) and evaluateDevRelPublishGate',
    '',
  ].join('\n');
  writeFileSync(join(distDir, 'llms.txt'), llmsTxt);

  // Ensure `.nojekyll` and `404.html` exist for GitHub Pages static serving
  writeFileSync(join(distDir, '.nojekyll'), '');
  const indexHtmlPath = join(distDir, 'index.html');
  if (existsSync(indexHtmlPath)) {
    copyFileSync(indexHtmlPath, join(distDir, '404.html'));
  }

  console.log(
    `assemble-pages: ${distDir} -> app.holo (${identities.archive_bytes} B, blake3:${identities.archive_fingerprint.slice(0, 16)}…), qiskit-verdant-aqm-manifest.json, 3 notebooks, 5 Diataxis docs, app.json, llms.txt`,
  );

  return {
    distDir,
    holoBytes: identities.archive_bytes,
    archiveFingerprint: identities.archive_fingerprint,
    inputKappa: identities.input_kappa,
    liveUrl,
    repositoryUrl: repoUrl,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  assemblePagesSite(process.argv[2] ?? 'dist').catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
