import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  PauliFault,
  buildRotatedSurfaceCode,
  extractSurfaceCodeSyndromes,
  inferSurfaceCodeDistance,
} from '../aqm/stabilizer';
import {
  TileRasterTelemetry,
  buildSoftwareQuantumSceneTriangles,
  rasterizeQuantumSceneTiles,
} from '../aqm/tileRasterizer';
import { computeBackwardLightcone } from '../aqm/tropical';
import {
  BasisAmplitudeSummary,
  BlochVector,
  CompiledDagNode,
  EntanglementEdge,
  GateKind,
} from '../aqm/types';

export type StudioSceneMode = 'bloch' | 'surface-code' | 'lightcone';
export type CameraPresetId = 'bench' | 'overhead' | 'macro';

interface QuantumViewport3DProps {
  sceneMode: StudioSceneMode;
  renderBackend: 'webgl2' | 'tile16';
  showTileGrid: boolean;
  lod: number;
  cameraPreset: CameraPresetId;
  blochVectors: readonly BlochVector[];
  entanglementEdges: readonly EntanglementEdge[];
  basisAmplitudes: readonly BasisAmplitudeSummary[];
  dagNodes: readonly CompiledDagNode[];
  stepCursor: number;
  selectedWire: number;
  surfaceFaults: readonly PauliFault[];
  decodedEdges: ReadonlyArray<{
    readonly kind: 'X-correction' | 'Z-correction';
    readonly fromId: string;
    readonly toId: string;
    readonly dataQubit: number;
  }>;
  onSelectWire: (wire: number) => void;
  onCycleDataQubitFault: (dataQubitIndex: number) => void;
}

const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return true;
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) || '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

function createBenchGridTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0e1622';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#1b2b3f';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    ctx.strokeStyle = '#24415c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, 254.5, 254.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 5);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(2, 6, 12, 0.65)');
    grad.addColorStop(0.6, 'rgba(2, 6, 12, 0.22)');
    grad.addColorStop(1, 'rgba(2, 6, 12, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _tmpVec = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _tmpQuat = new THREE.Quaternion();

export const QuantumViewport3D: React.FC<QuantumViewport3DProps> = ({
  sceneMode,
  renderBackend,
  showTileGrid,
  lod,
  cameraPreset,
  blochVectors,
  entanglementEdges,
  basisAmplitudes,
  dagNodes,
  stepCursor,
  selectedWire,
  surfaceFaults,
  decodedEdges,
  onSelectWire,
  onCycleDataQubitFault,
}) => {
  const webglMountRef = useRef<HTMLDivElement | null>(null);
  const tileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tileTelemetry, setTileTelemetry] = useState<TileRasterTelemetry | null>(null);
  const [tileYaw, setTileYaw] = useState(0.45);
  const [tilePitch, setTilePitch] = useState(0.42);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const callbacksRef = useRef({ onSelectWire, onCycleDataQubitFault });
  callbacksRef.current = { onSelectWire, onCycleDataQubitFault };

  const sceneApiRef = useRef<{
    rebuildDynamicContent: () => void;
    applyCameraPreset: (preset: CameraPresetId) => void;
    requestRender: () => void;
  } | null>(null);

  const propsRef = useRef({
    sceneMode,
    lod,
    blochVectors,
    entanglementEdges,
    basisAmplitudes,
    dagNodes,
    stepCursor,
    selectedWire,
    surfaceFaults,
    decodedEdges,
  });
  propsRef.current = {
    sceneMode,
    lod,
    blochVectors,
    entanglementEdges,
    basisAmplitudes,
    dagNodes,
    stepCursor,
    selectedWire,
    surfaceFaults,
    decodedEdges,
  };

  // Initialize Three.js WebGLRenderer once in an isolated ref container
  useEffect(() => {
    const mount = webglMountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = Math.max(320, mount.clientWidth || 960);
    const initH = Math.max(240, mount.clientHeight || 560);
    renderer.setSize(initW, initH);
    renderer.domElement.className = 'w-full h-full block cursor-grab active:cursor-grabbing';
    renderer.domElement.setAttribute('data-testid', 'aqm-webgl-canvas');
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgHex = 0x080c12;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.036);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(44, initW / initH, 0.15, 85);
    camera.position.set(0, 3.8, 8.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.6;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI * 0.485; // Near-frustum bench guard: prevents clipping below optical bench!
    controls.target.set(0, -0.65, 0);

    // 3-point warm/cool studio lighting
    const hemiLight = new THREE.HemisphereLight(0x8ec5ff, 0x101826, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.9);
    keyLight.position.set(5.5, 8.5, 5.2);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 24;
      keyLight.shadow.camera.left = -8;
      keyLight.shadow.camera.right = 8;
      keyLight.shadow.camera.top = 8;
      keyLight.shadow.camera.bottom = -8;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x22d3ee, 0.95);
    rimLight.position.set(-6.0, 4.2, -5.8);
    scene.add(rimLight);

    // Calibrated optical bench slab + chamfered trim frame (composite static base)
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const benchTex = createBenchGridTexture(maxAniso);
    const shadowTex = createContactShadowTexture();

    const staticGroup = new THREE.Group();
    const benchGeo = new THREE.BoxGeometry(13.2, 0.24, 8.4);
    const benchMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: benchTex,
      roughness: 0.72,
      metalness: 0.22,
    });
    const benchMesh = new THREE.Mesh(benchGeo, benchMat);
    benchMesh.position.set(0, -1.52, 0);
    benchMesh.receiveShadow = !isSoftwareGl;
    staticGroup.add(benchMesh);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x263548,
      roughness: 0.32,
      metalness: 0.85,
    });
    const frontRail = new THREE.Mesh(new THREE.BoxGeometry(13.36, 0.28, 0.14), railMat);
    frontRail.position.set(0, -1.5, 4.22);
    staticGroup.add(frontRail);
    const backRail = frontRail.clone();
    backRail.position.set(0, -1.5, -4.22);
    staticGroup.add(backRail);
    scene.add(staticGroup);

    // Dynamic quantum content root & interactables array
    const dynamicRoot = new THREE.Group();
    scene.add(dynamicRoot);
    const interactables: THREE.Object3D[] = [];
    const disposableGeos: THREE.BufferGeometry[] = [];
    const disposableMats: THREE.Material[] = [];

    // Smooth camera preset transition state
    let camTransitionActive = false;
    const desiredCamPos = new THREE.Vector3(0, 3.8, 8.8);
    const desiredTarget = new THREE.Vector3(0, -0.65, 0);
    let lastTimeMs = performance.now();

    controls.addEventListener('start', () => {
      camTransitionActive = false;
    });

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let unmounted = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (unmounted) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function requestRender() {
      if (unmounted) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (unmounted) return;
        renderDirty = false;
        const nowMs = performance.now();
        const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastTimeMs) * 0.001));
        lastTimeMs = nowMs;

        if (camTransitionActive) {
          const k = 9;
          const alpha = 1 - Math.exp(-k * dt);
          camera.position.lerp(desiredCamPos, alpha);
          controls.target.lerp(desiredTarget, alpha);
          if (
            camera.position.distanceToSquared(desiredCamPos) < 0.001 &&
            controls.target.distanceToSquared(desiredTarget) < 0.001
          ) {
            camera.position.copy(desiredCamPos);
            controls.target.copy(desiredTarget);
            camTransitionActive = false;
          } else {
            renderDirty = true;
          }
        }

        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty && !unmounted) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('change', requestRender);

    function clearDynamicContent() {
      while (dynamicRoot.children.length > 0) {
        dynamicRoot.remove(dynamicRoot.children[0]);
      }
      interactables.length = 0;
      for (const g of disposableGeos) g.dispose();
      for (const m of disposableMats) m.dispose();
      disposableGeos.length = 0;
      disposableMats.length = 0;
    }

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      disposableGeos.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      disposableMats.push(m);
      return m;
    };

    function rebuildDynamicContent() {
      clearDynamicContent();
      const p = propsRef.current;

      const metalDark = trackMat(
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.58, metalness: 0.78 }),
      );
      const metalBrushed = trackMat(
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.26, metalness: 0.9 }),
      );
      const shadowPlaneMat = trackMat(
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          depthWrite: false,
          opacity: 0.55,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );

      if (p.sceneMode === 'bloch') {
        const focusStart = p.blochVectors.length > 16 ? Math.max(0, Math.min(p.selectedWire - 8, p.blochVectors.length - 16)) : 0;
        const visibleBloch = p.blochVectors.slice(focusStart, focusStart + 16);
        const n = Math.max(1, visibleBloch.length);
        const spacing = Math.min(2.35, 10.4 / n);
        const startX = -((n - 1) * spacing) * 0.5;
        const stationScale = Math.min(1, 6 / Math.max(3, n));
        const sphereSegs = p.lod >= 3 ? 28 : p.lod >= 1 ? 18 : 12;

        const pedGeo = trackGeo(new THREE.CylinderGeometry(0.46, 0.56, 0.24, 8));
        const stemGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.1, 0.34, 12));
        const ringGeo = trackGeo(new THREE.TorusGeometry(0.86, 0.02, 10, sphereSegs * 2));
        const shellGeo = trackGeo(new THREE.SphereGeometry(0.84, sphereSegs, sphereSegs));
        const poleCapGeo = trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12));
        const shadowPlaneGeo = trackGeo(new THREE.PlaneGeometry(1.75, 1.75));

        visibleBloch.forEach((bv, localIdx) => {
          const globalWire = bv.qubit;
          const x = startX + localIdx * spacing;
          const isSelected = globalWire === p.selectedWire;

          // Composite 8-part Bloch Manifold Station Group
          const station = new THREE.Group();
          station.position.set(x, -1.385 * (1 - stationScale), 0.2);
          station.scale.setScalar(stationScale);

          // 1. Contact shadow disc on bench surface (y = -1.39, above -1.40 bench top)
          const cShadow = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
          cShadow.rotation.x = -Math.PI * 0.5;
          cShadow.position.set(0, -1.385, 0);
          station.add(cShadow);

          // 2. Octagonal pedestal base
          const ped = new THREE.Mesh(
            pedGeo,
            isSelected
              ? trackMat(
                  new THREE.MeshStandardMaterial({
                    color: 0x0f766e,
                    roughness: 0.32,
                    metalness: 0.72,
                  }),
                )
              : metalDark,
          );
          ped.position.set(0, -1.28, 0);
          ped.castShadow = !isSoftwareGl;
          station.add(ped);

          // 3. Support stanchion
          const stem = new THREE.Mesh(stemGeo, metalBrushed);
          stem.position.set(0, -1.0, 0);
          station.add(stem);

          // 4–5. Equatorial & Meridian Gimbals (LOD >= 1)
          const eqRingMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: isSelected ? 0x34d399 : 0x38bdf8,
              roughness: 0.22,
              metalness: 0.85,
              emissive: isSelected ? 0x064e3b : 0x082f49,
              emissiveIntensity: 0.5,
            }),
          );
          const eqRing = new THREE.Mesh(ringGeo, eqRingMat);
          eqRing.rotation.x = Math.PI * 0.5;
          station.add(eqRing);

          if (p.lod >= 1) {
            const merRingA = new THREE.Mesh(ringGeo, metalBrushed);
            station.add(merRingA);
            if (p.lod >= 2) {
              const merRingB = new THREE.Mesh(ringGeo, metalBrushed);
              merRingB.rotation.y = Math.PI * 0.5;
              station.add(merRingB);
            }
          }

          // 6. North |0> and South |1> calibration pole caps
          const northCap = new THREE.Mesh(poleCapGeo, metalBrushed);
          northCap.position.set(0, 0.88, 0);
          station.add(northCap);
          const southCap = new THREE.Mesh(poleCapGeo, metalBrushed);
          southCap.position.set(0, -0.88, 0);
          station.add(southCap);

          // 7. Translucent optical manifold shell (click proxy for selecting wire)
          const shellMat = trackMat(
            new THREE.MeshPhysicalMaterial({
              color: isSelected ? 0xa7f3d0 : 0xbae6fd,
              roughness: 0.12,
              metalness: 0.05,
              transmission: isSoftwareGl ? 0 : 0.88,
              transparent: true,
              opacity: isSoftwareGl ? 0.2 : 0.95,
              ior: 1.48,
              thickness: 0.6,
              depthWrite: false,
            }),
          );
          const shell = new THREE.Mesh(shellGeo, shellMat);
          shell.renderOrder = 4;
          shell.userData = { kind: 'wire', index: globalWire };
          interactables.push(shell);
          station.add(shell);

          // 8. Origin core + articulated Bloch state vector needle (rx -> +X, rz -> +Y, ry -> +Z)
          const coreMesh = new THREE.Mesh(
            trackGeo(new THREE.SphereGeometry(0.08, 12, 12)),
            metalBrushed,
          );
          station.add(coreMesh);

          const vecX = bv.rx * 0.78;
          const vecY = bv.rz * 0.78;
          const vecZ = bv.ry * 0.78;
          const vecLen = Math.hypot(vecX, vecY, vecZ);

          const needleColor = bv.collapsedTo !== null ? 0xf59e0b : 0x10b981;
          const needleMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: needleColor,
              roughness: 0.2,
              metalness: 0.35,
              emissive: needleColor,
              emissiveIntensity: 0.45,
            }),
          );

          if (vecLen > 0.04) {
            _tmpVec.set(vecX, vecY, vecZ).normalize();
            _tmpQuat.setFromUnitVectors(_upVec, _tmpVec);

            const shaftLen = Math.max(0.03, vecLen - 0.14);
            const shaft = new THREE.Mesh(
              trackGeo(new THREE.CylinderGeometry(0.028, 0.028, shaftLen, 12)),
              needleMat,
            );
            shaft.quaternion.copy(_tmpQuat);
            shaft.position.copy(_tmpVec).multiplyScalar(shaftLen * 0.5);
            station.add(shaft);

            const cone = new THREE.Mesh(
              trackGeo(new THREE.ConeGeometry(0.075, 0.18, 14)),
              needleMat,
            );
            cone.quaternion.copy(_tmpQuat);
            cone.position.copy(_tmpVec).multiplyScalar(vecLen - 0.05);
            station.add(cone);
          } else {
            // Maximally entangled mixed state (r ~ 0): glowing central singlet orb
            const mixedOrb = new THREE.Mesh(
              trackGeo(new THREE.SphereGeometry(0.16, 16, 16)),
              trackMat(
                new THREE.MeshStandardMaterial({
                  color: 0x06b6d4,
                  roughness: 0.18,
                  metalness: 0.25,
                  emissive: 0x0891b2,
                  emissiveIntensity: 0.65,
                }),
              ),
            );
            station.add(mixedOrb);
          }

          dynamicRoot.add(station);
        });

        // Entanglement mutual-information arches (LOD >= 1)
        if (p.lod >= 1) {
          for (const edge of p.entanglementEdges) {
            const locA = edge.qubitA - focusStart;
            const locB = edge.qubitB - focusStart;
            if (locA < 0 || locA >= n || locB < 0 || locB >= n) continue;
            const xA = startX + locA * spacing;
            const xB = startX + locB * spacing;
            const span = Math.abs(xB - xA);
            const curve = new THREE.QuadraticBezierCurve3(
              new THREE.Vector3(xA, 0.88 * stationScale, 0.2),
              new THREE.Vector3((xA + xB) * 0.5, 1.15 * stationScale + span * 0.2, -0.25),
              new THREE.Vector3(xB, 0.88 * stationScale, 0.2),
            );
            const tubeGeo = trackGeo(
              new THREE.TubeGeometry(curve, 24, 0.02 + edge.correlationStrength * 0.022, 8, false),
            );
            const tubeMat = trackMat(
              new THREE.MeshStandardMaterial({
                color: 0x22d3ee,
                roughness: 0.2,
                metalness: 0.3,
                emissive: 0x0891b2,
                emissiveIntensity: 0.55,
              }),
            );
            dynamicRoot.add(new THREE.Mesh(tubeGeo, tubeMat));
          }
        }

        // Rear gallery: Cyclotomic Amplitude Phase Towers (LOD >= 2)
        if (p.lod >= 2 && p.basisAmplitudes.length > 0) {
          const maxBars = Math.min(16, p.basisAmplitudes.length);
          const barSpacing = Math.min(0.62, 9.2 / maxBars);
          const barStartX = -((maxBars - 1) * barSpacing) * 0.5;

          for (let b = 0; b < maxBars; b += 1) {
            const amp = p.basisAmplitudes[b];
            const h = Math.max(0.06, amp.probability * 2.2);
            const hue = ((amp.phaseRad / (Math.PI * 2)) + 1) % 1;
            const col = new THREE.Color().setHSL(hue * 0.45 + 0.42, 0.78, 0.52);

            const towerGroup = new THREE.Group();
            towerGroup.position.set(barStartX + b * barSpacing, -1.38, -2.55);

            const plinth = new THREE.Mesh(
              trackGeo(new THREE.BoxGeometry(barSpacing * 0.72, 0.08, 0.38)),
              metalDark,
            );
            plinth.position.y = 0.04;
            towerGroup.add(plinth);

            const barMesh = new THREE.Mesh(
              trackGeo(new THREE.BoxGeometry(barSpacing * 0.54, h, 0.26)),
              trackMat(
                new THREE.MeshStandardMaterial({
                  color: col,
                  roughness: 0.28,
                  metalness: 0.4,
                  emissive: col,
                  emissiveIntensity: amp.probability > 0.01 ? 0.3 : 0.02,
                }),
              ),
            );
            barMesh.position.y = 0.08 + h * 0.5;
            towerGroup.add(barMesh);
            dynamicRoot.add(towerGroup);
          }
        }
      } else if (p.sceneMode === 'surface-code') {
        // Parametric [[d^2, 1, d]] Topological Surface-Code Cryo-Lattice (d = 3, 5, 7, 9)
        const d = inferSurfaceCodeDistance(p.surfaceFaults.length);
        const patch = buildRotatedSurfaceCode(d);
        const syn = extractSurfaceCodeSyndromes(p.surfaceFaults, d);
        const ratio = 3 / d;
        const gridScale = 1.65 * ratio;

        const plaqGeo = trackGeo(new THREE.BoxGeometry(1.42 * ratio, 0.14, 1.42 * ratio));
        const halfPlaqGeo = trackGeo(new THREE.BoxGeometry(1.25 * ratio, 0.12, 0.72 * ratio));
        const beaconGeo = trackGeo(new THREE.OctahedronGeometry(0.18 * ratio, 0));

        for (const plaq of patch.plaquettes) {
          const isExcited = syn.excitedIds.includes(plaq.id);
          const isWeight2 = plaq.dataQubits.length === 2;
          const baseColor = plaq.kind === 'X' ? 0x0e7490 : 0x047857;
          const excitedColor = plaq.kind === 'X' ? 0xf59e0b : 0xf43f5e;

          const pGroup = new THREE.Group();
          pGroup.position.set(plaq.centerX * gridScale, -1.26, plaq.centerZ * gridScale);

          const tileMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: isExcited ? excitedColor : baseColor,
              roughness: isExcited ? 0.22 : 0.55,
              metalness: 0.35,
              emissive: isExcited ? excitedColor : baseColor,
              emissiveIntensity: isExcited ? 0.55 : 0.08,
            }),
          );
          const tileMesh = new THREE.Mesh(isWeight2 ? halfPlaqGeo : plaqGeo, tileMat);
          if (
            isWeight2 &&
            (plaq.boundaryOrientation === 'left' || plaq.boundaryOrientation === 'right')
          ) {
            tileMesh.rotation.y = Math.PI * 0.5;
          }
          if (isExcited) {
            tileMesh.position.y = 0.12;
          }
          pGroup.add(tileMesh);

          if (isExcited) {
            const beacon = new THREE.Mesh(beaconGeo, tileMat);
            beacon.position.y = 0.52;
            pGroup.add(beacon);
          }

          dynamicRoot.add(pGroup);
        }

        // d^2 Composite Data-Qubit Cryo-Pillars (clickable to cycle I -> X -> Z -> Y)
        const pillarBaseGeo = trackGeo(
          new THREE.CylinderGeometry(0.24 * ratio, 0.3 * ratio, 0.22, 8),
        );
        const pillarColGeo = trackGeo(
          new THREE.CylinderGeometry(0.11 * ratio, 0.13 * ratio, 0.68, 12),
        );
        const orbGeo = trackGeo(new THREE.SphereGeometry(0.22 * ratio, 16, 16));
        const collarGeo = trackGeo(new THREE.TorusGeometry(0.24 * ratio, 0.025 * ratio, 8, 20));

        for (const dq of patch.dataCoords) {
          const fault = p.surfaceFaults[dq.id] ?? 'I';
          const orbHex =
            fault === 'I'
              ? 0xe2e8f0
              : fault === 'X'
                ? 0xf43f5e
                : fault === 'Z'
                  ? 0x38bdf8
                  : 0xf59e0b;

          const qGroup = new THREE.Group();
          qGroup.position.set(dq.x * gridScale, -1.38, dq.z * gridScale);

          const base = new THREE.Mesh(pillarBaseGeo, metalDark);
          base.position.y = 0.11;
          qGroup.add(base);

          const col = new THREE.Mesh(pillarColGeo, metalBrushed);
          col.position.y = 0.55;
          qGroup.add(col);

          const collar = new THREE.Mesh(collarGeo, metalBrushed);
          collar.rotation.x = Math.PI * 0.5;
          collar.position.y = 0.92;
          qGroup.add(collar);

          const orbMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: orbHex,
              roughness: 0.18,
              metalness: 0.28,
              emissive: orbHex,
              emissiveIntensity: fault === 'I' ? 0.08 : 0.6,
            }),
          );
          const orb = new THREE.Mesh(orbGeo, orbMat);
          orb.position.y = 1.05;
          orb.userData = { kind: 'data-qubit', index: dq.id };
          interactables.push(orb);
          qGroup.add(orb);

          dynamicRoot.add(qGroup);
        }

        // Tropical (min, +) decoded recovery arches
        for (const edge of p.decodedEdges) {
          const dq = patch.dataCoords[edge.dataQubit];
          if (!dq) continue;
          const ringHighlight = new THREE.Mesh(
            trackGeo(new THREE.TorusGeometry(0.36 * ratio, 0.04 * ratio, 10, 24)),
            trackMat(
              new THREE.MeshStandardMaterial({
                color: 0x10b981,
                roughness: 0.2,
                metalness: 0.4,
                emissive: 0x10b981,
                emissiveIntensity: 0.7,
              }),
            ),
          );
          ringHighlight.rotation.x = Math.PI * 0.5;
          ringHighlight.position.set(dq.x * gridScale, -0.33, dq.z * gridScale);
          dynamicRoot.add(ringHighlight);
        }
      } else {
        // 3D Causal Circuit DAG & Tropical Lightcone Sculpture (16-wire focus window)
        const totalWires = Math.max(1, p.blochVectors.length);
        const focusStart =
          totalWires > 16 ? Math.max(0, Math.min(p.selectedWire - 8, totalWires - 16)) : 0;
        const n = Math.min(16, totalWires - focusStart);
        const coneSet = computeBackwardLightcone(p.dagNodes, p.selectedWire, p.stepCursor);
        const wireSpacingZ = Math.min(1.25, 5.2 / n);
        const startZ = -((n - 1) * wireSpacingZ) * 0.5;
        const visibleNodes = p.dagNodes.slice(0, 48);
        const maxLayer = Math.max(1, ...visibleNodes.map((nd) => nd.layerIndex));
        const layerSpacingX = Math.min(1.3, 8.8 / Math.max(1, maxLayer));
        const startX = -((maxLayer - 1) * layerSpacingX) * 0.5;

        const railGeo = trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 10.2, 12));
        for (let localQ = 0; localQ < n; localQ += 1) {
          const globalQ = focusStart + localQ;
          const z = startZ + localQ * wireSpacingZ;
          const rail = new THREE.Mesh(
            railGeo,
            globalQ === p.selectedWire
              ? trackMat(
                  new THREE.MeshStandardMaterial({
                    color: 0x10b981,
                    roughness: 0.25,
                    metalness: 0.75,
                    emissive: 0x065f46,
                    emissiveIntensity: 0.5,
                  }),
                )
              : metalBrushed,
          );
          rail.rotation.z = Math.PI * 0.5;
          rail.position.set(0, -0.35, z);
          rail.userData = { kind: 'wire', index: globalQ };
          interactables.push(rail);
          dynamicRoot.add(rail);
        }

        const gateBoxGeo = trackGeo(new THREE.BoxGeometry(0.56, 0.56, 0.56));
        for (const node of visibleNodes) {
          const w0 = node.step.targets[0];
          const in0 = w0 >= focusStart && w0 < focusStart + n;
          const w1 = node.step.targets.length === 2 ? node.step.targets[1] : w0;
          const in1 = w1 >= focusStart && w1 < focusStart + n;
          if (!in0 && !in1) continue;

          const x = startX + (node.layerIndex - 1) * layerSpacingX;
          const inCone = coneSet.has(node.stepIndex);
          const executed = node.stepIndex < p.stepCursor;
          const baseCol =
            node.step.kind === GateKind.MEASURE
              ? 0xf59e0b
              : inCone
                ? 0x10b981
                : executed
                  ? 0x38bdf8
                  : 0x475569;

          const gMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: baseCol,
              roughness: 0.28,
              metalness: 0.45,
              emissive: baseCol,
              emissiveIntensity: inCone ? 0.55 : executed ? 0.22 : 0.04,
            }),
          );

          const z0 = startZ + Math.max(0, Math.min(n - 1, w0 - focusStart)) * wireSpacingZ;
          if (in0) {
            const block = new THREE.Mesh(gateBoxGeo, gMat);
            block.position.set(x, -0.35, z0);
            dynamicRoot.add(block);
          }

          if (node.step.targets.length === 2) {
            const z1 = startZ + Math.max(0, Math.min(n - 1, w1 - focusStart)) * wireSpacingZ;
            if (in1) {
              const targetSphere = new THREE.Mesh(
                trackGeo(new THREE.SphereGeometry(0.24, 16, 16)),
                gMat,
              );
              targetSphere.position.set(x, -0.35, z1);
              dynamicRoot.add(targetSphere);
            }

            const couplerLen = Math.abs(z1 - z0);
            if (couplerLen > 0.01) {
              const coupler = new THREE.Mesh(
                trackGeo(new THREE.CylinderGeometry(0.05, 0.05, couplerLen, 10)),
                gMat,
              );
              coupler.rotation.x = Math.PI * 0.5;
              coupler.position.set(x, -0.35, (z0 + z1) * 0.5);
              dynamicRoot.add(coupler);
            }
          }
        }
      }

      requestRender();
    }

    function applyCameraPreset(preset: CameraPresetId) {
      if (preset === 'bench') {
        desiredCamPos.set(0, 3.8, 8.8);
        desiredTarget.set(0, -0.65, 0);
      } else if (preset === 'overhead') {
        desiredCamPos.set(0, 9.6, 2.1);
        desiredTarget.set(0, -0.75, 0);
      } else {
        const n = Math.max(1, propsRef.current.blochVectors.length);
        const spacing = Math.min(2.35, 9.6 / n);
        const startX = -((n - 1) * spacing) * 0.5;
        const focusX =
          propsRef.current.sceneMode === 'bloch'
            ? startX + Math.min(n - 1, propsRef.current.selectedWire) * spacing
            : 0;
        desiredCamPos.set(focusX + 1.2, 1.85, 4.2);
        desiredTarget.set(focusX, -0.5, 0.1);
      }
      camTransitionActive = true;
      requestRender();
    }

    // Raycast click picking on dedicated interactables array
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(interactables, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData as { kind?: string; index?: number };
        if (ud.kind === 'wire' && typeof ud.index === 'number') {
          callbacksRef.current.onSelectWire(ud.index);
        } else if (ud.kind === 'data-qubit' && typeof ud.index === 'number') {
          callbacksRef.current.onCycleDataQubitFault(ud.index);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const resizeObserver = new ResizeObserver(() => {
      if (unmounted || !mount) return;
      const w = Math.max(320, mount.clientWidth);
      const h = Math.max(240, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(mount);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    sceneApiRef.current = { rebuildDynamicContent, applyCameraPreset, requestRender };
    rebuildDynamicContent();

    return () => {
      unmounted = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      clearDynamicContent();
      benchTex.dispose();
      shadowTex.dispose();
      envTarget.dispose();
      benchGeo.dispose();
      benchMat.dispose();
      railMat.dispose();
      renderer.dispose();
    };
  }, []);

  // Rebuild dynamic 3D objects whenever quantum state or scene mode changes
  useEffect(() => {
    if (renderBackend === 'webgl2') {
      sceneApiRef.current?.rebuildDynamicContent();
    }
  }, [
    renderBackend,
    sceneMode,
    lod,
    blochVectors,
    entanglementEdges,
    basisAmplitudes,
    dagNodes,
    stepCursor,
    selectedWire,
    surfaceFaults,
    decodedEdges,
  ]);

  useEffect(() => {
    if (renderBackend === 'webgl2') {
      sceneApiRef.current?.applyCameraPreset(cameraPreset);
    } else {
      if (cameraPreset === 'bench') {
        setTileYaw(0.45);
        setTilePitch(0.42);
      } else if (cameraPreset === 'overhead') {
        setTileYaw(0.08);
        setTilePitch(1.22);
      } else {
        setTileYaw(0.68);
        setTilePitch(0.28);
      }
    }
  }, [cameraPreset, renderBackend]);

  // Execute deterministic 16x16 Software Tile PBR rasterizer when active or if WebGL2 is unavailable
  useEffect(() => {
    const useTile = renderBackend === 'tile16' || webglUnavailable;
    if (!useTile || !tileCanvasRef.current) return;

    const tris = buildSoftwareQuantumSceneTriangles({
      sceneMode,
      blochVectors,
      entanglementEdges,
      surfaceFaults,
      lod,
    });
    const out = rasterizeQuantumSceneTiles({
      width: 640,
      height: 368,
      yawRad: tileYaw,
      pitchRad: tilePitch,
      distance: cameraPreset === 'macro' ? 5.2 : 7.8,
      triangles: tris,
      showTileGrid,
    });

    const canvas = tileCanvasRef.current;
    canvas.width = out.telemetry.width;
    canvas.height = out.telemetry.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = new ImageData(
        new Uint8ClampedArray(out.pixels),
        out.telemetry.width,
        out.telemetry.height,
      );
      ctx.putImageData(img, 0, 0);
    }
    setTileTelemetry(out.telemetry);
  }, [
    renderBackend,
    webglUnavailable,
    sceneMode,
    blochVectors,
    entanglementEdges,
    surfaceFaults,
    lod,
    tileYaw,
    tilePitch,
    cameraPreset,
    showTileGrid,
  ]);

  const activeSoftwareTile = renderBackend === 'tile16' || webglUnavailable;

  return (
    <div
      className="relative w-full h-full bg-[#080C12] overflow-hidden select-none"
      data-scene-mode={sceneMode}
      data-render-backend={activeSoftwareTile ? 'tile16' : 'webgl2'}
    >
      {/* Dedicated empty Three.js WebGL mount container */}
      <div
        ref={webglMountRef}
        className={`w-full h-full ${activeSoftwareTile ? 'hidden' : 'block'}`}
      />

      {/* Portable 16x16 Software Tile PBR Framebuffer */}
      {activeSoftwareTile && (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#080C12] p-4">
          <canvas
            ref={tileCanvasRef}
            data-testid="aqm-tile16-canvas"
            onPointerMove={(e) => {
              if (e.buttons === 1) {
                setTileYaw((y) => y + e.movementX * 0.01);
                setTilePitch((p) => Math.max(0.12, Math.min(1.35, p + e.movementY * 0.01)));
              }
            }}
            className="w-full h-full max-h-full object-contain rounded border border-slate-800 cursor-crosshair"
          />
          {tileTelemetry && (
            <div className="absolute top-14 right-5 text-xs font-mono tabular-nums text-slate-300 bg-slate-900/95 border border-slate-800 px-3 py-1.5 rounded">
              <span>16x16 Software Tile PBR</span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span>
                {tileTelemetry.activeTiles}/{tileTelemetry.tilesX * tileTelemetry.tilesY} active tiles
              </span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span>{tileTelemetry.triangleCount} tris</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
