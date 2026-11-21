/**
 * IslandScene: the whole 3D world in one imperative class. React owns the
 * records; it hands this class plain data (builds, players, light, weather)
 * and the scene animates toward it. Nothing in here talks to the network.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { ISLAND, MEETING_SPOT, WALK_SPEED, type TimeOfDay, type Weather } from '../constants'
import { LANDMARKS, walkable } from '../landmarks'
import { routePos, type Leg } from '../bots'
import { streamInfo, streamLevel, STREAM_DIR, STREAM_END, STREAM_START, terrainH, clamp, smooth } from '../terrain'
import { Fx, canvasTex, pick, rand } from './fx'
import { buildIslander, buildLandmark, buildMeetingBell, buildModel, paintOver, type Islander } from './models'

const { TOP_R, POND, POND_Y } = ISLAND
/** How much bigger this island is than the first prototype's; scales scenery around it. */
const K = TOP_R / 6.2

export interface SceneBuild {
  id: string
  type: string
  x: number
  z: number
  rot: number
  scale: number
  color: string
  playerId: string
  orderId: string
  seq: number
  /** Height above the ground (a bird on a roof). */
  lift?: number
  colorName?: string
  /** 'knocked' lies on its side; 'painted' is painted over. */
  state?: string
}

export interface SceneBreak {
  id: string
  x: number
  z: number
}

export interface ScenePlayer {
  id: string
  name: string
  color: string
  alive: boolean
  isMe: boolean
  seat: number
  /** AI players stroll around on their own; humans only move when they do. */
  wanders?: boolean
  /** An ejected player drawn as a see-through ghost (only other ghosts see them). */
  ghost?: boolean
}

interface SceneOptions {
  onGroundClick?: (x: number, z: number) => void
  onBellClick?: () => void
  /** Fires every frame the controlled islander moves. */
  onMyMove?: (x: number, z: number) => void
  /** Draw place names and player names (off for the landing hero). */
  labels?: boolean
}

export type CameraMode = 'orbit' | 'follow'

const EASE = {
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.9
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
}

interface Tween {
  t0: number
  dur: number
  fn: (k: number) => void
  ease: (t: number) => number
  resolve: () => void
}

interface BuildRec {
  build: SceneBuild
  root: THREE.Group
  target: THREE.Vector3
  shown: boolean
}

interface Character {
  player: ScenePlayer
  model: Islander
  label: CSS2DObject
  labelDiv: HTMLDivElement
  pos: THREE.Vector2
  target: THREE.Vector2 | null
  home: THREE.Vector2
  nextWander: number
  walkPhase: number
  heading: number
  ejecting: boolean
  ejectT: number
  ejectStart: number
  ejectV: THREE.Vector3
  gone: boolean
  /** Position supplied by presence for another human; overrides wandering. */
  remote: THREE.Vector2 | null
  busyUntil: number
  /** Timed walking legs for an AI player, evaluated against the shared clock. */
  route: Leg[] | null
  ghost: boolean
}

const TIMES: Record<TimeOfDay, { sun: string; sunI: number; sunPos: [number, number, number]; hemiSky: string; hemiGround: string; hemiI: number; top: string; mid: string; bottom: string; stars: number; glow: number; exposure: number }> = {
  dawn: { sun: '#ffc2a8', sunI: 1.9, sunPos: [14, 6, 10], hemiSky: '#ffd1e8', hemiGround: '#3b2a55', hemiI: 0.7, top: '#3a2266', mid: '#1d1440', bottom: '#05040f', stars: 0.35, glow: 0.35, exposure: 0.92 },
  day: { sun: '#fff3dc', sunI: 2.4, sunPos: [10, 20, 8], hemiSky: '#cfe6ff', hemiGround: '#4a3a5a', hemiI: 0.85, top: '#1b2660', mid: '#0e153a', bottom: '#03040c', stars: 0.3, glow: 0, exposure: 0.95 },
  sunset: { sun: '#ffa060', sunI: 2.9, sunPos: [16, 6, -4], hemiSky: '#ffc2a0', hemiGround: '#5a2c4a', hemiI: 1.0, top: '#5c2360', mid: '#2c1036', bottom: '#07030c', stars: 0.45, glow: 0.5, exposure: 0.98 },
  night: { sun: '#9fb4ff', sunI: 1.05, sunPos: [-8, 14, -6], hemiSky: '#4a5aa6', hemiGround: '#1a1230', hemiI: 0.65, top: '#130f34', mid: '#08071c', bottom: '#010106', stars: 0.75, glow: 1, exposure: 0.92 },
}

