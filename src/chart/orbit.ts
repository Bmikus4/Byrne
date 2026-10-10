// Two-body Kepler orbits in the plane, in closed form.
//
// The satellite's position and velocity ARE the orbit: every element below is derived
// from that state, so dragging either one redraws the conic exactly. There is no
// integrator — `t` moves the satellite by solving Kepler's equation (elliptic, hyperbolic,
// or Barker's for the parabola), which is why a full period returns it to the same point
// to machine precision rather than to a step-size tolerance. Byrne's rule that dynamics
// would need its own state vector is respected by not having dynamics: this is geometry
// parameterised by time.

import type { Vec } from './model.js'

export type OrbitKind = 'circle' | 'ellipse' | 'parabola' | 'hyperbola' | 'fall'

export interface Elements {
  readonly kind: OrbitKind
  /** Eccentricity. */
  readonly e: number
  /** Semi-latus rectum. */
  readonly p: number
  /** Closest approach (periapsis distance). */
  readonly rp: number
  /** Farthest point; Infinity when the orbit is open. */
  readonly ra: number
  /** Semi-major axis; negative for a hyperbola, Infinity for a parabola. */
  readonly a: number
  /** Direction of periapsis, radians, world frame. */
  readonly omega: number
  /** Where the satellite is now, measured from periapsis in the direction of motion. */
  readonly nu: number
  /** +1 anticlockwise, -1 clockwise. */
  readonly dir: 1 | -1
  readonly mu: number
  /** Specific orbital energy and angular momentum. */
  readonly energy: number
  readonly h: number
  /** Infinity when the orbit is open. */
  readonly period: number
  readonly r: number
  readonly speed: number
  readonly escapeSpeed: number
  readonly circularSpeed: number
}

const TAU = 2 * Math.PI
const EPS_E = 1e-9

const wrap = (x: number): number => {
  let y = x % TAU
  if (y <= -Math.PI) y += TAU
  if (y > Math.PI) y -= TAU
  return y
}

export function elementsOf(c: Vec, mu: number, at: Vec, vel: Vec): Elements {
  const rx = at[0] - c[0], ry = at[1] - c[1]
  const vx = vel[0], vy = vel[1]
  const r = Math.hypot(rx, ry)
  const v2 = vx * vx + vy * vy
  const h = rx * vy - ry * vx
  const rv = rx * vx + ry * vy
  const energy = v2 / 2 - mu / r
  const ex = ((v2 - mu / r) * rx - rv * vx) / mu
  const ey = ((v2 - mu / r) * ry - rv * vy) / mu
  const e = Math.hypot(ex, ey)
  const dir: 1 | -1 = h >= 0 ? 1 : -1
  const p = (h * h) / mu
  const base = {
    mu, energy, h, r, speed: Math.sqrt(v2),
    escapeSpeed: Math.sqrt((2 * mu) / r), circularSpeed: Math.sqrt(mu / r),
  }

  if (Math.abs(h) < 1e-12 * Math.max(1, r * Math.sqrt(v2))) {
    // Straight in or straight out: no conic, the satellite falls along a line.
    return {
      ...base, kind: 'fall', e: 1, p: 0, rp: 0, ra: energy < 0 ? -mu / energy : Infinity,
      a: energy < 0 ? -mu / (2 * energy) : Infinity, omega: Math.atan2(ry, rx), nu: 0, dir,
      period: Infinity,
    }
  }

  const circular = e < EPS_E
  const omega = circular ? Math.atan2(ry, rx) : Math.atan2(ey, ex)
  const nu = circular ? 0 : wrap(dir * (Math.atan2(ry, rx) - omega))
  const rp = p / (1 + e)
  const kind: OrbitKind = circular ? 'circle'
    : Math.abs(e - 1) < EPS_E ? 'parabola'
      : e < 1 ? 'ellipse' : 'hyperbola'
  const a = kind === 'parabola' ? Infinity : p / (1 - e * e)
  const ra = e < 1 ? p / (1 - e) : Infinity
  const period = e < 1 ? TAU * Math.sqrt((a * a * a) / mu) : Infinity
  return { ...base, kind, e, p, rp, ra, a, omega, nu, dir, period }
}

/** Distance from the central body at true anomaly nu. */
export const radiusAt = (el: Elements, nu: number): number => el.p / (1 + el.e * Math.cos(nu))

