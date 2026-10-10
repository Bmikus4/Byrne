// Chart document -> Figure IR. The canvas draws this, and the SVG, PDF and TikZ exports
// serialise this, so what is on screen and what is in the file are one computation.
//
// Space: IR points, y DOWN, origin at world (0,0). The editor pans and zooms over that
// space; an export shifts it so the drawing's bounding box sits at a margin.

import type { Figure, Prim, Pt, Style } from '../figure/ir.js'
import { Arrow, COLORS, Obj, ObjOf, Vec } from './model.js'
import { drawRange, elementsOf, equalTimeNus, advance, pointAt, velocityAt, Elements } from './orbit.js'
import { sample, smoothThrough } from './curves.js'
import { Block, NOTE_GREY, layoutBlock } from './text.js'
import { STATES, SPECTRUM_SAMPLES, binaryOf, fieldImage, framePhase, spectrum, stateRecord, stripImage } from './field.js'

/** Points per centimetre. */
export const K = 28.3465

export const toPt = (p: Vec): Pt => [p[0] * K, -p[1] * K]
export const toWorld = (p: Pt): Vec => [p[0] / K, -p[1] / K]

export type Box4 = [number, number, number, number]

export interface Rendered {
  readonly prims: Prim[]
  /** Per object: its bounding box in points, for selection, hit-testing and export crop. */
  readonly boxes: Map<string, Box4>
  /** The text block of each label and box: what a click on words should hit. */
  readonly areas: Map<string, Box4>
  /** Errors to show next to an object (a formula that does not parse, say). */
  readonly problems: Map<string, string>
  /** Orbit readouts, so the inspector does not recompute them. */
  readonly orbits: Map<string, Elements>
}

export interface RenderOpts {
  /** Seconds of orbit time to advance every satellite by. View only. */
  readonly time?: number
  /**
   * For the animated SVG: whatever moves is drawn as a placeholder image whose href is
   * `anim:<kind>:<id>` and whose box is where it moves, and chart/animate.ts swaps each
   * placeholder for SMIL. The placeholder keeps the export crop identical to the still.
   */
  readonly animated?: boolean
}

const DASH = (d: Obj['dash'], w: number): number[] | undefined =>
  d === 'dashed' ? [3 * Math.max(1, w / 0.8), 2.2 * Math.max(1, w / 0.8)]
    : d === 'dotted' ? [0.01, 1.8 + w * 1.5] : undefined

