/**
 * Permanent Zero-Constants & Purely Parametric Ratchet (`FI-08` / `AQ-23`, `spec = "prism/parametric-ratchet/1"`).
 *
 * Ported faithfully from `afflom/verdant-engine/crates/fidelity/src/ratchet.rs` (`model/parametric-ratchet.toml`).
 * Pure environment-agnostic TypeScript (runs identically in Node `tsx`, Web Workers, and Vite browser bundles).
 * Enforces all 6 permanent zero ceilings (`=== 0`):
 *   1. `max_ontology_root_literal_gt_one_count = 0`
 *   2. `max_ontology_root_string_field_count = 0`
 *   3. `max_classical_choice_count = 0`
 *   4. `max_ungrounded_lex_module_count = 0`
 *   5. `max_domain_lex_magic_literal_count = 0`
 *   6. `max_engine_rust_magic_literal_count = 0`
 */

import { ModeledAqmError, ParametricRatchetErrorKind } from './types';

export const RATCHET_SPEC_ID = 'prism/parametric-ratchet/1';

export interface ParametricRatchetCeilings {
  readonly max_ontology_root_literal_gt_one_count: number;
  readonly max_ontology_root_string_field_count: number;
  readonly max_classical_choice_count: number;
  readonly max_ungrounded_lex_module_count: number;
  readonly max_domain_lex_magic_literal_count: number;
  readonly max_engine_rust_magic_literal_count: number;
}

export interface StratumModuleEntry {
  readonly path: string;
  readonly stratum: number;
  readonly role: string;
}

export interface ParametricRatchetConfig {
  readonly spec: string;
  readonly ontology_root: string;
  readonly engine_rust_root: string;
  readonly additional_rust_roots: readonly string[];
  readonly pure_zero_one_lex_modules: readonly string[];
  readonly ceilings: ParametricRatchetCeilings;
  readonly stratum_module: readonly StratumModuleEntry[];
}

export interface RatchetViolationDetail {
  readonly category:
    | 'config-schema'
    | 'ceiling-weakened'
    | 'ontology-literal-gt-one'
    | 'ontology-string-field'
    | 'classical-choice'
    | 'ungrounded-lex-module'
    | 'domain-lex-magic-literal'
    | 'engine-rust-magic-literal';
  readonly path: string;
  readonly token: string;
  readonly line?: number;
}

export interface ParametricRatchetAuditReport {
  readonly ok: boolean;
  readonly spec: string;
  readonly counts: {
    readonly ontologyRootLiteralGtOneCount: number;
    readonly ontologyRootStringFieldCount: number;
    readonly classicalChoiceCount: number;
    readonly ungroundedLexModuleCount: number;
    readonly domainLexMagicLiteralCount: number;
    readonly engineRustMagicLiteralCount: number;
  };
  readonly ceilings: ParametricRatchetCeilings;
  readonly groundedLexModuleCount: number;
  readonly auditedRustFileCount: number;
  readonly violations: readonly RatchetViolationDetail[];
  readonly error?: ModeledAqmError;
}

export interface RatchetWorkspaceSnapshot {
  readonly ratchetToml: string;
  readonly lexFilesByPath: Readonly<Record<string, string>>;
  readonly rustFilesByPath: Readonly<Record<string, string>>;
}

const ALLOWED_TOP_KEYS = new Set([
  'spec',
  'ontology_root',
  'engine_rust_root',
  'additional_rust_roots',
  'pure_zero_one_lex_modules',
  'ceilings',
  'stratum_module',
]);

const ALLOWED_CEILING_KEYS = new Set([
  'max_ontology_root_literal_gt_one_count',
  'max_ontology_root_string_field_count',
  'max_classical_choice_count',
  'max_ungrounded_lex_module_count',
  'max_domain_lex_magic_literal_count',
  'max_engine_rust_magic_literal_count',
]);

const ALLOWED_STRATUM_KEYS = new Set(['path', 'stratum', 'role']);

/**
 * Strict parser for `model/parametric-ratchet.toml` enforcing `#[serde(deny_unknown_fields)]` parity with `ratchet.rs`.
 */
