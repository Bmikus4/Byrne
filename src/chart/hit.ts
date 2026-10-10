// What is under the pointer. Tested against the same primitives the canvas draws, so a
// thick band is grabbable across its whole width and a label across its whole box.

import type { Prim, Pt } from '../figure/ir.js'
import type { Obj } from './model.js'
import type { Rendered } from './render.js'

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function polyDist(p: Pt, pts: readonly Pt[]): number {
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1]!, pts[i]!))
  return d
}

function inside(p: Pt, pts: readonly Pt[]): boolean {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

function cubicPoints(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [pts[0]!]
  for (let i = 1; i + 2 < pts.length; i += 3) {
    const p0 = pts[i - 1]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2]!
    for (let k = 1; k <= 12; k++) {
      const t = k / 12, u = 1 - t
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ])
    }
  }
  return out
}

/** Distance from p to a primitive's painted area, in points. 0 means on or inside it. */
export function primDistance(p: Pt, q: Prim): number {
  const half = (q.style.stroke && q.style.stroke !== 'none' ? (q.style.weight ?? 1) : 0) / 2
  const filled = !!q.style.fill && q.style.fill !== 'none'
  switch (q.kind) {
    case 'line': return Math.max(0, segDist(p, q.a, q.b) - half)
    case 'polyline':
      if (q.closed && filled && inside(p, q.pts)) return 0
      return Math.max(0, polyDist(p, q.closed ? [...q.pts, q.pts[0]!] : q.pts) - half)
    case 'cubic': {
      const pts = cubicPoints(q.pts)
      if (filled && inside(p, pts)) return 0
      return Math.max(0, polyDist(p, pts) - half)
    }
    case 'circle': {
      const d = Math.hypot(p[0] - q.c[0], p[1] - q.c[1])
      if (filled && d <= q.r) return 0
      return Math.max(0, Math.abs(d - q.r) - half)
    }
    case 'ellipse': {
      const pts: Pt[] = []
      const c = Math.cos(q.rot), s = Math.sin(q.rot)
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * 2 * Math.PI
        const x = q.rx * Math.cos(t), y = q.ry * Math.sin(t)
        pts.push([q.c[0] + x * c - y * s, q.c[1] + x * s + y * c])
      }
      return Math.max(0, polyDist(p, pts) - half)
    }
    case 'arc': {
      const pts: Pt[] = []
      for (let i = 0; i <= 48; i++) {
        const a = q.a0 + ((q.a1 - q.a0) * i) / 48
        pts.push([q.c[0] + q.r * Math.cos(a), q.c[1] - q.r * Math.sin(a)])
      }
      return Math.max(0, polyDist(p, pts) - half)
    }
    case 'label': return Infinity
  }
}

/**
 * The topmost object within `tol` points of p. Labels and boxes hit across their whole
 * box; everything else on its painted strokes and fills. Locked objects are skipped, which
 * is what lets a background disk sit under everything without stealing every click.
 */
export function hitTest(r: Rendered, objects: readonly Obj[], p: Pt, tol: number): string | null {
  const byId = new Map<string, Prim[]>()
  for (const q of r.prims) {
    const list = byId.get(q.id)
    if (list) list.push(q)
    else byId.set(q.id, [q])
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!
    if (o.hidden || o.locked) continue
    if (o.type === 'label' || o.type === 'box') {
      const b = r.areas.get(o.id)
      if (b && p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol) return o.id
      if (o.type === 'label' && o.leader) {
        for (const q of byId.get(o.id) ?? []) if (q.kind === 'line' && primDistance(p, q) <= tol) return o.id
      }
      continue
    }
    for (const q of byId.get(o.id) ?? []) {
      if (primDistance(p, q) <= tol) return o.id
    }
  }
  return null
}

/** Objects whose boxes fall wholly inside a rectangle, for drag-to-select. */
export function inRect(r: Rendered, objects: readonly Obj[], a: Pt, b: Pt): string[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
  return objects.filter((o) => {
    if (o.hidden || o.locked) return false
    const bx = r.boxes.get(o.id)
    return !!bx && bx[0] >= x0 && bx[2] <= x1 && bx[1] >= y0 && bx[3] <= y1
  }).map((o) => o.id)
}