export function pointAt(el: Elements, c: Vec, nu: number): Vec {
  const r = radiusAt(el, nu)
  const th = el.omega + el.dir * nu
  return [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]
}

export function velocityAt(el: Elements, nu: number): Vec {
  const k = Math.sqrt(el.mu / el.p)
  const vr = k * el.e * Math.sin(nu)
  const vt = k * (1 + el.e * Math.cos(nu))
  const th = el.omega + el.dir * nu
  const ur: Vec = [Math.cos(th), Math.sin(th)]
  const ut: Vec = [-el.dir * Math.sin(th), el.dir * Math.cos(th)]
  return [vr * ur[0] + vt * ut[0], vr * ur[1] + vt * ut[1]]
}

/** Position and velocity from shape numbers: closest approach, eccentricity, tilt, place. */
export function stateFrom(
  c: Vec, mu: number, rp: number, e: number, omega: number, nu: number, dir: 1 | -1,
): { at: Vec; vel: Vec } {
  const p = rp * (1 + e)
  const el = { e, p, omega, dir, mu } as Elements
  return { at: pointAt(el, c, nu), vel: velocityAt(el, nu) }
}

/**
 * The true-anomaly interval to draw. Closed orbits are drawn whole; open ones stop where
 * they leave `reach`, since the asymptotes run to infinity.
 */
export function drawRange(el: Elements, reach: number): [number, number] {
  if (el.e < 1 && el.kind !== 'parabola') return [-Math.PI, Math.PI]
  const asym = Math.acos(-1 / el.e)
  const cosLim = (el.p / reach - 1) / el.e
  const lim = cosLim <= -1 ? asym : cosLim >= 1 ? 0 : Math.min(asym, Math.acos(cosLim))
  const m = Math.max(0, lim - 1e-6)
  return [-m, m]
}

// ---------------------------------------------------------------------------
// Time. tFromPeri(nu) is the time since periapsis; nuAt(t) inverts it.

export function timeFromPeri(el: Elements, nu: number): number {
  const { e, mu } = el
  if (el.kind === 'parabola') {
    const D = Math.tan(nu / 2)
    return 0.5 * Math.sqrt((el.p ** 3) / mu) * (D + (D ** 3) / 3)
  }
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2))
    const M = E - e * Math.sin(E)
    return M / Math.sqrt(mu / (el.a ** 3))
  }
  const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2))
  const M = e * Math.sinh(F) - F
  return M / Math.sqrt(mu / ((-el.a) ** 3))
}

export function nuAt(el: Elements, t: number): number {
  const { e, mu } = el
  if (el.kind === 'parabola') {
    const M = t / (0.5 * Math.sqrt((el.p ** 3) / mu))
    const W = 1.5 * M
    const Y = Math.cbrt(W + Math.sqrt(W * W + 1))
    return 2 * Math.atan(Y - 1 / Y)
  }
  if (e < 1) {
    const n = Math.sqrt(mu / (el.a ** 3))
    const M = wrap(t * n)
    let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1)
    for (let i = 0; i < 60; i++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
      E -= d
      if (Math.abs(d) < 1e-15) break
    }
    return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))
  }
  const n = Math.sqrt(mu / ((-el.a) ** 3))
  const M = t * n
  let F = Math.asinh(M / e)
  for (let i = 0; i < 80; i++) {
    const d = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1)
    F -= d
    if (Math.abs(d) < 1e-15) break
  }
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2))
}

/** Where the satellite is `dt` after now. A circle advances by angle directly. */
export function advance(el: Elements, dt: number): number {
  if (el.kind === 'fall') return el.nu
  if (el.kind === 'circle') return el.nu + dt * Math.sqrt(el.mu / (el.p ** 3))
  return nuAt(el, timeFromPeri(el, el.nu) + dt)
}

/** n points a full period apart in equal steps of TIME, starting at periapsis. */
export function equalTimeNus(el: Elements, n: number): number[] {
  if (!(el.e < 1) || el.kind === 'fall' || n < 1) return []
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    if (el.kind === 'circle') out.push((TAU * k) / n)
    else out.push(nuAt(el, (el.period * k) / n))
  }
  return out
}

export function kindName(k: OrbitKind): string {
  switch (k) {
    case 'circle': return 'Circle (bound)'
    case 'ellipse': return 'Ellipse (bound)'
    case 'parabola': return 'Parabola (just escapes)'
    case 'hyperbola': return 'Hyperbola (escapes)'
    case 'fall': return 'Straight fall'
  }
}
