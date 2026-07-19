/**
 * 3D mine-wall renderer for the Crystal Vein modal. Framework-free; owns its
 * own requestAnimationFrame loop and every three.js resource, mirroring the
 * board-canvas.ts pattern. three.js is loaded via dynamic import() so it ships
 * as a separate lazy chunk that only downloads when a player opens a vein.
 *
 * The component drives it: setDepth() reflects the shared shaft depth, and
 * playStrike()/playCaveIn()/playHeartstone() run scripted boulder animations.
 * No physics engine — all motion is deterministic time-based tweens.
 */
import type * as TN from 'three';

type ThreeModule = typeof import('three');

interface FallingRock {
  mesh: TN.Mesh;
  vy: number;
  vx: number;
  spin: TN.Vector3;
  life: number;
}

export class VeinCanvas {
  private three!: ThreeModule;
  private renderer!: TN.WebGLRenderer;
  private scene!: TN.Scene;
  private camera!: TN.PerspectiveCamera;
  private wall!: TN.Group;
  private crystals: TN.Mesh[] = [];
  private rocks: FallingRock[] = [];
  private rockGeo!: TN.IcosahedronGeometry;
  private rockMat!: TN.MeshStandardMaterial;
  private canvas!: HTMLCanvasElement;
  private raf = 0;
  private lastT = 0;
  private shake = 0;
  private disposed = false;

  /** Lazy-load three, build the scene, start the loop. Returns false if WebGL
   *  or the three import is unavailable so the caller can fall back to CSS. */
  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.three = await import('three');
    } catch {
      return false;
    }
    if (this.disposed) return false;
    const T = this.three;
    this.canvas = canvas;
    try {
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return false;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(50, 1.5, 0.1, 100);
    this.camera.position.set(0, 0, 7);

    this.scene.add(new T.AmbientLight(0x6b7a80, 0.9));
    const key = new T.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const glow = new T.PointLight(0x8fd0dd, 1.4, 24);
    glow.position.set(0, -1, 3);
    this.scene.add(glow);

    this.rockGeo = this.makeRockGeo();
    this.rockMat = new T.MeshStandardMaterial({
      color: 0x5a4a36,
      flatShading: true,
      roughness: 1,
    });

    this.wall = new T.Group();
    this.scene.add(this.wall);
    this.buildWall();

    this.resize();
    this.lastT = performance.now();
    this.loop();
    return true;
  }

  private makeRockGeo(): TN.IcosahedronGeometry {
    const geo = new this.three.IcosahedronGeometry(0.5, 0);
    const pos = geo.attributes['position'];
    for (let i = 0; i < pos.count; i++) {
      const j = 0.85 + Math.random() * 0.3;
      pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private buildWall(): void {
    const T = this.three;
    const back = new T.Mesh(
      new T.PlaneGeometry(14, 10),
      new T.MeshStandardMaterial({ color: 0x2a2018, flatShading: true, roughness: 1 }),
    );
    back.position.z = -1.5;
    this.wall.add(back);

    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -2; gy <= 2; gy++) {
        const m = new T.Mesh(this.rockGeo, this.rockMat);
        m.position.set(
          gx * 1.2 + (Math.random() - 0.5) * 0.4,
          gy * 1.2 + (Math.random() - 0.5) * 0.4,
          0,
        );
        m.scale.setScalar(0.8 + Math.random() * 0.7);
        m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        this.wall.add(m);
      }
    }

    const cMat = new T.MeshStandardMaterial({
      color: 0x8fd0dd,
      emissive: 0x2f6f7d,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < 8; i++) {
      const c = new T.Mesh(new T.OctahedronGeometry(0.35, 0), cMat.clone());
      c.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 0.5);
      c.scale.y = 1.8;
      c.visible = false;
      this.crystals.push(c);
      this.wall.add(c);
    }
  }

  /** Reveal a fraction of the crystals proportional to shared shaft depth. */
  setDepth(depth: number, max: number): void {
    if (this.disposed || !this.crystals.length) return;
    const show = Math.round((Math.max(0, depth) / max) * this.crystals.length);
    this.crystals.forEach((c, i) => (c.visible = i < show));
  }

  /** A normal swing: light shake, a few boulders dislodge. */
  playStrike(): void {
    if (this.disposed) return;
    this.shake = Math.max(this.shake, 0.25);
    for (let i = 0; i < 4; i++) this.spawnRock((Math.random() - 0.5) * 3, 2 + Math.random());
  }

  /** A cave-in: hard shake, heavy cascade from the top. */
  playCaveIn(): void {
    if (this.disposed) return;
    this.shake = Math.max(this.shake, 0.7);
    for (let i = 0; i < 22; i++) {
      this.spawnRock((Math.random() - 0.5) * 9, 4 + Math.random() * 3, 0.7 + Math.random() * 0.8);
    }
  }

  /** Max-depth reward: light all crystals and a small shimmer shake. */
  playHeartstone(): void {
    if (this.disposed) return;
    this.crystals.forEach((c) => (c.visible = true));
    this.shake = Math.max(this.shake, 0.3);
  }

  private spawnRock(x: number, y: number, scale = 0.6 + Math.random() * 0.6): void {
    const T = this.three;
    const m = new T.Mesh(this.rockGeo, this.rockMat);
    m.position.set(x, y, 0.6);
    m.scale.setScalar(scale);
    this.wall.add(m);
    this.rocks.push({
      mesh: m,
      vy: -(1 + Math.random()),
      vx: (Math.random() - 0.5) * 1.2,
      spin: new T.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4),
      life: 0,
    });
  }

  resize(): void {
    if (this.disposed || !this.renderer) return;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 180;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    const g = 9;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.vy -= g * dt;
      r.mesh.position.x += r.vx * dt;
      r.mesh.position.y += r.vy * dt;
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      r.life += dt;
      if (r.mesh.position.y < -6 || r.life > 4) {
        this.wall.remove(r.mesh);
        this.rocks.splice(i, 1);
      }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x = (Math.random() - 0.5) * this.shake;
      this.camera.position.y = (Math.random() - 0.5) * this.shake;
    } else if (this.camera) {
      this.camera.position.x = 0;
      this.camera.position.y = 0;
    }
    for (const c of this.crystals) if (c.visible) c.rotation.y += dt * 0.6;
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.rocks = [];
    if (this.scene) {
      this.scene.traverse((o: TN.Object3D) => {
        const mesh = o as TN.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          mats.forEach((m) => m.dispose());
        }
      });
    }
    if (this.renderer) this.renderer.dispose();
  }
}
