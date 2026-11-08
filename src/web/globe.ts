/**
 * The plot. Presentation only: it holds no game state and decides nothing, it
 * folds what the engine produced.
 *
 * Monochrome on purpose. A period phosphor screen had one colour, so powers are
 * told apart by shape rather than by hue — circle, triangle, square, and a
 * diamond for the bystanders who are on the board but not in the fight.
 */
import * as THREE from 'three';
import coastline from '../../data/coastline.json' with { type: 'json' };
import type { Trace } from '../engine/index.js';

const R = 1;

export type Shape = 0 | 1 | 2 | 3; // circle, triangle, square, diamond

export interface Marker {
  at: { lat: number; lon: number };
  shape: Shape;
  size: number;
  /** 1 live, 0 destroyed — the shader dims and hollows it out. */
  alive: number;
}

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
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world = new THREE.Group();
  private readonly arcs = new THREE.Group();
  private readonly blasts = new THREE.Group();
  private markers: THREE.Points | null = null;
  private phosphor = new THREE.Color(0xe8a33d);
  private target: { x: number; y: number } | null = null;
  private spin = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x050705, 1);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.camera.position.set(0, 0.55, 3.05);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.world);
    this.world.add(this.arcs, this.blasts);
    this.build();
    this.drag();
    this.resize();
  }

  setPhosphor(hex: number): void {
    this.phosphor.setHex(hex);
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!mat) return;
      if (mat instanceof THREE.LineBasicMaterial) mat.color.copy(this.phosphor);
      if (mat instanceof THREE.ShaderMaterial && mat.uniforms['uColor'])
        (mat.uniforms['uColor'].value as THREE.Color).copy(this.phosphor);
    });
  }

  private build(): void {
    this.world.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.995, 64, 48),
        new THREE.MeshBasicMaterial({ color: 0x050705 }),
      ),
    );

    const grat: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30)
      for (let lon = -180; lon < 180; lon += 4) push(grat, lat, lon, lat, lon + 4);
    for (let lon = -180; lon < 180; lon += 30)
      for (let lat = -84; lat < 84; lat += 4) push(grat, lat, lon, lat + 4, lon);
    this.world.add(lines(grat, this.phosphor, 0.14));

    const coast: number[] = [];
    for (const line of coastline.lines)
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i]!;
        const b = line[i + 1]!;
        if (Math.abs(a[0]! - b[0]!) > 180) continue;
        push(coast, a[1]!, a[0]!, b[1]!, b[0]!);
      }
    this.world.add(lines(coast, this.phosphor, 0.72));
  }

  setMarkers(ms: readonly Marker[]): void {
    if (this.markers) this.world.remove(this.markers);
    const pos: number[] = [];
    const shape: number[] = [];
    const size: number[] = [];
    const alive: number[] = [];
    for (const m of ms) {
      const v = toVec3(m.at.lat, m.at.lon, R * 1.005);
      pos.push(v.x, v.y, v.z);
      shape.push(m.shape);
      size.push(m.size);
      alive.push(m.alive);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aAlive', new THREE.Float32BufferAttribute(alive, 1));
    this.markers = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: this.phosphor.clone() },
          uDpr: { value: Math.min(2, window.devicePixelRatio) },
        },
        vertexShader: `
          attribute float aShape; attribute float aSize; attribute float aAlive;
          uniform float uDpr;
          varying float vShape; varying float vAlive;
          void main() {
            vShape = aShape; vAlive = aAlive;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (5.0 / -mv.z) * uDpr;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vShape; varying float vAlive;
          void main() {
            vec2 p = gl_PointCoord - vec2(0.5);
            float inside;
            if (vShape < 0.5) {
              inside = step(length(p), 0.42);                       // circle
            } else if (vShape < 1.5) {
              // triangle, point up
              float d = max(max(-p.y - 0.26, p.y * 0.5 + p.x * 0.87 - 0.2),
                             p.y * 0.5 - p.x * 0.87 - 0.2);
              inside = step(d, 0.0);
            } else if (vShape < 2.5) {
              inside = step(max(abs(p.x), abs(p.y)), 0.36);          // square
            } else {
              inside = step(abs(p.x) + abs(p.y), 0.42);              // diamond
            }
            if (inside < 0.5) discard;
            gl_FragColor = vec4(uColor, mix(0.28, 1.0, vAlive));
          }`,
      }),
    );
    this.world.add(this.markers);
  }

  setTraces(traces: readonly Trace[], progressOf: (t: Trace) => number): void {
    this.arcs.clear();
    for (const tr of traces) {
      const from = toVec3(tr.origin.lat, tr.origin.lon);
      const to = toVec3(tr.targetAt.lat, tr.targetAt.lon);
      const p = Math.max(0, Math.min(1, progressOf(tr)));
      const curve = ballistic(from, to);
      const all = curve.getPoints(96);
      this.arcs.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(all),
          new THREE.LineDashedMaterial({
            color: this.phosphor,
            transparent: true,
            opacity: 0.22,
            dashSize: 0.02,
            gapSize: 0.03,
          }),
        ),
      );
      this.arcs.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(all.slice(0, Math.max(2, Math.floor(96 * p)))),
          new THREE.LineBasicMaterial({ color: this.phosphor, transparent: true, opacity: 1 }),
        ),
      );
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.016, 10, 8),
        new THREE.MeshBasicMaterial({ color: this.phosphor }),
      );
      head.position.copy(curve.getPoint(p));
      this.arcs.add(head);
    }
  }

  blast(lat: number, lon: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.012, 0.026, 28),
      new THREE.MeshBasicMaterial({
        color: this.phosphor,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.copy(toVec3(lat, lon, R * 1.012));
    ring.lookAt(0, 0, 0);
    (ring as THREE.Mesh & { born?: number }).born = performance.now();
    this.blasts.add(ring);
  }

  focusOn(lat: number, lon: number): void {
    this.spin = false;
    const v = toVec3(lat, lon);
    const h = Math.hypot(v.x, v.z);
    this.target = { x: Math.atan2(v.y, h) * 0.5, y: -Math.atan2(v.x, v.z) };
  }

  setSpin(on: boolean): void {
    this.spin = on;
  }

  render(dt: number): void {
    if (this.spin) this.world.rotation.y += dt * 0.03;
    else if (this.target) {
      const k = 1 - Math.pow(0.004, dt);
      this.world.rotation.y += wrap(this.target.y - this.world.rotation.y) * k;
      this.world.rotation.x += (this.target.x - this.world.rotation.x) * k;
      if (Math.abs(wrap(this.target.y - this.world.rotation.y)) < 0.002) this.target = null;
    }
    const now = performance.now();
    for (const m of [...this.blasts.children]) {
      const age = (now - ((m as THREE.Mesh & { born?: number }).born ?? now)) / 1500;
      if (age > 1) {
        this.blasts.remove(m);
        continue;
      }
      m.scale.setScalar(1 + age * 6);
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - age;
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

  private drag(): void {
    let on = false;
    let lx = 0;
    let ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      on = true;
      lx = e.clientX;
      ly = e.clientY;
      this.spin = false;
      this.target = null;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!on) return;
      this.world.rotation.y += (e.clientX - lx) * 0.005;
      this.world.rotation.x = Math.max(
        -1.2,
        Math.min(1.2, this.world.rotation.x + (e.clientY - ly) * 0.005),
      );
      lx = e.clientX;
      ly = e.clientY;
    });
    for (const ev of ['pointerup', 'pointercancel'] as const)
      this.canvas.addEventListener(ev, () => (on = false));
  }
}

function push(out: number[], lat1: number, lon1: number, lat2: number, lon2: number): void {
  const a = toVec3(lat1, lon1, R * 1.002);
  const b = toVec3(lat2, lon2, R * 1.002);
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function lines(pts: number[], color: THREE.Color, opacity: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ color: color.clone(), transparent: true, opacity }),
  );
}

/** A lofted arc whose apex scales with range, so a short hop stays low. */
function ballistic(from: THREE.Vector3, to: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const sep = from.distanceTo(to);
  mid.normalize().multiplyScalar(R + sep * 0.4);
  return new THREE.QuadraticBezierCurve3(from, mid, to);
}

const wrap = (d: number): number => {
  let x = d % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

export { toVec3 };
