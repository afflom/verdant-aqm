#!/usr/bin/env node
/**
 * Input-Addressed Hologram v4 Cache & Builder (`ci/kappa-cache.ts`)
 *
 * Ported directly from `afflom/verdant-engine/ci/kappa-cache.mjs` for `verdant-aqm`:
 *  - Computes deterministic `prism/input-kappa/1` BLAKE3 `kappa` over tracked source inputs
 *    (`app`, `model`, `crates`, `src/aqm`).
 *  - Never trusts a cached `.holo`: every restored or freshly built `VerdantAqm.holo` must pass
 *    32-byte BLAKE3 self-fingerprint verification, 356-byte `APP_MANIFEST` inspection,
 *    zero-import `wasm32` compilation, 6-export ABI check, and 32/32 `holo_run` vector replay!
 *  - Supports OCI container registry caching on `ghcr.io/<owner>/prism-holo` in GitHub Actions,
 *    while gracefully falling through to fresh deterministic build on cache miss or offline runs.
 *
 * CLI Usage:
 *   npx tsx ci/kappa-cache.ts key [<input>...]
 *   npx tsx ci/kappa-cache.ts build <out.holo> [<input>...]
 *   npx tsx ci/kappa-cache.ts restore <out.holo> [<input>...]
 *   KAPPA=<kappa> npx tsx ci/kappa-cache.ts save <app.holo>
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blake3Kappa } from '../src/aqm/blake3';
import {
  buildVerdantAqmHoloArchive,
  HoloV4VerificationReport,
  instantiateHoloCoreWasmGuest,
  parseAndVerifyHoloV4Archive,
  runHoloCoreWasmGuest,
} from '../src/aqm/holoGuest';
import { CORE_WASM_ACCEPTANCE_VECTORS } from '../src/aqm/prismKernel';

export const SCHEMA = 'prism/input-kappa/1';
export const DEFAULT_INPUTS = ['app', 'model', 'crates', 'src/aqm'] as const;
export const PACKAGE_NAME = 'prism-holo';
export const MEDIA_TYPE = 'application/vnd.uor.prism.holo.v1';

const say = (msg: string) => console.log(`kappa-cache: ${msg}`);

function writeGithubOutput(name: string, value: string): void {
  const outPath = process.env.GITHUB_OUTPUT;
  if (outPath) {
    appendFileSync(outPath, `${name}=${value}\n`);
  }
}

function sha256Prefixed(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function walkFilesDeterministic(rootDir: string, targetRel: string): string[] {
  const abs = join(rootDir, targetRel);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) {
    return [relative(rootDir, abs).split('\\').join('/')];
  }
  const results: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === 'target' || entry === '.git' || entry === 'dist') {
      continue;
    }
    const childRel = join(targetRel, entry);
    results.push(...walkFilesDeterministic(rootDir, childRel));
  }
  return results;
}

function listInputFiles(inputs: readonly string[], cwd: string): string[] {
  try {
    const raw = execFileSync('git', ['ls-files', '-z', '--', ...inputs], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tracked = raw.split('\0').filter(Boolean).sort();
    if (tracked.length > 0) {
      return tracked;
    }
  } catch {
    // Fall back to deterministic filesystem walk when outside a git checkout (e.g. clean container)
  }

  const collected = new Set<string>();
  for (const inp of inputs) {
    for (const f of walkFilesDeterministic(cwd, inp)) {
      collected.add(f);
    }
  }
  return Array.from(collected).sort();
}

/**
 * Computes the deterministic `prism/input-kappa/1` BLAKE3 digest over all input files,
 * framed by `path\0byteLength\0` in strict byte-lexicographic path order.
 */
export function computeInputKappa(
  inputs: readonly string[] = DEFAULT_INPUTS,
  cwd = process.cwd(),
): { kappa: string; files: number } {
  const files = listInputFiles(inputs, cwd);
  if (files.length === 0) {
    throw new Error(`no files found under ${inputs.join(', ')}`);
  }

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [enc.encode(`${SCHEMA}\n`)];
  let totalLen = chunks[0].byteLength;

  for (const relPath of files) {
    const content = new Uint8Array(readFileSync(join(cwd, relPath)));
    const header = enc.encode(`${relPath}\0${content.byteLength}\0`);
    chunks.push(header, content);
    totalLen += header.byteLength + content.byteLength;
  }

  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  return { kappa: blake3Kappa(merged), files: files.length };
}

/**
 * Verifies a `.holo` v4 archive byte buffer:
 *  1. Checks 32-byte BLAKE3 self-fingerprint (`archive[0..end-32]`).
 *  2. Parses 356-byte `APP_MANIFEST` and content-addressed `CONTENT_BLOB` sections.
 *  3. Compiles embedded `wasm32` guest with zero imports and 6 required exports.
 *  4. Replays all 26 `CORE_WASM_ACCEPTANCE_VECTORS` through `holo_run(ptr, len)`.
 */
