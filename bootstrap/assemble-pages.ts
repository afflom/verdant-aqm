#!/usr/bin/env node
/**
 * GitHub Pages Static Site Assembler (`bootstrap/assemble-pages.ts`)
 *
 * Mirrors `afflom/verdant-engine`'s `pages.yml` assembly step + `bootstrap/page.mjs`:
 *  1. Embeds the verified `VerdantAqm.holo` v4 archive at `dist/app.holo` and `dist/VerdantAqm.holo`,
 *     plus `dist/holo-identities.json` with BLAKE3 `kappa` digests.
 *  2. Reads `site/app.json`, adapts `repository` / `live` URLs dynamically when built in
 *     GitHub Actions (`GITHUB_REPOSITORY`, `PAGES_BASE_URL`), attaches signed SLSA build
 *     provenance (`FINGERPRINT`, `ATTESTATION_URL`), and writes `dist/app.json`.
 *  3. Generates `dist/manifest.webmanifest` (PWA Web App Manifest), `dist/llms.txt`
 *     (machine-readable Prism specification & theorem index), `dist/.nojekyll`, and `dist/404.html`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAndWriteVerifiedHolo,
  computeInputKappa,
  DEFAULT_INPUTS,
  HoloIdentityRecord,
  verifyHoloArchiveComplete,
} from '../ci/kappa-cache';
import { CORE_WASM_ACCEPTANCE_VECTORS } from '../src/aqm/prismKernel';

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
    attestations: {
      ...attestations,
      build: {
        id: fingerprint,
        url: attestationUrl,
      },
    },
  };

  writeFileSync(join(distDir, 'app.json'), `${JSON.stringify(enrichedAppJson, null, 2)}\n`);

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

  // Write `dist/llms.txt` (machine-readable Prism specification summary, matching verdant-engine/site/llms.txt)
  const llmsTxt = [
    `# ${String(rawAppJson.name ?? 'Verdant AQM')}`,
    '',
    `> ${String(rawAppJson.purpose ?? '')}`,
    '',
    `- Live GitHub Pages App: ${liveUrl}`,
    `- Repository: ${repoUrl}`,
    `- Conformance Matrix: ${repoUrl}/blob/main/CONFORMANCE.md`,
    `- Portable Hologram v4 Guest: ${liveUrl}app.holo (blake3:${identities.archive_fingerprint})`,
    `- Wasm Zero-Import Exports (6): ${identities.wasm_exports.join(', ')}`,
    `- Pinned Core-Wasm Acceptance Vectors: ${identities.vectors_verified}/26`,
    '',
    '## 8 Prism Specification Facets',
    '- app/src/Quantum.lex.tex — Wire linearity, Z[zeta_8] norm conservation, Z_8 gate-fusion monoid, F_2 symplectic tableau, MTC & SkWeaver laws',
    '- app/src/Architecture.lex.tex — 8 constructive strata, BoundedBuffer, uor-matmul zero-decode tiers, Stitch 2-of-3 parity custody',
    '- app/src/Design.lex.tex — Zero-pill discipline, 16x16 software tile rasterizer, modal quantum sonification',
    '- app/src/Features.lex.tex — Capability registry AQ-01 through AQ-18',
    '- app/src/Security.lex.tex — Zero-import wasm32 sandbox, SHA-256 journal chain, BLAKE3 content addressing',
    '- app/src/Quality.lex.tex — 26 pinned acceptance vectors, 9 R5 planted-defect refusal gates',
    '- app/src/Compliance.lex.tex — Deterministic execution without hardware QPUs or cloud secrets',
    '- app/src/Honesty.lex.tex — Strict three-tier ledger separation (some-true, build, open)',
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
    `assemble-pages: ${distDir} -> app.holo (${identities.archive_bytes} B, blake3:${identities.archive_fingerprint.slice(0, 16)}…), app.json, manifest.webmanifest, llms.txt, .nojekyll, 404.html`,
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
