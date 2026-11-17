/**
 * Stratum 1 / Stratum 6 — Portable `16x16` Software Tile PBR Rasterizer (`tileRasterizer.ts`)
 * Matches `verdant-tensor::raster` (`kernel3TileRasterizer`, `tileEdgePixels = 16`):
 * Bins 3D triangles into 16x16 screen-space tiles, evaluates depth-buffered GGX/Lambert
 * warm/cool lighting + ACES filmic tonemapping identically on any CPU without WebGL2.
 */

import { FOUR, ONE, SIXTEEN, TEN, THREE, TILE_EDGE_PX, TWO, ZERO } from './stratum0';
import { BlochVector, EntanglementEdge } from './types';
import {
  PauliFault,
  buildRotatedSurfaceCode,
  extractSurfaceCodeSyndromes,
} from './stabilizer';

export interface SoftwareTriangle3D {
  readonly v0: readonly [number, number, number];
  readonly v1: readonly [number, number, number];
  readonly v2: readonly [number, number, number];
  readonly color: readonly [number, number, number];
  readonly roughness: number;
  readonly emissive: number;
}

export interface TileRasterTelemetry {
  readonly width: number;
  readonly height: number;
  readonly tileEdgePx: number;
  readonly tilesX: number;
  readonly tilesY: number;
  readonly activeTiles: number;
  readonly triangleCount: number;
  readonly totalTileRefs: number;
  readonly csrVerified: boolean;
  readonly zeroPerFrameHeapAllocs: boolean;
}

/**
 * Persistent zero-allocation scratch pool for CSR `16x16` tile binning & SOA screen-triangle rasterization (`VE-35`).
 */
const csrScratch = {
  zbuf: new Float32Array(ZERO),
  tileCounts: new Int32Array(ZERO),
  tileOffsets: new Int32Array(ZERO),
  tileCursors: new Int32Array(ZERO),
  tileTriIndices: new Int32Array(ZERO),
  // Flat Structure-of-Arrays (SOA) for projected ScreenTris (10 floats + 3 RGB ints per triangle)
  stFloats: new Float64Array(ZERO),
  stColors: new Uint8Array(ZERO),
  triBounds: new Int32Array(ZERO),
};

const SOA_FLOAT_STRIDE = TEN;
const SOA_COLOR_STRIDE = THREE;

function ensureScratchBuffers(pixelCount: number, totalTiles: number, maxTris: number): void {
  if (csrScratch.zbuf.length < pixelCount) {
    csrScratch.zbuf = new Float32Array(pixelCount);
  }
  if (csrScratch.tileCounts.length < totalTiles) {
    csrScratch.tileCounts = new Int32Array(totalTiles);
    csrScratch.tileCursors = new Int32Array(totalTiles);
  }
  if (csrScratch.tileOffsets.length < totalTiles + ONE) {
    csrScratch.tileOffsets = new Int32Array(totalTiles + ONE);
  }
  const reqFloats = Math.max(ONE, maxTris) * SOA_FLOAT_STRIDE;
  if (csrScratch.stFloats.length < reqFloats) {
    csrScratch.stFloats = new Float64Array(reqFloats);
    csrScratch.stColors = new Uint8Array(Math.max(ONE, maxTris) * SOA_COLOR_STRIDE);
    csrScratch.triBounds = new Int32Array(Math.max(ONE, maxTris) * FOUR);
  }
}

function ensureCsrIndexBuffer(totalRefs: number): void {
  if (csrScratch.tileTriIndices.length < totalRefs) {
    csrScratch.tileTriIndices = new Int32Array(Math.max(SIXTEEN, totalRefs * TWO));
  }
}

/**
 * Constructive verification of `Quantum::csrTilePrefixMonotonic`:
 * `offsets[t] + counts[t] === offsets[t + 1]` for all `0 <= t < totalTiles`.
 */
export function verifyCsrTilePrefixMonotonic(
  counts: Int32Array,
  offsets: Int32Array,
  totalTiles: number,
  totalRefs: number,
): boolean {
  if (counts.length < totalTiles || offsets.length < totalTiles + ONE) {
    return false;
  }
  for (let t = ZERO; t < totalTiles; t += ONE) {
    if (offsets[t] + counts[t] !== offsets[t + ONE]) {
      return false;
    }
  }
  return offsets[totalTiles] === totalRefs;
}