export function render(objects: readonly Obj[], opts: RenderOpts = {}): Rendered {
  const prims: Prim[] = []
  const boxes = new Map<string, Box4>()
  const areas = new Map<string, Box4>()
  const problems = new Map<string, string>()
  const orbits = new Map<string, Elements>()
  let depth = 0

  for (const o of objects) {
    if (o.hidden) continue
    const id = o.id
    const grow = (x0: number, y0: number, x1: number, y1: number): void => {
      const b = boxes.get(id)
      boxes.set(id, b
        ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)]
        : [x0, y0, x1, y1])
    }
    const push = (p: Prim): void => {
      prims.push(p)
      const [mn, mx] = primBounds(p)
      grow(mn[0], mn[1], mx[0], mx[1])
    }
    const st = (over: Partial<Style> = {}): Style => ({
      stroke: o.width > 0 ? o.color : 'none',
      weight: o.width,
      fill: o.fill || 'none',
      dash: DASH(o.dash, o.width),
      opacity: o.opacity < 1 ? o.opacity : undefined,
      ...over,
    })
    const d = depth++
    const line = (a: Vec, b: Vec, style: Style): void =>
      push({ kind: 'line', a: toPt(a), b: toPt(b), style, depth: d, id })
    const dot = (at: Vec, sizePt: number, color: string): void =>
      push({ kind: 'circle', c: toPt(at), r: sizePt / 2, style: { stroke: 'none', weight: 0, fill: color }, depth: d, id })
    const label = (at: Pt, latex: string, size: number, color: string): void =>
      push({ kind: 'label', at, latex, anchorX: 0, anchorY: 0, fontSize: size, baseline: true, style: { stroke: color }, depth: d, id })

    switch (o.type) {
      case 'circle':
        push({ kind: 'circle', c: toPt(o.c), r: o.r * K, style: st(), depth: d, id })
        break

      case 'band':
        bandPrims(o.c, o.r, o.thick, o, push, d)
        break

      case 'rings':
        for (const { r, t } of ringRadii(o)) bandPrims(o.c, r, t, o, push, d)
        break

      case 'line':
        drawLine(o.a, o.b, o.arrow, o.wavy, st(), push, d, id)
        break

      case 'arc': {
        const a0 = (o.from * Math.PI) / 180
        const a1 = (o.to * Math.PI) / 180
        push({ kind: 'arc', c: toPt(o.c), r: o.r * K, a0, a1, style: st(), depth: d, id })
        // An arrowhead is a zero-length-looking final segment: the IR puts heads on lines.
        const tip: Vec = [o.c[0] + o.r * Math.cos(a1), o.c[1] + o.r * Math.sin(a1)]
        const back = a1 - Math.sign(a1 - a0 || 1) * Math.min(0.05, Math.abs(a1 - a0) / 4)
        const pre: Vec = [o.c[0] + o.r * Math.cos(back), o.c[1] + o.r * Math.sin(back)]
        if (o.arrow === 'end' || o.arrow === 'both') line(pre, tip, st({ arrowHead: true, dash: undefined }))
        if (o.arrow === 'start' || o.arrow === 'both') {
          const s0: Vec = [o.c[0] + o.r * Math.cos(a0), o.c[1] + o.r * Math.sin(a0)]
          const fwd = a0 + Math.sign(a1 - a0 || 1) * Math.min(0.05, Math.abs(a1 - a0) / 4)
          line([o.c[0] + o.r * Math.cos(fwd), o.c[1] + o.r * Math.sin(fwd)], s0, st({ arrowHead: true, dash: undefined }))
        }
        break
      }

      case 'dot':
        dot(o.at, o.size, o.color)
        break

      case 'label': {
        const block = layoutBlock({ title: o.title, text: o.text, note: o.note, size: o.size, color: o.color })
        const pad = 0.33 * o.size
        const A = toPt(o.at)
        const W = block.w + 2 * pad, H = block.h + 2 * pad
        const fx = o.anchor.includes('w') ? 0 : o.anchor.includes('e') ? 1 : 0.5
        const fy = o.anchor.startsWith('n') ? 0 : o.anchor.startsWith('s') ? 1 : 0.5
        const left = A[0] - fx * W, top = A[1] - fy * H
        if (o.leader) {
          line(o.leader, o.at, { stroke: o.leaderColor, weight: 0.4 })
        }
        placeLines(block, left, top, W, pad, o.align, label)
        grow(left, top, left + W, top + H)
        areas.set(id, [left, top, left + W, top + H])
        break
      }

      case 'box': {
        const pad = 4
        const W = o.w * K
        const block = layoutBlock(
          { title: o.title, text: o.text, note: o.note, size: o.size, color: COLORS.ink }, W - 2 * pad,
        )
        const H = block.h + 2 * pad
        const [x, y] = toPt(o.at)
        push({ kind: 'cubic', pts: roundedRect(x, y, W, H, 2), style: st(), depth: d, id })
        areas.set(id, [x, y, x + W, y + H])
        placeLines(block, x, y, W, pad, 'left', label)
        break
      }

      case 'ticks': {
        const slots = [...o.bits]
        const n = slots.length
        for (let i = 0; i < n; i++) {
          const ch = slots[i]!
          if (ch === ' ') continue
          const deg = n === 1 ? o.from : o.from + ((o.to - o.from) * i) / (n - 1)
          const a = (deg * Math.PI) / 180
          const u: Vec = [Math.cos(a), Math.sin(a)]
          line([o.c[0] + o.r * u[0], o.c[1] + o.r * u[1]],
            [o.c[0] + (o.r + o.length) * u[0], o.c[1] + (o.r + o.length) * u[1]], st({ dash: undefined }))
          const rl = o.r + o.length + 0.27
          label(toPt([o.c[0] + rl * u[0], o.c[1] + rl * u[1] - 0.08]), `\\texttt{${ch.replace(/[\\{}#%&_~^$]/g, '')}}`, 7, o.color)
        }
        break
      }

      case 'curve': {
        const s = sample(o)
        if (s.error) problems.set(id, s.error)
        for (const run of s.runs) {
          push({ kind: 'polyline', pts: run.map(toPt), closed: false, style: st({ fill: 'none' }), depth: d, id })
        }
        if (!s.runs.length) grow(...ptBox(toPt(o.at), 6))
        break
      }

      case 'path': {
        if (o.pts.length === 1) { grow(...ptBox(toPt(o.pts[0]!), 4)); break }
        if (o.smooth && o.pts.length > 2) {
          push({ kind: 'cubic', pts: smoothThrough(o.pts, o.closed, o.tan).map(toPt), style: st({ fill: o.closed ? o.fill || 'none' : 'none' }), depth: d, id })
        } else {
          push({ kind: 'polyline', pts: o.pts.map(toPt), closed: o.closed, style: st({ fill: o.closed ? o.fill || 'none' : 'none' }), depth: d, id })
        }
        break
      }

      case 'orbit': {
        orbitPrims(o, opts.time ?? 0, !!opts.animated, push, line, dot, label, d, orbits)
        break
      }

      case 'image': {
        const tl = toPt([o.at[0] - o.w / 2, o.at[1] + o.h / 2])
        const W = o.w * K, H = o.h * K
        if (o.src) push({ kind: 'image', at: tl, w: W, h: H, href: o.src, style: { opacity: o.opacity < 1 ? o.opacity : undefined }, depth: d, id })
        const frame: Pt[] = [tl, [tl[0] + W, tl[1]], [tl[0] + W, tl[1] + H], [tl[0], tl[1] + H]]
        if (o.width > 0 || !o.src) {
          push({ kind: 'polyline', pts: frame, closed: true, style: o.width > 0 ? st({ fill: 'none' }) : { stroke: NOTE_GREY, weight: 0.5, fill: 'none', dash: [3, 2] }, depth: d, id })
        }
        break
      }

      case 'field':
        fieldPrims(o, opts, push, label, d)
        break
    }
  }
  return { prims, boxes, areas, problems, orbits }
}

