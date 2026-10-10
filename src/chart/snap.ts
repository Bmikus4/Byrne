// Snapping: to an object's key point when one is close, otherwise to the grid.
//
// Key points win over the grid because a pointer tip dropped next to a dot means the dot,
// even when the dot is off-grid (a ring radius of R tanh(ln 2) is never on a 0.5 cm grid).

import { Grid, Obj, Vec, handles } from './model.js'

export interface Snapped {
  readonly p: Vec
  readonly kind: 'point' | 'grid' | 'none'
}

export function snapToGrid(p: Vec, g: Grid): Vec {
  if (g.kind === 'square') {
    const s = g.step > 0 ? g.step : 0.5
    return [round(Math.round(p[0] / s) * s), round(Math.round(p[1] / s) * s)]
  }
  const r = Math.hypot(p[0], p[1])
  const s = g.step > 0 ? g.step : 0.5
  const rs = Math.round(r / s) * s
  if (rs === 0) return [0, 0]
  const a = (Math.atan2(p[1], p[0]) * 180) / Math.PI
  const as = g.angle > 0 ? Math.round(a / g.angle) * g.angle : a
  const t = (as * Math.PI) / 180
  return [round(rs * Math.cos(t)), round(rs * Math.sin(t))]
}

const round = (x: number): number => Math.round(x * 1e6) / 1e6

/** Every point worth landing on: centres, ends, dots, and the four quarter points of circles. */
export function keyPoints(objects: readonly Obj[], exclude: ReadonlySet<string>): Vec[] {
  const out: Vec[] = []
  for (const o of objects) {
    if (exclude.has(o.id) || o.hidden) continue
    for (const h of handles(o)) out.push(h.at)
    if (o.type === 'circle' || o.type === 'band') {
      out.push([o.c[0], o.c[1] + o.r], [o.c[0] - o.r, o.c[1]], [o.c[0], o.c[1] - o.r])
    }
  }
  return out
}

/**
 * `tol` is in world cm (the caller converts from screen pixels so snapping feels the same
 * at every zoom). `free` turns snapping off for one gesture (the Alt key).
 */
export function snap(
  p: Vec, grid: Grid, points: readonly Vec[], tol: number, free = false,
): Snapped {
  if (free || !grid.snap) return { p, kind: 'none' }
  let best: Vec | null = null
  let bestD = tol
  for (const q of points) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < bestD) { bestD = d; best = q }
  }
  if (best) return { p: [best[0], best[1]], kind: 'point' }
  return { p: snapToGrid(p, grid), kind: 'grid' }
}