export class IslandScene {
  private container: HTMLElement
  private opts: SceneOptions
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private labelRenderer: CSS2DRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private island = new THREE.Group()
  private fx = new Fx()
  private clock = new THREE.Clock()
  private elapsed = 0
  private raf = 0
  private tweens: Tween[] = []
  private camTweening = false
  private disposed = false
  private pointScale = { value: 1 }
  /** prefers-reduced-motion: no auto turning, camera moves jump instead of gliding. */
  private reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight
  private skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } }
  private starMat!: THREE.ShaderMaterial
  private env = {
    sun: new THREE.Color(), sunI: 0, sunPos: new THREE.Vector3(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    hemiI: 0, top: new THREE.Color(), mid: new THREE.Color(), bottom: new THREE.Color(), stars: 0, glow: 0, exposure: 1,
  }
  private envToken = 0
  /** In follow view the sun's shadow box moves with you so shadows stay sharp. */
  private sunFocus = new THREE.Vector3()
  private currentTime: TimeOfDay = 'day'
  private lightsOut = 0
  private lightsOutTarget = 0

  private grassColor = new THREE.Color('#6fcf5c')
  private sandColor = new THREE.Color('#e9d8a2')
  private snowColor = new THREE.Color('#f1f5ff')
  private snowAmt = 0
  private terrainGeo!: THREE.BufferGeometry
  private terrainMesh!: THREE.Mesh
  private terrainTris: { kind: number; f: number }[] = []
  private waterMat!: THREE.MeshStandardMaterial

  private weather = { rain: 0, snow: 0, fog: 0, fireflies: 0 }
  private weatherTarget = { rain: 0, snow: 0, fog: 0, fireflies: 0 }
  private rain!: THREE.LineSegments
  private rainPos!: Float32Array
  private rainSpd!: Float32Array
  private snow!: THREE.Points
  private snowPos!: Float32Array
  private snowPh!: Float32Array
  private fireflies!: THREE.Points
  private ffPos!: Float32Array
  private ffBase: { x: number; y: number; z: number; ph: number; sp: number }[] = []

  private fall!: THREE.Points
  private fallPos!: Float32Array
  private fallVel: THREE.Vector3[] = []
  private fallLife!: Float32Array
  private ripples: { m: THREE.Mesh; life: number }[] = []
  private rippleGeo = new THREE.RingGeometry(0.08, 0.1, 32)
  private rippleT = 0
  private shards: THREE.Mesh[] = []

  private smokeGeo = new THREE.BufferGeometry()
  private sPos = new Float32Array(320 * 3)
  private sSize = new Float32Array(320)
  private sAlpha = new Float32Array(320)
  private sTint = new Float32Array(320 * 3)
  private sVel = Array.from({ length: 320 }, () => new THREE.Vector3())
  private sLife = new Float32Array(320).fill(-1)
  private sMax = new Float32Array(320)
  private sBase = new Float32Array(320)
  private sA = new Float32Array(320)
  private smokePtr = 0

  private builds = new Map<string, BuildRec>()
  private breaks = new Map<string, THREE.Group>()
  private focusRing: THREE.Mesh
  private focusMat: THREE.MeshBasicMaterial
  private clockFn: () => number = () => Date.now()
  private visionR: number | null = null
  private visionEl: HTMLElement | null = null
  private visionShown = { rx: 0, ry: 0 }
  private characters = new Map<string, Character>()
  private pbeams: { m: THREE.Mesh; life: number; max: number }[] = []
  private bursts: { pts: THREE.Points; v: THREE.Vector3[]; life: number; max: number }[] = []
  private placeBeamGeo: THREE.CylinderGeometry
  private agentBeamMat: THREE.MeshBasicMaterial
  private agentRingMat: THREE.MeshBasicMaterial
  private agentBeam: THREE.Mesh
  private agentRings: THREE.Mesh[] = []
  private agentTarget = 0
  private highlights: (THREE.MeshStandardMaterial | THREE.Mesh)[] = []
  private meeting = false
  private bellButton: THREE.Mesh
  private bellGroup: THREE.Group
  private bellRing = 0
  private camMode: CameraMode = 'orbit'
  private controlledId: string | null = null
  private canMove = false
  private keys = new Set<string>()
  private followZoom = 1
  private landmarkLabels: { obj: CSS2DObject; x: number; z: number }[] = []
  private shedPanel: THREE.MeshStandardMaterial | null = null
  private raycaster = new THREE.Raycaster()
  private pointerDown: { x: number; y: number; t: number; yaw: number; dragging: boolean } | null = null
  /** Follow camera angle around the player, turned by dragging. 0 looks north from the south. */
  private followYaw = 0
  private lastInteract = 0
  private tmpV = new THREE.Vector3()

  constructor(container: HTMLElement, opts: SceneOptions = {}) {
    this.container = container
    this.opts = opts
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    const pr = Math.min(window.devicePixelRatio || 1, 2)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none'
    container.appendChild(this.renderer.domElement)

    this.scene.fog = new THREE.FogExp2(0x0a0820, 0.008)
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 3000)
    this.camera.position.set(-22 * K, 13 * K, 40 * K)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.3, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.minDistance = 6
    this.controls.maxDistance = 30 * K
    this.controls.maxPolarAngle = Math.PI * 0.62
    this.controls.enablePan = false
    this.controls.autoRotate = !this.reduceMotion
    this.controls.autoRotateSpeed = 0.3
    this.controls.addEventListener('start', () => {
      this.lastInteract = performance.now()
      this.controls.autoRotate = false
    })

    const cpr = Math.min(pr, 1.5)
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(cpr)
    this.composer.setSize(w, h)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.45, 0.9)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(w, h)
    this.labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none'
    container.appendChild(this.labelRenderer.domElement)
    this.updatePointScale(h)

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a3a5a, 0.85)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff3dc, 2.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 90 })
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun, this.sun.target)
    const rim = new THREE.DirectionalLight(0x9a8cff, 0.9)
    rim.position.set(-12, 6, -14)
    const under = new THREE.DirectionalLight(0x6a4cff, 0.7)
    under.position.set(3, -12, 4)
    this.scene.add(rim, under)

    this.buildSky()
    this.scene.add(this.island)
    this.buildTerrain()
    this.buildUnderside()
    this.buildWater()
    this.buildShards()
    this.buildSmoke()
    this.buildWeather()

    const bell = buildMeetingBell(this.fx)
    this.bellGroup = bell.group
    this.bellButton = bell.button
    bell.group.scale.setScalar(1.25)
    bell.group.position.set(MEETING_SPOT.x, terrainH(MEETING_SPOT.x, MEETING_SPOT.z) - 0.02, MEETING_SPOT.z)
    this.island.add(bell.group)
    this.buildLandmarks()
    this.focusMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    this.focusRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 64), this.focusMat)
    this.focusRing.rotation.x = -Math.PI / 2
    this.focusRing.visible = false
    this.island.add(this.focusRing)

    this.placeBeamGeo = new THREE.CylinderGeometry(0.05, 0.17, 10, 12, 1, true)
    this.placeBeamGeo.translate(0, 5, 0)
    this.agentBeamMat = new THREE.MeshBasicMaterial({ map: this.fx.beamUpTex, color: new THREE.Color('#7cf7ff'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    const agentGeo = new THREE.CylinderGeometry(1.8, 0.35, 16, 40, 1, true)
    agentGeo.translate(0, 8, 0)
    this.agentBeam = new THREE.Mesh(agentGeo, this.agentBeamMat)
    this.agentBeam.position.y = 0.9
    this.island.add(this.agentBeam)
    this.agentRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7cf7ff').multiplyScalar(1.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.1 + i * 0.35, 0.018, 8, 80), this.agentRingMat)
      r.rotation.x = -Math.PI / 2
      r.position.y = 1.3 + i * 0.5
      this.island.add(r)
      this.agentRings.push(r)
    }

    this.copyEnv(this.envFrom('day'))
    this.applyEnv()

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerCancel)
    el.style.touchAction = 'none'
    el.addEventListener('wheel', this.onWheel, { passive: true })
    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.frame()
  }

  // ─── public API ────────────────────────────────────────────────────────────

  /** Sync the island to the builds list. New builds animate in when `animate` is true. */
  setBuilds(list: SceneBuild[], animate: boolean) {
    const ids = new Set(list.map((b) => b.id))
    for (const [id, rec] of this.builds) {
      if (!ids.has(id)) {
        if (animate && rec.shown) this.burst(rec.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), '#ff4d6d', 30)
        this.island.remove(rec.root)
        this.builds.delete(id)
      }
    }
    const fresh: SceneBuild[] = []
    for (const b of list) {
      const prev = this.builds.get(b.id)
      if (prev && (prev.build.state ?? 'ok') === (b.state ?? 'ok') && (prev.build.colorName ?? '') === (b.colorName ?? '')) continue
      if (prev) {
        // A wreck changed it: swap the model in place with a puff.
        this.island.remove(prev.root)
        this.builds.delete(b.id)
        if (animate) this.burst(prev.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), '#ff4d6d', 30)
      }
      const painted = b.state === 'painted'
      const root = buildModel(this.fx, b.type, b.color && !painted ? b.color : undefined)
      if (painted) paintOver(root, b.color || '#1f1b2a')
      const y = this.isWater(b.type) ? POND_Y - 0.01 : b.type === 'dock' ? POND_Y - 0.02 : terrainH(b.x, b.z) - 0.02 + (b.lift ?? 0)
      root.position.set(b.x, y, b.z)
      root.rotation.y = b.rot
      if (b.state === 'knocked') {
        root.rotation.z = Math.PI / 2.2
        root.position.y += 0.05
      }
      const target = root.scale.clone().multiplyScalar(b.scale || 1)
      const rec: BuildRec = { build: b, root, target, shown: false }
      this.builds.set(b.id, rec)
      this.island.add(root)
      if (prev) {
        root.scale.copy(target)
        rec.shown = true
        continue
      }
      if (animate && b.playerId !== 'world') {
        root.visible = false
        root.scale.setScalar(0.0001)
        fresh.push(b)
      } else {
        root.scale.copy(target)
        rec.shown = true
      }
    }
    if (fresh.length) this.choreograph(fresh)
  }

  /** Add, recolor or remove islanders to match the player list. */
  setPlayers(players: ScenePlayer[]) {
    const ids = new Set(players.map((p) => p.id))
    for (const [id, c] of this.characters) {
      if (!ids.has(id)) {
        this.island.remove(c.model.root)
        c.labelDiv.remove()
        this.characters.delete(id)
      }
    }
    for (const p of players) {
      const existing = this.characters.get(p.id)
      if (existing) {
        existing.player = p
        existing.labelDiv.textContent = p.isMe ? `${p.name} (you)` : p.name
        if (p.ghost && !existing.ghost) {
          // Back as a ghost, even if the ejection is still flying on a slow screen.
          this.reviveAsGhost(existing)
        } else if (!p.alive && !p.ghost && !existing.ejecting && !existing.gone) {
          existing.gone = true
          existing.model.root.visible = false
          existing.label.visible = false
        }
        continue
      }
      const model = buildIslander(this.fx, p.color)
      const div = document.createElement('div')
      div.className = 'si-label' + (p.isMe ? ' me' : '')
      div.style.setProperty('--c', p.color)
      div.textContent = p.isMe ? `${p.name} (you)` : p.name
      const label = new CSS2DObject(div)
      label.position.set(0, 0.78, 0)
      model.root.add(label)
      if (this.opts.labels === false) div.classList.add('si-nolabel')
      const home = this.seatHome(p.seat)
      const start = home.clone().add(new THREE.Vector2(rand(-0.4, 0.4), rand(-0.4, 0.4)))
      model.root.position.set(start.x, terrainH(start.x, start.y), start.y)
      this.island.add(model.root)
      const c: Character = {
        player: p, model, label, labelDiv: div, pos: start, target: null, home, nextWander: this.elapsed + rand(1, 4),
        walkPhase: rand(0, 6), heading: rand(0, Math.PI * 2), ejecting: false, ejectT: 0, ejectStart: 0, ejectV: new THREE.Vector3(),
        gone: !p.alive && !p.ghost, remote: null, busyUntil: 0, route: this.routeMap[p.id] ?? null, ghost: false,
      }
      if (!p.alive && !p.ghost) {
        model.root.visible = false
        label.visible = false
      }
      this.characters.set(p.id, c)
      if (p.ghost) this.makeGhost(c)
    }
  }

  /** Walk a character to a spot (my clicks, or another human's presence). */
  walkTo(playerId: string, x: number, z: number, remote = false) {
    const c = this.characters.get(playerId)
    if (!c || c.gone || c.ejecting || this.meeting) return
    const p = this.clampWalkable(x, z)
    if (remote) {
      // Presence updates arrive about ten times a second; a big jump means we
      // missed some, so snap instead of sliding across the island.
      if (c.pos.distanceTo(p) > 4) c.pos.copy(p)
      c.remote = p
    }
    c.target = p
  }

  /** Put an islander exactly at a spot (after a meeting, or on first load). */
  placeAt(playerId: string, x: number, z: number) {
    const c = this.characters.get(playerId)
    if (!c) return
    const p = this.clampWalkable(x, z)
    c.pos.copy(p)
    c.target = null
    c.remote = null
  }

  getCharacterPos(playerId: string): { x: number; z: number } | null {
    const c = this.characters.get(playerId)
    return c ? { x: c.pos.x, z: c.pos.y } : null
  }

  /**
   * Hand the keyboard and clicks to one islander (yours). `canMove` is false
   * during meetings and after you are ejected.
   */
  setControlled(playerId: string | null, canMove: boolean) {
    if (playerId !== this.controlledId) this.keys.clear()
    this.controlledId = playerId
    this.canMove = canMove
    if (!canMove) {
      const c = playerId ? this.characters.get(playerId) : null
      if (c && !this.meeting) c.target = null
    }
  }

  /**
   * How far you can see other islanders. Anyone outside the circle is hidden,
   * and an element (a full screen overlay) gets the circle's size on screen as
   * CSS variables so the world outside it can be darkened. null sees everything.
   */
  setVision(radius: number | null, el?: HTMLElement | null) {
    this.visionR = radius
    if (el !== undefined) this.visionEl = el
  }

  /** Shared clock (server time) for AI players' routes. */
  setClock(fn: () => number) {
    this.clockFn = fn
  }

  /** AI players walk their planned legs; everyone draws the same legs. */
  setRoutes(routes: Record<string, Leg[]>) {
    this.routeMap = routes
    for (const [id, c] of this.characters) c.route = routes[id] ?? null
  }

  private routeMap: Record<string, Leg[]> = {}

  /** Smoke and rubble where a finished task was wrecked. */
  setBreaks(list: SceneBreak[]) {
    const ids = new Set(list.map((b) => b.id))
    for (const [id, g] of this.breaks) {
      if (!ids.has(id)) {
        this.island.remove(g)
        this.breaks.delete(id)
      }
    }
    for (const b of list) {
      if (this.breaks.has(b.id)) continue
      const g = new THREE.Group()
      g.position.set(b.x, terrainH(b.x, b.z), b.z)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3)
        g.add(this.fx.mesh(new THREE.DodecahedronGeometry(rand(0.05, 0.1), 0), this.fx.mat('#4a3d4f'), Math.cos(a) * rand(0.15, 0.4), 0.04, Math.sin(a) * rand(0.15, 0.4)))
      }
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: '#1a1420', transparent: true, opacity: 0.55, depthWrite: false }))
      scorch.rotation.x = -Math.PI / 2
      scorch.position.y = 0.015
      g.add(scorch)
      this.fx.emitters.push({ root: g, offset: new THREE.Vector3(0, 0.2, 0), rate: 4, acc: 0, tint: new THREE.Color('#3a3040'), size: 0.6, alpha: 0.55, rise: 0.55 })
      this.island.add(g)
      this.breaks.set(b.id, g)
    }
  }

  /** A glowing ring on the ground at the landmark you can use. */
  setFocus(spot: { x: number; z: number; r?: number; color?: string } | null) {
    if (!spot) {
      this.focusRing.visible = false
      return
    }
    this.focusRing.visible = true
    this.focusRing.position.set(spot.x, terrainH(spot.x, spot.z) + 0.04, spot.z)
    this.focusRing.scale.setScalar(spot.r ?? 1)
    this.focusMat.color.set(spot.color ?? '#ffd166')
  }

  /** Orbit view for the lobby and the end screen; follow view while playing. */
  setCameraMode(mode: CameraMode) {
    if (mode === this.camMode) return
    this.camMode = mode
    this.controls.enabled = mode === 'orbit'
    const cam = this.sun.shadow.camera
    const r = mode === 'follow' ? 9 : 14
    Object.assign(cam, { left: -r, right: r, top: r, bottom: -r })
    cam.updateProjectionMatrix()
    if (mode === 'orbit') {
      this.sun.target.position.set(0, 0, 0)
      this.home(1600)
    } else {
      this.controls.autoRotate = false
    }
  }

  setEnvironment(time: TimeOfDay, weather: Weather) {
    if (time !== this.currentTime) this.setTime(time)
    this.setWeather(weather)
  }

  setLightsOut(on: boolean) {
    this.lightsOutTarget = on ? 1 : 0
  }

  setAgentWorking(color: string | null) {
    this.agentTarget = color ? 1 : 0
    if (color) {
      const c = new THREE.Color(color)
      this.agentBeamMat.color.copy(c)
      this.agentRingMat.color.copy(c).multiplyScalar(1.4)
    }
  }

  /** Gather everyone at the bell (true) or send them back to wandering (false). */
  setMeeting(on: boolean) {
    if (on === this.meeting) return
    this.meeting = on
    this.bellRing = on ? 2.5 : 0
    const alive = [...this.characters.values()].filter((c) => !c.gone && !c.ejecting)
    alive.forEach((c) => {
      if (on) {
        // Same seats the server uses (seatSpot in src/actions/game.ts), so every browser agrees.
        const a = (c.player.seat / 6) * Math.PI * 2 + 2.3
        const seat = this.clampWalkable(MEETING_SPOT.x + Math.cos(a) * 1.55, MEETING_SPOT.z + Math.sin(a) * 1.55)
        c.pos.copy(seat)
        c.target = null
        c.remote = null
      } else {
        c.target = null
        c.nextWander = this.elapsed + rand(0.5, 2)
      }
    })
    if (on) this.swoop(new THREE.Vector3(MEETING_SPOT.x, 0.6, MEETING_SPOT.z), new THREE.Vector3(3.6, 4.2, 5.2), 1400)
    else if (this.camMode === 'orbit') this.home(1800)
  }

  /** Fling a character off the island into space. */
  eject(playerId: string) {
    const c = this.characters.get(playerId)
    if (!c || c.ejecting) return
    c.ejecting = true
    c.ejectT = 0
    c.ejectStart = performance.now()
    const dir = new THREE.Vector3(c.pos.x, 0, c.pos.y)
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0)
    dir.normalize()
    c.ejectV.copy(dir.multiplyScalar(4.5)).add(new THREE.Vector3(0, 3.8, 0))
    this.burst(c.model.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), c.player.color, 40)
  }

  /** Make the Impostor's builds glow red and swing the camera over to them. */
  revealBuilds(ids: string[]) {
    const recs = ids.map((id) => this.builds.get(id)).filter((r): r is BuildRec => Boolean(r))
    for (const rec of recs) {
      rec.root.traverse((o) => {
        const mesh = o as THREE.Mesh
        const m = mesh.material as THREE.MeshStandardMaterial | undefined
        if (mesh.isMesh && m && 'emissive' in m && m.emissive) {
          mesh.material = m.clone()
          ;(mesh.material as THREE.MeshStandardMaterial).emissive.set('#ff1a3c')
          this.highlights.push(mesh.material as THREE.MeshStandardMaterial)
        }
      })
      const s = Math.max(rec.root.scale.x, 0.01)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(0.35, 0.5) / s, 0.03 / s, 8, 64),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a4a').multiplyScalar(1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.08
      rec.root.add(ring)
      this.highlights.push(ring)
      this.placeBeam(rec.root.position, '#ff2a4a')
    }
    if (recs.length) {
      const c = new THREE.Vector3()
      recs.forEach((r) => c.add(this.island.localToWorld(r.root.position.clone())))
      c.divideScalar(recs.length)
      const out = new THREE.Vector3(c.x, 0, c.z)
      if (out.lengthSq() < 0.01) out.set(1, 0, 1)
      out.normalize()
      const spread = Math.max(1.5, ...recs.map((r) => Math.hypot(r.root.position.x - c.x, r.root.position.z - c.z)))
      this.swoop(c.clone().setY(c.y + 0.3), out.multiplyScalar(3.5 + spread * 1.4).add(new THREE.Vector3(0, 2.6 + spread * 0.6, 0)), 2600)
    }
  }

  clearReveal() {
    for (const h of this.highlights) {
      if ((h as THREE.Mesh).isMesh) (h as THREE.Mesh).removeFromParent()
    }
    this.highlights = []
  }

  /** Fly the camera in from far away (game start). */
  introFlight() {
    const from = this.camera.position.clone()
    this.camTweening = true
    this.tween(3600, (k) => {
      this.camera.position.lerpVectors(from, new THREE.Vector3(10.8 * K, 6.6 * K, 12.6 * K), k)
      this.camera.lookAt(this.controls.target)
    }).then(() => {
      this.camTweening = false
      this.controls.autoRotate = !this.reduceMotion
    })
  }

  home(dur = 2000) {
    this.swoop(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(10.8 * K, 6.3 * K, 12.6 * K), dur).then(() => {
      this.controls.autoRotate = !this.reduceMotion
    })
  }

  focusOn(x: number, z: number) {
    const p = this.island.localToWorld(new THREE.Vector3(x, terrainH(x, z), z))
    const out = new THREE.Vector3(p.x, 0, p.z)
    if (out.lengthSq() < 0.01) out.set(1, 0, 1)
    out.normalize()
    this.swoop(p, out.multiplyScalar(4.5).add(new THREE.Vector3(0, 3.2, 0)), 1400)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerCancel)
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    for (const l of this.landmarkLabels) l.obj.element.remove()
    this.controls.dispose()
    this.renderer.dispose()
    this.composer.dispose()
    this.renderer.domElement.remove()
    this.labelRenderer.domElement.remove()
  }

  // ─── choreography ──────────────────────────────────────────────────────────

  private choreograph(fresh: SceneBuild[]) {
    const groups = new Map<string, SceneBuild[]>()
    for (const b of fresh) {
      const key = b.orderId || b.id
      const g = groups.get(key) ?? []
      g.push(b)
      groups.set(key, g)
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.seq - b.seq)
      group.forEach((b, i) => {
        window.setTimeout(() => this.popIn(b.id), 250 + i * 220)
      })
    }
  }

  private popIn(id: string) {
    const rec = this.builds.get(id)
    if (!rec || rec.shown || this.disposed) return
    rec.shown = true
    rec.root.visible = true
    const color = rec.build.color || '#7cf7ff'
    this.placeBeam(rec.root.position, color)
    this.burst(rec.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), color)
    this.tween(720, (k) => rec.root.scale.copy(rec.target).multiplyScalar(Math.max(0.0001, k)), EASE.outBack)
  }

  // ─── world building ────────────────────────────────────────────────────────

  private isWater(type: string) {
    return type === 'boat' || type === 'duck'
  }

  private seatHome(seat: number): THREE.Vector2 {
    const a = (seat / 6) * Math.PI * 2 + 2.3
    const p = new THREE.Vector2(MEETING_SPOT.x + Math.cos(a) * 2.2, MEETING_SPOT.z + Math.sin(a) * 2.2)
    return this.clampWalkable(p.x, p.y)
  }

  private reviveAsGhost(c: Character) {
    c.ejecting = false
    c.gone = false
    c.target = null
    c.model.root.visible = true
    c.label.visible = true
    c.model.root.scale.setScalar(1)
    c.model.root.rotation.set(0, c.heading, 0)
    c.labelDiv.style.opacity = '1'
    if (!c.ghost) this.makeGhost(c)
  }

  private makeGhost(c: Character) {
    c.ghost = true
    c.model.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || Array.isArray(m.material)) return
      const mat = (m.material as THREE.Material).clone()
      mat.transparent = true
      mat.opacity = 0.4
      mat.depthWrite = false
      m.material = mat
      m.castShadow = false
    })
    c.labelDiv.classList.add('ghost')
  }

  private clampWalkable(x: number, z: number): THREE.Vector2 {
    const p = walkable(x, z)
    return new THREE.Vector2(p.x, p.z)
  }

  private buildLandmarks() {
    for (const l of LANDMARKS) {
      if (l.id !== 'bell') {
        const { group, panel } = buildLandmark(this.fx, l.id)
        const y = l.id === 'dock' ? POND_Y - 0.02 : terrainH(l.x, l.z) - 0.02
        group.position.set(l.x, y, l.z)
        group.rotation.y = l.rot
        this.island.add(group)
        if (panel) this.shedPanel = panel
      }
      if (this.opts.labels === false) continue
      const div = document.createElement('div')
      div.className = 'si-place'
      div.textContent = l.name
      const label = new CSS2DObject(div)
      const top = l.id === 'lighthouse' ? 3.3 : l.id === 'windmill' ? 2.6 : l.id === 'bell' ? 1.6 : l.id.includes('cottage') ? 1.9 : 1.3
      label.position.set(l.x, terrainH(l.x, l.z) + top, l.z)
      this.island.add(label)
      this.landmarkLabels.push({ obj: label, x: l.x, z: l.z })
    }
  }

  private buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: this.skyU,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bottom, pow(-h, 0.45)); gl_FragColor = vec4(c, 1.0); }',
      }),
    )
    this.scene.add(sky)

    const N = 3200
    const geo = new THREE.BufferGeometry()
    const p = new Float32Array(N * 3)
    const s = new Float32Array(N)
    const ph = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1
      const th = Math.random() * Math.PI * 2
      const r = rand(380, 900)
      const q = Math.sqrt(1 - u * u)
      p[i * 3] = Math.cos(th) * q * r
      p[i * 3 + 1] = u * r
      p[i * 3 + 2] = Math.sin(th) * q * r
      s[i] = Math.random() < 0.05 ? rand(1.8, 3.0) : rand(0.5, 1.2)
      ph[i] = Math.random() * 20
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(s, 1))
    geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1))
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, opacity: { value: 0.3 }, scale: this.pointScale },
      vertexShader:
        'attribute float size; attribute float phase; uniform float time; uniform float scale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(1.5, size * scale / -mv.z); vA = 0.55 + 0.45 * sin(time * 1.3 + phase); gl_Position = projectionMatrix * mv; }',
      fragmentShader:
        'uniform float opacity; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.95, 0.92) * 1.2, a * vA * opacity); }',
    })
    this.scene.add(new THREE.Points(geo, this.starMat))

    const cloud = (hue: number) =>
      canvasTex(256, 256, (g) => {
        for (let i = 0; i < 34; i++) {
          const x = rand(70, 186)
          const y = rand(70, 186)
          const r = rand(28, 88)
          const gr = g.createRadialGradient(x, y, 0, x, y, r)
          gr.addColorStop(0, `hsla(${hue + rand(-25, 25)},85%,${rand(50, 68)}%,0.2)`)
          gr.addColorStop(1, `hsla(${hue},80%,40%,0)`)
          g.fillStyle = gr
          g.fillRect(0, 0, 256, 256)
        }
      })
    const nebulae: [number, THREE.Vector3, number][] = [
      [285, new THREE.Vector3(-0.6, 0.35, -0.7), 520],
      [190, new THREE.Vector3(0.75, -0.1, -0.55), 460],
      [320, new THREE.Vector3(0.2, 0.55, 0.8), 420],
      [250, new THREE.Vector3(-0.8, -0.4, 0.45), 380],
    ]
    for (const [hue, dir, sc] of nebulae) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloud(hue), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
      sp.position.copy(dir.normalize().multiplyScalar(650))
      sp.scale.setScalar(sc)
      this.scene.add(sp)
    }
  }

  private outerRing: THREE.Vector3[] = []

  private buildTerrain() {
    const N = 26
    const M = 96
    const pos: number[] = [0, terrainH(0, 0), 0]
    for (let i = 1; i <= N; i++) {
      const r0 = (TOP_R * i) / N
      for (let j = 0; j < M; j++) {
        const a = ((j + (i % 2) * 0.5) / M) * Math.PI * 2 + (i < N ? rand(-0.02, 0.02) : 0)
        const r = i < N ? r0 + rand(-0.07, 0.07) : r0
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        pos.push(x, terrainH(x, z), z)
        if (i === N) this.outerRing.push(new THREE.Vector3(x, terrainH(x, z), z))
      }
    }
    const idx: number[] = []
    for (let j = 0; j < M; j++) idx.push(0, 1 + ((j + 1) % M), 1 + j)
    for (let i = 1; i < N; i++) {
      const a0 = 1 + (i - 1) * M
      const a1 = 1 + i * M
      for (let j = 0; j < M; j++) {
        const j1 = (j + 1) % M
        idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j)
      }
    }
    let g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g = g.toNonIndexed()
    g.computeVertexNormals()
    const P = g.attributes.position
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P.count * 3), 3))
    for (let t = 0; t < P.count / 3; t++) {
      const cx = (P.getX(t * 3) + P.getX(t * 3 + 1) + P.getX(t * 3 + 2)) / 3
      const cz = (P.getZ(t * 3) + P.getZ(t * 3 + 1) + P.getZ(t * 3 + 2)) / 3
      const dp = Math.hypot(cx - POND.x, cz - POND.z)
      const sand = dp < POND.r + 0.32 || streamInfo(cx, cz).d < 0.3
      const rn = Math.hypot(cx, cz) / TOP_R
      this.terrainTris.push({ kind: sand ? 1 : 0, f: rand(0.84, 1.08) * (rn > 0.86 ? 0.9 : 1) })
    }
    this.terrainGeo = g
    this.terrainMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }))
    this.terrainMesh.receiveShadow = true
    this.island.add(this.terrainMesh)
    this.refreshTerrainColors()
  }

  private refreshTerrainColors() {
    const col = this.terrainGeo.attributes.color as THREE.BufferAttribute
    const c = new THREE.Color()
    for (let t = 0; t < this.terrainTris.length; t++) {
      const tr = this.terrainTris[t]
      c.copy(tr.kind ? this.sandColor : this.grassColor)
        .multiplyScalar(tr.f)
        .lerp(this.snowColor, this.snowAmt * (tr.kind ? 0.75 : 0.93))
      for (let v = 0; v < 3; v++) col.setXYZ(t * 3 + v, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }

  private buildUnderside() {
    const M = this.outerRing.length
    const rings: THREE.Vector3[][] = [this.outerRing]
    const prof: [number, number][] = [[0.995, -0.32], [0.955, -0.62], [0.86, -1.4], [0.72, -2.5], [0.55, -3.7], [0.37, -4.9], [0.19, -6.1]]
    prof.forEach(([rs, y], i) => {
      const ring: THREE.Vector3[] = []
      for (let j = 0; j < M; j++) {
        const a = (j / M) * Math.PI * 2
        const deep = y < -1
        const lump = deep ? 1 + 0.13 * Math.sin(a * 3 + i * 1.7) + 0.08 * Math.sin(a * 7 + i * 2.3) + rand(-0.035, 0.035) : 1
        const r = TOP_R * rs * lump
        const yy = deep ? y * K * 0.85 : y
        ring.push(new THREE.Vector3(Math.cos(a) * r, yy + (deep ? Math.sin(a * 5 + i) * 0.3 : 0), Math.sin(a) * r))
      }
      rings.push(ring)
    })
    const tip = new THREE.Vector3(0.15, -7.7 * K * 0.85, -0.1)
    const pos: number[] = []
    const pv = (v: THREE.Vector3) => pos.push(v.x, v.y, v.z)
    for (let i = 0; i < rings.length - 1; i++) {
      const U = rings[i]
      const L = rings[i + 1]
      for (let j = 0; j < M; j++) {
        const j1 = (j + 1) % M
        pv(U[j]); pv(U[j1]); pv(L[j]); pv(U[j1]); pv(L[j1]); pv(L[j])
      }
    }
    const last = rings[rings.length - 1]
    for (let j = 0; j < M; j++) {
      pv(last[j]); pv(last[(j + 1) % M]); pv(tip)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    const P = g.attributes.position
    const col = new Float32Array(P.count * 3)
    const D = K * 0.85
    const stops: [number, string][] = [[0.1, '#4f9a45'], [-0.45, '#4a8a40'], [-0.7, '#8a5a3a'], [-1.6 * D, '#6e4a3c'], [-3.0 * D, '#55405a'], [-4.6 * D, '#3c3152'], [-8 * D, '#241e38']]
    const c = new THREE.Color()
    const ca = new THREE.Color()
    const cb = new THREE.Color()
    for (let t = 0; t < P.count / 3; t++) {
      const cy = (P.getY(t * 3) + P.getY(t * 3 + 1) + P.getY(t * 3 + 2)) / 3
      let k = 0
      while (k < stops.length - 2 && cy < stops[k + 1][0]) k++
      const f = clamp((stops[k][0] - cy) / (stops[k][0] - stops[k + 1][0]), 0, 1)
      c.copy(ca.set(stops[k][1])).lerp(cb.set(stops[k + 1][1]), f).multiplyScalar(rand(0.85, 1.1))
      for (let v = 0; v < 3; v++) {
        col[(t * 3 + v) * 3] = c.r
        col[(t * 3 + v) * 3 + 1] = c.g
        col[(t * 3 + v) * 3 + 2] = c.b
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }))
    m.castShadow = true
    m.receiveShadow = true
    this.island.add(m)
  }

  private buildWater() {
    this.waterMat = new THREE.MeshStandardMaterial({ color: '#46c2ff', emissive: '#0b4f86', emissiveIntensity: 0.5, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.9 })
    const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 48), this.waterMat)
    pond.rotation.x = -Math.PI / 2
    pond.position.set(POND.x, POND_Y, POND.z)
    pond.receiveShadow = true
    this.island.add(pond)

    const pos: number[] = []
    const steps = 14
    const n = new THREE.Vector2(-STREAM_DIR.z, STREAM_DIR.x)
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const cx = STREAM_START.x + (STREAM_END.x - STREAM_START.x) * t
      const cz = STREAM_START.z + (STREAM_END.z - STREAM_START.z) * t
      const w = (0.3 + 0.05 * Math.sin(t * 9)) / 2
      const y = streamLevel(t)
      pos.push(cx + n.x * w, y, cz + n.y * w, cx - n.x * w, y, cz - n.y * w)
    }
    const idx: number[] = []
    for (let k = 0; k < steps; k++) {
      const a = k * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    this.island.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#46c2ff', emissive: '#0b4f86', emissiveIntensity: 0.55, roughness: 0.1, side: THREE.DoubleSide })))

    const N = 260
    this.fallPos = new Float32Array(N * 3)
    this.fallLife = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      this.fallVel.push(new THREE.Vector3())
      this.respawnFall(i)
      this.fallLife[i] = rand(0, 1.8)
    }
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(this.fallPos, 3))
    this.fall = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.1, map: this.fx.glowTex, color: new THREE.Color('#bfe9ff'), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.fall.frustumCulled = false
    this.island.add(this.fall)
  }

  private respawnFall(i: number) {
    const lat = rand(-0.14, 0.14)
    const E = { x: STREAM_END.x, y: streamLevel(1), z: STREAM_END.z }
    this.fallPos[i * 3] = E.x - STREAM_DIR.z * lat
    this.fallPos[i * 3 + 1] = E.y
    this.fallPos[i * 3 + 2] = E.z + STREAM_DIR.x * lat
    this.fallVel[i].set(STREAM_DIR.x * rand(0.5, 0.9), rand(-0.1, 0.15), STREAM_DIR.z * rand(0.5, 0.9))
    this.fallLife[i] = 0
  }

  private buildShards() {
    for (let i = 0; i < 11; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.18, 0.5), 0), new THREE.MeshStandardMaterial({ color: pick(['#5a4560', '#6e4a3c', '#4a3d5e']), flatShading: true, roughness: 0.9 }))
      m.scale.setScalar(K * 0.8)
      m.userData = { a: rand(0, Math.PI * 2), r: rand(6.8, 9.5) * K, y: rand(-6.5, -1.2) * K, s: rand(0.03, 0.07) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, 6) }
      m.castShadow = true
      this.island.add(m)
      this.shards.push(m)
    }
  }

  private buildSmoke() {
    const g = this.smokeGeo
    g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3))
    g.setAttribute('size', new THREE.BufferAttribute(this.sSize, 1))
    g.setAttribute('alpha', new THREE.BufferAttribute(this.sAlpha, 1))
    g.setAttribute('tint', new THREE.BufferAttribute(this.sTint, 3))
    const smoke = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { map: { value: this.fx.glowTex }, scale: this.pointScale },
        vertexShader:
          'attribute float size; attribute float alpha; attribute vec3 tint; uniform float scale; varying float vA; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; vA = alpha; vC = tint; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }',
      }),
    )
    smoke.frustumCulled = false
    this.scene.add(smoke)
  }

  private buildWeather() {
    const RAIN_N = 1800
    this.rainPos = new Float32Array(RAIN_N * 6)
    this.rainSpd = new Float32Array(RAIN_N)
    for (let i = 0; i < RAIN_N; i++) {
      const a = rand(0, Math.PI * 2)
      const r = Math.sqrt(Math.random()) * 11 * K
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = rand(-7, 16)
      this.rainPos.set([x, y, z, x - 0.03, y + 0.45, z], i * 6)
      this.rainSpd[i] = rand(11, 16)
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3))
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: new THREE.Color('#a8c8ff'), transparent: true, opacity: 0, depthWrite: false }))
    this.rain.frustumCulled = false
    this.scene.add(this.rain)

    const SNOW_N = 1500
    this.snowPos = new Float32Array(SNOW_N * 3)
    this.snowPh = new Float32Array(SNOW_N)
    for (let i = 0; i < SNOW_N; i++) {
      const a = rand(0, Math.PI * 2)
      const r = Math.sqrt(Math.random()) * 11 * K
      this.snowPos.set([Math.cos(a) * r, rand(-7, 14), Math.sin(a) * r], i * 3)
      this.snowPh[i] = rand(0, 10)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3))
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.13, map: this.fx.glowTex, color: new THREE.Color('#ffffff'), transparent: true, opacity: 0, depthWrite: false }))
    this.snow.frustumCulled = false
    this.scene.add(this.snow)

    const FF_N = 200
    this.ffPos = new Float32Array(FF_N * 3)
    for (let i = 0; i < FF_N; i++) {
      const a = rand(0, Math.PI * 2)
      const r = Math.sqrt(Math.random()) * ISLAND.USABLE_R
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      this.ffBase.push({ x, z, y: terrainH(x, z) + rand(0.25, 2.2), ph: rand(0, 10), sp: rand(0.4, 0.9) })
    }
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(this.ffPos, 3))
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.2, map: this.fx.glowTex, color: new THREE.Color('#ffe27a').multiplyScalar(1.9), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.fireflies.frustumCulled = false
    this.island.add(this.fireflies)
  }

  // ─── environment ───────────────────────────────────────────────────────────

  private envFrom(name: TimeOfDay) {
    const P = TIMES[name]
    return {
      sun: new THREE.Color(P.sun), sunI: P.sunI, sunPos: new THREE.Vector3(...P.sunPos), hemiSky: new THREE.Color(P.hemiSky),
      hemiGround: new THREE.Color(P.hemiGround), hemiI: P.hemiI, top: new THREE.Color(P.top), mid: new THREE.Color(P.mid),
      bottom: new THREE.Color(P.bottom), stars: P.stars, glow: P.glow, exposure: P.exposure,
    }
  }

  private copyEnv(src: ReturnType<IslandScene['envFrom']>) {
    this.env.sun.copy(src.sun)
    this.env.sunI = src.sunI
    this.env.sunPos.copy(src.sunPos)
    this.env.hemiSky.copy(src.hemiSky)
    this.env.hemiGround.copy(src.hemiGround)
    this.env.hemiI = src.hemiI
    this.env.top.copy(src.top)
    this.env.mid.copy(src.mid)
    this.env.bottom.copy(src.bottom)
    this.env.stars = src.stars
    this.env.glow = src.glow
    this.env.exposure = src.exposure
  }

  private applyEnv() {
    const dark = 1 - this.lightsOut * 0.88
    this.sun.color.copy(this.env.sun)
    this.sun.intensity = this.env.sunI * dark
    this.sun.position.copy(this.env.sunPos).add(this.sunFocus)
    this.sun.target.position.copy(this.sunFocus)
    this.hemi.color.copy(this.env.hemiSky)
    this.hemi.groundColor.copy(this.env.hemiGround)
    this.hemi.intensity = this.env.hemiI * (1 - this.lightsOut * 0.8)
    this.skyU.top.value.copy(this.env.top).multiplyScalar(1 - this.lightsOut * 0.6)
    this.skyU.mid.value.copy(this.env.mid).multiplyScalar(1 - this.lightsOut * 0.6)
    this.skyU.bottom.value.copy(this.env.bottom)
    this.starMat.uniforms.opacity.value = this.env.stars
    this.renderer.toneMappingExposure = this.env.exposure
    ;(this.scene.fog as THREE.FogExp2).color.copy(this.env.mid)
  }

  private setTime(name: TimeOfDay, dur = 3000) {
    this.currentTime = name
    const tok = ++this.envToken
    const from = this.envFrom('day')
    from.sun.copy(this.env.sun)
    from.sunI = this.env.sunI
    from.sunPos.copy(this.env.sunPos)
    from.hemiSky.copy(this.env.hemiSky)
    from.hemiGround.copy(this.env.hemiGround)
    from.hemiI = this.env.hemiI
    from.top.copy(this.env.top)
    from.mid.copy(this.env.mid)
    from.bottom.copy(this.env.bottom)
    from.stars = this.env.stars
    from.glow = this.env.glow
    from.exposure = this.env.exposure
    const to = this.envFrom(name)
    this.tween(dur, (k) => {
      if (tok !== this.envToken) return
      const e = this.env
      e.sun.lerpColors(from.sun, to.sun, k)
      e.sunI = from.sunI + (to.sunI - from.sunI) * k
      e.sunPos.lerpVectors(from.sunPos, to.sunPos, k)
      e.hemiSky.lerpColors(from.hemiSky, to.hemiSky, k)
      e.hemiGround.lerpColors(from.hemiGround, to.hemiGround, k)
      e.hemiI = from.hemiI + (to.hemiI - from.hemiI) * k
      e.top.lerpColors(from.top, to.top, k)
      e.mid.lerpColors(from.mid, to.mid, k)
      e.bottom.lerpColors(from.bottom, to.bottom, k)
      e.stars = from.stars + (to.stars - from.stars) * k
      e.glow = from.glow + (to.glow - from.glow) * k
      e.exposure = from.exposure + (to.exposure - from.exposure) * k
    })
  }

  private setWeather(w: Weather) {
    const t = this.weatherTarget
    t.rain = w === 'rain' ? 1 : 0
    t.snow = w === 'snow' ? 1 : 0
    t.fog = w === 'fog' ? 1 : 0
    t.fireflies = w === 'fireflies' ? 1 : 0
  }

  // ─── effects ───────────────────────────────────────────────────────────────

  private placeBeam(pos: THREE.Vector3, color: string) {
    const m = new THREE.Mesh(
      this.placeBeamGeo,
      new THREE.MeshBasicMaterial({ map: this.fx.beamUpTex, color: new THREE.Color(color).multiplyScalar(1.3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    m.position.copy(pos)
    this.island.add(m)
    this.pbeams.push({ m, life: 0, max: 0.9 })
  }

  private burst(pos: THREE.Vector3, color: string, n = 26) {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(n * 3)
    const v: THREE.Vector3[] = []
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x
      p[i * 3 + 1] = pos.y
      p[i * 3 + 2] = pos.z
      v.push(new THREE.Vector3(rand(-1, 1), rand(0.8, 2.6), rand(-1, 1)))
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.13, map: this.fx.glowTex, color: new THREE.Color(color).multiplyScalar(1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    pts.frustumCulled = false
    this.island.add(pts)
    this.bursts.push({ pts, v, life: 0, max: 1.1 })
  }

  private spawnSmoke(pos: THREE.Vector3, e: { rise: number; size: number; alpha: number; tint: THREE.Color }) {
    const i = this.smokePtr
    this.smokePtr = (this.smokePtr + 1) % 320
    this.sPos[i * 3] = pos.x + rand(-0.04, 0.04)
    this.sPos[i * 3 + 1] = pos.y
    this.sPos[i * 3 + 2] = pos.z + rand(-0.04, 0.04)
    this.sVel[i].set(rand(-0.07, 0.07) + 0.06, e.rise * rand(0.8, 1.2), rand(-0.07, 0.07))
    this.sLife[i] = 0
    this.sMax[i] = rand(2.2, 3.4)
    this.sBase[i] = e.size * rand(0.8, 1.2)
    this.sA[i] = e.alpha
    this.sTint[i * 3] = e.tint.r
    this.sTint[i * 3 + 1] = e.tint.g
    this.sTint[i * 3 + 2] = e.tint.b
  }

  private tween(dur: number, fn: (k: number) => void, ease: (t: number) => number = EASE.inOutCubic): Promise<void> {
    if (this.reduceMotion) dur = 1
    return new Promise((resolve) => this.tweens.push({ t0: performance.now(), dur, fn, ease, resolve }))
  }

  private swoop(target: THREE.Vector3, offset: THREE.Vector3, dur: number): Promise<void> {
    this.camTweening = true
    this.controls.autoRotate = false
    const fromCam = this.camera.position.clone()
    const fromT = this.controls.target.clone()
    const toCam = target.clone().add(offset)
    return this.tween(dur, (k) => {
      this.camera.position.lerpVectors(fromCam, toCam, k)
      this.controls.target.lerpVectors(fromT, target, k)
      this.camera.lookAt(this.controls.target)
    }).then(() => {
      this.camTweening = false
    })
  }

  // ─── input ─────────────────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), yaw: this.followYaw, dragging: false }
  }

  /** Dragging turns the follow camera around the player; a click without a drag still walks. */
  private onPointerMove = (e: PointerEvent) => {
    const d = this.pointerDown
    if (!d || this.camMode !== 'follow' || this.meeting) return
    const dx = e.clientX - d.x
    if (!d.dragging && Math.abs(dx) < 6) return
    if (!d.dragging) {
      d.dragging = true
      this.renderer.domElement.setPointerCapture?.(e.pointerId)
    }
    const w = this.container.clientWidth || window.innerWidth
    this.followYaw = d.yaw - (dx / w) * Math.PI * 1.6
  }

  private onPointerCancel = () => {
    this.pointerDown = null
  }

  private onPointerUp = (e: PointerEvent) => {
    const d = this.pointerDown
    this.pointerDown = null
    if (!d) return
    if (d.dragging || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    if (this.opts.onBellClick && this.raycaster.intersectObject(this.bellGroup, true).length) {
      this.opts.onBellClick()
      return
    }
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0]
    if (!hit) return
    const local = this.island.worldToLocal(hit.point.clone())
    const me = this.controlledId ? this.characters.get(this.controlledId) : null
    if (me && this.canMove && !this.meeting && !me.gone && !me.ejecting) {
      me.target = this.clampWalkable(local.x, local.z)
      me.remote = null
    }
    this.opts.onGroundClick?.(local.x, local.z)
  }

  private onWheel = (e: WheelEvent) => {
    if (this.camMode !== 'follow') return
    this.followZoom = clamp(this.followZoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.6, 1.8)
  }

  private static MOVE_KEYS: Record<string, [number, number]> = {
    w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (!IslandScene.MOVE_KEYS[k]) return
    if (k.startsWith('arrow')) e.preventDefault()
    this.keys.add(k)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase())
  }

  private onBlur = () => {
    this.keys.clear()
  }

  private followCam(dt: number) {
    const me = this.controlledId ? this.characters.get(this.controlledId) : null
    if (!me || this.meeting) return
    const ground = terrainH(me.pos.x, me.pos.y)
    const focus = this.island.localToWorld(this.tmpV.set(me.pos.x, ground + 0.35, me.pos.y)).clone()
    // Narrow portrait screens see less sideways, so the camera pulls back.
    const z = this.followZoom * (this.camera.aspect < 0.8 ? 1.55 : 1)
    const want = focus.clone().add(new THREE.Vector3(Math.sin(this.followYaw) * 5.3 * z, 4.9 * z, Math.cos(this.followYaw) * 5.3 * z))
    const k = Math.min(1, dt * 5)
    this.camera.position.lerp(want, k)
    this.controls.target.lerp(focus, k)
    this.camera.lookAt(this.controls.target)
    this.sunFocus.set(me.pos.x, 0, me.pos.y)
  }

  /** Slide the picture sideways (a fraction of the width) so copy can sit beside the island. */
  setViewShift(fraction: number) {
    this.viewShift = fraction
    this.onResize()
  }

  private viewShift = 0

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    if (this.viewShift) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.bloom.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.updatePointScale(h)
  }

  private updatePointScale(h: number) {
    this.pointScale.value = (h * Math.min(window.devicePixelRatio || 1, 1.5)) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))
  }

  // ─── frame loop ────────────────────────────────────────────────────────────

  private frame = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this.elapsed += dt
    const t = this.elapsed
    const now = performance.now()

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]
      const p = clamp((now - tw.t0) / tw.dur, 0, 1)
      tw.fn(tw.ease(p))
      if (p >= 1) {
        this.tweens.splice(i, 1)
        tw.resolve()
      }
    }

    this.lightsOut += (this.lightsOutTarget - this.lightsOut) * Math.min(1, dt * 2.5)
    this.applyEnv()
    this.island.position.y = Math.sin(t * 0.6) * 0.22
    this.starMat.uniforms.time.value = t
    const glow = Math.min(1, this.env.glow + this.lightsOut)
    const fx = this.fx

    if (Math.floor(t * 0.5) !== Math.floor((t - dt) * 0.5)) fx.prune()
    for (const s of fx.spinners) s.obj.rotation[s.axis] += s.speed * dt
    for (const f of fx.floaters) {
      if (!f.root.visible) continue
      if (f.baseY === undefined) f.baseY = f.obj.position.y
      f.obj.position.y = f.baseY + Math.sin(t * f.speed + f.phase) * f.amp
      if (f.rock) f.obj.rotation.z = Math.sin(t * f.speed * 0.8 + f.phase) * f.rock
      if (f.spin) f.obj.rotation.y += f.spin * dt
    }
    for (const f of fx.flickers) {
      f.obj.scale.y = 1 + Math.sin(t * 17 + f.phase) * 0.14 + Math.sin(t * 29 + f.phase) * 0.08
      f.obj.scale.x = f.obj.scale.z = 1 + Math.sin(t * 13 + f.phase) * 0.06
    }
    for (const g of fx.glowMats) g.m.emissiveIntensity = g.base + g.night * glow
    const flick = 0.85 + Math.sin(t * 14) * 0.08 + Math.sin(t * 23) * 0.07
    for (const g of fx.groundGlows) (g.m.material as THREE.MeshBasicMaterial).opacity = (g.base + g.night * glow) * flick
    for (const h of fx.haloSprites) h.s.material.opacity = Math.min(1, (h.base + h.night * glow) * flick)
    for (const b of fx.beamMats) b.m.opacity = 0.005 + 0.07 * glow
    for (const w of fx.wavers) {
      const p = w.geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const x = w.base[i * 3]
        p.setZ(i, Math.sin(t * 5 + x * 10) * 0.07 * (x / 0.55))
      }
      p.needsUpdate = true
      w.geo.computeVertexNormals()
    }
    for (const e of fx.emitters) {
      if (!e.root.visible || !e.root.parent) continue
      e.acc += dt * e.rate
      while (e.acc >= 1) {
        e.acc -= 1
        this.spawnSmoke(e.root.localToWorld(this.tmpV.copy(e.offset)), e)
      }
    }
    for (let i = 0; i < 320; i++) {
      if (this.sLife[i] < 0) {
        this.sAlpha[i] = 0
        continue
      }
      this.sLife[i] += dt
      const k = this.sLife[i] / this.sMax[i]
      if (k >= 1) {
        this.sLife[i] = -1
        this.sAlpha[i] = 0
        continue
      }
      this.sPos[i * 3] += this.sVel[i].x * dt
      this.sPos[i * 3 + 1] += this.sVel[i].y * dt
      this.sPos[i * 3 + 2] += this.sVel[i].z * dt
      this.sSize[i] = this.sBase[i] * (0.35 + k * 1.5)
      this.sAlpha[i] = Math.sin(Math.PI * k) * this.sA[i]
    }
    for (const name of ['position', 'size', 'alpha', 'tint']) (this.smokeGeo.attributes[name] as THREE.BufferAttribute).needsUpdate = true

    this.waterMat.emissiveIntensity = 0.42 + Math.sin(t * 1.3) * 0.08 + glow * 0.25
    for (let i = 0; i < this.fallLife.length; i++) {
      this.fallLife[i] += dt
      if (this.fallLife[i] > 1.9) {
        this.respawnFall(i)
        continue
      }
      this.fallVel[i].y -= 7 * dt
      this.fallPos[i * 3] += this.fallVel[i].x * dt
      this.fallPos[i * 3 + 1] += this.fallVel[i].y * dt
      this.fallPos[i * 3 + 2] += this.fallVel[i].z * dt
    }
    ;(this.fall.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    this.rippleT += dt
    if (this.rippleT > 1.1) {
      this.rippleT = 0
      const a = rand(0, Math.PI * 2)
      const r = rand(0, POND.r - 0.4)
      const m = new THREE.Mesh(this.rippleGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8f4ff').multiplyScalar(0.8), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }))
      m.rotation.x = -Math.PI / 2
      m.position.set(POND.x + Math.cos(a) * r, POND_Y + 0.01, POND.z + Math.sin(a) * r)
      this.island.add(m)
      this.ripples.push({ m, life: 0 })
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i]
      rp.life += dt
      const k = rp.life / 2.2
      rp.m.scale.setScalar(1 + k * 4)
      ;(rp.m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k)
      if (k >= 1) {
        this.island.remove(rp.m)
        ;(rp.m.material as THREE.Material).dispose()
        this.ripples.splice(i, 1)
      }
    }
    for (const s of this.shards) {
      const u = s.userData as { a: number; r: number; y: number; s: number; ph: number }
      const a = u.a + t * u.s
      s.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.8 + u.ph) * 0.3, Math.sin(a) * u.r)
      s.rotation.x += dt * 0.2
      s.rotation.y += dt * 0.3
    }

    const W = this.weather
    const WT = this.weatherTarget
    W.rain += (WT.rain - W.rain) * Math.min(1, dt * 0.9)
    W.snow += (WT.snow - W.snow) * Math.min(1, dt * 0.9)
    W.fog += (WT.fog - W.fog) * Math.min(1, dt * 0.9)
    W.fireflies += (WT.fireflies - W.fireflies) * Math.min(1, dt * 0.9)
    ;(this.rain.material as THREE.LineBasicMaterial).opacity = W.rain * 0.55
    this.rain.visible = W.rain > 0.01
    if (this.rain.visible) {
      for (let i = 0; i < this.rainSpd.length; i++) {
        let y = this.rainPos[i * 6 + 1] - this.rainSpd[i] * dt
        if (y < -7) y = 16
        this.rainPos[i * 6 + 1] = y
        this.rainPos[i * 6 + 4] = y + 0.45
      }
      ;(this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }
    ;(this.snow.material as THREE.PointsMaterial).opacity = W.snow * 0.95
    this.snow.visible = W.snow > 0.01
    if (this.snow.visible) {
      for (let i = 0; i < this.snowPh.length; i++) {
        let y = this.snowPos[i * 3 + 1] - 1.1 * dt
        if (y < -7) y = 14
        this.snowPos[i * 3 + 1] = y
        this.snowPos[i * 3] += Math.sin(t * 0.9 + this.snowPh[i]) * 0.25 * dt
      }
      ;(this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }
    if (Math.abs(this.snowAmt - W.snow) > 0.004) {
      this.snowAmt = W.snow
      this.refreshTerrainColors()
    }
    ;(this.fireflies.material as THREE.PointsMaterial).opacity = W.fireflies * (0.55 + 0.45 * glow)
    this.fireflies.visible = W.fireflies > 0.01
    if (this.fireflies.visible) {
      for (let i = 0; i < this.ffBase.length; i++) {
        const b = this.ffBase[i]
        this.ffPos[i * 3] = b.x + Math.sin(t * b.sp + b.ph) * 0.5
        this.ffPos[i * 3 + 1] = b.y + Math.sin(t * b.sp * 1.7 + b.ph) * 0.3
        this.ffPos[i * 3 + 2] = b.z + Math.cos(t * b.sp * 0.8 + b.ph) * 0.5
      }
      ;(this.fireflies.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }
    ;(this.scene.fog as THREE.FogExp2).density = 0.008 + W.fog * 0.04
    this.bloom.strength = 0.42 + glow * 0.1

    for (let i = this.pbeams.length - 1; i >= 0; i--) {
      const b = this.pbeams[i]
      b.life += dt
      const k = b.life / b.max
      ;(b.m.material as THREE.MeshBasicMaterial).opacity = 1 - k
      b.m.scale.set(1 - k * 0.7, 1, 1 - k * 0.7)
      if (k >= 1) {
        this.island.remove(b.m)
        ;(b.m.material as THREE.Material).dispose()
        this.pbeams.splice(i, 1)
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]
      b.life += dt
      const p = b.pts.geometry.attributes.position as THREE.BufferAttribute
      for (let j = 0; j < b.v.length; j++) {
        b.v[j].y -= 3.2 * dt
        p.setXYZ(j, p.getX(j) + b.v[j].x * dt, p.getY(j) + b.v[j].y * dt, p.getZ(j) + b.v[j].z * dt)
      }
      p.needsUpdate = true
      ;(b.pts.material as THREE.PointsMaterial).opacity = 1 - b.life / b.max
      if (b.life >= b.max) {
        this.island.remove(b.pts)
        b.pts.geometry.dispose()
        ;(b.pts.material as THREE.Material).dispose()
        this.bursts.splice(i, 1)
      }
    }
    const aOp = this.agentBeamMat.opacity + (this.agentTarget * (0.32 + Math.sin(t * 6) * 0.06) - this.agentBeamMat.opacity) * Math.min(1, dt * 4)
    this.agentBeamMat.opacity = aOp
    this.agentRingMat.opacity = aOp * 2.2
    this.agentBeam.visible = aOp > 0.005
    this.agentRings.forEach((r, i) => {
      r.visible = this.agentBeam.visible
      r.rotation.z += dt * (0.8 + i * 0.4) * (i % 2 ? -1 : 1)
      const s = 1 + Math.sin(t * 3 + i) * 0.08
      r.scale.set(s, s, s)
      r.position.y = 1.2 + i * 0.5 + Math.sin(t * 2 + i) * 0.15
    })
    for (const h of this.highlights) {
      if ((h as THREE.MeshStandardMaterial).isMaterial) (h as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(t * 6) * 0.5
      else {
        const s = 1 + Math.sin(t * 4) * 0.12
        ;(h as THREE.Mesh).scale.set(s, s, s)
      }
    }
    if (this.bellRing > 0) {
      this.bellRing -= dt
      this.bellGroup.rotation.z = Math.sin(t * 30) * 0.03 * Math.min(1, this.bellRing)
    } else this.bellGroup.rotation.z = 0
    ;(this.bellButton.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45 + Math.sin(t * 3) * 0.25

    this.updateCharacters(dt, t)

    if (this.focusRing.visible) {
      this.focusMat.opacity = 0.45 + Math.sin(t * 4) * 0.2
      this.focusRing.rotation.z += dt * 0.6
    }
    if (this.shedPanel) {
      if (this.lightsOutTarget > 0) {
        this.shedPanel.emissive.set('#ff2a4a')
        this.shedPanel.emissiveIntensity = 0.5 + Math.max(0, Math.sin(t * 8)) * 1.4
      } else {
        this.shedPanel.emissive.set('#ffb020')
        this.shedPanel.emissiveIntensity = 0.8 + glow * 0.5
      }
    }
    if (this.camMode === 'follow') {
      const me = this.controlledId ? this.characters.get(this.controlledId) : null
      for (const l of this.landmarkLabels) {
        const d = me ? Math.hypot(me.pos.x - l.x, me.pos.y - l.z) : 0
        l.obj.element.style.opacity = String(clamp(1.4 - d / 9, 0.15, 1))
      }
    } else if (this.landmarkLabels.length && this.landmarkLabels[0].obj.element.style.opacity !== '1') {
      for (const l of this.landmarkLabels) l.obj.element.style.opacity = '1'
      this.sunFocus.set(0, 0, 0)
    }

    if (!this.camTweening) {
      if (this.camMode === 'follow') this.followCam(dt)
      else {
        if (!this.reduceMotion && !this.controls.autoRotate && !this.meeting && performance.now() - this.lastInteract > 9000 && this.lastInteract > 0) this.controls.autoRotate = true
        this.controls.update()
      }
    }
    this.updateVisionOverlay(dt)
    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
  }

  private updateCharacters(dt: number, t: number) {
    for (const c of this.characters.values()) {
      const m = c.model
      if (c.ejecting) {
        // Wall clock, not frame time, so a slow screen does not stretch the flight past the eject phase.
        c.ejectT = (performance.now() - c.ejectStart) / 1000
        c.ejectV.multiplyScalar(1 + dt * 0.4)
        m.root.position.addScaledVector(c.ejectV, dt)
        m.root.rotation.x += dt * 2.2
        m.root.rotation.z += dt * 1.4
        m.root.scale.setScalar(Math.max(0.01, 1 - c.ejectT * 0.12))
        c.labelDiv.style.opacity = String(Math.max(0, 1 - c.ejectT * 0.5))
        if (c.ejectT > 6) {
          if (c.player.ghost) this.reviveAsGhost(c)
          else {
            c.ejecting = false
            c.gone = true
            m.root.visible = false
          }
        }
        continue
      }
      if (c.gone) continue
      // light of your own: during a blackout everyone carries a small lantern
      m.light.intensity = this.lightsOut * 2.2
      m.glow.material.opacity = 0.15 + this.lightsOut * 0.35
      const controlled = c.player.id === this.controlledId
      if (!c.target && !this.meeting && !controlled && this.elapsed > c.nextWander && this.elapsed > c.busyUntil) {
        if (c.remote) c.target = c.remote.clone()
        else if (c.player.wanders) {
          const a = rand(0, Math.PI * 2)
          const r = rand(0.4, 2.2)
          c.target = this.clampWalkable(c.home.x + Math.cos(a) * r, c.home.y + Math.sin(a) * r)
        }
        c.nextWander = this.elapsed + rand(2.5, 6)
      }
      let moving = false
      const turn = (dx: number, dz: number) => {
        const want = Math.atan2(dx, dz)
        let diff = want - c.heading
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        c.heading += diff * Math.min(1, dt * 12)
      }
      let ix = 0
      let iz = 0
      if (controlled && this.canMove && !this.meeting) {
        for (const k of this.keys) {
          const v = IslandScene.MOVE_KEYS[k]
          if (v) {
            ix += v[0]
            iz += v[1]
          }
        }
      }
      if ((ix || iz) && this.camMode === 'follow' && this.followYaw) {
        // Keys move relative to the camera, so W always walks away from you.
        const cy = Math.cos(this.followYaw)
        const sy = Math.sin(this.followYaw)
        const rx = ix * cy + iz * sy
        const rz = -ix * sy + iz * cy
        ix = rx
        iz = rz
      }
      if (ix || iz) {
        c.target = null
        const len = Math.hypot(ix, iz)
        const next = this.clampWalkable(c.pos.x + (ix / len) * WALK_SPEED * dt, c.pos.y + (iz / len) * WALK_SPEED * dt)
        if (next.distanceToSquared(c.pos) > 1e-8) {
          moving = true
          turn(ix, iz)
          c.pos.copy(next)
        }
      } else if (c.target) {
        const d = new THREE.Vector2().subVectors(c.target, c.pos)
        const dist = d.length()
        if (dist < 0.05) {
          c.target = null
          c.nextWander = this.elapsed + rand(2, 5)
        } else {
          moving = true
          const speed = controlled ? WALK_SPEED : c.remote ? Math.max(WALK_SPEED * 1.15, dist * 5) : 1.6
          d.normalize()
          const next = this.clampWalkable(c.pos.x + d.x * Math.min(dist, speed * dt), c.pos.y + d.y * Math.min(dist, speed * dt))
          // Stuck against a wall: give up on this target instead of pushing forever.
          if (next.distanceToSquared(c.pos) < 1e-7) c.target = null
          c.pos.copy(next)
          turn(d.x, d.y)
        }
      }
      if (c.route && !controlled && !this.meeting) {
        const p = routePos(c.route, this.clockFn(), { x: c.pos.x, z: c.pos.y })
        const dx = p.x - c.pos.x
        const dz = p.z - c.pos.y
        const d = Math.hypot(dx, dz)
        if (d > 3) c.pos.set(p.x, p.z)
        else if (d > 0.002) {
          moving = true
          turn(dx, dz)
          c.pos.set(p.x, p.z)
        }
        c.target = null
      }
      if (controlled && moving) this.opts.onMyMove?.(c.pos.x, c.pos.y)
      c.walkPhase += dt * (moving ? 14 : 2)
      const ground = terrainH(c.pos.x, c.pos.y) + (c.ghost ? 0.35 + Math.sin(t * 1.6 + c.walkPhase * 0.1) * 0.08 : 0)
      const hop = c.ghost ? 0 : moving ? Math.abs(Math.sin(c.walkPhase)) * 0.06 : Math.sin(c.walkPhase) * 0.01
      m.root.position.set(c.pos.x, ground + hop, c.pos.y)
      m.root.rotation.set(0, c.heading, moving ? Math.sin(c.walkPhase) * 0.08 : 0)
      m.feet[0].position.z = 0.03 + (moving ? Math.sin(c.walkPhase) * 0.06 : 0)
      m.feet[1].position.z = 0.03 - (moving ? Math.sin(c.walkPhase) * 0.06 : 0)
      m.sprout.rotation.z = Math.sin(t * 2.4 + c.walkPhase * 0.3) * 0.15
      m.body.scale.y = 0.95 + Math.sin(t * 2 + c.walkPhase * 0.2) * 0.02
      if (!controlled) {
        const seen = this.canSee(c)
        if (m.root.visible !== seen) {
          m.root.visible = seen
          c.label.visible = seen
        }
      }
    }
  }

  private canSee(c: Character): boolean {
    if (this.visionR === null || this.meeting || this.camMode !== 'follow') return true
    const me = this.controlledId ? this.characters.get(this.controlledId) : null
    if (!me) return true
    return me.pos.distanceTo(c.pos) <= this.visionR + 0.25
  }

  /** Put the vision circle's on-screen size into CSS variables on the overlay. */
  private updateVisionOverlay(dt: number) {
    const el = this.visionEl
    if (!el) return
    const me = this.controlledId ? this.characters.get(this.controlledId) : null
    const w = this.renderer.domElement.clientWidth || 1
    const h = this.renderer.domElement.clientHeight || 1
    let rx = w * 1.5
    let ry = h * 1.5
    let cx = w / 2
    let cy = h / 2
    if (me && this.visionR !== null && this.camMode === 'follow' && !this.meeting) {
      const ground = terrainH(me.pos.x, me.pos.y) + 0.3
      const c = this.island.localToWorld(new THREE.Vector3(me.pos.x, ground, me.pos.y)).project(this.camera)
      // Measure along the camera's own right and forward directions, so turning the camera keeps the circle right.
      const cyaw = Math.cos(this.followYaw)
      const syaw = Math.sin(this.followYaw)
      const R = this.visionR
      const ex = this.island.localToWorld(new THREE.Vector3(me.pos.x + cyaw * R, ground, me.pos.y - syaw * R)).project(this.camera)
      const ez = this.island.localToWorld(new THREE.Vector3(me.pos.x - syaw * R, ground, me.pos.y - cyaw * R)).project(this.camera)
      cx = ((c.x + 1) / 2) * w
      cy = ((1 - c.y) / 2) * h
      rx = Math.hypot(((ex.x + 1) / 2) * w - cx, ((1 - ex.y) / 2) * h - cy)
      ry = Math.abs(((1 - ez.y) / 2) * h - cy)
    }
    const k = Math.min(1, dt * 4)
    this.visionShown.rx += (rx - this.visionShown.rx) * k
    this.visionShown.ry += (ry - this.visionShown.ry) * k
    el.style.setProperty('--cx', `${cx.toFixed(1)}px`)
    el.style.setProperty('--cy', `${cy.toFixed(1)}px`)
    el.style.setProperty('--rx', `${this.visionShown.rx.toFixed(1)}px`)
    el.style.setProperty('--ry', `${this.visionShown.ry.toFixed(1)}px`)
  }

  /** Smoothstep re-export for HUD helpers that want the same easing. */
  static smooth = smooth
}
