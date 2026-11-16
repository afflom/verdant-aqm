/**
 * Stratum 1 / Stratum 6 — Portable `16x16` Software Tile PBR Rasterizer (`tileRasterizer.ts`)
 * Matches `verdant-tensor::raster` (`kernel3TileRasterizer`, `tileEdgePixels = 16`):
 * Bins 3D triangles into 16x16 screen-space tiles, evaluates depth-buffered GGX/Lambert
 * warm/cool lighting + ACES filmic tonemapping identically on any CPU without WebGL2.
 */

import { FOUR, ONE, SIXTEEN, THREE, TILE_EDGE_PX, TWO, ZERO } from './stratum0';
import { BlochVector, EntanglementEdge } from './types';
import {
  PauliFault,
  SURFACE_CODE_DATA_COORDS,
  SURFACE_CODE_PLAQUETTES,
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
}

interface ScreenTri {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  invArea: number;
  r: number;
  g: number;
  b: number;
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
    const syn = extractSurfaceCodeSyndromes(params.surfaceFaults);
    const scale = 1.35;
    for (const plaq of SURFACE_CODE_PLAQUETTES) {
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
        0.52,
        excited ? 0.18 : 0.06,
        0.52,
        col,
        0.35,
        excited ? 0.35 : 0.04,
      );
    }
    for (const dq of SURFACE_CODE_DATA_COORDS) {
      const f = params.surfaceFaults[dq.id] ?? 'I';
      const col: [number, number, number] =
        f === 'I'
          ? [0.75, 0.82, 0.9]
          : f === 'X'
            ? [0.95, 0.32, 0.38]
            : f === 'Z'
              ? [0.18, 0.75, 0.95]
              : [0.96, 0.68, 0.16];
      addBoxTriangles(tris, dq.x * scale, -0.82, dq.z * scale, 0.16, 0.45, 0.16, [0.22, 0.28, 0.36], 0.5, 0);
      addOctahedronSphere(
        tris,
        dq.x * scale,
        -0.25,
        dq.z * scale,
        0.24,
        col,
        f === 'I' ? 0.05 : 0.35,
      );
    }
    return tris;
  }

  // Bloch manifold & entanglement bridges
  const n = Math.max(ONE, params.blochVectors.length);
  const spacing = Math.min(2.3, 7.2 / n);
  const startX = -((n - ONE) * spacing) * 0.5;

  params.blochVectors.forEach((bv, idx) => {
    const x = startX + idx * spacing;
    // Pedestal base
    addBoxTriangles(tris, x, -1.18, 0, 0.48, 0.2, 0.48, [0.16, 0.22, 0.3], 0.55, 0);
    // Equatorial frame rails
    if (params.lod >= ONE) {
      addBoxTriangles(tris, x, 0, 0, 0.88, 0.025, 0.88, [0.14, 0.3, 0.42], 0.4, 0.04);
    }
    // Core hub
    addOctahedronSphere(tris, x, 0, 0, 0.14, [0.35, 0.45, 0.58], 0.06);
    // Bloch state tip (Three.js +Y = Z_bloch, +X = X_bloch, +Z = Y_bloch)
    const tipX = x + bv.rx * 0.82;
    const tipY = bv.rz * 0.82;
    const tipZ = bv.ry * 0.82;
    const vecCol: [number, number, number] =
      bv.collapsedTo !== null
        ? [0.96, 0.65, 0.14]
        : [0.09, 0.82, 0.62];
    addLineBeam(tris, x, 0, 0, tipX, tipY, tipZ, 0.055, vecCol, 0.32);
    addOctahedronSphere(tris, tipX, tipY, tipZ, 0.16, vecCol, 0.38);
  });

  if (params.lod >= ONE) {
    for (const edge of params.entanglementEdges) {
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
 * Renders 3D triangles into an RGBA `Uint8ClampedArray` via `16x16` tile-binned software PBR.
 */
export function rasterizeQuantumSceneTiles(params: {
  width: number;
  height: number;
  yawRad: number;
  pitchRad: number;
  distance: number;
  triangles: readonly SoftwareTriangle3D[];
  showTileGrid?: boolean;
}): { pixels: Uint8ClampedArray; telemetry: TileRasterTelemetry } {
  const width = alignToTileEdge(params.width);
  const height = alignToTileEdge(params.height);
  const tilesX = width / TILE_EDGE_PX;
  const tilesY = height / TILE_EDGE_PX;
  const totalTiles = tilesX * tilesY;

  const pixels = new Uint8ClampedArray(width * height * FOUR);
  const zbuf = new Float32Array(width * height).fill(1e9);

  // Fill deep obsidian horizon gradient background
  for (let y = ZERO; y < height; y += ONE) {
    const t = y / Math.max(ONE, height - ONE);
    const bgR = Math.round((8 + t * 10));
    const bgG = Math.round((13 + t * 16));
    const bgB = Math.round((21 + t * 24));
    for (let x = ZERO; x < width; x += ONE) {
      const p = (y * width + x) * FOUR;
      pixels[p] = bgR;
      pixels[p + ONE] = bgG;
      pixels[p + TWO] = bgB;
      pixels[p + THREE] = 255;
    }
  }

  // Camera basis from spherical coordinates
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

  // Right = normalize(f x up(0,1,0)) = (-fz, 0, fx)
  const rLen = Math.hypot(-fz, fx) || ONE;
  const rx = -fz / rLen;
  const ry = 0;
  const rz = fx / rLen;

  // Up = r x f
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const fovScale = 1.45;
  const aspect = width / height;

  const projectVertex = (v: readonly [number, number, number]): [number, number, number] | null => {
    const dx = v[ZERO] - eyeX;
    const dy = v[ONE] - eyeY;
    const dz = v[TWO] - eyeZ;
    const camZ = dx * fx + dy * fy + dz * fz;
    if (camZ <= 0.25) return null;
    const camX = dx * rx + dy * ry + dz * rz;
    const camY = dx * ux + dy * uy + dz * uz;
    const ndcX = (camX * fovScale) / (camZ * aspect);
    const ndcY = (camY * fovScale) / camZ;
    const sx = (ndcX * 0.5 + 0.5) * width;
    const sy = (0.5 - ndcY * 0.5) * height;
    return [sx, sy, camZ];
  };

  const lightDir = [0.52, 0.76, 0.38];
  const bins: number[][] = Array.from({ length: totalTiles }, () => []);
  const screenTris: ScreenTri[] = [];

  for (const tri of params.triangles) {
    const p0 = projectVertex(tri.v0);
    const p1 = projectVertex(tri.v1);
    const p2 = projectVertex(tri.v2);
    if (!p0 || !p1 || !p2) continue;

    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    if (Math.abs(area) < 0.5) continue;

    // World normal for warm key + cool hemisphere PBR shading
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

    const ndl = Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
    const hemi = 0.24 + 0.18 * (ny * 0.5 + 0.5);
    const spec = (ONE - tri.roughness) * Math.pow(ndl, SIXTEEN) * 0.45;
    const linR = tri.color[0] * (hemi * 0.85 + ndl * 1.15 + tri.emissive) + spec;
    const linG = tri.color[1] * (hemi * 0.95 + ndl * 1.08 + tri.emissive) + spec;
    const linB = tri.color[2] * (hemi * 1.12 + ndl * 0.98 + tri.emissive) + spec;

    const sR = Math.round(Math.pow(acesFilmic(linR), 1 / 2.2) * 255);
    const sG = Math.round(Math.pow(acesFilmic(linG), 1 / 2.2) * 255);
    const sB = Math.round(Math.pow(acesFilmic(linB), 1 / 2.2) * 255);

    const stIdx = screenTris.length;
    // Normalize winding order so area > 0
    if (area > 0) {
      screenTris.push({
        x0: p0[0], y0: p0[1], z0: p0[2],
        x1: p1[0], y1: p1[1], z1: p1[2],
        x2: p2[0], y2: p2[1], z2: p2[2],
        invArea: 1 / area,
        r: sR, g: sG, b: sB,
      });
    } else {
      screenTris.push({
        x0: p0[0], y0: p0[1], z0: p0[2],
        x1: p2[0], y1: p2[1], z1: p2[2],
        x2: p1[0], y2: p1[1], z2: p1[2],
        invArea: -1 / area,
        r: sR, g: sG, b: sB,
      });
    }

    const minTx = Math.max(ZERO, Math.floor(Math.min(p0[0], p1[0], p2[0]) / TILE_EDGE_PX));
    const maxTx = Math.min(tilesX - ONE, Math.floor(Math.max(p0[0], p1[0], p2[0]) / TILE_EDGE_PX));
    const minTy = Math.max(ZERO, Math.floor(Math.min(p0[1], p1[1], p2[1]) / TILE_EDGE_PX));
    const maxTy = Math.min(tilesY - ONE, Math.floor(Math.max(p0[1], p1[1], p2[1]) / TILE_EDGE_PX));

    for (let ty = minTy; ty <= maxTy; ty += ONE) {
      for (let tx = minTx; tx <= maxTx; tx += ONE) {
        bins[ty * tilesX + tx].push(stIdx);
      }
    }
  }

  let activeTiles = ZERO;
  for (let ty = ZERO; ty < tilesY; ty += ONE) {
    for (let tx = ZERO; tx < tilesX; tx += ONE) {
      const bucket = bins[ty * tilesX + tx];
      if (bucket.length === ZERO) continue;
      activeTiles += ONE;

      const xStart = tx * TILE_EDGE_PX;
      const yStart = ty * TILE_EDGE_PX;
      const xEnd = xStart + TILE_EDGE_PX;
      const yEnd = yStart + TILE_EDGE_PX;

      for (const triIdx of bucket) {
        const st = screenTris[triIdx];
        const minX = Math.max(xStart, Math.floor(Math.min(st.x0, st.x1, st.x2)));
        const maxX = Math.min(xEnd - ONE, Math.ceil(Math.max(st.x0, st.x1, st.x2)));
        const minY = Math.max(yStart, Math.floor(Math.min(st.y0, st.y1, st.y2)));
        const maxY = Math.min(yEnd - ONE, Math.ceil(Math.max(st.y0, st.y1, st.y2)));

        for (let py = minY; py <= maxY; py += ONE) {
          const cy = py + 0.5;
          for (let px = minX; px <= maxX; px += ONE) {
            const cx = px + 0.5;
            const w0 = (st.x2 - st.x1) * (cy - st.y1) - (st.y2 - st.y1) * (cx - st.x1);
            const w1 = (st.x0 - st.x2) * (cy - st.y2) - (st.y0 - st.y2) * (cx - st.x2);
            const w2 = (st.x1 - st.x0) * (cy - st.y0) - (st.y1 - st.y0) * (cx - st.x0);
            if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
              const b0 = w0 * st.invArea;
              const b1 = w1 * st.invArea;
              const b2 = w2 * st.invArea;
              const z = b0 * st.z0 + b1 * st.z1 + b2 * st.z2;
              const pixIdx = py * width + px;
              if (z < zbuf[pixIdx]) {
                zbuf[pixIdx] = z;
                const off = pixIdx * FOUR;
                pixels[off] = st.r;
                pixels[off + ONE] = st.g;
                pixels[off + TWO] = st.b;
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
      triangleCount: screenTris.length,
    },
  };
}