export function parseParametricRatchetToml(rawToml: string): {
  config?: ParametricRatchetConfig;
  schemaError?: string;
} {
  const lines = rawToml.split(/\r?\n/);
  let section: 'root' | 'ceilings' | 'stratum_module' = 'root';
  const rootValues: Record<string, unknown> = {};
  const ceilings: Record<string, number> = {};
  const stratumModules: Array<Record<string, unknown>> = [];
  let currentStratum: Record<string, unknown> | null = null;

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    let clean = '';
    let inQuotes = false;
    for (let c = 0; c < rawLine.length; c += 1) {
      const ch = rawLine[c];
      if (ch === '"' && rawLine[c - 1] !== '\\') inQuotes = !inQuotes;
      if (ch === '#' && !inQuotes) break;
      clean += ch;
    }
    const trimmed = clean.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed === '[ceilings]') {
      section = 'ceilings';
      currentStratum = null;
      i += 1;
      continue;
    }
    if (trimmed === '[[stratum_module]]') {
      section = 'stratum_module';
      currentStratum = {};
      stratumModules.push(currentStratum);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('[')) {
      return { schemaError: `Unknown TOML table '${trimmed}' in parametric-ratchet.toml` };
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) {
      return { schemaError: `Malformed assignment line '${trimmed}'` };
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let rhs = trimmed.slice(eqIdx + 1).trim();

    if (rhs.startsWith('[') && !rhs.endsWith(']')) {
      const multiParts = [rhs];
      while (i + 1 < lines.length) {
        i += 1;
        const subRaw = lines[i].replace(/#.*$/, '').trim();
        multiParts.push(subRaw);
        if (subRaw.endsWith(']')) break;
      }
      rhs = multiParts.join(' ');
    }

    let parsedVal: unknown;
    if (rhs.startsWith('"') && rhs.endsWith('"')) {
      parsedVal = rhs.slice(1, -1);
    } else if (rhs.startsWith('[') && rhs.endsWith(']')) {
      const inner = rhs.slice(1, -1).trim();
      if (!inner) {
        parsedVal = [];
      } else {
        const items: string[] = [];
        const re = /"([^"]*)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(inner)) !== null) {
          items.push(m[1]);
        }
        parsedVal = items;
      }
    } else if (/^-?\d+$/.test(rhs)) {
      parsedVal = Number(rhs);
    } else {
      return { schemaError: `Unsupported TOML value '${rhs}' for key '${key}'` };
    }

    if (section === 'root') {
      if (!ALLOWED_TOP_KEYS.has(key)) {
        return { schemaError: `Unknown root field '${key}' denied by prism/parametric-ratchet/1` };
      }
      rootValues[key] = parsedVal;
    } else if (section === 'ceilings') {
      if (!ALLOWED_CEILING_KEYS.has(key) || typeof parsedVal !== 'number') {
        return { schemaError: `Invalid ceiling field '${key}' in [ceilings]` };
      }
      ceilings[key] = parsedVal;
    } else if (section === 'stratum_module' && currentStratum) {
      if (!ALLOWED_STRATUM_KEYS.has(key)) {
        return { schemaError: `Unknown field '${key}' in [[stratum_module]]` };
      }
      currentStratum[key] = parsedVal;
    }
    i += 1;
  }

  for (const reqKey of ALLOWED_CEILING_KEYS) {
    if (typeof ceilings[reqKey] !== 'number') {
      return { schemaError: `Missing required ceiling '${reqKey}' in [ceilings]` };
    }
  }

  if (
    typeof rootValues.spec !== 'string' ||
    typeof rootValues.ontology_root !== 'string' ||
    typeof rootValues.engine_rust_root !== 'string' ||
    !Array.isArray(rootValues.additional_rust_roots) ||
    !Array.isArray(rootValues.pure_zero_one_lex_modules)
  ) {
    return { schemaError: 'Missing required top-level fields in parametric-ratchet.toml' };
  }

  return {
    config: {
      spec: rootValues.spec,
      ontology_root: rootValues.ontology_root,
      engine_rust_root: rootValues.engine_rust_root,
      additional_rust_roots: rootValues.additional_rust_roots as string[],
      pure_zero_one_lex_modules: rootValues.pure_zero_one_lex_modules as string[],
      ceilings: ceilings as unknown as ParametricRatchetCeilings,
      stratum_module: stratumModules.map((m) => ({
        path: String(m.path ?? ''),
        stratum: Number(m.stratum ?? -1),
        role: String(m.role ?? ''),
      })),
    },
  };
}

