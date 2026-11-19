/**
 * Low poly models for every catalog type, the meeting bell, and the
 * islander characters players control. All original designs, built from
 * primitives so the bundle ships no model files.
 */

import * as THREE from 'three'
import type { BuildType } from '../catalog'
import { Fx, pick, rand } from './fx'

type Builder = (fx: Fx, o: { color?: string }) => THREE.Group

const GREENS = ['#2f8f4e', '#3aa35a', '#2a7d47', '#47b36a']

const prism = (w: number, h: number, depth: number) => {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(0, h)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })
  g.translate(0, 0, -depth / 2)
  return g
}

const MODELS: Record<BuildType, Builder> = {
  house: (fx, o) => {
    const g = new THREE.Group()
    const wall = o.color || pick(['#f4e8d4', '#ead0a8', '#d9e8f4', '#f5dad3', '#e4f1d9'])
    const roof = pick(['#c9534a', '#4073bd', '#4f8a4a', '#7b4cb3', '#bf7a3a'])
    const w = 0.82
    const d = 0.7
    const h = 0.56
    g.add(fx.mesh(new THREE.BoxGeometry(w, h, d), fx.mat(wall), 0, h / 2, 0))
    g.add(fx.mesh(prism(w + 0.18, 0.44, d + 0.14), fx.mat(roof), 0, h, 0))
    g.add(fx.mesh(new THREE.BoxGeometry(0.17, 0.29, 0.03), fx.mat('#5b3a27'), 0.14, 0.145, d / 2 + 0.01))
    g.add(fx.mesh(new THREE.BoxGeometry(0.15, 0.14, 0.03), fx.WINDOW, -0.2, 0.33, d / 2 + 0.01))
    g.add(fx.mesh(new THREE.BoxGeometry(0.03, 0.14, 0.16), fx.WINDOW, w / 2 + 0.01, 0.33, 0))
    g.add(fx.mesh(new THREE.BoxGeometry(0.03, 0.14, 0.16), fx.WINDOW, -w / 2 - 0.01, 0.33, 0))
    g.add(fx.mesh(new THREE.BoxGeometry(0.11, 0.3, 0.11), fx.mat('#8b7d74'), -0.2, h + 0.3, -0.14))
    fx.emitters.push({ root: g, offset: new THREE.Vector3(-0.2, h + 0.5, -0.14), rate: 0.8, acc: rand(0, 1), tint: new THREE.Color('#d2d2e2'), size: 0.42, alpha: 0.3, rise: 0.42 })
    return g
  },
  pine_tree: (fx) => {
    const g = new THREE.Group()
    const c = pick(GREENS)
    g.add(fx.mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6), fx.mat('#6b4a2f'), 0, 0.15, 0))
    ;[
      [0.42, 0.5, 0.45],
      [0.33, 0.45, 0.75],
      [0.22, 0.4, 1.02],
    ].forEach(([r, h, y]) => g.add(fx.mesh(new THREE.ConeGeometry(r, h, 7), fx.mat(c), 0, y, 0)))
    g.scale.setScalar(rand(0.85, 1.3))
    return g
  },
  round_tree: (fx) => {
    const g = new THREE.Group()
    const c = Math.random() < 0.25 ? pick(['#e0892e', '#d4543a', '#e8b33a']) : pick(['#4caf50', '#5cbf5a', '#3f9e4a'])
    g.add(fx.mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.45, 6), fx.mat('#6b4a2f'), 0, 0.22, 0))
    g.add(fx.mesh(new THREE.IcosahedronGeometry(0.4, 0), fx.mat(c), 0, 0.68, 0))
    g.add(fx.mesh(new THREE.IcosahedronGeometry(0.26, 0), fx.mat(c), 0.22, 0.52, 0.1))
    g.scale.setScalar(rand(0.85, 1.25))
    return g
  },
  rock: (fx) => {
    const g = new THREE.Group()
    const m = fx.mesh(new THREE.DodecahedronGeometry(0.22, 0), fx.mat(pick(['#8d8ba0', '#7b7890', '#9d9aae'])), 0, 0.1, 0)
    m.scale.set(rand(0.8, 1.5), rand(0.6, 1.1), rand(0.8, 1.4))
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3))
    g.add(m)
    return g
  },
  lantern: (fx) => {
    const g = new THREE.Group()
    g.add(fx.mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.62, 6), fx.mat('#2e2a3d'), 0, 0.31, 0))
    const head = fx.mesh(new THREE.BoxGeometry(0.13, 0.15, 0.13), fx.LANTERN, 0, 0.68, 0)
    head.castShadow = false
    g.add(head)
    g.add(fx.mesh(new THREE.ConeGeometry(0.11, 0.08, 4), fx.mat('#2e2a3d'), 0, 0.79, 0))
    fx.groundGlow(g, '#ffb54a', 1.6, 0.02, 0.3)
    fx.halo(g, '#ffc46a', 0.6, 0.68, 0.02, 0.3)
    return g
  },
  boat: (fx) => {
    const g = new THREE.Group()
    const hull = new THREE.Shape()
    hull.moveTo(-0.38, 0.12)
    hull.lineTo(0.38, 0.12)
    hull.lineTo(0.26, -0.02)
    hull.lineTo(-0.3, -0.02)
    hull.closePath()
    const hg = new THREE.ExtrudeGeometry(hull, { depth: 0.26, bevelEnabled: false })
    hg.translate(0, 0, -0.13)
    g.add(fx.mesh(hg, fx.mat('#8b5a3c')))
    g.add(fx.mesh(new THREE.BoxGeometry(0.66, 0.02, 0.2), fx.mat('#c08a5a'), 0, 0.12, 0))
    g.add(fx.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.62, 5), fx.mat('#5b3a27'), 0.02, 0.43, 0))
    const sail = new THREE.Shape()
    sail.moveTo(0, 0)
    sail.lineTo(0.3, 0)
    sail.lineTo(0, 0.45)
    sail.closePath()
    g.add(fx.mesh(new THREE.ShapeGeometry(sail), fx.mat('#f6f1e6', { side: THREE.DoubleSide }), 0.04, 0.18, 0))
    fx.floaters.push({ root: g, obj: g, amp: 0.025, speed: 1.6, phase: rand(0, 6), rock: 0.06 })
    return g
  },
  dock: (fx) => {
    const g = new THREE.Group()
    for (let i = 0; i < 6; i++) g.add(fx.mesh(new THREE.BoxGeometry(0.14, 0.04, 0.5), fx.mat(i % 2 ? '#a8774e' : '#b8875a'), 0.08 + i * 0.16, 0.08, 0))
    ;[
      [0.1, 0.22],
      [0.1, -0.22],
      [0.86, 0.22],
      [0.86, -0.22],
    ].forEach(([x, z]) => g.add(fx.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 5), fx.mat('#6b4a32'), x, -0.03, z)))
    return g
  },
  windmill: (fx) => {
    const g = new THREE.Group()
    g.add(fx.mesh(new THREE.CylinderGeometry(0.2, 0.32, 1.15, 8), fx.mat('#efe5d3'), 0, 0.575, 0))
    g.add(fx.mesh(new THREE.ConeGeometry(0.3, 0.36, 8), fx.mat('#c9534a'), 0, 1.33, 0))
    g.add(fx.mesh(new THREE.BoxGeometry(0.12, 0.2, 0.03), fx.WINDOW, 0, 0.75, 0.25))
    const hub = new THREE.Group()
    hub.position.set(0, 1.08, 0.27)
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group()
      arm.rotation.z = (i * Math.PI) / 2
      arm.add(fx.mesh(new THREE.BoxGeometry(0.1, 0.72, 0.02), fx.mat('#e9dcc6'), 0, 0.4, 0))
      arm.add(fx.mesh(new THREE.BoxGeometry(0.02, 0.74, 0.03), fx.mat('#6b4a32'), -0.04, 0.4, 0.01))
      hub.add(arm)
    }
    hub.add(fx.mesh(new THREE.SphereGeometry(0.05, 8, 6), fx.mat('#6b4a32')))
    g.add(hub)
    fx.spinners.push({ root: g, obj: hub, axis: 'z', speed: 1.1 })
    return g
  },
  campfire: (fx) => {
    const g = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const l = fx.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 5), fx.mat('#6b4330'), 0, 0.05, 0)
      l.rotation.z = Math.PI / 2
      l.rotation.y = (i * Math.PI) / 3
      g.add(l)
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      g.add(fx.mesh(new THREE.DodecahedronGeometry(0.06, 0), fx.mat('#8d8a9c'), Math.cos(a) * 0.27, 0.03, Math.sin(a) * 0.27))
    }
    const f1 = fx.mesh(new THREE.ConeGeometry(0.13, 0.38, 6), fx.FIRE, 0, 0.26, 0)
    const f2 = fx.mesh(new THREE.ConeGeometry(0.08, 0.26, 5), fx.LAMP, 0.02, 0.2, 0.02)
    f1.castShadow = false
    f2.castShadow = false
    g.add(f1, f2)
    fx.flickers.push({ root: g, obj: f1, phase: rand(0, 6) }, { root: g, obj: f2, phase: rand(0, 6) })
    fx.groundGlow(g, '#ff8a3a', 2.4, 0.22, 0.38)
    fx.halo(g, '#ff9a4a', 1.2, 0.3, 0.3, 0.3)
    fx.emitters.push({ root: g, offset: new THREE.Vector3(0, 0.5, 0), rate: 2.2, acc: 0, tint: new THREE.Color('#9a9aa8'), size: 0.5, alpha: 0.3, rise: 0.6 })
    return g
  },
  lighthouse: (fx) => {
    const g = new THREE.Group()
    const H = 1.7
    const S = 4
    for (let i = 0; i < S; i++) {
      const y0 = (i * H) / S
      const r0 = 0.34 - 0.12 * (i / S)
      const r1 = 0.34 - 0.12 * ((i + 1) / S)
      g.add(fx.mesh(new THREE.CylinderGeometry(r1, r0, H / S, 10), fx.mat(i % 2 ? '#d84a4a' : '#f4f1ea'), 0, y0 + H / S / 2, 0))
    }
    g.add(fx.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10), fx.mat('#2e2a3d'), 0, H + 0.02, 0))
    const lamp = fx.mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.22, 8), fx.LAMP, 0, H + 0.16, 0)
    lamp.castShadow = false
    g.add(lamp)
    g.add(fx.mesh(new THREE.ConeGeometry(0.22, 0.24, 10), fx.mat('#d84a4a'), 0, H + 0.39, 0))
    const pivot = new THREE.Group()
    pivot.position.y = H + 0.16
    const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4c4'), map: fx.beamTipTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    for (const s of [1, -1]) {
      const geo = new THREE.ConeGeometry(0.42, 4.6, 24, 1, true)
      geo.translate(0, -2.3, 0)
      geo.rotateZ((Math.PI / 2) * s)
      pivot.add(new THREE.Mesh(geo, bm))
    }
    g.add(pivot)
    fx.spinners.push({ root: g, obj: pivot, axis: 'y', speed: 0.9 })
    fx.beamMats.push({ root: g, m: bm })
    fx.halo(g, '#fff1b8', 0.9, H + 0.16, 0.1, 0.35)
    return g
  },
  well: (fx) => {
    const g = new THREE.Group()
    g.add(fx.mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.26, 10), fx.mat('#9b98a8'), 0, 0.13, 0))
    g.add(fx.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 10), fx.mat('#3b6fb0', { emissive: '#0a2a55', emissiveIntensity: 0.4 }), 0, 0.25, 0))
    for (const x of [-0.22, 0.22]) g.add(fx.mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), fx.mat('#6b4a32'), x, 0.45, 0))
    g.add(fx.mesh(prism(0.64, 0.2, 0.4), fx.mat('#9a4a3a'), 0, 0.68, 0))
    return g
  },
  fence: (fx) => {
    const g = new THREE.Group()
    const wood = fx.mat('#a8774e')
    for (let i = 0; i < 5; i++) g.add(fx.mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), wood, -0.5 + i * 0.25, 0.15, 0))
    for (const y of [0.1, 0.22]) g.add(fx.mesh(new THREE.BoxGeometry(1.08, 0.04, 0.025), wood, 0, y, 0))
    return g
  },
  flowers: (fx) => {
    const g = new THREE.Group()
    const cols = ['#ff6b9a', '#ffd166', '#c084fc', '#ffffff', '#ff8a5c', '#7cf7ff']
    for (let i = 0; i < 9; i++) {
      const x = rand(-0.25, 0.25)
      const z = rand(-0.25, 0.25)
      g.add(fx.mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 3), fx.mat('#3e8a3e'), x, 0.07, z))
      g.add(fx.mesh(new THREE.IcosahedronGeometry(0.045, 0), fx.mat(pick(cols)), x, 0.15, z))
    }
    return g
  },
  tent: (fx, o) => {
    const g = new THREE.Group()
    const t = fx.mesh(new THREE.ConeGeometry(0.42, 0.55, 4), fx.mat(o.color || pick(['#e8604a', '#4a8fe0', '#f2b440', '#5bbf7a'])), 0, 0.275, 0)
    t.rotation.y = Math.PI / 4
    g.add(t)
    g.add(fx.mesh(new THREE.ConeGeometry(0.12, 0.3, 3), fx.mat('#2e2a3d'), 0.22, 0.13, 0))
    return g
  },
  crystal: (fx, o) => {
    const g = new THREE.Group()
    const color = o.color || pick(['#7cf7ff', '#b98cff', '#ff7ad9'])
    const cm = fx.glowMat(color, 0.6, 0.9)
    for (let i = 0; i < 3; i++) {
      const c = fx.mesh(new THREE.OctahedronGeometry(0.16 - i * 0.03, 0), cm, (i - 1) * 0.17, 0.34 + (i === 1 ? 0.12 : 0), rand(-0.05, 0.05))
      c.scale.y = 1.8
      c.castShadow = false
      g.add(c)
      fx.floaters.push({ root: g, obj: c, amp: 0.06, speed: 1.2 + i * 0.3, phase: rand(0, 6), spin: 0.6 })
    }
    fx.halo(g, color, 1.3, 0.42, 0.18, 0.22)
    fx.groundGlow(g, color, 1.6, 0.12, 0.25)
    return g
  },
  mushroom: (fx, o) => {
    const g = new THREE.Group()
    const cap = o.color || pick(['#e04848', '#ff8a3a', '#b05cff'])
    g.add(fx.mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.42, 7), fx.mat('#f2ead8'), 0, 0.21, 0))
    const c = fx.mesh(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), fx.mat(cap), 0, 0.38, 0)
    c.scale.y = 0.75
    g.add(c)
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2)
      const r = rand(0.1, 0.26)
      const yy = 0.38 + Math.sqrt(Math.max(0, 0.34 * 0.34 - r * r)) * 0.75
      g.add(fx.mesh(new THREE.IcosahedronGeometry(0.035, 0), fx.mat('#ffffff'), Math.cos(a) * r, yy, Math.sin(a) * r))
    }
    return g
  },
  sheep: (fx) => {
    const g = new THREE.Group()
    const body = fx.mesh(new THREE.IcosahedronGeometry(0.17, 1), fx.mat('#f7f5ef'), 0, 0.22, 0)
    body.scale.set(1.35, 1, 1)
    g.add(body)
    g.add(fx.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.1), fx.mat('#2f2a38'), 0.24, 0.27, 0))
    ;[
      [0.1, 0.07],
      [0.1, -0.07],
      [-0.1, 0.07],
      [-0.1, -0.07],
    ].forEach(([x, z]) => g.add(fx.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 4), fx.mat('#2f2a38'), x, 0.06, z)))
    return g
  },
  duck: (fx) => {
    const g = new THREE.Group()
    const yb = fx.mat('#ffd23f', { roughness: 0.35 })
    const b = fx.mesh(new THREE.SphereGeometry(0.13, 12, 8), yb, 0, 0.08, 0)
    b.scale.set(1.3, 0.85, 1)
    g.add(b)
    g.add(fx.mesh(new THREE.SphereGeometry(0.085, 10, 8), yb, 0.1, 0.2, 0))
    const beak = fx.mesh(new THREE.ConeGeometry(0.035, 0.08, 6), fx.mat('#ff8a1f'), 0.2, 0.19, 0)
    beak.rotation.z = -Math.PI / 2
    g.add(beak)
    for (const z of [0.045, -0.045]) g.add(fx.mesh(new THREE.SphereGeometry(0.014, 6, 4), fx.mat('#151320'), 0.165, 0.23, z))
    fx.floaters.push({ root: g, obj: g, amp: 0.02, speed: 2.1, phase: rand(0, 6), rock: 0.12 })
    return g
  },
  volcano: (fx) => {
    const g = new THREE.Group()
    g.add(fx.mesh(new THREE.CylinderGeometry(0.24, 0.8, 0.95, 9, 2), fx.mat('#4e3a36'), 0, 0.475, 0))
    const top = fx.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 9), fx.LAVA, 0, 0.94, 0)
    top.castShadow = false
    g.add(top)
    for (let i = 0; i < 5; i++) {
      const a = rand(0, Math.PI * 2)
      const r = fx.mesh(new THREE.DodecahedronGeometry(rand(0.05, 0.09), 0), fx.LAVA, Math.cos(a) * 0.85, 0.04, Math.sin(a) * 0.85)
      r.castShadow = false
      g.add(r)
    }
    fx.halo(g, '#ff5a2a', 1.4, 1.0, 0.35, 0.25)
    fx.groundGlow(g, '#ff4a1a', 2.4, 0.15, 0.28)
    fx.emitters.push({ root: g, offset: new THREE.Vector3(0, 1.05, 0), rate: 3.2, acc: 0, tint: new THREE.Color('#4a4450'), size: 0.75, alpha: 0.55, rise: 0.75 })
    return g
  },
  pirate_flag: (fx) => {
    const g = new THREE.Group()
    g.add(fx.mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.3, 6), fx.mat('#2e2a3d'), 0, 0.65, 0))
    const fg = new THREE.PlaneGeometry(0.55, 0.34, 8, 3)
    fg.translate(0.275, 0, 0)
    const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: '#16131f', side: THREE.DoubleSide, roughness: 0.9, flatShading: true }))
    flag.position.set(0.02, 1.12, 0)
    flag.castShadow = true
    g.add(flag)
    fx.wavers.push({ root: g, geo: fg, base: (fg.attributes.position.array as Float32Array).slice() })
    return g
  },
  totem: (fx) => {
    const g = new THREE.Group()
    const woods = ['#8a5a3c', '#a06a44', '#6e4630']
    for (let i = 0; i < 3; i++) {
      const block = fx.mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.32, 7), fx.mat(woods[i]), 0, 0.16 + i * 0.32, 0)
      g.add(block)
      for (const x of [-0.07, 0.07]) {
        const eye = fx.mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), i === 2 ? fx.EYES : fx.mat('#2a1c14'), x, 0.2 + i * 0.32, 0.17)
        eye.castShadow = false
        g.add(eye)
      }
      g.add(fx.mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), fx.mat('#2a1c14'), 0, 0.1 + i * 0.32, 0.18))
    }
    const wingL = fx.mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), fx.mat('#c9534a'), -0.25, 0.86, 0)
    const wingR = fx.mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), fx.mat('#c9534a'), 0.25, 0.86, 0)
    g.add(wingL, wingR)
    fx.halo(g, '#ff3b30', 0.7, 0.86, 0.15, 0.35)
    return g
  },
  cactus: (fx) => {
    const g = new THREE.Group()
    const green = fx.mat(pick(['#3f8f4f', '#4f9f5a', '#367f45']))
    g.add(fx.mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.8, 8), green, 0, 0.4, 0))
    g.add(fx.mesh(new THREE.SphereGeometry(0.09, 8, 6), green, 0, 0.8, 0))
    const arm = (side: number, y: number, h: number) => {
      g.add(fx.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 7), green, side * 0.13, y, 0).rotateZ(Math.PI / 2))
      g.add(fx.mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 7), green, side * 0.21, y + h / 2, 0))
      g.add(fx.mesh(new THREE.SphereGeometry(0.06, 7, 5), green, side * 0.21, y + h, 0))
    }
    arm(1, 0.38, 0.26)
    arm(-1, 0.52, 0.18)
    g.add(fx.mesh(new THREE.SphereGeometry(0.04, 6, 4), fx.mat('#ff7ad9'), 0, 0.9, 0))
    return g
  },
}