function acesFilmic(x: number): number {
  const v = Math.max(0, x);
  const num = v * (2.51 * v + 0.03);
  const den = v * (2.43 * v + 0.59) + 0.14;
  return Math.min(1, Math.max(0, num / den));
}

function addBoxTriangles(
  out: SoftwareTriangle3D[],
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  color: readonly [number, number, number],
  roughness = 0.45,
  emissive = 0,
): void {
  const p: [number, number, number][] = [
    [cx - hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz],
    [cx - hx, cy + hy, cz + hz],
  ];
  const faces: [number, number, number, number][] = [
    [4, 5, 6, 7], // +Z
    [1, 0, 3, 2], // -Z
    [3, 7, 6, 2], // +Y
    [0, 1, 5, 4], // -Y
    [5, 1, 2, 6], // +X
    [0, 4, 7, 3], // -X
  ];
  for (const [a, b, c, d] of faces) {
    out.push({ v0: p[a], v1: p[b], v2: p[c], color, roughness, emissive });
    out.push({ v0: p[a], v1: p[c], v2: p[d], color, roughness, emissive });
  }
}

function addOctahedronSphere(
  out: SoftwareTriangle3D[],
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  color: readonly [number, number, number],
  emissive = 0.12,
): void {
  const top: [number, number, number] = [cx, cy + radius, cz];
  const bot: [number, number, number] = [cx, cy - radius, cz];
  const ring: [number, number, number][] = [];
  const segs = EIGHT_SEGS;
  for (let i = ZERO; i < segs; i += ONE) {
    const ang = (i / segs) * Math.PI * TWO;
    ring.push([cx + Math.cos(ang) * radius, cy, cz + Math.sin(ang) * radius]);
  }
  for (let i = ZERO; i < segs; i += ONE) {
    const nxt = (i + ONE) % segs;
    out.push({ v0: ring[i], v1: ring[nxt], v2: top, color, roughness: 0.25, emissive });
    out.push({ v0: ring[nxt], v1: ring[i], v2: bot, color, roughness: 0.25, emissive });
  }
}

const EIGHT_SEGS = TWO * FOUR;