/**
 * Scans `\begin{semanticmodule}...\end{semanticmodule}` in a `.lex.tex` file for standalone numeric tokens
 * outside `{"0", "1"}`, blanking double-quoted strings and `%` LaTeX comments (`ratchet.rs` parity).
 */
export function scanLexMagicLiterals(
  lexPath: string,
  content: string,
): RatchetViolationDetail[] {
  const out: RatchetViolationDetail[] = [];
  const beginTag = '\\begin{semanticmodule}';
  const endTag = '\\end{semanticmodule}';
  const bIdx = content.indexOf(beginTag);
  const eIdx = content.indexOf(endTag);
  const region =
    bIdx >= 0 && eIdx > bIdx ? content.slice(bIdx + beginTag.length, eIdx) : content;
  const lineOffset = bIdx >= 0 ? content.slice(0, bIdx).split('\n').length : 1;

  const lines = region.split('\n');
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    let scrubbed = '';
    let inStr = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"' && line[i - 1] !== '\\') {
        inStr = !inStr;
        scrubbed += ' ';
        continue;
      }
      if (!inStr && ch === '%') break;
      scrubbed += inStr ? ' ' : ch;
    }

    const tokenRe = /(?<![A-Za-z0-9_])([0-9][A-Za-z0-9_.]*)(?![A-Za-z0-9_])/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(scrubbed)) !== null) {
      const tok = m[1];
      if (tok !== '0' && tok !== '1') {
        out.push({
          category: 'domain-lex-magic-literal',
          path: lexPath,
          token: tok,
          line: lineOffset + idx,
        });
      }
    }
  }
  return out;
}

export function stripRustCfgTestItems(source: string): string {
  const cfgIdx = source.indexOf('#[cfg(test)]');
  if (cfgIdx < 0) return source;
  let res = '';
  let pos = 0;
  while (pos < source.length) {
    const nextCfg = source.indexOf('#[cfg(test)]', pos);
    if (nextCfg < 0) {
      res += source.slice(pos);
      break;
    }
    res += source.slice(pos, nextCfg);
    let p = nextCfg + '#[cfg(test)]'.length;
    while (p < source.length && source[p] !== '{' && source[p] !== ';') {
      if (source[p] === '\n') res += '\n';
      p += 1;
    }
    if (p < source.length && source[p] === ';') {
      p += 1;
    } else if (p < source.length && source[p] === '{') {
      let depth = 1;
      p += 1;
      while (p < source.length && depth > 0) {
        if (source[p] === '\n') res += '\n';
        if (source[p] === '{') depth += 1;
        else if (source[p] === '}') depth -= 1;
        p += 1;
      }
    }
    pos = p;
  }
  return res;
}