function bandPrims(
  c: Vec, r: number, thick: number, o: Obj & { edge: string },
  push: (p: Prim) => void, d: number,
): void {
  push({
    kind: 'circle', c: toPt(c), r: r * K,
    style: { stroke: o.color, weight: Math.max(0.1, thick * K), fill: 'none', opacity: o.opacity < 1 ? o.opacity : undefined },
    depth: d, id: o.id,
  })
  if (o.edge && o.width > 0) {
    push({ kind: 'circle', c: toPt(c), r: r * K, style: { stroke: o.edge, weight: o.width, fill: 'none', dash: DASH(o.dash, o.width) }, depth: d, id: o.id })
  }
}

/** Radii and full thicknesses of a ring set, in cm. */
export function ringRadii(o: ObjOf<'rings'>): Array<{ r: number; t: number }> {
  const out: Array<{ r: number; t: number }> = []
  const lam = Math.max(1.0001, o.ratio)
  for (let n = 1; n <= Math.max(0, Math.min(60, Math.round(o.count))); n++) {
    const r = o.spacing === 'hyperbolic' ? o.r * Math.tanh((n * Math.log(lam)) / 2)
      : o.spacing === 'converging' ? o.r * Math.tanh((o.start * lam ** -(n - 1)) / 2)
        : (o.r * n) / (o.count + 1)
    const t = o.thickness === 'hyperbolic' ? (o.r / 2) * (1 - (r / o.r) ** 2) * o.thick * 1.0
      : o.thickness === 'proportional' ? o.thick * r * 0.5
        : o.thick
    out.push({ r, t })
  }
  return out
}

function drawLine(
  a: Vec, b: Vec, arrow: Arrow, wavy: boolean,
  style: Style, push: (p: Prim) => void, d: number, id: string,
): void {
  const A = toPt(a), B = toPt(b)
  if (wavy) {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1])
    if (L > 0) {
      const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L
      const amp = 0.6 + (style.weight ?? 1) * 0.25, wave = 6
      const pts: Pt[] = []
      const steps = Math.max(8, Math.ceil(L / 0.75))
      for (let i = 0; i <= steps; i++) {
        const s = (L * i) / steps
        const env = Math.min(1, s / 3, (L - s) / 3)
        const off = amp * env * Math.sin((2 * Math.PI * s) / wave)
        pts.push([A[0] + ux * s - uy * off, A[1] + uy * s + ux * off])
      }
      push({ kind: 'polyline', pts, closed: false, style: { ...style, arrowHead: false }, depth: d, id })
    }
    if (arrow === 'end' || arrow === 'both') push({ kind: 'line', a: lerp(A, B, 0.97), b: B, style: { ...style, arrowHead: true }, depth: d, id })
    return
  }
  if (arrow === 'both') {
    const M = lerp(A, B, 0.5)
    push({ kind: 'line', a: M, b: B, style: { ...style, arrowHead: true }, depth: d, id })
    push({ kind: 'line', a: M, b: A, style: { ...style, arrowHead: true }, depth: d, id })
  } else if (arrow === 'start') {
    push({ kind: 'line', a: B, b: A, style: { ...style, arrowHead: true }, depth: d, id })
  } else {
    push({ kind: 'line', a: A, b: B, style: { ...style, arrowHead: arrow === 'end' }, depth: d, id })
  }
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

