/**
 * Isolated Web Worker Verifier (`hologram:guest/core-wasm@1` contract, FR-01)
 * Keeps archive/model verification isolated off the UI main thread; only string/byte verdicts cross the boundary.
 */

import {
  PLANTED_DEFECT_CATALOG,
  dispatchCoreWasmQuery,
  runAllAcceptanceVectors,
  verifyAndCompileCircuitPrism,
} from './prismKernel';
import { sha256Hex } from './sha256';
import { verifyConstructiveRatchet } from './stratum0';
import { AqmCircuitSpec } from './types';

export type VerifierWorkerRequest =
  | { id: number; kind: 'init' }
  | { id: number; kind: 'dispatch'; request: string }
  | { id: number; kind: 'acceptance' }
  | { id: number; kind: 'verify-circuit'; spec: AqmCircuitSpec }
  | { id: number; kind: 'plant-defect'; defectId: string };

const ATTESTATION_DIGEST = sha256Hex(
  'verdant-aqm:hologram:guest/core-wasm@1:Quantum.lex.tex:zero-constants',
);

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<VerifierWorkerRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};

if (typeof self !== 'undefined' && typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = (event: MessageEvent<VerifierWorkerRequest>) => {
    const msg = event.data;
    try {
      if (msg.kind === 'init') {
        const ratchet = verifyConstructiveRatchet();
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: {
            contract: 'hologram:guest/core-wasm@1',
            verified: ratchet.valid,
            attestation: ATTESTATION_DIGEST,
            ratchetSummary: ratchet.summary,
          },
        });
      } else if (msg.kind === 'dispatch') {
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: dispatchCoreWasmQuery(msg.request),
        });
      } else if (msg.kind === 'acceptance') {
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: runAllAcceptanceVectors(),
        });
      } else if (msg.kind === 'verify-circuit') {
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: verifyAndCompileCircuitPrism(msg.spec),
        });
      } else if (msg.kind === 'plant-defect') {
        const entry = PLANTED_DEFECT_CATALOG.find((d) => d.id === msg.defectId);
        if (!entry) {
          workerScope.postMessage({
            id: msg.id,
            ok: false,
            error: `Unknown defect ID: ${msg.defectId}`,
          });
          return;
        }
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: entry.run(),
        });
      }
    } catch (err) {
      workerScope.postMessage({
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