export function scrubRustCommentsAndStrings(source: string): string {
  const withoutTests = stripRustCfgTestItems(source);
  let out = '';
  let i = 0;
  const n = withoutTests.length;

  while (i < n) {
    const ch = withoutTests[i];
    const next = withoutTests[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && withoutTests[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      let depth = 1;
      out += '  ';
      i += 2;
      while (i < n && depth > 0) {
        if (withoutTests[i] === '/' && withoutTests[i + 1] === '*') {
          depth += 1;
          out += '  ';
          i += 2;
        } else if (withoutTests[i] === '*' && withoutTests[i + 1] === '/') {
          depth -= 1;
          out += '  ';
          i += 2;
        } else {
          out += withoutTests[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
      }
      continue;
    }

    if (
      (ch === 'r' && (next === '"' || next === '#')) ||
      (ch === 'b' && next === 'r' && (withoutTests[i + 2] === '"' || withoutTests[i + 2] === '#'))
    ) {
      let p = ch === 'b' ? i + 2 : i + 1;
      let hashes = 0;
      while (p < n && withoutTests[p] === '#') {
        hashes += 1;
        p += 1;
      }
      if (withoutTests[p] === '"') {
        while (i <= p) {
          out += ' ';
          i += 1;
        }
        const closeSeq = '"' + '#'.repeat(hashes);
        while (i < n && !withoutTests.startsWith(closeSeq, i)) {
          out += withoutTests[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
        for (let k = 0; k < closeSeq.length && i < n; k += 1) {
          out += ' ';
          i += 1;
        }
        continue;
      }
    }

    if (ch === '"' || (ch === 'b' && next === '"')) {
      if (ch === 'b') {
        out += ' ';
        i += 1;
      }
      out += ' ';
      i += 1;
      while (i < n) {
        if (withoutTests[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (withoutTests[i] === '"') {
          out += ' ';
          i += 1;
          break;
        }
        out += withoutTests[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (ch === "'" || (ch === 'b' && next === "'")) {
      const qStart = ch === 'b' ? i + 1 : i;
      if (withoutTests[qStart + 1] === '\\') {
        const closeTick = withoutTests.indexOf("'", qStart + 2);
        if (closeTick > qStart && closeTick - qStart <= 6) {
          while (i <= closeTick) {
            out += ' ';
            i += 1;
          }
          continue;
        }
      } else if (withoutTests[qStart + 2] === "'") {
        while (i <= qStart + 2) {
          out += ' ';
          i += 1;
        }
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function scanRustMagicLiterals(
  rustPath: string,
  source: string,
): RatchetViolationDetail[] {
  const scrubbed = scrubRustCommentsAndStrings(source);
  const violations: RatchetViolationDetail[] = [];
  const lines = scrubbed.split('\n');

  const suffixRe = /(?:_?(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64))$/;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    const litRe = /(?<![A-Za-z0-9_])(0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?(?:_?(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64))?)(?![A-Za-z0-9_])/g;
    let m: RegExpExecArray | null;
    while ((m = litRe.exec(line)) !== null) {
      const rawTok = m[1];
      const stripped = rawTok.replace(suffixRe, '').replace(/_/g, '');

      if (stripped.includes('.') || stripped.includes('e') || stripped.includes('E')) {
        if (stripped !== '0.0' && stripped !== '1.0') {
          violations.push({
            category: 'engine-rust-magic-literal',
            path: rustPath,
            token: rawTok,
            line: lineIdx + 1,
          });
        }
      } else {
        let val: bigint;
        try {
          val = BigInt(stripped);
        } catch {
          val = 2n;
        }
        if (val > 1n) {
          violations.push({
            category: 'engine-rust-magic-literal',
            path: rustPath,
            token: rawTok,
            line: lineIdx + 1,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * Evaluates all 6 permanent zero ceilings of `prism/parametric-ratchet/1` (`FI-08` / `AQ-23`).
 */
export function evaluateParametricRatchet(
  workspace: RatchetWorkspaceSnapshot,
): ParametricRatchetAuditReport {
  const parsed = parseParametricRatchetToml(workspace.ratchetToml);
  if (!parsed.config) {
    return {
      ok: false,
      spec: 'invalid',
      counts: {
        ontologyRootLiteralGtOneCount: 0,
        ontologyRootStringFieldCount: 0,
        classicalChoiceCount: 0,
        ungroundedLexModuleCount: 0,
        domainLexMagicLiteralCount: 0,
        engineRustMagicLiteralCount: 0,
      },
      ceilings: {
        max_ontology_root_literal_gt_one_count: 0,
        max_ontology_root_string_field_count: 0,
        max_classical_choice_count: 0,
        max_ungrounded_lex_module_count: 0,
        max_domain_lex_magic_literal_count: 0,
        max_engine_rust_magic_literal_count: 0,
      },
      groundedLexModuleCount: 0,
      auditedRustFileCount: 0,
      violations: [
        {
          category: 'config-schema',
          path: 'model/parametric-ratchet.toml',
          token: parsed.schemaError ?? 'invalid schema',
        },
      ],
      error: {
        kind: ParametricRatchetErrorKind.WeakenedNonZeroCeiling,
        capabilityId: 'AQ-23',
        refusalCode: 'refused:parametric-ratchet-schema-error',
        detail: parsed.schemaError ?? 'Invalid parametric-ratchet.toml schema',
      },
    };
  }

  const cfg = parsed.config;
  const violations: RatchetViolationDetail[] = [];

  if (cfg.spec !== RATCHET_SPEC_ID) {
    violations.push({
      category: 'config-schema',
      path: 'model/parametric-ratchet.toml',
      token: cfg.spec,
    });
  }

  for (const [k, v] of Object.entries(cfg.ceilings)) {
    if (v !== 0) {
      violations.push({
        category: 'ceiling-weakened',
        path: 'model/parametric-ratchet.toml',
        token: `${k}=${v}`,
      });
    }
  }

  const ontologyContent = workspace.lexFilesByPath[cfg.ontology_root];
  let ontologyRootLiteralGtOneCount = 0;
  let ontologyRootStringFieldCount = 0;

  if (!ontologyContent) {
    violations.push({
      category: 'ungrounded-lex-module',
      path: cfg.ontology_root,
      token: 'missing-ontology-root',
    });
  } else {
    const ontLits = scanLexMagicLiterals(cfg.ontology_root, ontologyContent);
    ontologyRootLiteralGtOneCount = ontLits.length;
    for (const v of ontLits) {
      violations.push({ ...v, category: 'ontology-literal-gt-one' });
    }
    const stringFieldMatches =
      ontologyContent.match(/type:\s*(?:String|\(\s*List\s+String\s*\))/g) ?? [];
    ontologyRootStringFieldCount = stringFieldMatches.length;
    for (const m of stringFieldMatches) {
      violations.push({
        category: 'ontology-string-field',
        path: cfg.ontology_root,
        token: m,
      });
    }
  }

  let classicalChoiceCount = 0;
  for (const [lexPath, content] of Object.entries(workspace.lexFilesByPath)) {
    const matches = content.match(/Classical\.choice/g);
    if (matches) {
      classicalChoiceCount += matches.length;
      for (const tok of matches) {
        violations.push({
          category: 'classical-choice',
          path: lexPath,
          token: tok,
        });
      }
    }
  }

  const diskLexPaths = new Set(Object.keys(workspace.lexFilesByPath));
  const groundedPaths = new Set<string>();
  let ungroundedLexModuleCount = 0;

  for (const sm of cfg.stratum_module) {
    if (
      sm.stratum < 0 ||
      sm.stratum > 7 ||
      !sm.role.trim() ||
      groundedPaths.has(sm.path) ||
      !diskLexPaths.has(sm.path)
    ) {
      ungroundedLexModuleCount += 1;
      violations.push({
        category: 'ungrounded-lex-module',
        path: sm.path,
        token: `stratum=${sm.stratum}`,
      });
    }
    groundedPaths.add(sm.path);
  }

  for (const diskPath of diskLexPaths) {
    if (!groundedPaths.has(diskPath)) {
      ungroundedLexModuleCount += 1;
      violations.push({
        category: 'ungrounded-lex-module',
        path: diskPath,
        token: 'unlisted-in-stratum_module',
      });
    }
  }

  let domainLexMagicLiteralCount = 0;
  for (const modPath of cfg.pure_zero_one_lex_modules) {
    const content = workspace.lexFilesByPath[modPath];
    if (!content) {
      domainLexMagicLiteralCount += 1;
      violations.push({
        category: 'domain-lex-magic-literal',
        path: modPath,
        token: 'missing-pure-lex-module',
      });
      continue;
    }
    const lits = scanLexMagicLiterals(modPath, content);
    domainLexMagicLiteralCount += lits.length;
    violations.push(...lits);
  }

  const rustRoots = [cfg.engine_rust_root, ...cfg.additional_rust_roots];
  let engineRustMagicLiteralCount = 0;
  let auditedRustFileCount = 0;

  for (const [rustPath, rustContent] of Object.entries(workspace.rustFilesByPath)) {
    if (rustRoots.some((root) => rustPath.startsWith(root))) {
      auditedRustFileCount += 1;
      const rustV = scanRustMagicLiterals(rustPath, rustContent);
      engineRustMagicLiteralCount += rustV.length;
      violations.push(...rustV);
    }
  }

  const ok =
    violations.length === 0 &&
    ontologyRootLiteralGtOneCount <= cfg.ceilings.max_ontology_root_literal_gt_one_count &&
    ontologyRootStringFieldCount <= cfg.ceilings.max_ontology_root_string_field_count &&
    classicalChoiceCount <= cfg.ceilings.max_classical_choice_count &&
    ungroundedLexModuleCount <= cfg.ceilings.max_ungrounded_lex_module_count &&
    domainLexMagicLiteralCount <= cfg.ceilings.max_domain_lex_magic_literal_count &&
    engineRustMagicLiteralCount <= cfg.ceilings.max_engine_rust_magic_literal_count;

  let error: ModeledAqmError | undefined;
  if (!ok) {
    const first = violations[0];
    const kind =
      first?.category === 'ceiling-weakened' || first?.category === 'config-schema'
        ? ParametricRatchetErrorKind.WeakenedNonZeroCeiling
        : first?.category === 'ontology-literal-gt-one' || first?.category === 'ontology-string-field'
          ? ParametricRatchetErrorKind.OntologyRootViolation
          : first?.category === 'classical-choice'
            ? ParametricRatchetErrorKind.ClassicalChoiceDetected
            : first?.category === 'ungrounded-lex-module'
              ? ParametricRatchetErrorKind.UngroundedLexModule
              : ParametricRatchetErrorKind.MagicLiteralDetected;

    error = {
      kind,
      capabilityId: 'AQ-23',
      refusalCode: 'refused:parametric-ratchet-magic-literal',
      detail: `FI-08 parametric ratchet refused ${violations.length} violation(s); first=${first?.category} at ${first?.path}${first?.line ? `:${first.line}` : ''} ('${first?.token}').`,
    };
  }

  return {
    ok,
    spec: cfg.spec,
    counts: {
      ontologyRootLiteralGtOneCount,
      ontologyRootStringFieldCount,
      classicalChoiceCount,
      ungroundedLexModuleCount,
      domainLexMagicLiteralCount,
      engineRustMagicLiteralCount,
    },
    ceilings: cfg.ceilings,
    groundedLexModuleCount: groundedPaths.size,
    auditedRustFileCount,
    violations,
    error,
  };
}

/**
 * Verifies that planting a defect into ANY of the 6 `prism/parametric-ratchet/1` zero ceilings
 * deterministically trips the ratchet and restores cleanly on baseline.
 */
export function verifyParametricRatchetPlantedDefects(
  baseWorkspace: RatchetWorkspaceSnapshot,
): {
  allCaughtAndRestored: boolean;
  casesVerified: number;
} {
  const baseline = evaluateParametricRatchet(baseWorkspace);
  if (!baseline.ok) {
    return { allCaughtAndRestored: false, casesVerified: 0 };
  }

  const ontPath = 'app/src/Foundation/Ontology/V1/Model.lex.tex';
  const ontBase = baseWorkspace.lexFilesByPath[ontPath] ?? '';

  const c1 = evaluateParametricRatchet({
    ...baseWorkspace,
    lexFilesByPath: {
      ...baseWorkspace.lexFilesByPath,
      [ontPath]: ontBase.replace(
        '\\end{semanticmodule}',
        '\\lexdef{badConst}{type: Nat, value: 42}\n\\end{semanticmodule}',
      ),
    },
  });

  const c2 = evaluateParametricRatchet({
    ...baseWorkspace,
    lexFilesByPath: {
      ...baseWorkspace.lexFilesByPath,
      [ontPath]: ontBase.replace(
        '\\end{semanticmodule}',
        '\\lexfield{badLabel}{of: ParametricQuantumCoordinates, type: String}\n\\end{semanticmodule}',
      ),
    },
  });

  const c3 = evaluateParametricRatchet({
    ...baseWorkspace,
    lexFilesByPath: {
      ...baseWorkspace.lexFilesByPath,
      'app/src/Quantum.lex.tex': `${baseWorkspace.lexFilesByPath['app/src/Quantum.lex.tex'] ?? ''}\n% Classical.choice forbidden\n`,
    },
  });

  const c4 = evaluateParametricRatchet({
    ...baseWorkspace,
    lexFilesByPath: {
      ...baseWorkspace.lexFilesByPath,
      'app/src/UngroundedShadow.lex.tex': '\\begin{semanticmodule}{Shadow}\n\\end{semanticmodule}\n',
    },
  });

  const c5 = evaluateParametricRatchet({
    ...baseWorkspace,
    rustFilesByPath: {
      ...baseWorkspace.rustFilesByPath,
      'crates/verdant-aqm/src/lib.rs': `${baseWorkspace.rustFilesByPath['crates/verdant-aqm/src/lib.rs'] ?? ''}\npub const CONTRIVED_CAP: usize = 28_usize;\n`,
    },
  });

  const c6 = evaluateParametricRatchet({
    ...baseWorkspace,
    ratchetToml: baseWorkspace.ratchetToml.replace(
      'max_engine_rust_magic_literal_count = 0',
      'max_engine_rust_magic_literal_count = 1',
    ),
  });

  const allCaught = !c1.ok && !c2.ok && !c3.ok && !c4.ok && !c5.ok && !c6.ok;
  return {
    allCaughtAndRestored: allCaught && baseline.ok,
    casesVerified: 6,
  };
}