function placeLines(
  block: Block, left: number, top: number, W: number, pad: number, align: 'left' | 'center' | 'right',
  label: (at: Pt, latex: string, size: number, color: string) => void,
): void {
  let y = top + pad
  for (const l of block.lines) {
    const base = y + l.above
    const cx = align === 'left' ? left + pad + l.w / 2
      : align === 'right' ? left + W - pad - l.w / 2
        : left + W / 2
    if (l.w > 0) label([cx, base], l.latex, l.size, l.color)
    y = base + l.below
  }
}

/** A rounded rectangle as one closed cubic path: straight sides are degenerate cubics. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const k = 0.5523 * r
  const pts: Pt[] = [[x + r, y]]
  const seg = (c1: Pt, c2: Pt, p: Pt): void => { pts.push(c1, c2, p) }
  const straight = (to: Pt): void => {
    const from = pts[pts.length - 1]!
    seg(lerp(from, to, 1 / 3), lerp(from, to, 2 / 3), to)
  }
  straight([x + w - r, y]); seg([x + w - r + k, y], [x + w, y + r - k], [x + w, y + r])
  straight([x + w, y + h - r]); seg([x + w, y + h - r + k], [x + w - r + k, y + h], [x + w - r, y + h])
  straight([x + r, y + h]); seg([x + r - k, y + h], [x, y + h - r + k], [x, y + h - r])
  straight([x, y + r]); seg([x, y + r - k], [x + r - k, y], [x + r, y])
  return pts
}

export { SPECTRUM_SAMPLES }

/**
 * The frame of the loop showing at `time`: one of STATES per period, so the strip under
 * the field during Play shows exactly the rows of the record, and the raster cache holds
 * one whole loop.
 */
export function fieldFrame(o: ObjOf<'field'>, time: number): number {
  if (o.flow === 'still' || !time) return 0
  return Math.round((time / Math.max(0.1, o.period)) * STATES) % STATES
}

export const fieldPhase = (o: ObjOf<'field'>, time: number): number =>
  o.flow === 'still' ? 0 : framePhase(o.flow, fieldFrame(o, time))

/** Where the slice strips sit under a field, in world cm: spectrum, binary, record. */
export function stripBoxes(o: ObjOf<'field'>): { spectrum: Box4; binary: Box4; record: Box4 } {
  const x0 = o.c[0] - o.r, x1 = o.c[0] + o.r
  const top = o.c[1] - o.r - 1.5
  return {
    spectrum: [x0, top, x1, top - 0.9],
    binary: [x0, top - 1.65, x1, top - 2.4],
    record: [x0, top - 3.15, x1, top - 3.15 - 1.6 * o.r],
  }
}

const BIT_INK = '#1e2230'