export function buildModel(fx: Fx, type: string, color?: string): THREE.Group {
  const make = (MODELS as Record<string, Builder>)[type] ?? MODELS.rock
  return make(fx, { color })
}

/** Stone table and the emergency bell at the meeting spot. */
export function buildMeetingBell(fx: Fx): { group: THREE.Group; bell: THREE.Mesh; button: THREE.Mesh } {
  const g = new THREE.Group()
  g.add(fx.mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.14, 12), fx.mat('#9b98a8'), 0, 0.07, 0))
  g.add(fx.mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.08, 12), fx.mat('#b3b0c2'), 0, 0.18, 0))
  const post = fx.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), fx.mat('#6b4a32'), 0.0, 0.55, -0.32)
  g.add(post)
  g.add(fx.mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), fx.mat('#6b4a32'), 0, 0.9, -0.32))
  const bell = fx.mesh(new THREE.CylinderGeometry(0.07, 0.14, 0.18, 10, 1, true), fx.mat('#e8c04a', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }), 0, 0.78, -0.32)
  g.add(bell)
  const buttonMat = new THREE.MeshStandardMaterial({ color: '#ff2a4a', emissive: '#ff2a4a', emissiveIntensity: 0.6, roughness: 0.4 })
  const button = fx.mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.08, 16), buttonMat, 0, 0.26, 0.05)
  g.add(button)
  fx.halo(g, '#ff2a4a', 0.9, 0.3, 0.25, 0.3)
  return { group: g, bell, button }
}

