// Electrostatic fields, evaluated numerically AFTER the solve.
//
// Fields do not participate in the constraint system: no acceptance example has a
// geometry constrained by a field value, and putting a quadrature inside the residual
// vector would put its error into every Jacobian. So field quantities are DEFERRED
// measures — computed once from the solved configuration, reported with their own error
// estimate. The limitation is real and stated: you cannot currently constrain a
// construction by a flux.
//
// The flux quadrature is a product rule: Gauss-Legendre in cos(theta), which is exact
// for polynomials and converges fast on a smooth integrand, and the trapezoid rule in
// phi, which is spectrally accurate because the integrand is periodic. The error is
// estimated by comparing order n with order 2n; when it exceeds the requested tolerance
// the result carries a warning rather than a confident wrong number.

import { Vec3, add, cross, dot, norm, normalize, scale, sub } from './frame.js'

/** CODATA 2018. */
export const EPS0 = 8.8541878128e-12
const K = 1 / (4 * Math.PI * EPS0)

export interface PointCharge {
  readonly q: number      // coulombs
  readonly at: Vec3       // metres
}

/** Electric field in V/m at `r`. Returns null at a charge's own position. */
export function fieldAt(charges: readonly PointCharge[], r: Vec3): Vec3 | null {
  let out: Vec3 = [0, 0, 0]
  for (const c of charges) {
    const d = sub(r, c.at)
    const n = norm(d)
    if (n < 1e-15) return null
    out = add(out, scale(d, (K * c.q) / (n * n * n)))
  }
  return out
}

export interface FluxResult {
  /** Volt-metres. */
  readonly value: number
  /** Estimated absolute quadrature error, from the order-n against order-2n comparison. */
  readonly error: number
  readonly order: number
  readonly converged: boolean
}

/**
 * Flux of the field of `charges` through a sphere of radius R about `center`.
 * Gauss's law says this is (enclosed charge)/eps0 exactly; computing it by quadrature is
 * what makes it a test of the field evaluator rather than of arithmetic.
 */
export function fluxThroughSphere(
  charges: readonly PointCharge[], center: Vec3, R: number, tol = 1e-6,
): FluxResult {
  let prev = quadrature(charges, center, R, 8)
  for (let n = 16; n <= 256; n *= 2) {
    const cur = quadrature(charges, center, R, n)
    const err = Math.abs(cur - prev)
    if (err <= tol * Math.max(1, Math.abs(cur))) {
      return { value: cur, error: err, order: n, converged: true }
    }
    prev = cur
  }
  return { value: prev, error: Number.POSITIVE_INFINITY, order: 256, converged: false }
}

function quadrature(charges: readonly PointCharge[], center: Vec3, R: number, n: number): number {
  const { nodes, weights } = gaussLegendre(n)
  const mPhi = 2 * n
  let total = 0
  for (let i = 0; i < n; i++) {
    const u = nodes[i]!                       // cos(theta) on [-1, 1]
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    for (let j = 0; j < mPhi; j++) {
      const phi = (2 * Math.PI * j) / mPhi
      const nhat: Vec3 = [s * Math.cos(phi), s * Math.sin(phi), u]
      const p = add(center, scale(nhat, R))
      const E = fieldAt(charges, p)
      if (!E) continue                        // a charge exactly on the surface
      total += weights[i]! * dot(E, nhat) * ((2 * Math.PI) / mPhi)
    }
  }
  return total * R * R
}

/** Golub-Welsch by Newton iteration on the Legendre polynomial. Deterministic. */
function gaussLegendre(n: number): { nodes: number[]; weights: number[] } {
  const nodes: number[] = []
  const weights: number[] = []
  for (let i = 0; i < n; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5))
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = 0
      for (let k = 0; k < n; k++) {
        const p2 = p1
        p1 = p0
        p0 = ((2 * k + 1) * x * p1 - k * p2) / (k + 1)
      }
      const dp = (n * (x * p0 - p1)) / (x * x - 1)
      const dx = -p0 / dp
      x += dx
      if (Math.abs(dx) < 1e-16) break
    }
    let p0 = 1, p1 = 0
    for (let k = 0; k < n; k++) {
      const p2 = p1
      p1 = p0
      p0 = ((2 * k + 1) * x * p1 - k * p2) / (k + 1)
    }
    const dp = (n * (x * p0 - p1)) / (x * x - 1)
    nodes.push(x)
    weights.push(2 / ((1 - x * x) * dp * dp))
  }
  return { nodes, weights }
}

export interface FieldLineOptions {
  readonly step: number
  readonly maxSteps: number
  /** Stop when within this distance of any charge. */
  readonly nearRadius: number
  readonly sign: 1 | -1
}

/** Trace one field line by RK4 on the unit field direction. Arc-length parameterised. */
export function traceFieldLine(
  charges: readonly PointCharge[], start: Vec3, opts: FieldLineOptions,
): Vec3[] {
  const dirAt = (p: Vec3): Vec3 | null => {
    const E = fieldAt(charges, p)
    if (!E) return null
    const n = norm(E)
    if (n === 0 || !Number.isFinite(n)) return null
    return scale(E, opts.sign / n)
  }
  const out: Vec3[] = [start]
  let p = start
  for (let i = 0; i < opts.maxSteps; i++) {
    const k1 = dirAt(p); if (!k1) break
    const k2 = dirAt(add(p, scale(k1, opts.step / 2))); if (!k2) break
    const k3 = dirAt(add(p, scale(k2, opts.step / 2))); if (!k3) break
    const k4 = dirAt(add(p, scale(k3, opts.step))); if (!k4) break
    p = add(p, scale(add(add(k1, scale(k2, 2)), add(scale(k3, 2), k4)), opts.step / 6))
    out.push(p)
    if (charges.some((c) => norm(sub(p, c.at)) < opts.nearRadius)) break
    if (norm(p) > 1e4) break
  }
  return out
}

/**
 * Seed points spread evenly over a small sphere about a charge, by the Fibonacci
 * spiral, so that a line count is a count and not a resolution in two directions.
 */
export function seedSphere(center: Vec3, radius: number, count: number): Vec3[] {
  const capped = Math.max(1, Math.min(512, Math.floor(count)))
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: Vec3[] = []
  for (let i = 0; i < capped; i++) {
    const y = 1 - (2 * (i + 0.5)) / capped
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const th = golden * i
    out.push(add(center, scale([r * Math.cos(th), y, r * Math.sin(th)], radius)))
  }
  return out
}

export { normalize, cross }