function fieldPrims(
  o: ObjOf<'field'>, opts: RenderOpts, push: (p: Prim) => void,
  label: (at: Pt, latex: string, size: number, color: string) => void, d: number,
): void {
  const id = o.id
  const moving = !!opts.animated && o.flow !== 'still'
  const phase = fieldPhase(o, opts.time ?? 0)
  const n = Math.round(Math.min(720, Math.max(120, o.detail)))
  const tl = toPt([o.c[0] - o.r, o.c[1] + o.r])
  push({
    kind: 'image', at: tl, w: 2 * o.r * K, h: 2 * o.r * K,
    href: moving ? `anim:field:${id}` : fieldImage(o, o.palette, n, phase),
    style: { opacity: o.opacity < 1 ? o.opacity : undefined }, depth: d, id,
  })
  if (o.width > 0) push({ kind: 'circle', c: toPt(o.c), r: o.r * K, style: { stroke: o.color, weight: o.width, fill: 'none' }, depth: d, id })
  const white = (w: number, dash?: number[]): Style => ({ stroke: '#ffffff', weight: w, fill: 'none', dash })
  if (o.geometry) {
    for (const s of [-1, 1]) push({ kind: 'circle', c: toPt([o.c[0] + (s * o.r) / 2, o.c[1]]), r: (o.r / 2) * K, style: white(0.9), depth: d, id })
    push({ kind: 'line', a: toPt([o.c[0], o.c[1] - o.r]), b: toPt([o.c[0], o.c[1] + o.r]), style: white(0.7, [2.5, 2.5]), depth: d, id })
  }
  if (!o.slice) return
  const a = (o.sliceAngle * Math.PI) / 180
  push({ kind: 'line', a: toPt(o.c), b: toPt([o.c[0] + o.r * Math.cos(a), o.c[1] + o.r * Math.sin(a)]), style: white(1.3), depth: d, id })

  const { spectrum: sp, binary: bn, record: rb } = stripBoxes(o)
  const values = spectrum(o, o.sliceAngle, SPECTRUM_SAMPLES, phase)
  const rect = (b: Box4): Pt[] => [toPt([b[0], b[1]]), toPt([b[2], b[1]]), toPt([b[2], b[3]]), toPt([b[0], b[3]])]
  const edge: Style = { stroke: BIT_INK, weight: 0.4, fill: 'none' }
  push({
    kind: 'image', at: toPt([sp[0], sp[1]]), w: (sp[2] - sp[0]) * K, h: (sp[1] - sp[3]) * K,
    href: moving ? `anim:spectrum:${id}` : stripImage(values, o.palette), style: {}, depth: d, id,
  })
  push({ kind: 'polyline', pts: rect(sp), closed: true, style: edge, depth: d, id })
  const sites = Math.max(1, Math.min(128, Math.round(o.sites)))
  if (moving) {
    push({ kind: 'image', at: toPt([bn[0], bn[1]]), w: (bn[2] - bn[0]) * K, h: (bn[1] - bn[3]) * K, href: `anim:binary:${id}`, style: {}, depth: d, id })
  } else {
    const bits = binaryOf(values, sites)
    const cw = (bn[2] - bn[0]) / sites
    const size = Math.min(7, cw * K * 0.6)
    for (let k = 0; k < sites; k++) {
      const one = bits[k] === '1'
      const cell: Box4 = [bn[0] + k * cw, bn[1], bn[0] + (k + 1) * cw, bn[3]]
      push({ kind: 'polyline', pts: rect(cell), closed: true, style: { stroke: BIT_INK, weight: 0.3, fill: one ? BIT_INK : '#ffffff' }, depth: d, id })
      label(toPt([cell[0] + cw / 2, (bn[1] + bn[3]) / 2 - size / K / 2.8]), `\\textsf{${bits[k]}}`, size, one ? '#ffffff' : BIT_INK)
    }
  }
  if (!o.record) return

  // The record: one row per frame, top to bottom, each row one state. A run of ones that
  // repeats down the rows is ONE rectangle: drawn row by row, antialiasing left a hairline
  // of white between every pair of rows, and the 3840 cells stay a few hundred shapes.
  const rows = stateRecord(o, o.sliceAngle, sites, o.flow)
  const cw = (rb[2] - rb[0]) / sites, rh = (rb[1] - rb[3]) / rows.length
  const ink: Style = { stroke: 'none', weight: 0, fill: BIT_INK }
  const runsOf = (row: string): string[] => [...row.matchAll(/1+/g)].map((m) => `${m.index}-${m.index! + m[0].length}`)
  let open = new Map<string, number>()
  const close = (key: string, from: number, to: number): void => {
    const [k, e] = key.split('-').map(Number) as [number, number]
    push({ kind: 'polyline', pts: rect([rb[0] + k * cw, rb[1] - from * rh, rb[0] + e * cw, rb[1] - to * rh]), closed: true, style: ink, depth: d, id })
  }
  rows.forEach((row, f) => {
    const next = new Map<string, number>()
    for (const key of runsOf(row)) next.set(key, open.get(key) ?? f)
    for (const [key, from] of open) if (!next.has(key)) close(key, from, f)
    open = next
  })
  for (const [key, from] of open) close(key, from, rows.length)
  push({ kind: 'polyline', pts: rect(rb), closed: true, style: edge, depth: d, id })
  if (moving) {
    push({ kind: 'image', at: toPt([rb[0], rb[1]]), w: (rb[2] - rb[0]) * K, h: (rb[1] - rb[3]) * K, href: `anim:record:${id}`, style: {}, depth: d, id })
  } else if (opts.time && o.flow !== 'still') {
    const f = fieldFrame(o, opts.time)
    const y0 = rb[1] - f * rh
    push({ kind: 'polyline', pts: rect([rb[0] - 0.12, y0 + 0.02, rb[2] + 0.12, y0 - rh - 0.02]), closed: true, style: { stroke: o.color, weight: 0.9, fill: 'none' }, depth: d, id })
  }
}

