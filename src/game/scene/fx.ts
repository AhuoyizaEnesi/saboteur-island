/**
 * Shared textures, materials and the animation registries that the island's
 * objects hook into (spinning windmill sails, flickering fires, glow that
 * rises at night, smoke). One Fx instance lives per IslandScene.
 */

import * as THREE from 'three'

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (ctx) draw(ctx, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]

export interface Emitter {
  root: THREE.Object3D
  offset: THREE.Vector3
  rate: number
  acc: number
  tint: THREE.Color
  size: number
  alpha: number
  rise: number
}

export interface Floater {
  root: THREE.Object3D
  obj: THREE.Object3D
  amp: number
  speed: number
  phase: number
  rock?: number
  spin?: number
  baseY?: number
}

export class Fx {
  glowTex = canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.2, 'rgba(255,255,255,0.65)')
    r.addColorStop(0.5, 'rgba(255,255,255,0.16)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 128, 128)
  })
  beamUpTex = canvasTex(4, 256, (g) => {
    const r = g.createLinearGradient(0, 256, 0, 0)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.3, 'rgba(255,255,255,0.45)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 4, 256)
  })
  beamTipTex = canvasTex(4, 256, (g) => {
    const r = g.createLinearGradient(0, 0, 0, 256)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.5, 'rgba(255,255,255,0.3)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 4, 256)
  })

  private matCache = new Map<string, THREE.MeshStandardMaterial>()
  glowMats: { m: THREE.MeshStandardMaterial; base: number; night: number }[] = []
  spinners: { root: THREE.Object3D; obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = []
  floaters: Floater[] = []
  flickers: { root: THREE.Object3D; obj: THREE.Object3D; phase: number }[] = []
  beamMats: { root: THREE.Object3D; m: THREE.MeshBasicMaterial }[] = []
  wavers: { root: THREE.Object3D; geo: THREE.BufferGeometry; base: Float32Array }[] = []
  emitters: Emitter[] = []
  groundGlows: { root: THREE.Object3D; m: THREE.Mesh; base: number; night: number }[] = []
  haloSprites: { root: THREE.Object3D; s: THREE.Sprite; base: number; night: number }[] = []

  WINDOW = this.glowMat('#ffd28a', 0.08, 1.7)
  LANTERN = this.glowMat('#ffb54a', 0.35, 2.1)
  LAMP = this.glowMat('#fff1b8', 0.45, 3.6)
  FIRE = this.glowMat('#ff7a2a', 1.8, 1.0)
  LAVA = this.glowMat('#ff4a1a', 2.0, 0.8)
  EYES = this.glowMat('#ff3b30', 0.8, 1.6)

  mat(color: string, extra?: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const key = color + (extra ? JSON.stringify(extra) : '')
    let m = this.matCache.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.82, metalness: 0, ...(extra || {}) })
      this.matCache.set(key, m)
    }
    return m
  }

  glowMat(color: string, base: number, night: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: base, flatShading: true, roughness: 0.5 })
    this.glowMats.push({ m, base, night })
    return m
  }

  mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, material)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  groundGlow(root: THREE.Object3D, color: string, size: number, base: number, night: number) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color: new THREE.Color(color), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    m.rotation.x = -Math.PI / 2
    m.position.y = 0.07
    root.add(m)
    this.groundGlows.push({ root, m, base, night })
  }

  halo(root: THREE.Object3D, color: string, scale: number, y: number, base: number, night: number) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(color), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    s.scale.setScalar(scale)
    s.position.y = y
    root.add(s)
    this.haloSprites.push({ root, s, base, night })
    return s
  }

  /** Drop registry entries whose object left the scene. */
  prune() {
    const alive = (o: { root: THREE.Object3D }) => Boolean(o.root.parent)
    this.spinners = this.spinners.filter(alive)
    this.floaters = this.floaters.filter(alive)
    this.flickers = this.flickers.filter(alive)
    this.beamMats = this.beamMats.filter(alive)
    this.wavers = this.wavers.filter(alive)
    this.emitters = this.emitters.filter(alive)
    this.groundGlows = this.groundGlows.filter(alive)
    this.haloSprites = this.haloSprites.filter(alive)
  }
}
