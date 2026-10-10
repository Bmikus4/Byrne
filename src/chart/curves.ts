// Curves from a formula the user types: y = f(x), (x(t), y(t)), or r = f(theta).
//
// Evaluated by Byrne's own expression walker (core/expr.ts), never by eval or by mathjs's
// evaluate, so a formula cannot reach anything but arithmetic. Two friendly rewrites run
// first because chart formulas are dimensionless and typed by people, not physicists:
// `2x` means `2*x` (Byrne would read the letter after a number as a UNIT), and `θ`, `π`
// and `ln` are accepted as written.

import { ExprError, ValueEnv, evaluate, parse } from '../core/expr.js'
import { T, Value, vScalar } from '../core/values.js'
import type { CurveMode, Vec } from './model.js'

export function friendly(src: string): string {
  return src
    .replace(/θ/g, 'theta')
    .replace(/π/g, 'pi')
    .replace(/τ/g, 'tau')
    .replace(/\bln\s*\(/g, 'log(')
    .replace(/·|×/g, '*')
    // A digit followed by a name or a bracket is a product, except scientific notation.
    // The look-behind keeps `atan2(` a function name rather than `atan2*(`.
    .replace(/(?<![A-Za-z_\d.])(\d+(?:\.\d*)?)\s*(?=[A-Za-z(])(?![eE][+-]?\d)/g, '$1*')
    .replace(/\)\s*(?=[A-Za-z(\d])/g, ')*')
}

type Fn = (vars: Record<string, number>) => number

export function compile(src: string): Fn {
  const parsed = parse(friendly(src))
  return (vars) => {
    const env: ValueEnv = {
      defaultFrame: 'world',
      type: (name) => (name in vars || name in CONSTS ? T('scalar') : undefined),
      value: (name): Value | undefined => {
        if (name in vars) return vScalar(vars[name]!)
        if (name in CONSTS) return vScalar(CONSTS[name]!)
        return undefined
      },
    }
    const v = evaluate(parsed, env)
    if (v.k !== 'scalar' && v.k !== 'integer') throw new ExprError('the formula must give a number')
    return v.si
  }
}

const CONSTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E }

export interface Sampled {
  /** One or more polylines in world cm; a break wherever the curve leaves the finite. */
  readonly runs: Vec[][]
  readonly error: string | null
}

export interface CurveSpec {
  mode: CurveMode
  at: Vec
  fx: string; px: string; py: string; pr: string
  from: number; to: number; k: number; scale: number
}

const SAMPLES = 600
const LIMIT = 1e4

export function sample(c: CurveSpec): Sampled {
  let fs: Fn[]
  try {
    fs = c.mode === 'function' ? [compile(c.fx)]
      : c.mode === 'parametric' ? [compile(c.px), compile(c.py)]
        : [compile(c.pr)]
  } catch (e) {
    return { runs: [], error: tidy((e as Error).message) }
  }
  const runs: Vec[][] = []
  let run: Vec[] = []
  let prev: Vec | null = null
  let firstError: string | null = null
  const span = Math.abs(c.to - c.from)
  const jump = Math.max(5, span) * 2
  for (let i = 0; i <= SAMPLES; i++) {
    const u = c.from + ((c.to - c.from) * i) / SAMPLES
    let p: Vec | null = null
    try {
      if (c.mode === 'function') {
        p = [u, fs[0]!({ x: u, t: u, k: c.k })]
      } else if (c.mode === 'parametric') {
        const v = { t: u, x: u, k: c.k }
        p = [fs[0]!(v), fs[1]!(v)]
      } else {
        const r = fs[0]!({ theta: u, t: u, x: u, k: c.k })
        p = [r * Math.cos(u), r * Math.sin(u)]
      }
    } catch (e) {
      firstError ??= tidy((e as Error).message)
      p = null
    }
    const ok = p && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
      Math.abs(p[0]) < LIMIT && Math.abs(p[1]) < LIMIT
    if (!ok || (prev && p && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > jump)) {
      if (run.length > 1) runs.push(run)
      run = []
    }
    if (ok && p) {
      run.push([c.at[0] + p[0] * c.scale, c.at[1] + p[1] * c.scale])
      prev = p
    } else prev = null
  }
  if (run.length > 1) runs.push(run)
  return { runs, error: runs.length ? null : firstError ?? 'nothing to draw in this range' }
}

function tidy(msg: string): string {
  return msg
    .replace(/^cannot parse `[^`]*`: /, 'Could not read the formula: ')
    .replace(/unknown name `([^`]+)`/, 'unknown name "$1" (use x, t, theta, k, pi or e)')
}

/** Catmull-Rom through the points, as cubic Bezier control points: p0 c1 c2 p1 c1 c2 p2 ... */
export function smoothThrough(pts: readonly Vec[], closed: boolean): Vec[] {
  if (pts.length < 2) return pts.slice()
  const P = closed ? [pts[pts.length - 1]!, ...pts, pts[0]!, pts[1]!] : [pts[0]!, ...pts, pts[pts.length - 1]!]
  const out: Vec[] = [P[1]!]
  const segs = closed ? pts.length : pts.length - 1
  for (let i = 1; i <= segs; i++) {
    const p0 = P[i - 1]!, p1 = P[i]!, p2 = P[i + 1]!, p3 = P[i + 2]!
    out.push(
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    )
  }
  return out
}