export async function verifyHoloArchiveComplete(
  blob: Uint8Array,
): Promise<HoloV4VerificationReport> {
  if (blob.byteLength < 64) {
    throw new Error('Archive too short to be a Hologram v4 .holo');
  }
  const report = await parseAndVerifyHoloV4Archive(blob);
  if (!report.valid) {
    throw new Error('Hologram v4 structural, footer, or zero-import verification failed');
  }

  const guest = await instantiateHoloCoreWasmGuest(report.wasmBytes);
  for (const vec of CORE_WASM_ACCEPTANCE_VECTORS) {
    const actual = runHoloCoreWasmGuest(guest, vec.request);
    if (actual !== vec.expectedResponse) {
      throw new Error(
        `Acceptance vector replay failed on '${vec.request}': expected '${vec.expectedResponse}', got '${actual}'`,
      );
    }
  }
  return report;
}

export interface HoloIdentityRecord {
  readonly schema: 'prism/holo-identities/1';
  readonly archive_fingerprint: string;
  readonly input_kappa: string;
  readonly wasm_kappa: string;
  readonly requires_kappa: string;
  readonly view_kappa: string;
  readonly archive_bytes: number;
  readonly wasm_bytes: number;
  readonly wasm_exports: readonly string[];
  readonly vectors_verified: number;
}

/**
 * Deterministically builds `VerdantAqm.holo`, verifies all 32 vectors, and writes
 * `<dirname(outPath)>/application/holo-identities.json` matching `verdant-engine/pages.yml`.
 */
