// The radial field of Figure 8 in "The Need for Quantum Relativity": one field emanated
// from the centre, radius = scale, angle = direction, colour = density of placed
// observations.
//
// The field is a function of log-radius, so it is self-similar: crests sit at radii
// R * ratio^-n and converge on the zero point without reaching it. Pockets lie on a
// logarithmic spiral, so the whole pattern P(U, Theta) satisfies
//   P(U + 1, Theta + twist) = P(U, Theta),   U = ln(R/r) / ln(ratio)
// and that identity is what lets the field flow: one period of flow is one crest inward
// and one twist round, and the last frame IS the first. Break the identity (pockets at
// arbitrary radii, say) and every animation of it jumps once per loop.

import { pngDataUrl } from './png.js'

export type Palette = 'jet' | 'viridis' | 'magma' | 'grey' | 'ice'

export interface FieldSpec {
  /** Ratio between neighbouring crest radii (> 1). */
  readonly ratio: number
  /** Pockets per crest. */
  readonly pockets: number
  /** 0..1: how dense a pocket is against the rings. */
  readonly strength: number
  /** Degrees the pocket spiral turns per crest. */
  readonly twist: number
  readonly seed: number
  /** Each pole of the horn-torus section carries its own field at half the scale (F9). */
  readonly poles: boolean
}

function rng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Pocket { u: number; th: number; su: number; sth: number }

const pocketCache = new Map<string, Pocket[]>()
function pocketsOf(s: FieldSpec): Pocket[] {
  const key = `${s.seed}|${s.pockets}`
  let p = pocketCache.get(key)
  if (!p) {
    const r = rng(s.seed)
    p = Array.from({ length: Math.max(0, Math.min(24, Math.round(s.pockets))) }, () => ({
      u: r(), th: r() * 2 * Math.PI, su: 0.12 + 0.08 * r(), sth: 0.3 + 0.35 * r(),
    }))
    pocketCache.set(key, p)
  }
  return p
}

const TAU = 2 * Math.PI
const wrap = (a: number): number => a - TAU * Math.round(a / TAU)
/** The value the field fades to at its core, and where its crests are finer than a pixel. */
export const MID = 0.42
/** The core: inside CORE[0] of the radius the field is MID, and the crests rise by CORE[1]. */
export const CORE = [0.03, 0.14] as const
/** Highest density drawn: the palette's last tenth is near black in jet, which reads as a hole. */
const PEAK = 0.9

/**
 * Density at (x, y) in units of the field's radius, 0..1. `phase` is flow in crests:
 * at phase 1 the field is back where it started. `pix` is the sample spacing, used only
 * to fade crests finer than it, which would otherwise alias into moire at the centre.
 */
export function fieldValue(s: FieldSpec, x: number, y: number, phase = 0, pix = 0, nested = true, core = true): number {
  const rho = Math.hypot(x, y)
  const L = Math.log(Math.max(1.05, s.ratio))
  if (rho < 1e-12) return MID
  const U = -Math.log(rho) / L - phase
  const tw = (s.twist * Math.PI) / 180
  const Th = Math.atan2(y, x) - tw * phase
  const rings = 0.5 + 0.5 * Math.cos(TAU * U)
  let pock = 0
  for (const p of pocketsOf(s)) {
    const k0 = Math.round(U - p.u)
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const du = (U - p.u - k) / p.su
      if (du * du > 9) continue
      const dt = wrap(Th - p.th - k * tw) / p.sth
      pock = Math.max(pock, Math.exp(-du * du - dt * dt))
    }
  }
  let v = 0.1 + 0.32 * rings + s.strength * pock * (0.45 + 0.55 * rings)
  // The core is the one part that is not self-similar, so the animated export draws the
  // field without it (core = false) and lays coreFade() over the centre as a gradient.
  let fade = core ? coreFade(rho) : 1
  if (pix > 0) fade *= Math.min(1, Math.max(0, ((rho * L) / pix - 2) / 3))
  v = MID + fade * (v - MID)
  if (nested && s.poles) {
    for (const cx of [-0.5, 0.5]) {
      const dx = x - cx
      if (dx * dx + y * y < 0.25) v = 0.55 * v + 0.45 * fieldValue(s, dx / 0.5, y / 0.5, phase, pix * 2, false)
    }
  }
  return Math.min(PEAK, Math.max(0, v))
}

/** 0 at the zero point, 1 outside the core: how much of the field shows through. */
export function coreFade(rho: number): number {
  const t = Math.min(1, Math.max(0, (rho - CORE[0]) / (CORE[1] - CORE[0])))
  return t * t * (3 - 2 * t)
}

const STOPS: Record<Exclude<Palette, 'jet'>, number[][]> = {
  viridis: [[68, 1, 84], [65, 68, 135], [42, 120, 142], [34, 168, 132], [122, 209, 81], [253, 231, 37]],
  magma: [[0, 0, 4], [59, 15, 112], [140, 41, 129], [222, 73, 104], [254, 159, 109], [252, 253, 191]],
  grey: [[250, 250, 250], [20, 20, 24]],
  ice: [[255, 255, 255], [182, 199, 231], [50, 110, 180], [20, 40, 90]],
}

