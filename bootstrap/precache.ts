#!/usr/bin/env node
/**
 * Content-Addressed Precache Manifest Generator (`bootstrap/precache.ts`)
 *
 * Direct TypeScript port of `afflom/verdant-engine/bootstrap/precache.mjs`:
 *  - Writes `<site>/precache.json`: every served file in `dist/`, with its SHA-256 digest,
 *    byte count, and `eager` flag (`favicon.svg`, `manifest.webmanifest`, `app.holo`),
 *    plus a 16-hex `version` equal to the SHA-256 prefix of the `(path, sha256)` list.
 *  - Ensures a changed deployment transitions `public/sw.js` to a new `prism-<version>` cache,
 *    while an identical deployment preserves the existing cache with zero redundant fetches.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PrecacheFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly eager?: boolean;
}

export interface PrecacheManifest {
  readonly version: string;
  readonly files: readonly PrecacheFileEntry[];
}

const SKIP_FILES = new Set([
  'precache.json',
  'sw.js',
  '404.html',
  '.nojekyll',
  'holo-identities.json',
]);

function walkFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

export function buildPrecacheManifest(siteArg = 'dist', cwd = process.cwd()): PrecacheManifest {
  const siteDir = resolve(cwd, siteArg);
  const allPaths = walkFilesRecursive(siteDir).sort();
  const files: PrecacheFileEntry[] = [];

  for (const fullPath of allPaths) {
    const rel = relative(siteDir, fullPath).split('\\').join('/');
    if (
      SKIP_FILES.has(rel) ||
      rel.endsWith('.txt') ||
      rel.endsWith('.md') ||
      rel.endsWith('.d.ts') ||
      rel.endsWith('.map')
    ) {
      continue;
    }

    const bytes = readFileSync(fullPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const eager =
      rel === 'favicon.svg' ||
      rel === 'manifest.webmanifest' ||
      rel === 'app.holo' ||
      rel.startsWith('icons/');

    files.push({
      path: `./${rel}`,
      sha256,
      bytes: bytes.byteLength,
      ...(eager ? { eager: true } : {}),
    });
  }

  const version = createHash('sha256')
    .update(JSON.stringify(files.map((f) => [f.path, f.sha256])))
    .digest('hex')
    .slice(0, 16);

  const manifest: PrecacheManifest = { version, files };
  writeFileSync(join(siteDir, 'precache.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const totalBytes = files.reduce((acc, f) => acc + f.bytes, 0);
  console.log(`precache: ${files.length} files, ${totalBytes} bytes, version ${version}`);
  return manifest;
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    buildPrecacheManifest(process.argv[2] ?? 'dist');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
