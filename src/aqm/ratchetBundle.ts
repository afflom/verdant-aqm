/**
 * Vite `?raw` Workspace Bundle for In-Browser `prism/parametric-ratchet/1` Inspection (`PrismVerifierPanel.tsx`).
 */

import architectureLexRaw from '@/app/src/Architecture.lex.tex?raw';
import complianceLexRaw from '@/app/src/Compliance.lex.tex?raw';
import designLexRaw from '@/app/src/Design.lex.tex?raw';
import featuresLexRaw from '@/app/src/Features.lex.tex?raw';
import foundationBytesLexRaw from '@/app/src/Foundation/Bytes.lex.tex?raw';
import ontologyRootLexRaw from '@/app/src/Foundation/Ontology/V1/Model.lex.tex?raw';
import honestyLexRaw from '@/app/src/Honesty.lex.tex?raw';
import qualityLexRaw from '@/app/src/Quality.lex.tex?raw';
import quantumLexRaw from '@/app/src/Quantum.lex.tex?raw';
import securityLexRaw from '@/app/src/Security.lex.tex?raw';
import rustLibRaw from '@/crates/verdant-aqm/src/lib.rs?raw';
import rustUorcRaw from '@/crates/verdant-aqm/src/uorc.rs?raw';
import ratchetTomlRaw from '@/model/parametric-ratchet.toml?raw';

import { RatchetWorkspaceSnapshot } from './ratchet';

export {
  foundationBytesLexRaw,
  ontologyRootLexRaw,
  ratchetTomlRaw,
  rustUorcRaw,
};

export const BUNDLED_RATCHET_WORKSPACE: RatchetWorkspaceSnapshot = {
  ratchetToml: ratchetTomlRaw,
  lexFilesByPath: {
    'app/src/Foundation/Ontology/V1/Model.lex.tex': ontologyRootLexRaw,
    'app/src/Foundation/Bytes.lex.tex': foundationBytesLexRaw,
    'app/src/Quantum.lex.tex': quantumLexRaw,
    'app/src/Architecture.lex.tex': architectureLexRaw,
    'app/src/Design.lex.tex': designLexRaw,
    'app/src/Features.lex.tex': featuresLexRaw,
    'app/src/Security.lex.tex': securityLexRaw,
    'app/src/Quality.lex.tex': qualityLexRaw,
    'app/src/Compliance.lex.tex': complianceLexRaw,
    'app/src/Honesty.lex.tex': honestyLexRaw,
  },
  rustFilesByPath: {
    'crates/verdant-aqm/src/lib.rs': rustLibRaw,
    'crates/verdant-aqm/src/uorc.rs': rustUorcRaw,
  },
};