export function colorOf(p: Palette, v: number): [number, number, number] {
  if (p === 'jet') {
    const c = (x: number): number => Math.round(255 * Math.min(1, Math.max(0, x)))
    return [c(1.5 - Math.abs(4 * v - 3)), c(1.5 - Math.abs(4 * v - 2)), c(1.5 - Math.abs(4 * v - 1))]
  }
  const st = STOPS[p]
  const f = Math.min(0.999999, Math.max(0, v)) * (st.length - 1)
  const i = Math.floor(f), t = f - i
  const a = st[i]!, b = st[i + 1]!
  return [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as [number, number, number]
}

/**
 * The disk as RGBA, n x n pixels covering radius `extent` (in field radii). Outside
 * `extent` is transparent, with a one-pixel antialiased edge.
 */
export function fieldRgba(s: FieldSpec, palette: Palette, n: number, phase = 0, extent = 1, core = true): Uint8Array {
  const out = new Uint8Array(n * n * 4)
  const pix = (2 * extent) / n
  for (let j = 0; j < n; j++) {
    const y = (1 - ((j + 0.5) * 2) / n) * extent
    for (let i = 0; i < n; i++) {
      const x = (((i + 0.5) * 2) / n - 1) * extent
      const rho = Math.hypot(x, y)
      const a = Math.min(1, Math.max(0, (extent - rho) / pix + 0.5))
      if (a <= 0) continue
      const [r, g, b] = colorOf(palette, fieldValue(s, x, y, phase, pix, true, core))
      const o = (j * n + i) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = Math.round(255 * a)
    }
  }
  return out
}

/** The field along one ray from the zero point to `reach` (in field radii). */
export function spectrum(s: FieldSpec, angleDeg: number, samples: number, phase = 0, reach = 1): number[] {
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a), sn = Math.sin(a)
  return Array.from({ length: samples }, (_, i) => {
    const r = (reach * (i + 0.5)) / samples
    return fieldValue(s, r * c, r * sn, phase, reach / samples)
  })
}

/** The paper's binary reading: `sites` equal cells, 1 where the field is above the median. */
export function binaryOf(values: readonly number[], sites: number): string {
  const sorted = [...values].sort((a, b) => a - b)
  const m = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
  let out = ''
  for (let k = 0; k < sites; k++) {
    const i = Math.min(values.length - 1, Math.floor(((k + 0.5) / sites) * values.length))
    out += values[i]! > m ? '1' : '0'
  }
  return out
}

/** Frames per loop of the flow. The editor, the animated export and the record share it. */
export const STATES = 120
/** Samples along the slice before it is read as bits. */
export const SPECTRUM_SAMPLES = 400

/**
 * Phase of frame k. A still field is recorded as if it flowed inward: the record is a
 * property of the field, not of how it is being shown.
 */
export const framePhase = (flow: 'in' | 'out' | 'still', k: number, frames = STATES): number =>
  flow === 'out' ? ((frames - (k % frames)) % frames) / frames : (k % frames) / frames

/**
 * The state at every frame of one loop: `frames` strings of `sites` bits. One loop is
 * the whole history, because the field after one crest of flow is the field it started
 * as (see the identity at the top of this file): frame `frames` is frame 0 again.
 */
export function stateRecord(s: FieldSpec, angleDeg: number, sites: number, flow: 'in' | 'out' | 'still', frames = STATES): string[] {
  return Array.from({ length: frames }, (_, k) => binaryOf(spectrum(s, angleDeg, SPECTRUM_SAMPLES, framePhase(flow, k, frames)), sites))
}

const images = new Map<string, string>()

/** A PNG data: URL of the disk, cached: the editor redraws on every pointer move. */
export function fieldImage(s: FieldSpec, palette: Palette, n: number, phase = 0, extent = 1, core = true): string {
  const key = `${s.ratio}|${s.pockets}|${s.strength}|${s.twist}|${s.seed}|${s.poles}|${palette}|${n}|${phase}|${extent}|${core}`
  let url = images.get(key)
  if (url) {
    images.delete(key)
  } else {
    url = pngDataUrl(n, n, fieldRgba(s, palette, n, phase, extent, core))
    if (images.size >= 120) images.delete(images.keys().next().value!)
  }
  images.set(key, url)
  return url
}

/** One row of colour, stretched by the viewer into the spectrum strip. */
export function stripImage(values: readonly number[], palette: Palette): string {
  const w = values.length, h = 2
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    values.forEach((v, i) => {
      const [r, g, b] = colorOf(palette, v)
      px.set([r, g, b, 255], (y * w + i) * 4)
    })
  }
  return pngDataUrl(w, h, px)
}
