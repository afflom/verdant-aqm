#!/usr/bin/env node
/**
 * Pre-Deploy GitHub Pages Integrity, Wasm Replay & FR-03 Wire-Weight Gate (`bootstrap/weight-gate.ts`)
 *
 * Modeled after `afflom/verdant-engine/bootstrap/weight.mjs`:
 *  1. Verifies all required GitHub Pages artifacts exist in `dist/`:
 *     `index.html`, `404.html`, `.nojekyll`, `sw.js`, `manifest.webmanifest`, `app.json`, `app.holo`, `precache.json`, `llms.txt`.
 *  2. Verifies `dist/index.html` uses subpath-safe relative `./assets/...` references so project
 *     sites (`https://<owner>.github.io/<repo>/`) load without 404s.
 *  3. Re-verifies `dist/app.holo` (`VerdantAqm.holo` v4) from disk: 32-byte BLAKE3 footer,
 *     zero-import `wasm32` sandbox, 6 exports, and all 36 `holo_run` acceptance vectors.
 *  4. Verifies every file listed in `dist/precache.json` matches its recorded SHA-256 digest.
 *  5. Computes gzipped wire-transfer sizes (matching GitHub Pages gzip encoding) and enforces
 *     explicit `holo` and `app` wire budgets before `actions/upload-pages-artifact` runs.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { verifyHoloArchiveComplete } from '../ci/kappa-cache';
import { CORE_WASM_ACCEPTANCE_VECTORS } from '../src/aqm/prismKernel';
import { verifyParametricRatchetPlantedDefects } from '../src/aqm/ratchet';
import { PrecacheManifest } from './precache';
import { auditParametricRatchetOnDisk, loadDiskRatchetWorkspace } from './ratchet-gate';

export const PAGES_WIRE_BUDGET = {
  holoGzipMaxBytes: 16 * 1024, // VerdantAqm.holo v4 guest (< 5 KiB raw, < 3 KiB gzip)
  shellHtmlGzipMaxBytes: 16 * 1024,
  totalGzipMaxBytes: 600 * 1024, // Full React + Three.js + Unbounded Qiskit BackendV2 + Notebooks + Docs + Wasm studio gzipped
} as const;

export interface PagesWeightGateReport {
  readonly valid: boolean;
  readonly precacheVersion: string;
  readonly verifiedFiles: number;
  readonly holoRawBytes: number;
  readonly holoGzipBytes: number;
  readonly totalRawBytes: number;
  readonly totalGzipBytes: number;
  readonly vectorsPassed: number;
  readonly ratchetVerified: boolean;
}

const REQUIRED_ARTIFACTS = [
  'index.html',
  '404.html',
  '.nojekyll',
  'sw.js',
  'favicon.svg',
  'manifest.webmanifest',
  'app.json',
  'app.holo',
  'VerdantAqm.holo',
  'qiskit-verdant-aqm-manifest.json',
  'notebooks/01_quickstart_verdant_qiskit_backend.ipynb',
  'notebooks/02_megascale_4096q_cat_stabilizer_and_toffoli.ipynb',
  'notebooks/03_primitives_v2_vqe_pauli_estimator_and_oracle.ipynb',
  'docs/index.md',
  'precache.json',
  'llms.txt',
] as const;

export async function verifyAssembledPagesSite(
  siteArg = 'dist',
  cwd = process.cwd(),
): Promise<PagesWeightGateReport> {
  const siteDir = resolve(cwd, siteArg);
  const failures: string[] = [];

  for (const reqFile of REQUIRED_ARTIFACTS) {
    if (!existsSync(join(siteDir, reqFile))) {
      failures.push(`missing required GitHub Pages artifact: ${reqFile}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Pages artifact check failed:\n  - ${failures.join('\n  - ')}`);
  }

  // Verify index.html uses subpath-safe references (no root-anchored `/assets/` script/style tags)
  const indexHtml = readFileSync(join(siteDir, 'index.html'), 'utf8');
  if (/(?:src|href)="\/assets\//.test(indexHtml)) {
    failures.push(
      'dist/index.html contains root-absolute /assets/ URLs that break GitHub Pages repository subpaths; set base="./" or VITE_BASE_PATH',
    );
  }

  // Enforce permanent zero-constants parametric ratchet (`FI-08` / `prism/parametric-ratchet/1`)
  const ratchetReport = auditParametricRatchetOnDisk(cwd);
  if (!ratchetReport.ok) {
    failures.push(
      `prism/parametric-ratchet/1 failed (${ratchetReport.violations.length} violation(s)): ${ratchetReport.error?.detail ?? 'ratchet violation'}`,
    );
  } else {
    const plantedCheck = verifyParametricRatchetPlantedDefects(loadDiskRatchetWorkspace(cwd));
    if (!plantedCheck.allCaughtAndRestored) {
      failures.push('prism/parametric-ratchet/1 planted-defect self-check failed');
    }
  }

  // Replay full zero-import wasm32 verification on the emitted dist/app.holo
  const holoBytes = new Uint8Array(readFileSync(join(siteDir, 'app.holo')));
  const holoReport = await verifyHoloArchiveComplete(holoBytes);
  const holoGzipBytes = gzipSync(holoBytes).byteLength;

  // Verify app.json schema & provenance fields
  const appJson = JSON.parse(readFileSync(join(siteDir, 'app.json'), 'utf8')) as {
    name?: string;
    live?: string;
    repository?: string;
    theorems?: unknown[];
    attestations?: { build?: { id?: string; url?: string } };
  };
  if (!appJson.name || !appJson.live || !appJson.repository || !Array.isArray(appJson.theorems)) {
    failures.push('dist/app.json is missing required Prism manifest fields (name, live, repository, theorems)');
  }
  if (!appJson.attestations?.build?.id || !appJson.attestations?.build?.url) {
    failures.push('dist/app.json is missing attestations.build provenance metadata');
  }

  // Verify precache.json SHA-256 integrity and measure gzipped wire transfer
  const precache = JSON.parse(
    readFileSync(join(siteDir, 'precache.json'), 'utf8'),
  ) as PrecacheManifest;
  if (!precache.version || precache.version.length !== 16 || precache.files.length === 0) {
    failures.push('dist/precache.json has invalid version or empty file list');
  }

  let totalRawBytes = 0;
  let totalGzipBytes = 0;
  let shellHtmlGzipBytes = 0;

  for (const entry of precache.files) {
    const cleanRel = entry.path.replace(/^\.\//, '');
    const fullPath = join(siteDir, cleanRel);
    if (!existsSync(fullPath)) {
      failures.push(`precache entry missing on disk: ${entry.path}`);
      continue;
    }
    const diskBytes = readFileSync(fullPath);
    const actualSha = createHash('sha256').update(diskBytes).digest('hex');
    if (actualSha !== entry.sha256) {
      failures.push(`SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${actualSha}`);
    }
    const gz = gzipSync(diskBytes).byteLength;
    totalRawBytes += diskBytes.byteLength;
    totalGzipBytes += gz;
    if (cleanRel === 'index.html') {
      shellHtmlGzipBytes = gz;
    }
  }

  if (holoGzipBytes > PAGES_WIRE_BUDGET.holoGzipMaxBytes) {
    failures.push(
      `app.holo gzipped wire size ${holoGzipBytes} B exceeds budget ${PAGES_WIRE_BUDGET.holoGzipMaxBytes} B`,
    );
  }
  if (shellHtmlGzipBytes > PAGES_WIRE_BUDGET.shellHtmlGzipMaxBytes) {
    failures.push(
      `index.html gzipped wire size ${shellHtmlGzipBytes} B exceeds budget ${PAGES_WIRE_BUDGET.shellHtmlGzipMaxBytes} B`,
    );
  }
  if (totalGzipBytes > PAGES_WIRE_BUDGET.totalGzipMaxBytes) {
    failures.push(
      `total gzipped wire size ${totalGzipBytes} B exceeds budget ${PAGES_WIRE_BUDGET.totalGzipMaxBytes} B`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`Pages weight/integrity gate refused deployment:\n  - ${failures.join('\n  - ')}`);
  }

  const expectedVecs = CORE_WASM_ACCEPTANCE_VECTORS.length;
  console.log(
    `weight-gate: PASS · ratchet=0/0 (${ratchetReport.groundedLexModuleCount} lex, ${ratchetReport.auditedRustFileCount} rs) · precache v=${precache.version} (${precache.files.length} files) · app.holo=${holoReport.byteLength}B (${holoGzipBytes}B gz, ${expectedVecs}/${expectedVecs} Wasm vectors) · total=${(totalRawBytes / 1024).toFixed(1)} KiB raw / ${(totalGzipBytes / 1024).toFixed(1)} KiB gzip`,
  );

  return {
    valid: true,
    precacheVersion: precache.version,
    verifiedFiles: precache.files.length,
    holoRawBytes: holoReport.byteLength,
    holoGzipBytes,
    totalRawBytes,
    totalGzipBytes,
    vectorsPassed: expectedVecs,
    ratchetVerified: ratchetReport.ok,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  verifyAssembledPagesSite(process.argv[2] ?? 'dist').catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
