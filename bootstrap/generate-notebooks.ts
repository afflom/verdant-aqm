#!/usr/bin/env node
/**
 * Deterministic Jupyter Notebook Generator (`bootstrap/generate-notebooks.ts`)
 *
 * Emits the 3 canonical `nbformat` v4.5 `.ipynb` notebooks into `/notebooks/*.ipynb`
 * with pre-executed `VerdantAqmBackend`, `VerdantAqmSamplerV2`, and `VerdantAqmEstimatorV2`
 * cell outputs and `holo_kappa` provenance digests, then verifies the `prism-devrel`
 * `devrel-publish-gate` (`uncovered=0, undeclared=0, unverifiedNotebooks=0, pin=current -> publish`).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_CAPABILITY_IDS,
  CANONICAL_NOTEBOOK_SPECS,
  DIATAXIS_GUIDE_META,
  buildJupyterNotebookJson,
  runDevRelContentAndPublishGateAudit,
} from '../src/aqm/devrelGuides';
import { LOCKED_UPSTREAM_ORACLE_FILES } from '../src/aqm/qiskitOracle';

export function generateAllJupyterNotebooks(outDirArg = 'notebooks', cwd = process.cwd()): {
  writtenFiles: readonly string[];
  gateVerdict: string;
} {
  const outDir = resolve(cwd, outDirArg);
  mkdirSync(outDir, { recursive: true });

  const writtenFiles: string[] = [];
  for (const spec of CANONICAL_NOTEBOOK_SPECS) {
    const built = buildJupyterNotebookJson(spec);
    if (!built.allCellsSucceeded) {
      throw new Error(`Notebook '${spec.fileName}' failed cell verification during build`);
    }
    const targetPath = join(outDir, spec.fileName);
    writeFileSync(targetPath, `${JSON.stringify(built.notebook, null, 2)}\n`);
    writtenFiles.push(targetPath);
  }

  const guideMap: Record<string, string> = {};
  for (const meta of DIATAXIS_GUIDE_META) {
    guideMap[meta.path] = readFileSync(join(cwd, meta.path), 'utf8');
  }

  const oraclePayloads: Record<string, Uint8Array> = {};
  for (const entry of LOCKED_UPSTREAM_ORACLE_FILES) {
    oraclePayloads[entry.fileName] = new Uint8Array(
      readFileSync(join(cwd, 'vendor/qiskit-oracle', entry.fileName)),
    );
  }

  const audit = runDevRelContentAndPublishGateAudit(guideMap, oraclePayloads);
  if (!audit.gateOk) {
    throw new Error(
      `prism-devrel publish gate refused publication: verdict=${audit.gateVerdict}, uncovered=[${audit.uncoveredCapabilities.join(',')}], filler=${JSON.stringify(audit.fillerViolations)}, vagueLinks=${JSON.stringify(audit.vagueLinkViolations)}, unverifiedNotebooks=${audit.unverifiedNotebooks}`,
    );
  }

  console.log(
    `generate-notebooks: emitted ${writtenFiles.length} verified .ipynb notebooks in ${outDir} · prism-devrel gate=${audit.gateVerdict} (${audit.coveredCapabilities.length}/${ALL_CAPABILITY_IDS.length} capabilities, 0 filler words)`,
  );

  return {
    writtenFiles,
    gateVerdict: audit.gateVerdict,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  generateAllJupyterNotebooks(process.argv[2] ?? 'notebooks');
}
