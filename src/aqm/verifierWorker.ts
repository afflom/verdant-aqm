/**
 * Isolated Web Worker Verifier (`hologram:guest/core-wasm@1` contract, FR-01 / AQ-15)
 * Assembles, BLAKE3-verifies, compiles via `WebAssembly.compile`, and executes the REAL zero-import
 * `wasm32` `VerdantAqm.holo` v4 guest (`holo_alloc` + `holo_run`) inside an isolated Web Worker!
 */

import {
  CoreWasmGuestExports,
  buildVerdantAqmHoloArchive,
  instantiateHoloCoreWasmGuest,
  parseAndVerifyHoloV4Archive,
  runHoloCoreWasmGuest,
} from './holoGuest';
import {
  CORE_WASM_ACCEPTANCE_VECTORS,
  PLANTED_DEFECT_CATALOG,
  verifyAndCompileCircuitPrism,
} from './prismKernel';
import { verifyConstructiveRatchet } from './stratum0';
import { AqmCircuitSpec } from './types';

export type VerifierWorkerRequest =
  | { id: number; kind: 'init' }
  | { id: number; kind: 'dispatch'; request: string }
  | { id: number; kind: 'acceptance' }
  | { id: number; kind: 'verify-circuit'; spec: AqmCircuitSpec }
  | { id: number; kind: 'plant-defect'; defectId: string };

export interface WorkerHoloBootSummary {
  readonly contract: string;
  readonly verified: boolean;
  readonly attestation: string;
  readonly ratchetSummary: string;
  readonly holoVersion: number;
  readonly archiveBytesLength: number;
  readonly wasmBytesLength: number;
  readonly wasmKappa: string;
  readonly requiresKappa: string;
  readonly viewKappa: string;
  readonly zeroImportsVerified: boolean;
  readonly exportedSymbols: readonly string[];
}

let cachedGuestPromise: Promise<{
  guest: CoreWasmGuestExports;
  summary: WorkerHoloBootSummary;
}> | null = null;

function ensureHoloGuestReady(): Promise<{
  guest: CoreWasmGuestExports;
  summary: WorkerHoloBootSummary;
}> {
  if (!cachedGuestPromise) {
    cachedGuestPromise = (async () => {
      const ratchet = verifyConstructiveRatchet();
      const built = buildVerdantAqmHoloArchive('VerdantAqm@0.3.0:8-facets:AQ-01..AQ-23');
      const report = await parseAndVerifyHoloV4Archive(built.archiveBytes);
      const guest = await instantiateHoloCoreWasmGuest(report.wasmBytes);

      return {
        guest,
        summary: {
          contract: 'hologram:guest/core-wasm@1',
          verified: ratchet.valid && report.valid,
          attestation: report.archiveFingerprint,
          ratchetSummary: ratchet.summary,
          holoVersion: report.version,
          archiveBytesLength: report.byteLength,
          wasmBytesLength: report.wasmBytes.byteLength,
          wasmKappa: report.wasmKappa,
          requiresKappa: report.requiresKappa,
          viewKappa: report.viewKappa,
          zeroImportsVerified: report.zeroImportsVerified,
          exportedSymbols: report.exportedSymbols,
        },
      };
    })();
  }
  return cachedGuestPromise;
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<VerifierWorkerRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};

if (typeof self !== 'undefined' && typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = async (event: MessageEvent<VerifierWorkerRequest>) => {
    const msg = event.data;
    try {
      const { guest, summary } = await ensureHoloGuestReady();

      if (msg.kind === 'init') {
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: summary,
        });
      } else if (msg.kind === 'dispatch') {
        // Execute every static and parameterized `aqm:eval:*` query directly inside the compiled zero-import `wasm32` guest (`holo_alloc` + `holo_run`)
        const finalOut = runHoloCoreWasmGuest(guest, msg.request);
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: finalOut,
        });
      } else if (msg.kind === 'acceptance') {
        const results = CORE_WASM_ACCEPTANCE_VECTORS.map((vec) => {
          const actual = runHoloCoreWasmGuest(guest, vec.request);
          return {
            request: vec.request,
            expected: vec.expectedResponse,
            actual,
            passed: actual === vec.expectedResponse,
          };
        });
        const passed = results.filter((r) => r.passed).length;
        workerScope.postMessage({
          id: msg.id,
          ok: true,
          value: {
            passed,
            total: results.length,
            executedViaWasmGuest: true,
            results,
          },
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