export interface Islander {
  root: THREE.Group
  body: THREE.Mesh
  head: THREE.Group
  feet: THREE.Mesh[]
  scarf: THREE.Mesh
  sprout: THREE.Group
  glow: THREE.Sprite
  light: THREE.PointLight
}

/**
 * The player character: a round, fluffy islander with a leaf sprout on top,
 * big dark eyes and a scarf in the player's color.
 */
export function buildIslander(fx: Fx, color: string): Islander {
  const root = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ color: '#f3efe6', flatShading: true, roughness: 0.95 })
  const body = fx.mesh(new THREE.IcosahedronGeometry(0.2, 1), fur, 0, 0.26, 0)
  body.scale.set(1, 0.95, 1)
  root.add(body)
  const head = new THREE.Group()
  head.position.set(0, 0.26, 0)
  const eyeMat = fx.mat('#1a1626', { roughness: 0.3 })
  for (const x of [-0.07, 0.07]) {
    const eye = fx.mesh(new THREE.SphereGeometry(0.035, 10, 8), eyeMat, x, 0.05, 0.175)
    eye.scale.set(1, 1.3, 0.6)
    eye.castShadow = false
    head.add(eye)
    const shine = fx.mesh(new THREE.SphereGeometry(0.01, 6, 4), fx.mat('#ffffff'), x + 0.012, 0.065, 0.195)
    shine.castShadow = false
    head.add(shine)
  }
  const cheekMat = fx.mat('#ff9aa8')
  for (const x of [-0.12, 0.12]) {
    const cheek = fx.mesh(new THREE.SphereGeometry(0.025, 8, 6), cheekMat, x, -0.01, 0.15)
    cheek.scale.set(1, 0.6, 0.4)
    cheek.castShadow = false
    head.add(cheek)
  }
  root.add(head)
  const scarfMat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, emissive: color, emissiveIntensity: 0.15 })
  const scarf = fx.mesh(new THREE.TorusGeometry(0.16, 0.045, 6, 16), scarfMat, 0, 0.15, 0)
  scarf.rotation.x = Math.PI / 2
  root.add(scarf)
  const tail = fx.mesh(new THREE.BoxGeometry(0.06, 0.14, 0.03), scarfMat, 0.08, 0.08, 0.15)
  tail.rotation.z = 0.3
  root.add(tail)
  const sprout = new THREE.Group()
  sprout.position.set(0, 0.45, 0)
  sprout.add(fx.mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.08, 4), fx.mat('#3e8a3e'), 0, 0.03, 0))
  const leafMat = fx.mat('#5cc96a', { side: THREE.DoubleSide })
  for (const s of [1, -1]) {
    const leaf = fx.mesh(new THREE.SphereGeometry(0.05, 8, 6), leafMat, s * 0.04, 0.08, 0)
    leaf.scale.set(1.3, 0.35, 0.7)
    leaf.rotation.z = s * 0.5
    sprout.add(leaf)
  }
  root.add(sprout)
  const footMat = fx.mat('#3a3346')
  const feet = [-0.08, 0.08].map((x) => {
    const f = fx.mesh(new THREE.SphereGeometry(0.05, 8, 6), footMat, x, 0.04, 0.03)
    f.scale.set(1, 0.6, 1.3)
    root.add(f)
    return f
  })
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.glowTex, color: new THREE.Color(color), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }))
  glow.scale.setScalar(1.1)
  glow.position.y = 0.25
  root.add(glow)
  const light = new THREE.PointLight(new THREE.Color(color), 0, 2.2, 2)
  light.position.y = 0.5
  root.add(light)
  return { root, body, head, feet, scarf, sprout, glow, light }
}
