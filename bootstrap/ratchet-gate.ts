#!/usr/bin/env node
// On-Disk `prism/parametric-ratchet/1` Gate (`bootstrap/ratchet-gate.ts`)
// Walks `app/src/` (.lex.tex) and `crates/verdant-aqm/src/` (.rs) directly on disk
// and enforces all 6 permanent zero ceilings from `model/parametric-ratchet.toml` (`FI-08` / `AQ-23`).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateParametricRatchet,
  ParametricRatchetAuditReport,
  parseParametricRatchetToml,
  RatchetWorkspaceSnapshot,
  verifyParametricRatchetPlantedDefects,
} from '../src/aqm/ratchet';

function collectFilesBySuffix(
  rootDir: string,
  relStart: string,
  suffix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const absStart = join(rootDir, relStart);
  if (!existsSync(absStart)) return out;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(suffix)) {
        const rel = relative(rootDir, full).split('\\').join('/');
        out[rel] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(absStart);
  return out;
}

export function loadDiskRatchetWorkspace(cwd = process.cwd()): RatchetWorkspaceSnapshot {
  const root = resolve(cwd);
  const ratchetTomlPath = join(root, 'model/parametric-ratchet.toml');
  if (!existsSync(ratchetTomlPath)) {
    throw new Error('Missing model/parametric-ratchet.toml on disk');
  }
  const ratchetToml = readFileSync(ratchetTomlPath, 'utf8');
  const parsed = parseParametricRatchetToml(ratchetToml);
  const lexFilesByPath = collectFilesBySuffix(root, 'app/src', '.lex.tex');

  const rustFilesByPath: Record<string, string> = {};
  const rustRoots = parsed.config
    ? [parsed.config.engine_rust_root, ...parsed.config.additional_rust_roots]
    : ['crates/verdant-aqm/src'];
  for (const rRoot of rustRoots) {
    Object.assign(rustFilesByPath, collectFilesBySuffix(root, rRoot, '.rs'));
  }

  return {
    ratchetToml,
    lexFilesByPath,
    rustFilesByPath,
  };
}

export function auditParametricRatchetOnDisk(cwd = process.cwd()): ParametricRatchetAuditReport {
  return evaluateParametricRatchet(loadDiskRatchetWorkspace(cwd));
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const ws = loadDiskRatchetWorkspace(process.cwd());
  const report = evaluateParametricRatchet(ws);
  if (!report.ok) {
    console.error('parametric-ratchet: REFUSED');
    for (const v of report.violations) {
      console.error(`  - [${v.category}] ${v.path}${v.line ? `:${v.line}` : ''} -> ${v.token}`);
    }
    process.exit(1);
  }
  const planted = verifyParametricRatchetPlantedDefects(ws);
  if (!planted.allCaughtAndRestored) {
    console.error('parametric-ratchet: planted-defect self-check failed');
    process.exit(1);
  }
  console.log(
    `parametric-ratchet: PASS · spec=${report.spec} · ceilings=0/0 · grounded_lex=${report.groundedLexModuleCount} · rust_files=${report.auditedRustFileCount} · planted_gates=${planted.casesVerified}/${planted.casesVerified}`,
  );
}
