// Units. The table, the prefixes and the imperial conversions come from mathjs; this
// module is a thin, cached adapter that turns a unit string into (SI factor, dimension)
// and back. We do not maintain a unit table.
//
// Everything inside the model is stored in SI. A unit string is a DISPLAY choice and a
// PARSE instruction, never a storage format. That is what makes acceptance example F
// (switch project units, model unchanged) true by construction rather than by effort.

import { create, all } from 'mathjs'
import { Dim, dimFromArray, dimEq, dimName, dimToString, DIMLESS, isDimless } from './dimension.js'

const math = create(all, { number: 'number' })

export interface UnitSpec {
  /** Multiply a value in this unit by `factor` to get SI. */
  readonly factor: number
  readonly dim: Dim
  /** The unit string as written. */
  readonly symbol: string
}

const unitCache = new Map<string, UnitSpec>()

export class UnitError extends Error {}

/** Resolve a unit string such as "cm", "m/s^2", "N*m", "lbf". Cached. */
export function unit(symbol: string): UnitSpec {
  const key = symbol.trim()
  const hit = unitCache.get(key)
  if (hit) return hit
  if (key === '' || key === '1') {
    const u = { factor: 1, dim: DIMLESS, symbol: '' }
    unitCache.set(key, u)
    return u
  }
  let u: UnitSpec
  try {
    const m = math.unit(1, key)
    const si = m.toSI()
    const factor = si.toNumber()
    if (!Number.isFinite(factor)) throw new UnitError(`unit ${key} has no finite SI factor`)
    u = { factor, dim: dimFromArray(m.dimensions as unknown as number[]), symbol: key }
  } catch (e) {
    throw new UnitError(`unknown unit \`${key}\``)
  }
  unitCache.set(key, u)
  return u
}

export function isKnownUnit(symbol: string): boolean {
  try { unit(symbol); return true } catch { return false }
}

/** A scalar magnitude in SI, its dimension, and the unit it was written in. */
export interface Scalar {
  readonly si: number
  readonly dim: Dim
  /** Display preference. Empty string means "dimensionless" or "project default". */
  readonly unit: string
}

export const scalar = (si: number, dim: Dim = DIMLESS, u = ''): Scalar => ({ si, dim, unit: u })

/**
 * Parse a literal such as `5`, `5 m`, `-3.2e4 kg m^2 / s^2`, `0.3`.
 * Returns undefined when the text is not a bare literal (it is then an expression).
 */
const LITERAL = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/

export function parseLiteral(text: string): Scalar | undefined {
  const m = LITERAL.exec(text)
  if (!m) return undefined
  const value = Number(m[1])
  const usym = m[2] ?? ''
  if (usym === '') return scalar(value, DIMLESS, '')
  if (!isKnownUnit(usym)) return undefined
  const u = unit(usym)
  return scalar(value * u.factor, u.dim, usym)
}

/** Convert an SI magnitude to a display magnitude in `symbol`. Throws on dimension mismatch. */
export function toUnit(s: Scalar, symbol: string): number {
  const u = unit(symbol)
  if (!dimEq(s.dim, u.dim)) {
    throw new UnitError(
      `cannot express ${dimToString(s.dim)} in \`${symbol}\` (${dimToString(u.dim)})`,
    )
  }
  return s.si / u.factor
}

/** Shortest round-trip decimal, then trimmed to `sig` significant figures for display. */
export function formatNumber(x: number, sig = 6): string {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) return trimExp(x.toExponential(Math.max(0, sig - 1)))
  const s = x.toPrecision(sig)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function trimExp(s: string): string {
  const [m, e] = s.split('e')
  const mm = m!.includes('.') ? m!.replace(/\.?0+$/, '') : m!
  return `${mm}e${e}`
}

/** Render a scalar for display, in its own unit or an override. Always carries the unit. */
export function formatScalar(s: Scalar, opts: { unit?: string; sig?: number } = {}): string {
  const sym = opts.unit ?? s.unit
  const sig = opts.sig ?? 6
  if (sym === '') {
    return isDimless(s.dim) ? formatNumber(s.si, sig) : `${formatNumber(s.si, sig)} ${dimToString(s.dim)}`
  }
  return `${formatNumber(toUnit(s, sym), sig)} ${sym}`
}

/**
 * The unit a quantity is displayed in: the project's own choice for that dimension if it
 * declared one, else the quantity's own, else SI symbols. This is the whole of "per-project
 * defaults, per-value override" -- the stored value never moves.
 */
export function displayUnit(
  projectUnits: Readonly<Record<string, string>>, dim: Dim, own = '',
): string {
  const name = dimName(dim)
  if (name && projectUnits[name]) return projectUnits[name]!
  if (own) return own
  return ''
}

/** The SI symbol string for a dimension, used when no display unit was chosen. */
export function siSymbol(dim: Dim): string {
  return isDimless(dim) ? '' : dimToString(dim)
}

export { math as mathjs }