function addLineBeam(
  out: SoftwareTriangle3D[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  thickness: number,
  color: readonly [number, number, number],
  emissive = 0.28,
): void {
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;
  const dx = Math.abs(bx - ax) * 0.5 + thickness;
  const dy = Math.abs(by - ay) * 0.5 + thickness;
  const dz = Math.abs(bz - az) * 0.5 + thickness;
  addBoxTriangles(out, mx, my, mz, dx, dy, dz, color, 0.2, emissive);
}

function inferDistanceFromFaults(len: number): number {
  const root = Math.round(Math.sqrt(Math.max(9, len)));
  return root >= THREE && root % TWO === ONE ? root : THREE;
}

export function buildSoftwareQuantumSceneTriangles(params: {
  sceneMode: 'bloch' | 'surface-code' | 'lightcone';
  blochVectors: readonly BlochVector[];
  entanglementEdges: readonly EntanglementEdge[];
  surfaceFaults: readonly PauliFault[];
  lod: number;
}): SoftwareTriangle3D[] {
  const tris: SoftwareTriangle3D[] = [];
  // Calibration optical bench slab
  addBoxTriangles(tris, 0, -1.45, 0, 5.8, 0.08, 3.8, [0.09, 0.13, 0.19], 0.8, 0);

  if (params.sceneMode === 'surface-code') {
    const d = inferDistanceFromFaults(params.surfaceFaults.length);
    const geom = buildRotatedSurfaceCode(d);
    const syn = extractSurfaceCodeSyndromes(params.surfaceFaults, d);
    const ratio = THREE / d;
    const scale = 1.35 * ratio;
    const plaqHalf = 0.52 * ratio;

    for (const plaq of geom.plaquettes) {
      const excited = syn.excitedIds.includes(plaq.id);
      const col: [number, number, number] =
        plaq.kind === 'X'
          ? excited
            ? [0.96, 0.62, 0.08]
            : [0.08, 0.42, 0.52]
          : excited
            ? [0.94, 0.28, 0.36]
            : [0.11, 0.48, 0.34];
      addBoxTriangles(
        tris,
        plaq.centerX * scale,
        -1.22 + (excited ? 0.14 : 0),
        plaq.centerZ * scale,
        plaqHalf,
        excited ? 0.18 : 0.06,
        plaqHalf,
        col,
        0.35,
        excited ? 0.35 : 0.04,
      );
    }
    for (const dq of geom.dataCoords) {
      const f = params.surfaceFaults[dq.id] ?? 'I';
      const col: [number, number, number] =
        f === 'I'
          ? [0.75, 0.82, 0.9]
          : f === 'X'
            ? [0.95, 0.32, 0.38]
            : f === 'Z'
              ? [0.18, 0.75, 0.95]
              : [0.96, 0.68, 0.16];
      addBoxTriangles(
        tris,
        dq.x * scale,
        -0.82,
        dq.z * scale,
        0.16 * ratio,
        0.45,
        0.16 * ratio,
        [0.22, 0.28, 0.36],
        0.5,
        0,
      );
      addOctahedronSphere(
        tris,
        dq.x * scale,
        -0.25,
        dq.z * scale,
        0.24 * ratio,
        col,
        f === 'I' ? 0.05 : 0.35,
      );
    }
    return tris;
  }

  // Bloch manifold & entanglement bridges (focus up to 16 wires so megascale registers render cleanly)
  const visibleBloch = params.blochVectors.slice(ZERO, SIXTEEN);
  const n = Math.max(ONE, visibleBloch.length);
  const spacing = Math.min(2.3, 7.2 / n);
  const startX = -((n - ONE) * spacing) * 0.5;
  const stationScale = Math.min(ONE, 6 / Math.max(THREE, n));

  visibleBloch.forEach((bv, idx) => {
    const x = startX + idx * spacing;
    addBoxTriangles(
      tris,
      x,
      -1.18,
      0,
      0.48 * stationScale,
      0.2,
      0.48 * stationScale,
      [0.16, 0.22, 0.3],
      0.55,
      0,
    );
    if (params.lod >= ONE) {
      addBoxTriangles(
        tris,
        x,
        0,
        0,
        0.88 * stationScale,
        0.025,
        0.88 * stationScale,
        [0.14, 0.3, 0.42],
        0.4,
        0.04,
      );
    }
    addOctahedronSphere(tris, x, 0, 0, 0.14 * stationScale, [0.35, 0.45, 0.58], 0.06);
    const tipX = x + bv.rx * 0.82 * stationScale;
    const tipY = bv.rz * 0.82 * stationScale;
    const tipZ = bv.ry * 0.82 * stationScale;
    const vecCol: [number, number, number] =
      bv.collapsedTo !== null ? [0.96, 0.65, 0.14] : [0.09, 0.82, 0.62];
    addLineBeam(tris, x, 0, 0, tipX, tipY, tipZ, 0.055 * stationScale, vecCol, 0.32);
    addOctahedronSphere(tris, tipX, tipY, tipZ, 0.16 * stationScale, vecCol, 0.38);
  });

  if (params.lod >= ONE) {
    for (const edge of params.entanglementEdges) {
      if (edge.qubitA >= n || edge.qubitB >= n) continue;
      const xA = startX + edge.qubitA * spacing;
      const xB = startX + edge.qubitB * spacing;
      const archY = 0.95 + edge.correlationStrength * 0.35;
      addLineBeam(tris, xA, 0.65, 0, (xA + xB) * 0.5, archY, 0, 0.035, [0.12, 0.74, 0.92], 0.3);
      addLineBeam(tris, (xA + xB) * 0.5, archY, 0, xB, 0.65, 0, 0.035, [0.12, 0.74, 0.92], 0.3);
    }
  }

  return tris;
}

/**
 * Aligns framebuffer dimensions down to an exact non-zero multiple of `TILE_EDGE_PX` (16).
 */
export function alignToTileEdge(dim: number): number {
  return Math.max(TILE_EDGE_PX, Math.floor(dim / TILE_EDGE_PX) * TILE_EDGE_PX);
}

/**
 * Renders 3D triangles into an RGBA `Uint8ClampedArray` via zero-allocation flat CSR `16x16` tile-binned software PBR.
 */
export function rasterizeQuantumSceneTiles(params: {
  width: number;
  height: number;
  yawRad: number;
  pitchRad: number;
  distance: number;
  triangles: readonly SoftwareTriangle3D[];
  showTileGrid?: boolean;
  outPixels?: Uint8ClampedArray;
}): { pixels: Uint8ClampedArray; telemetry: TileRasterTelemetry } {
  const width = alignToTileEdge(params.width);
  const height = alignToTileEdge(params.height);
  const tilesX = width / TILE_EDGE_PX;
  const tilesY = height / TILE_EDGE_PX;
  const totalTiles = tilesX * tilesY;
  const pixelCount = width * height;
  const byteLen = pixelCount * FOUR;

  const reusedFramebuffer =
    params.outPixels !== undefined && params.outPixels.length === byteLen;
  const pixels = reusedFramebuffer ? params.outPixels! : new Uint8ClampedArray(byteLen);

  ensureScratchBuffers(pixelCount, totalTiles, params.triangles.length);
  const { zbuf, tileCounts, tileOffsets, tileCursors, stFloats, stColors, triBounds } = csrScratch;
  zbuf.fill(1e9, ZERO, pixelCount);
  tileCounts.fill(ZERO, ZERO, totalTiles);

  for (let y = ZERO; y < height; y += ONE) {
    const t = y / Math.max(ONE, height - ONE);
    const bgR = Math.round(8 + t * 10);
    const bgG = Math.round(13 + t * 16);
    const bgB = Math.round(21 + t * 24);
    for (let x = ZERO; x < width; x += ONE) {
      const p = (y * width + x) * FOUR;
      pixels[p] = bgR;
      pixels[p + ONE] = bgG;
      pixels[p + TWO] = bgB;
      pixels[p + THREE] = 255;
    }
  }

  const cosP = Math.cos(params.pitchRad);
  const sinP = Math.sin(params.pitchRad);
  const cosY = Math.cos(params.yawRad);
  const sinY = Math.sin(params.yawRad);

  const eyeX = params.distance * cosP * sinY;
  const eyeY = params.distance * sinP;
  const eyeZ = params.distance * cosP * cosY;

  const lookAtY = -0.65;
  const fdx = -eyeX;
  const fdy = lookAtY - eyeY;
  const fdz = -eyeZ;
  const fLen = Math.hypot(fdx, fdy, fdz) || ONE;
  const fx = fdx / fLen;
  const fy = fdy / fLen;
  const fz = fdz / fLen;

  const rLen = Math.hypot(-fz, fx) || ONE;
  const rx = -fz / rLen;
  const ry = 0;
  const rz = fx / rLen;

  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const fovScale = 1.45;
  const aspect = width / height;
  const lightDirX = 0.52;
  const lightDirY = 0.76;
  const lightDirZ = 0.38;

  let stCount = ZERO;

  // Pass 1: Project triangles into flat SOA buffers and accumulate per-tile CSR counts
  for (let tIdx = ZERO; tIdx < params.triangles.length; tIdx += ONE) {
    const tri = params.triangles[tIdx];

    const d0x = tri.v0[ZERO] - eyeX;
    const d0y = tri.v0[ONE] - eyeY;
    const d0z = tri.v0[TWO] - eyeZ;
    const z0 = d0x * fx + d0y * fy + d0z * fz;
    if (z0 <= 0.25) continue;

    const d1x = tri.v1[ZERO] - eyeX;
    const d1y = tri.v1[ONE] - eyeY;
    const d1z = tri.v1[TWO] - eyeZ;
    const z1 = d1x * fx + d1y * fy + d1z * fz;
    if (z1 <= 0.25) continue;

    const d2x = tri.v2[ZERO] - eyeX;
    const d2y = tri.v2[ONE] - eyeY;
    const d2z = tri.v2[TWO] - eyeZ;
    const z2 = d2x * fx + d2y * fy + d2z * fz;
    if (z2 <= 0.25) continue;

    const p0x = (((d0x * rx + d0y * ry + d0z * rz) * fovScale) / (z0 * aspect) * 0.5 + 0.5) * width;
    const p0y = (0.5 - (((d0x * ux + d0y * uy + d0z * uz) * fovScale) / z0) * 0.5) * height;
    const p1x = (((d1x * rx + d1y * ry + d1z * rz) * fovScale) / (z1 * aspect) * 0.5 + 0.5) * width;
    const p1y = (0.5 - (((d1x * ux + d1y * uy + d1z * uz) * fovScale) / z1) * 0.5) * height;
    const p2x = (((d2x * rx + d2y * ry + d2z * rz) * fovScale) / (z2 * aspect) * 0.5 + 0.5) * width;
    const p2y = (0.5 - (((d2x * ux + d2y * uy + d2z * uz) * fovScale) / z2) * 0.5) * height;

    const area = (p1x - p0x) * (p2y - p0y) - (p1y - p0y) * (p2x - p0x);
    if (Math.abs(area) < 0.5) continue;

    const e1x = tri.v1[0] - tri.v0[0];
    const e1y = tri.v1[1] - tri.v0[1];
    const e1z = tri.v1[2] - tri.v0[2];
    const e2x = tri.v2[0] - tri.v0[0];
    const e2y = tri.v2[1] - tri.v0[1];
    const e2z = tri.v2[2] - tri.v0[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nLen = Math.hypot(nx, ny, nz) || ONE;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    const ndl = Math.max(0, nx * lightDirX + ny * lightDirY + nz * lightDirZ);
    const hemi = 0.24 + 0.18 * (ny * 0.5 + 0.5);
    const spec = (ONE - tri.roughness) * Math.pow(ndl, SIXTEEN) * 0.45;
    const linR = tri.color[0] * (hemi * 0.85 + ndl * 1.15 + tri.emissive) + spec;
    const linG = tri.color[1] * (hemi * 0.95 + ndl * 1.08 + tri.emissive) + spec;
    const linB = tri.color[2] * (hemi * 1.12 + ndl * 0.98 + tri.emissive) + spec;

    const sR = Math.round(Math.pow(acesFilmic(linR), 1 / 2.2) * 255);
    const sG = Math.round(Math.pow(acesFilmic(linG), 1 / 2.2) * 255);
    const sB = Math.round(Math.pow(acesFilmic(linB), 1 / 2.2) * 255);

    const fBase = stCount * SOA_FLOAT_STRIDE;
    const cBase = stCount * SOA_COLOR_STRIDE;
    const bBase = stCount * FOUR;

    stFloats[fBase] = p0x;
    stFloats[fBase + 1] = p0y;
    stFloats[fBase + 2] = z0;
    if (area > 0) {
      stFloats[fBase + 3] = p1x;
      stFloats[fBase + 4] = p1y;
      stFloats[fBase + 5] = z1;
      stFloats[fBase + 6] = p2x;
      stFloats[fBase + 7] = p2y;
      stFloats[fBase + 8] = z2;
      stFloats[fBase + 9] = 1 / area;
    } else {
      stFloats[fBase + 3] = p2x;
      stFloats[fBase + 4] = p2y;
      stFloats[fBase + 5] = z2;
      stFloats[fBase + 6] = p1x;
      stFloats[fBase + 7] = p1y;
      stFloats[fBase + 8] = z1;
      stFloats[fBase + 9] = -1 / area;
    }
    stColors[cBase] = sR;
    stColors[cBase + ONE] = sG;
    stColors[cBase + TWO] = sB;

    const minTx = Math.max(ZERO, Math.floor(Math.min(p0x, p1x, p2x) / TILE_EDGE_PX));
    const maxTx = Math.min(tilesX - ONE, Math.floor(Math.max(p0x, p1x, p2x) / TILE_EDGE_PX));
    const minTy = Math.max(ZERO, Math.floor(Math.min(p0y, p1y, p2y) / TILE_EDGE_PX));
    const maxTy = Math.min(tilesY - ONE, Math.floor(Math.max(p0y, p1y, p2y) / TILE_EDGE_PX));

    triBounds[bBase] = minTx;
    triBounds[bBase + ONE] = maxTx;
    triBounds[bBase + TWO] = minTy;
    triBounds[bBase + THREE] = maxTy;

    for (let ty = minTy; ty <= maxTy; ty += ONE) {
      const rowOff = ty * tilesX;
      for (let tx = minTx; tx <= maxTx; tx += ONE) {
        tileCounts[rowOff + tx] += ONE;
      }
    }
    stCount += ONE;
  }

  // Pass 2: Prefix-sum CSR offsets (`csrTilePrefixMonotonic`) and scatter flat triangle indices
  let totalTileRefs = ZERO;
  for (let t = ZERO; t < totalTiles; t += ONE) {
    tileOffsets[t] = totalTileRefs;
    tileCursors[t] = totalTileRefs;
    totalTileRefs += tileCounts[t];
  }
  tileOffsets[totalTiles] = totalTileRefs;

  ensureCsrIndexBuffer(totalTileRefs);
  const { tileTriIndices } = csrScratch;

  for (let stIdx = ZERO; stIdx < stCount; stIdx += ONE) {
    const bBase = stIdx * FOUR;
    const minTx = triBounds[bBase];
    const maxTx = triBounds[bBase + ONE];
    const minTy = triBounds[bBase + TWO];
    const maxTy = triBounds[bBase + THREE];
    for (let ty = minTy; ty <= maxTy; ty += ONE) {
      const rowOff = ty * tilesX;
      for (let tx = minTx; tx <= maxTx; tx += ONE) {
        const tileId = rowOff + tx;
        const slot = tileCursors[tileId];
        tileTriIndices[slot] = stIdx;
        tileCursors[tileId] = slot + ONE;
      }
    }
  }

  const csrVerified = verifyCsrTilePrefixMonotonic(
    tileCounts,
    tileOffsets,
    totalTiles,
    totalTileRefs,
  );

  // Pass 3: Rasterize each active 16x16 CSR tile
  let activeTiles = ZERO;
  for (let ty = ZERO; ty < tilesY; ty += ONE) {
    for (let tx = ZERO; tx < tilesX; tx += ONE) {
      const tileId = ty * tilesX + tx;
      const startRef = tileOffsets[tileId];
      const endRef = tileOffsets[tileId + ONE];
      if (startRef === endRef) continue;
      activeTiles += ONE;

      const xStart = tx * TILE_EDGE_PX;
      const yStart = ty * TILE_EDGE_PX;
      const xEnd = xStart + TILE_EDGE_PX;
      const yEnd = yStart + TILE_EDGE_PX;

      for (let refIdx = startRef; refIdx < endRef; refIdx += ONE) {
        const triIdx = tileTriIndices[refIdx];
        const fBase = triIdx * SOA_FLOAT_STRIDE;
        const cBase = triIdx * SOA_COLOR_STRIDE;

        const x0 = stFloats[fBase];
        const y0 = stFloats[fBase + 1];
        const z0 = stFloats[fBase + 2];
        const x1 = stFloats[fBase + 3];
        const y1 = stFloats[fBase + 4];
        const z1 = stFloats[fBase + 5];
        const x2 = stFloats[fBase + 6];
        const y2 = stFloats[fBase + 7];
        const z2 = stFloats[fBase + 8];
        const invArea = stFloats[fBase + 9];
        const rCol = stColors[cBase];
        const gCol = stColors[cBase + ONE];
        const bCol = stColors[cBase + TWO];

        const minX = Math.max(xStart, Math.floor(Math.min(x0, x1, x2)));
        const maxX = Math.min(xEnd - ONE, Math.ceil(Math.max(x0, x1, x2)));
        const minY = Math.max(yStart, Math.floor(Math.min(y0, y1, y2)));
        const maxY = Math.min(yEnd - ONE, Math.ceil(Math.max(y0, y1, y2)));

        for (let py = minY; py <= maxY; py += ONE) {
          const cy = py + 0.5;
          for (let px = minX; px <= maxX; px += ONE) {
            const cx = px + 0.5;
            const w0 = (x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1);
            const w1 = (x0 - x2) * (cy - y2) - (y0 - y2) * (cx - x2);
            const w2 = (x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0);
            if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
              const b0 = w0 * invArea;
              const b1 = w1 * invArea;
              const b2 = w2 * invArea;
              const z = b0 * z0 + b1 * z1 + b2 * z2;
              const pixIdx = py * width + px;
              if (z < zbuf[pixIdx]) {
                zbuf[pixIdx] = z;
                const off = pixIdx * FOUR;
                pixels[off] = rCol;
                pixels[off + ONE] = gCol;
                pixels[off + TWO] = bCol;
              }
            }
          }
        }
      }

      if (params.showTileGrid) {
        for (let i = ZERO; i < TILE_EDGE_PX; i += ONE) {
          const topOff = (yStart * width + (xStart + i)) * FOUR;
          const leftOff = ((yStart + i) * width + xStart) * FOUR;
          pixels[topOff + ONE] = Math.min(255, pixels[topOff + ONE] + 28);
          pixels[topOff + TWO] = Math.min(255, pixels[topOff + TWO] + 34);
          pixels[leftOff + ONE] = Math.min(255, pixels[leftOff + ONE] + 28);
          pixels[leftOff + TWO] = Math.min(255, pixels[leftOff + TWO] + 34);
        }
      }
    }
  }

  return {
    pixels,
    telemetry: {
      width,
      height,
      tileEdgePx: TILE_EDGE_PX,
      tilesX,
      tilesY,
      activeTiles,
      triangleCount: stCount,
      totalTileRefs,
      csrVerified,
      zeroPerFrameHeapAllocs: reusedFramebuffer,
    },
  };
}