function orbitPrims(
  o: ObjOf<'orbit'>, time: number, animated: boolean, push: (p: Prim) => void,
  line: (a: Vec, b: Vec, s: Style) => void, dot: (at: Vec, size: number, color: string) => void,
  label: (at: Pt, latex: string, size: number, color: string) => void, d: number,
  orbits: Map<string, Elements>,
): void {
  const id = o.id
  const el = elementsOf(o.c, o.mu, o.at, o.vel)
  orbits.set(id, el)
  const style: Style = {
    stroke: o.color, weight: o.width, fill: 'none',
    dash: DASH(o.dash, o.width), opacity: o.opacity < 1 ? o.opacity : undefined,
  }
  const guide: Style = { stroke: NOTE_GREY, weight: 0.4, fill: 'none', dash: [2, 2] }
  const eu: Vec = [Math.cos(el.omega), Math.sin(el.omega)]

  if (el.kind === 'fall') {
    const far = Math.max(o.reach, el.r)
    line(o.c, [o.c[0] + far * eu[0], o.c[1] + far * eu[1]], style)
  } else if (el.kind === 'circle') {
    push({ kind: 'circle', c: toPt(o.c), r: el.p * K, style, depth: d, id })
  } else if (el.kind === 'ellipse') {
    const a = el.a, b = a * Math.sqrt(1 - el.e * el.e)
    const centre: Vec = [o.c[0] - a * el.e * eu[0], o.c[1] - a * el.e * eu[1]]
    push({ kind: 'ellipse', c: toPt(centre), rx: a * K, ry: b * K, rot: -el.omega, style, depth: d, id })
  } else {
    const [lo, hi] = drawRange(el, o.reach)
    const pts: Pt[] = []
    for (let i = 0; i <= 400; i++) pts.push(toPt(pointAt(el, o.c, lo + ((hi - lo) * i) / 400)))
    push({ kind: 'polyline', pts, closed: false, style, depth: d, id })
  }

  const bound = el.e < 1 && el.kind !== 'fall' && el.kind !== 'parabola'
  if (o.showApsides && el.kind !== 'fall') {
    const peri = pointAt(el, o.c, 0)
    if (bound && el.kind !== 'circle') {
      const apo = pointAt(el, o.c, Math.PI)
      line(peri, apo, guide)
      dot(apo, 3.5, NOTE_GREY)
      label(toPt([apo[0] - 0.35 * eu[0], apo[1] - 0.35 * eu[1] - 0.1]), '\\textsf{apoapsis}', 6, NOTE_GREY)
    } else {
      line(o.c, peri, guide)
    }
    dot(peri, 3.5, NOTE_GREY)
    label(toPt([peri[0] + 0.35 * eu[0], peri[1] + 0.35 * eu[1] - 0.1]), '\\textsf{periapsis}', 6, NOTE_GREY)
  }
  if (o.showFoci && bound && el.kind !== 'circle') {
    const f2: Vec = [o.c[0] - 2 * el.a * el.e * eu[0], o.c[1] - 2 * el.a * el.e * eu[1]]
    push({ kind: 'circle', c: toPt(f2), r: 2, style: { stroke: NOTE_GREY, weight: 0.6, fill: '#ffffff' }, depth: d, id })
    label(toPt([f2[0], f2[1] - 0.32]), '\\textsf{empty focus}', 6, NOTE_GREY)
  }
  if (o.marks > 0 && bound) {
    for (const nu of equalTimeNus(el, Math.min(72, Math.round(o.marks)))) {
      const p = pointAt(el, o.c, nu)
      if (o.spokes) line(o.c, p, { stroke: o.color, weight: 0.3, fill: 'none', opacity: 0.6 })
      dot(p, 3, o.color)
    }
  }

  if (o.showBody) dot(o.c, 9, o.bodyColor)

  if (animated && el.kind !== 'fall' && (o.showSatellite || o.showVelocity || o.showRadius)) {
    // A zero-size placeholder at the body: animate.ts reads the export's shift from it.
    push({ kind: 'image', at: toPt(o.c), w: 0, h: 0, href: `anim:orbit:${id}`, style: {}, depth: d, id })
    return
  }
  const nu = time ? advance(el, time) : el.nu
  const sat = time ? pointAt(el, o.c, nu) : o.at
  const vel = time ? velocityAt(el, nu) : o.vel
  if (o.showRadius) line(o.c, sat, { stroke: NOTE_GREY, weight: 0.4, fill: 'none' })
  if (o.showVelocity) {
    line(sat, [sat[0] + vel[0] * o.arrowScale, sat[1] + vel[1] * o.arrowScale],
      { stroke: '#1f4fd8', weight: 1, fill: 'none', arrowHead: true })
  }
  if (o.showSatellite) dot(sat, 5.5, o.satColor)
}

