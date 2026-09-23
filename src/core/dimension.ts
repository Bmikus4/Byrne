// Dimensional algebra: a dimension is a 9-vector of RATIONAL exponents.
//
// Rational, not integer, because sqrt(k/m) is a thing a user types and its intermediate
// carries M^(1/2). Rational, not float, because dimensional equality must be exact —
// a tolerance on an exponent is not a thing that can be defended.
//
// The nine slots follow mathjs's BASE_DIMENSIONS so the unit table can be reused
// verbatim. ANGLE is a base dimension here. That is a deviation from strict SI and it
// is deliberate: it makes `sin(x)` reject a dimensionless x that was meant to be an
// angle, which is the error this tool exists to catch.

export const BASE = [
  'MASS', 'LENGTH', 'TIME', 'CURRENT', 'TEMPERATURE',
  'LUMINOUS_INTENSITY', 'AMOUNT_OF_SUBSTANCE', 'ANGLE', 'BIT',
] as const

export const NBASE = BASE.length

/** A rational number in lowest terms with a positive denominator. */
export interface Rat { readonly n: number; readonly d: number }

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a || 1
}

export function rat(n: number, d = 1): Rat {
  if (d === 0) throw new Error('rational with zero denominator')
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    // Only ever reached from user input like `x^0.5`; snap to a small denominator.
    const approx = approxRat(n / d)
    return approx
  }
  if (d < 0) { n = -n; d = -d }
  const g = gcd(n, d)
  return { n: n / g, d: d / g }
}

/** Continued-fraction approximation, capped at denominator 64. Exponents are small. */
export function approxRat(x: number): Rat {
  let bestN = Math.round(x), bestD = 1, bestErr = Math.abs(x - bestN)
  for (let d = 2; d <= 64; d++) {
    const n = Math.round(x * d)
    const err = Math.abs(x - n / d)
    if (err < bestErr - 1e-15) { bestN = n; bestD = d; bestErr = err }
    if (bestErr === 0) break
  }
  if (bestErr > 1e-9) throw new Error(`exponent ${x} is not a small rational`)
  return rat(bestN, bestD)
}

export const ratAdd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d)
export const ratSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d)
export const ratMul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d)
export const ratEq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d
export const ratNum = (a: Rat): number => a.n / a.d
export const ratIsZero = (a: Rat): boolean => a.n === 0

export const ZERO: Rat = { n: 0, d: 1 }
export const ONE: Rat = { n: 1, d: 1 }

/** A dimension: exponents of the nine base dimensions. */
export type Dim = readonly Rat[]

export const DIMLESS: Dim = Object.freeze(Array(NBASE).fill(ZERO))

export function dimFrom(exponents: Partial<Record<(typeof BASE)[number], number>>): Dim {
  const d = Array<Rat>(NBASE).fill(ZERO)
  for (const [k, v] of Object.entries(exponents)) {
    const i = BASE.indexOf(k as (typeof BASE)[number])
    if (i < 0) throw new Error(`unknown base dimension ${k}`)
    d[i] = rat(v as number)
  }
  return Object.freeze(d)
}

/** Build from a mathjs dimension array (integers, same order). */
export function dimFromArray(a: readonly number[]): Dim {
  const d = Array<Rat>(NBASE).fill(ZERO)
  for (let i = 0; i < NBASE; i++) d[i] = Number.isInteger(a[i] ?? 0) ? rat(a[i] ?? 0) : approxRat(a[i] ?? 0)
  return Object.freeze(d)
}

export const dimMul = (a: Dim, b: Dim): Dim =>
  Object.freeze(a.map((x, i) => ratAdd(x, b[i]!)))

export const dimDiv = (a: Dim, b: Dim): Dim =>
  Object.freeze(a.map((x, i) => ratSub(x, b[i]!)))

export const dimPow = (a: Dim, p: Rat): Dim =>
  Object.freeze(a.map((x) => ratMul(x, p)))

export const dimEq = (a: Dim, b: Dim): boolean =>
  a.length === b.length && a.every((x, i) => ratEq(x, b[i]!))

export const isDimless = (a: Dim): boolean => a.every(ratIsZero)

/** SI symbols for the base dimensions, for error messages and fallback display. */
const SI_SYMBOL = ['kg', 'm', 's', 'A', 'K', 'cd', 'mol', 'rad', 'bit'] as const

const SUPER: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸',
  '9': '⁹', '/': 'ᐟ',
}

function superscript(r: Rat): string {
  if (ratEq(r, ONE)) return ''
  const s = r.d === 1 ? String(r.n) : `${r.n}/${r.d}`
  return [...s].map((c) => SUPER[c] ?? c).join('')
}

/** Human-readable SI form of a dimension, e.g. "kg m s⁻²". Used in errors. */
export function dimToString(d: Dim): string {
  const parts: string[] = []
  for (let i = 0; i < NBASE; i++) {
    const r = d[i]!
    if (ratIsZero(r)) continue
    parts.push(SI_SYMBOL[i]! + superscript(r))
  }
  return parts.length ? parts.join(' ') : 'dimensionless'
}

/** Named dimensions, for parameter `type=` declarations and inspector labels. */
export const NAMED: Record<string, Dim> = {
  scalar: DIMLESS,
  integer: DIMLESS,
  angle: dimFrom({ ANGLE: 1 }),
  length: dimFrom({ LENGTH: 1 }),
  area: dimFrom({ LENGTH: 2 }),
  volume: dimFrom({ LENGTH: 3 }),
  mass: dimFrom({ MASS: 1 }),
  time: dimFrom({ TIME: 1 }),
  velocity: dimFrom({ LENGTH: 1, TIME: -1 }),
  acceleration: dimFrom({ LENGTH: 1, TIME: -2 }),
  force: dimFrom({ MASS: 1, LENGTH: 1, TIME: -2 }),
  torque: dimFrom({ MASS: 1, LENGTH: 2, TIME: -2 }),
  energy: dimFrom({ MASS: 1, LENGTH: 2, TIME: -2 }),
  power: dimFrom({ MASS: 1, LENGTH: 2, TIME: -3 }),
  stiffness: dimFrom({ MASS: 1, TIME: -2 }),
  damping: dimFrom({ MASS: 1, TIME: -1 }),
  inertia: dimFrom({ MASS: 1, LENGTH: 2 }),
  charge: dimFrom({ TIME: 1, CURRENT: 1 }),
  efield: dimFrom({ MASS: 1, LENGTH: 1, TIME: -3, CURRENT: -1 }),
  eflux: dimFrom({ MASS: 1, LENGTH: 3, TIME: -3, CURRENT: -1 }),
  permittivity: dimFrom({ MASS: -1, LENGTH: -3, TIME: 4, CURRENT: 2 }),
  frequency: dimFrom({ TIME: -1 }),
}

/** Reverse lookup: the name of a dimension if it has one. For inspector display. */
export function dimName(d: Dim): string | undefined {
  for (const [name, dd] of Object.entries(NAMED)) {
    if (name === 'integer' || name === 'scalar') continue
    if (dimEq(d, dd)) return name
  }
  return isDimless(d) ? 'scalar' : undefined
}
