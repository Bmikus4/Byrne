// The chart document: a flat list of drawable objects in world centimetres, y up.
//
// Centimetres because the charts this mode was built for are TikZ figures written in
// centimetres; a template copied out of a .tex keeps its numbers. Everything here is plain
// data so a document survives JSON, localStorage and undo by structural copy.

import type { Palette } from './field.js'

export type Vec = [number, number]

export type Dash = 'solid' | 'dashed' | 'dotted'
export type Arrow = 'none' | 'end' | 'start' | 'both'
export type Anchor = 'c' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type Spacing = 'hyperbolic' | 'converging' | 'even'
export type Thickness = 'hyperbolic' | 'proportional' | 'fixed'
export type CurveMode = 'function' | 'parametric' | 'polar'

/** Every object carries the same flat style so the inspector is one panel, not twelve. */
export interface Look {
  /** Line or text colour. */
  color: string
  /** Line width in points. */
  width: number
  dash: Dash
  /** Fill colour; empty string means no fill. */
  fill: string
  opacity: number
}

interface Base extends Look {
  id: string
  name: string
  hidden?: boolean
  locked?: boolean
}

export type Obj =
  | Base & { type: 'circle'; c: Vec; r: number }
  | Base & { type: 'band'; c: Vec; r: number; thick: number; edge: string }
  | Base & {
    type: 'rings'; c: Vec; r: number; count: number; spacing: Spacing; ratio: number
    start: number; thick: number; thickness: Thickness; edge: string
  }
  | Base & { type: 'line'; a: Vec; b: Vec; arrow: Arrow; wavy: boolean }
  | Base & { type: 'arc'; c: Vec; r: number; from: number; to: number; arrow: Arrow }
  | Base & { type: 'dot'; at: Vec; size: number }
  | Base & {
    type: 'label'; at: Vec; title: string; text: string; note: string; anchor: Anchor
    size: number; align: 'left' | 'center' | 'right'; leader: Vec | null; leaderColor: string
  }
  | Base & { type: 'box'; at: Vec; w: number; title: string; text: string; note: string; size: number }
  | Base & { type: 'ticks'; c: Vec; r: number; from: number; to: number; bits: string; length: number }
  | Base & {
    type: 'curve'; mode: CurveMode; at: Vec; fx: string; px: string; py: string; pr: string
    from: number; to: number; k: number; scale: number
  }
  // tan: the curve's direction through each point once a point has been dragged; null or
  // absent means it follows from the neighbours.
  | Base & { type: 'path'; pts: Vec[]; smooth: boolean; closed: boolean; tan?: (Vec | null)[] }
  | Base & {
    type: 'orbit'; c: Vec; mu: number; at: Vec; vel: Vec; arrowScale: number
    showBody: boolean; showSatellite: boolean; showVelocity: boolean; showFoci: boolean
    showApsides: boolean; showRadius: boolean; marks: number; spokes: boolean
    bodyColor: string; satColor: string; reach: number
  }
  // color/width are the rim. flow moves the crests one per `period` seconds.
  | Base & {
    type: 'field'; c: Vec; r: number; ratio: number; pockets: number; strength: number; twist: number
    seed: number; palette: Palette; poles: boolean; geometry: boolean; slice: boolean; sliceAngle: number
    sites: number; flow: 'in' | 'out' | 'still'; period: number; detail: number
  }
  // at is the centre; src a data: URL (PNG or JPEG); w and h in cm.
  | Base & { type: 'image'; at: Vec; w: number; h: number; src: string }

export type ObjType = Obj['type']
export type ObjOf<T extends ObjType> = Extract<Obj, { type: T }>

export interface Grid {
  kind: 'square' | 'polar'
  /** Spacing in cm (square) or ring spacing in cm (polar). */
  step: number
  /** Angular step in degrees, polar grid only. */
  angle: number
  show: boolean
  snap: boolean
}

export interface ChartDoc {
  version: 1
  title: string
  objects: Obj[]
  grid: Grid
  background: string
}

/** The named colours of the source charts, so a new object matches the old ones. */
export const COLORS = {
  ink: '#1e1e28',
  note: '#5f5f69',
  soft: '#727278',
  shell: '#f3f6fb',
  pocket: '#b6c7e7',
  pocketEdge: '#a1b7e0',
  chaos: '#be3c46',
  order: '#326eb4',
  source: '#c88c1e',
  sourceDark: '#a07018',
  daemon: '#6e3ca0',
  boxEdge: '#9f9fa5',
  white: '#ffffff',
} as const