const ptBox = (p: Pt, r: number): Box4 => [p[0] - r, p[1] - r, p[0] + r, p[1] + r]

/** Bounds of a primitive in points, including its stroke. Labels are handled by callers. */
export function primBounds(p: Prim): [Pt, Pt] {
  const w = ((p.style.weight ?? 1) / 2) || 0
  switch (p.kind) {
    case 'line': return [[Math.min(p.a[0], p.b[0]) - w - 3, Math.min(p.a[1], p.b[1]) - w - 3], [Math.max(p.a[0], p.b[0]) + w + 3, Math.max(p.a[1], p.b[1]) + w + 3]]
    case 'polyline': case 'cubic': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const q of p.pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]) }
      return [[x0 - w, y0 - w], [x1 + w, y1 + w]]
    }
    case 'circle': return [[p.c[0] - p.r - w, p.c[1] - p.r - w], [p.c[0] + p.r + w, p.c[1] + p.r + w]]
    case 'ellipse': {
      const c = Math.cos(p.rot), s = Math.sin(p.rot)
      const hx = Math.hypot(p.rx * c, p.ry * s) + w, hy = Math.hypot(p.rx * s, p.ry * c) + w
      return [[p.c[0] - hx, p.c[1] - hy], [p.c[0] + hx, p.c[1] + hy]]
    }
    case 'arc': return [[p.c[0] - p.r - w, p.c[1] - p.r - w], [p.c[0] + p.r + w, p.c[1] + p.r + w]]
    case 'label': return [[p.at[0] - 1, p.at[1] - 1], [p.at[0] + 1, p.at[1] + 1]]
    case 'image': return [p.at, [p.at[0] + p.w, p.at[1] + p.h]]
  }
}

function shiftPrim(p: Prim, dx: number, dy: number): Prim {
  const s = (q: Pt): Pt => [q[0] + dx, q[1] + dy]
  switch (p.kind) {
    case 'line': return { ...p, a: s(p.a), b: s(p.b) }
    case 'polyline': case 'cubic': return { ...p, pts: p.pts.map(s) }
    case 'circle': case 'ellipse': case 'arc': return { ...p, c: s(p.c) }
    case 'label': case 'image': return { ...p, at: s(p.at) }
  }
}

/** The figure an export writes: cropped to the drawing with a margin. */
export function toFigure(objects: readonly Obj[], title: string, margin = 12, opts: RenderOpts = {}): Figure {
  const r = render(objects, opts)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of r.boxes.values()) {
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3])
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 100; y1 = 100 }
  const dx = margin - x0, dy = margin - y0
  return {
    width: x1 - x0 + 2 * margin,
    height: y1 - y0 + 2 * margin,
    prims: r.prims.map((p) => shiftPrim(p, dx, dy)),
    scale: 1 / K / 100,
    title,
    caveats: [...r.problems.values()].map((m) => `a formula curve was skipped: ${m}`),
  }
}
