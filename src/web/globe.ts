/**
 * Presentation only. The globe holds no game state and makes no decisions: it
 * folds the same event log the agent-facing side produces, so the viewer can
 * never show something a replay cannot reconstruct.
 */
import * as THREE from 'three';
import type { City, GameState, Trace } from '../engine/index.js';

const R = 1;
const PHOSPHOR = 0xe8a33d;
const PHOSPHOR_2 = 0x8c6a2b;
const ALARM = 0xd9533b;

function toVec3(lat: number, lon: number, r = R): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

export class Globe {
  readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world = new THREE.Group();
  private readonly arcs = new THREE.Group();
  private readonly marks = new THREE.Group();
  private cityPoints: THREE.Points | null = null;
  private cityOrder: string[] = [];
  private spin = true;
  private disposed = false;
  private target: { x: number; y: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x0d1512, 1);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 0.9, 3.1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.world);
    this.world.add(this.arcs, this.marks);
    this.buildSphere();
    this.buildGraticule();
    this.attachDrag();
    this.resize();
  }

  private buildSphere(): void {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.995, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x0d1512 }),
    );
    this.world.add(body);
    const halo = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(R, 48, 1)),
      new THREE.LineBasicMaterial({ color: PHOSPHOR_2, transparent: true, opacity: 0.5 }),
    );
    this.world.add(halo);
  }

  /** A vector graticule instead of a texture: no image assets, and it reads as a plot. */
  private buildGraticule(): void {
    const pts: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 4) {
        const a = toVec3(lat, lon, R * 1.001);
        const b = toVec3(lat, lon + 4, R * 1.001);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -84; lat < 84; lat += 4) {
        const a = toVec3(lat, lon, R * 1.001);
        const b = toVec3(lat + 4, lon, R * 1.001);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.world.add(
      new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: PHOSPHOR_2, transparent: true, opacity: 0.22 }),
      ),
    );
  }

  setCities(cities: readonly City[]): void {
    if (this.cityPoints) this.world.remove(this.cityPoints);
    const pos: number[] = [];
    const size: number[] = [];
    this.cityOrder = [];
    for (const c of cities) {
      const v = toVec3(c.at.lat, c.at.lon, R * 1.004);
      pos.push(v.x, v.y, v.z);
      size.push(3 + Math.sqrt(c.pop) * 1.1);
      this.cityOrder.push(c.id);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aAlive', new THREE.Float32BufferAttribute(new Array(cities.length).fill(1), 1));
    this.cityPoints = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uLive: { value: new THREE.Color(PHOSPHOR) },
          uDead: { value: new THREE.Color(ALARM) },
          uDpr: { value: Math.min(2, window.devicePixelRatio) },
        },
        vertexShader: `
          attribute float aSize; attribute float aAlive;
          uniform float uDpr;
          varying float vAlive;
          void main() {
            vAlive = aAlive;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (4.2 / -mv.z) * uDpr;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uLive; uniform vec3 uDead;
          varying float vAlive;
          void main() {
            vec2 d = gl_PointCoord - vec2(0.5);
            float r = length(d);
            if (r > 0.5) discard;
            float edge = smoothstep(0.5, 0.18, r);
            vec3 c = mix(uDead, uLive, vAlive);
            gl_FragColor = vec4(c, edge * (0.45 + 0.55 * vAlive));
          }`,
      }),
    );
    this.world.add(this.cityPoints);
  }

  updateCities(cities: readonly City[]): void {
    const attr = this.cityPoints?.geometry.getAttribute('aAlive') as
      THREE.BufferAttribute | undefined;
    if (!attr) return;
    const byId = new Map(cities.map((c) => [c.id, c]));
    this.cityOrder.forEach((id, i) => {
      const c = byId.get(id);
      attr.setX(i, c && c.pop > 0 ? c.popRemaining / c.pop : 1);
    });
    attr.needsUpdate = true;
  }

  /** `progressOf` lets the caller interpolate between ticks for smooth flight. */
  setTraces(traces: readonly Trace[], progressOf: (t: Trace) => number): void {
    this.arcs.clear();
    for (const tr of traces) {
      const from = toVec3(tr.origin.lat, tr.origin.lon);
      const to = toVec3(tr.targetAt.lat, tr.targetAt.lon);
      const p = Math.max(0, Math.min(1, progressOf(tr)));
      const curve = ballistic(from, to);
      const flown = curve.getPoints(96).slice(0, Math.max(2, Math.floor(96 * p)));
      const g = new THREE.BufferGeometry().setFromPoints(flown);
      this.arcs.add(
        new THREE.Line(
          g,
          new THREE.LineBasicMaterial({ color: PHOSPHOR, transparent: true, opacity: 0.9 }),
        ),
      );
      const full = new THREE.BufferGeometry().setFromPoints(curve.getPoints(96));
      this.arcs.add(
        new THREE.Line(
          full,
          new THREE.LineBasicMaterial({ color: PHOSPHOR_2, transparent: true, opacity: 0.25 }),
        ),
      );
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 10, 8),
        new THREE.MeshBasicMaterial({ color: PHOSPHOR }),
      );
      head.position.copy(curve.getPoint(p));
      this.arcs.add(head);
    }
  }

  flashImpact(lat: number, lon: number): void {
    const at = toVec3(lat, lon, R * 1.01);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.01, 0.02, 24),
      new THREE.MeshBasicMaterial({ color: ALARM, transparent: true, side: THREE.DoubleSide }),
    );
    ring.position.copy(at);
    ring.lookAt(0, 0, 0);
    const born = performance.now();
    (ring as THREE.Mesh & { bornAt?: number }).bornAt = born;
    this.marks.add(ring);
  }

  setSpin(on: boolean): void {
    this.spin = on;
  }

  /** Turn the globe so a point faces the camera. Used on launch and on impact:
   *  an idle spin looks good but hides the only thing the player needs to see. */
  focusOn(lat: number, lon: number): void {
    this.spin = false;
    const v = toVec3(lat, lon);
    // rotation.y = a sends azimuth t to t + a, so a = -t puts the point on +z.
    const h = Math.hypot(v.x, v.z);
    // Damp the tilt: a full latitude rotation reads as a polar view, not a globe.
    this.target = { x: Math.atan2(v.y, h) * 0.55, y: -Math.atan2(v.x, v.z) };
  }

  render(dt: number): void {
    if (this.disposed) return;
    if (this.spin) {
      this.world.rotation.y += dt * 0.04;
    } else if (this.target) {
      const k = 1 - Math.pow(0.002, dt);
      this.world.rotation.y += shortestAngle(this.world.rotation.y, this.target.y) * k;
      this.world.rotation.x += (this.target.x - this.world.rotation.x) * k;
      if (
        Math.abs(shortestAngle(this.world.rotation.y, this.target.y)) < 0.002 &&
        Math.abs(this.target.x - this.world.rotation.x) < 0.002
      )
        this.target = null;
    }
    const now = performance.now();
    for (const m of [...this.marks.children]) {
      const born = (m as THREE.Mesh & { bornAt?: number }).bornAt ?? now;
      const age = (now - born) / 1200;
      if (age > 1) {
        this.marks.remove(m);
        continue;
      }
      m.scale.setScalar(1 + age * 5);
      const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - age;
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private attachDrag(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.spin = false;
      this.target = null;
      this.canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      this.world.rotation.y += (e.clientX - lastX) * 0.005;
      this.world.rotation.x = Math.max(
        -1.2,
        Math.min(1.2, this.world.rotation.x + (e.clientY - lastY) * 0.005),
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = () => {
      dragging = false;
    };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.position.multiplyScalar(1 + Math.sign(e.deltaY) * 0.06);
        this.camera.position.clampLength(1.5, 6);
      },
      { passive: false },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}

/** Signed difference to `to`, wrapped into (-PI, PI], so the globe never spins the long way. */
function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A lofted arc whose apex scales with range, so a short hop stays low. */
function ballistic(from: THREE.Vector3, to: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const sep = from.distanceTo(to);
  mid.normalize().multiplyScalar(R + sep * 0.42);
  return new THREE.QuadraticBezierCurve3(from, mid, to);
}