export async function buildAndWriteVerifiedHolo(
  outPath: string,
  inputs: readonly string[] = DEFAULT_INPUTS,
  cwd = process.cwd(),
): Promise<HoloIdentityRecord> {
  const { kappa: inputKappa } = computeInputKappa(inputs, cwd);
  const built = buildVerdantAqmHoloArchive(`VerdantAqm@0.3.0:8-facets:AQ-01..AQ-21:${inputKappa}`);
  const verified = await verifyHoloArchiveComplete(built.archiveBytes);

  const absOut = resolve(cwd, outPath);
  mkdirSync(dirname(absOut), { recursive: true });
  writeFileSync(absOut, built.archiveBytes);

  const identities: HoloIdentityRecord = {
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

  const appMetaDir = join(dirname(absOut), 'application');
  mkdirSync(appMetaDir, { recursive: true });
  writeFileSync(
    join(appMetaDir, 'holo-identities.json'),
    `${JSON.stringify(identities, null, 2)}\n`,
  );

  return identities;
}

async function fetchGhcrToken(repoScope: string, actions: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_ACTOR) {
    const creds = Buffer.from(`${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}`).toString(
      'base64',
    );
    headers.authorization = `Basic ${creds}`;
  }
  const resp = await fetch(
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${repoScope}:${actions}`,
    { headers },
  );
  if (!resp.ok) {
    throw new Error(`ghcr token HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { token: string };
  return body.token;
}

async function restoreFromGhcr(
  outPath: string,
  inputKappa: string,
  cwd: string,
): Promise<boolean> {
  const repo = (process.env.GITHUB_REPOSITORY ?? '').toLowerCase();
  if (!repo || !repo.includes('/')) {
    say('GITHUB_REPOSITORY not set; skipping remote ghcr.io lookup (miss)');
    return false;
  }

  const owner = repo.split('/')[0];
  const pkg = `${owner}/${PACKAGE_NAME}`;
  const tag = inputKappa.replace(':', '-');

  try {
    const tok = await fetchGhcrToken(pkg, 'pull');
    const manResp = await fetch(`https://ghcr.io/v2/${pkg}/manifests/${tag}`, {
      headers: {
        authorization: `Bearer ${tok}`,
        accept: 'application/vnd.oci.image.manifest.v1+json',
      },
    });
    if (!manResp.ok) {
      say(`miss on ghcr.io/${pkg}:${tag} (HTTP ${manResp.status})`);
      return false;
    }
    const manifest = (await manResp.json()) as {
      layers?: Array<{ mediaType: string; digest: string }>;
    };
    const layer = manifest.layers?.find((l) => l.mediaType === MEDIA_TYPE);
    if (!layer) {
      say('manifest contains no prism.holo layer; treating as miss');
      return false;
    }

    const blobResp = await fetch(`https://ghcr.io/v2/${pkg}/blobs/${layer.digest}`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    if (!blobResp.ok) {
      say(`blob fetch HTTP ${blobResp.status}; treating as miss`);
      return false;
    }
    const blobBytes = new Uint8Array(await blobResp.arrayBuffer());
    if (sha256Prefixed(blobBytes) !== layer.digest) {
      throw new Error('OCI layer SHA-256 mismatch');
    }

    const verified = await verifyHoloArchiveComplete(blobBytes);
    const absOut = resolve(cwd, outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, blobBytes);

    const identities: HoloIdentityRecord = {
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
    const appMetaDir = join(dirname(absOut), 'application');
    mkdirSync(appMetaDir, { recursive: true });
    writeFileSync(
      join(appMetaDir, 'holo-identities.json'),
      `${JSON.stringify(identities, null, 2)}\n`,
    );

    say(
      `restored & verified ${tag} (${verified.byteLength} B, ${CORE_WASM_ACCEPTANCE_VECTORS.length}/${CORE_WASM_ACCEPTANCE_VECTORS.length} vectors)`,
    );
    return true;
  } catch (err) {
    say(`cache lookup fell through cleanly (${err instanceof Error ? err.message : String(err)})`);
    return false;
  }
}

async function saveToGhcr(holoPath: string, inputKappa: string): Promise<void> {
  const repo = (process.env.GITHUB_REPOSITORY ?? '').toLowerCase();
  if (!repo || !process.env.GITHUB_TOKEN) {
    say('skipping ghcr.io save (no GITHUB_REPOSITORY / GITHUB_TOKEN)');
    return;
  }

  try {
    const bytes = new Uint8Array(readFileSync(holoPath));
    await verifyHoloArchiveComplete(bytes);

    const owner = repo.split('/')[0];
    const pkg = `${owner}/${PACKAGE_NAME}`;
    const tag = inputKappa.replace(':', '-');
    const tok = await fetchGhcrToken(pkg, 'pull,push');

    const emptyConfig = new TextEncoder().encode('{}');
    const configDigest = sha256Prefixed(emptyConfig);
    const layerDigest = sha256Prefixed(bytes);

    const uploadBlob = async (payload: Uint8Array, digest: string) => {
      const start = await fetch(`https://ghcr.io/v2/${pkg}/blobs/uploads/`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok}` },
      });
      if (!start.ok) throw new Error(`blob upload start HTTP ${start.status}`);
      const loc = start.headers.get('location');
      if (!loc) throw new Error('missing upload location header');
      const url = loc.startsWith('http') ? loc : `https://ghcr.io${loc}`;
      const sep = url.includes('?') ? '&' : '?';
      const bodyCopy = new ArrayBuffer(payload.byteLength);
      new Uint8Array(bodyCopy).set(payload);
      const put = await fetch(`${url}${sep}digest=${encodeURIComponent(digest)}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${tok}`,
          'content-type': 'application/octet-stream',
        },
        body: bodyCopy,
      });
      if (!put.ok && put.status !== 201) {
        throw new Error(`blob upload PUT HTTP ${put.status}`);
      }
    };

    await uploadBlob(emptyConfig, configDigest);
    await uploadBlob(bytes, layerDigest);

    const ociManifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.empty.v1+json',
        digest: configDigest,
        size: emptyConfig.byteLength,
      },
      layers: [
        {
          mediaType: MEDIA_TYPE,
          digest: layerDigest,
          size: bytes.byteLength,
          annotations: {
            'org.opencontainers.image.title': 'VerdantAqm.holo',
            'foundation.uor.input-kappa': inputKappa,
          },
        },
      ],
    });

    const putMan = await fetch(`https://ghcr.io/v2/${pkg}/manifests/${tag}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tok}`,
        'content-type': 'application/vnd.oci.image.manifest.v1+json',
      },
      body: ociManifest,
    });
    if (!putMan.ok) {
      throw new Error(`manifest PUT HTTP ${putMan.status}`);
    }
    say(`stored verified holo at ghcr.io/${pkg}:${tag}`);
  } catch (err) {
    say(`ghcr.io save skipped (${err instanceof Error ? err.message : String(err)})`);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'key') {
    const inputs = rest.length > 0 ? rest : DEFAULT_INPUTS;
    const { kappa, files } = computeInputKappa(inputs);
    console.log(`${kappa} (${files} files)`);
    return;
  }

  if (cmd === 'build') {
    const outPath = rest[0] ?? '.prism/build/kappa/VerdantAqm.holo';
    const inputs = rest.length > 1 ? rest.slice(1) : DEFAULT_INPUTS;
    const rec = await buildAndWriteVerifiedHolo(outPath, inputs);
    say(
      `built & verified ${outPath} (${rec.archive_bytes} B, fingerprint ${rec.archive_fingerprint.slice(0, 16)}…, ${rec.vectors_verified}/${CORE_WASM_ACCEPTANCE_VECTORS.length} vectors)`,
    );
    return;
  }

  if (cmd === 'restore') {
    const outPath = rest[0] ?? '.prism/build/kappa/VerdantAqm.holo';
    const inputs = rest.length > 1 ? rest.slice(1) : DEFAULT_INPUTS;
    const { kappa, files } = computeInputKappa(inputs);
    say(`input kappa ${kappa} across ${files} tracked files`);
    writeGithubOutput('kappa', kappa);
    const hit = await restoreFromGhcr(outPath, kappa, process.cwd());
    writeGithubOutput('hit', hit ? 'true' : 'false');
    return;
  }

  if (cmd === 'save') {
    const holoPath = rest[0] ?? process.env.HOLO ?? '.prism/build/kappa/VerdantAqm.holo';
    const kappa = process.env.KAPPA ?? computeInputKappa(DEFAULT_INPUTS).kappa;
    await saveToGhcr(holoPath, kappa);
    return;
  }

  throw new Error(`Unknown subcommand '${cmd ?? ''}'. Expected: key | build | restore | save`);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