export const SWATCHES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Ink', hex: COLORS.ink },
  { name: 'Grey', hex: COLORS.note },
  { name: 'Chaos red', hex: COLORS.chaos },
  { name: 'Order blue', hex: COLORS.order },
  { name: 'Source gold', hex: COLORS.source },
  { name: 'Dark gold', hex: COLORS.sourceDark },
  { name: 'Daemon purple', hex: COLORS.daemon },
  { name: 'Pocket blue', hex: COLORS.pocket },
  { name: 'Pale shell', hex: COLORS.shell },
  { name: 'Green', hex: '#2e7d4f' },
  { name: 'Orange', hex: '#d9731a' },
  { name: 'White', hex: COLORS.white },
]

export const SIZES: ReadonlyArray<{ name: string; pt: number }> = [
  { name: 'Small', pt: 7 },
  { name: 'Normal', pt: 8 },
  { name: 'Large', pt: 10 },
  { name: 'Heading', pt: 12 },
  { name: 'Huge', pt: 16 },
]

let counter = 0
export const newId = (): string =>
  `o${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

const look = (over: Partial<Look> = {}): Look => ({
  color: COLORS.ink, width: 0.8, dash: 'solid', fill: '', opacity: 1, ...over,
})

export const TYPE_NAMES: Record<ObjType, string> = {
  circle: 'Circle',
  band: 'Band',
  rings: 'Rings',
  line: 'Line',
  arc: 'Arc',
  dot: 'Dot',
  label: 'Label',
  box: 'Note box',
  ticks: 'Tick string',
  curve: 'Formula curve',
  path: 'Drawn curve',
  orbit: 'Orbit',
  field: 'Heatmap',
  image: 'Picture',
}

/** A fresh object of each kind, at a point, with defaults chosen to look right at once. */
export function make(type: ObjType, at: Vec, extra: Partial<Obj> = {}): Obj {
  const id = newId()
  const name = TYPE_NAMES[type]
  const base = { id, name }
  let o: Obj
  switch (type) {
    case 'circle': o = { ...base, ...look({ width: 1.2 }), type, c: at, r: 2 }; break
    case 'band': o = { ...base, ...look({ color: COLORS.pocket, width: 0 }), type, c: at, r: 2, thick: 0.3, edge: COLORS.pocketEdge }; break
    case 'rings': o = {
      ...base, ...look({ color: COLORS.pocket, width: 0 }), type, c: at, r: 5, count: 5,
      spacing: 'hyperbolic', ratio: 2, start: 2.4, thick: 0.2, thickness: 'hyperbolic', edge: COLORS.pocketEdge,
    }; break
    case 'line': o = { ...base, ...look(), type, a: at, b: [at[0] + 2, at[1]], arrow: 'none', wavy: false }; break
    case 'arc': o = { ...base, ...look({ width: 0.4 }), type, c: at, r: 2, from: 0, to: 90, arrow: 'none' }; break
    case 'dot': o = { ...base, ...look(), type, at, size: 5 }; break
    case 'label': o = {
      ...base, ...look(), type, at, title: '', text: 'New label', note: '', anchor: 'c',
      size: 8, align: 'center', leader: null, leaderColor: COLORS.note,
    }; break
    case 'box': o = {
      ...base, ...look({ color: COLORS.ink, width: 0.4, fill: COLORS.white }), type, at, w: 6,
      title: 'Heading', text: 'Write here. Long lines wrap to the width of the box.', note: '', size: 8,
    }; break
    case 'ticks': o = {
      ...base, ...look(), type, c: at, r: 3, from: 60, to: 120, bits: '1011001011', length: 0.28,
    }; break
    case 'curve': o = {
      ...base, ...look({ color: COLORS.order }), type, mode: 'function', at,
      fx: 'sin(x)', px: 'cos(3*t)', py: 'sin(2*t)', pr: '1 + 0.5*cos(k*theta)',
      from: -6.28, to: 6.28, k: 3, scale: 1,
    }; break
    case 'path': o = { ...base, ...look(), type, pts: [at], smooth: true, closed: false }; break
    case 'orbit': o = {
      ...base, ...look({ color: COLORS.order, width: 1 }), type, c: at, mu: 9,
      at: [at[0] + 3, at[1]], vel: [0, Math.sqrt(9 / 3)], arrowScale: 1,
      showBody: true, showSatellite: true, showVelocity: true, showFoci: false,
      showApsides: false, showRadius: false, marks: 0, spokes: false,
      bodyColor: COLORS.source, satColor: COLORS.ink, reach: 12,
    }; break
    case 'field': o = {
      ...base, ...look({ color: '#c8501e', width: 2.4 }), type, c: at, r: 4, ratio: 1.45, pockets: 4,
      strength: 0.85, twist: 55, seed: 7, palette: 'jet', poles: false, geometry: true, slice: true,
      sliceAngle: 90, sites: 32, flow: 'in', period: 4, detail: 360,
    }; break
    case 'image': o = { ...base, ...look({ width: 0 }), type, at, w: 6, h: 4, src: '' }; break
  }
  return { ...o, ...extra } as Obj
}

// ---------------------------------------------------------------------------
// Handles: the points a user can grab. Each is a world point with a setter, so the canvas
// needs no per-type code to drag anything.

export interface Handle {
  key: string
  at: Vec
  /** 'move' handles carry the whole object; 'shape' handles reshape it. */
  role: 'move' | 'shape'
  hint: string
}

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]
const len = (a: Vec): number => Math.hypot(a[0], a[1])
const polar = (c: Vec, r: number, deg: number): Vec =>
  [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)]
const angleOf = (c: Vec, p: Vec): number => (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI

export function handles(o: Obj): Handle[] {
  switch (o.type) {
    case 'circle': case 'band':
      return [
        { key: 'c', at: o.c, role: 'move', hint: 'centre' },
        { key: 'r', at: [o.c[0] + o.r, o.c[1]], role: 'shape', hint: 'radius' },
      ]
    case 'rings':
      return [
        { key: 'c', at: o.c, role: 'move', hint: 'centre' },
        { key: 'r', at: [o.c[0] + o.r, o.c[1]], role: 'shape', hint: 'outer radius' },
      ]
    case 'line':
      return [
        { key: 'a', at: o.a, role: 'shape', hint: 'start' },
        { key: 'b', at: o.b, role: 'shape', hint: 'end' },
      ]
    case 'arc':
      return [
        { key: 'c', at: o.c, role: 'move', hint: 'centre' },
        { key: 'from', at: polar(o.c, o.r, o.from), role: 'shape', hint: 'start' },
        { key: 'to', at: polar(o.c, o.r, o.to), role: 'shape', hint: 'end' },
      ]
    case 'dot':
      return [{ key: 'at', at: o.at, role: 'move', hint: 'position' }]
    case 'label': {
      const h: Handle[] = [{ key: 'at', at: o.at, role: 'move', hint: 'anchor point' }]
      if (o.leader) h.push({ key: 'leader', at: o.leader, role: 'shape', hint: 'pointer tip' })
      return h
    }
    case 'box':
      return [
        { key: 'at', at: o.at, role: 'move', hint: 'top-left corner' },
        { key: 'w', at: [o.at[0] + o.w, o.at[1]], role: 'shape', hint: 'width' },
      ]
    case 'ticks':
      return [
        { key: 'c', at: o.c, role: 'move', hint: 'centre' },
        { key: 'from', at: polar(o.c, o.r, o.from), role: 'shape', hint: 'first tick' },
        { key: 'to', at: polar(o.c, o.r, o.to), role: 'shape', hint: 'last tick' },
      ]
    case 'curve':
      return [{ key: 'at', at: o.at, role: 'move', hint: 'origin' }]
    case 'path':
      return o.pts.map((p, i) => ({ key: `p${i}`, at: p, role: 'shape' as const, hint: `point ${i + 1}` }))
    case 'orbit':
      return [
        { key: 'c', at: o.c, role: 'move', hint: 'central body' },
        { key: 'at', at: o.at, role: 'shape', hint: 'satellite' },
        { key: 'vel', at: add(o.at, [o.vel[0] * o.arrowScale, o.vel[1] * o.arrowScale]), role: 'shape', hint: 'velocity' },
      ]
    case 'field':
      return [
        { key: 'c', at: o.c, role: 'move', hint: 'centre' },
        { key: 'r', at: [o.c[0] + o.r, o.c[1]], role: 'shape', hint: 'radius' },
      ]
    case 'image':
      return [
        { key: 'at', at: o.at, role: 'move', hint: 'centre' },
        { key: 'size', at: [o.at[0] + o.w / 2, o.at[1] - o.h / 2], role: 'shape', hint: 'size' },
      ]
  }
}

/** Move one handle to a world point. Returns a new object; the input is not touched. */
export function setHandle(o: Obj, key: string, p: Vec): Obj {
  switch (o.type) {
    case 'circle': case 'band': case 'rings': case 'field':
      if (key === 'c') return { ...o, c: p }
      return { ...o, r: Math.max(0.01, len(sub(p, o.c))) }
    case 'image': {
      if (key === 'at') return { ...o, at: p }
      // The corner keeps the picture's proportions: a stretched photograph is never wanted.
      const w = Math.max(0.2, 2 * Math.max(Math.abs(p[0] - o.at[0]), (Math.abs(p[1] - o.at[1]) * o.w) / o.h))
      return { ...o, w, h: (w * o.h) / o.w }
    }
    case 'line':
      return key === 'a' ? { ...o, a: p } : { ...o, b: p }
    case 'arc':
      if (key === 'c') return { ...o, c: p }
      if (key === 'from') return { ...o, from: round(angleOf(o.c, p)), r: Math.max(0.01, len(sub(p, o.c))) }
      return { ...o, to: unwrapNear(round(angleOf(o.c, p)), o.to), r: Math.max(0.01, len(sub(p, o.c))) }
    case 'dot': return { ...o, at: p }
    case 'label':
      return key === 'leader' ? { ...o, leader: p } : { ...o, at: p }
    case 'box':
      return key === 'w' ? { ...o, w: Math.max(0.5, p[0] - o.at[0]) } : { ...o, at: p }
    case 'ticks':
      if (key === 'c') return { ...o, c: p }
      if (key === 'from') return { ...o, from: round(angleOf(o.c, p)), r: Math.max(0.01, len(sub(p, o.c))) }
      return { ...o, to: unwrapNear(round(angleOf(o.c, p)), o.to), r: Math.max(0.01, len(sub(p, o.c))) }
    case 'curve': return { ...o, at: p }
    case 'path': {
      const i = Number(key.slice(1))
      const pts = o.pts.slice()
      pts[i] = p
      if (!o.smooth) return { ...o, pts }
      // Every other point keeps the direction the curve already had through it. Deriving
      // each direction from its neighbours made one drag bend the curve two points away.
      const was = tangents(o.pts, o.closed), now = tangents(pts, o.closed)
      return { ...o, pts, tan: o.pts.map((_, j) => (j === i ? now[j]! : o.tan?.[j] ?? was[j]!)) }
    }
    case 'orbit':
      // The body's square carries the whole system: the satellite keeps its place
      // relative to the body, so the orbit moves without changing shape.
      if (key === 'c') return translate(o, [p[0] - o.c[0], p[1] - o.c[1]])
      if (key === 'at') return { ...o, at: p }
      return { ...o, vel: [(p[0] - o.at[0]) / o.arrowScale, (p[1] - o.at[1]) / o.arrowScale] }
  }
}

const round = (x: number): number => Math.round(x * 10) / 10

/** Catmull-Rom direction through each point; an open curve's ends lean on their one neighbour. */
export function tangents(pts: readonly Vec[], closed: boolean): Vec[] {
  const n = pts.length
  return pts.map((_, i) => {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!
    return [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2]
  })
}

/** Keep an end angle on the same turn as before, so dragging past 180 does not flip it. */
function unwrapNear(deg: number, prev: number): number {
  let d = deg
  while (d - prev > 180) d -= 360
  while (prev - d > 180) d += 360
  return d
}

/** Move a whole object by a world offset. */
export function translate(o: Obj, d: Vec): Obj {
  const t = (p: Vec): Vec => add(p, d)
  switch (o.type) {
    case 'circle': case 'band': case 'rings': case 'arc': case 'ticks': case 'field':
      return { ...o, c: t(o.c) }
    case 'image': return { ...o, at: t(o.at) }
    case 'line': return { ...o, a: t(o.a), b: t(o.b) }
    case 'dot': case 'box': case 'curve': return { ...o, at: t(o.at) }
    case 'label': return { ...o, at: t(o.at), leader: o.leader ? t(o.leader) : null }
    case 'path': return { ...o, pts: o.pts.map(t) }
    case 'orbit': return { ...o, c: t(o.c), at: t(o.at) }
  }
}

/** The point a whole-object drag snaps by: the first handle. */
export const anchorOf = (o: Obj): Vec => handles(o)[0]!.at

export function emptyDoc(title = 'Untitled chart'): ChartDoc {
  return {
    version: 1,
    title,
    objects: [],
    grid: { kind: 'square', step: 0.5, angle: 15, show: true, snap: true },
    background: '#ffffff',
  }
}

/** Accept anything that looks like a saved chart; fill whatever a newer default added. */
export function normalize(raw: unknown): ChartDoc {
  const d = raw as Partial<ChartDoc> | null
  if (!d || typeof d !== 'object' || !Array.isArray(d.objects)) throw new Error('This file is not a chart.')
  const base = emptyDoc(d.title ?? 'Untitled chart')
  const objects = d.objects.map((o) => {
    const fresh = make(o.type, [0, 0])
    return { ...fresh, ...o } as Obj
  })
  return { ...base, ...d, version: 1, objects, grid: { ...base.grid, ...(d.grid ?? {}) } }
}
