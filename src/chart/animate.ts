// Animated SVG: the still export with SMIL in place of whatever moves.
//
// render() runs in its `animated` mode, which draws each moving thing as a placeholder
// <image href="anim:<kind>:<id>"> sitting exactly where the thing is. The still SVG is
// written as usual, and each placeholder is swapped for its animation. The placeholder's
// box is in the export's own coordinates, so nothing here needs to know how the export
// was cropped.
//
// Orbits move by Kepler's equation: the satellite's path is sampled at equal TIMES, and
// SMIL's linear interpolation spends equal time on each sample, so the satellite speeds
// up at periapsis as it does in the editor. A field flows by its self-similarity (see
// field.ts): one crest inward is a scale by 1/ratio and a turn by the twist, so the disk
// is one image under two transforms, not a stack of frames.

import type { ChartDoc, ObjOf, Vec } from './model.js'
import { K, toFigure, toPt } from './render.js'
import { advance, drawRange, elementsOf, nuAt, pointAt, timeFromPeri, velocityAt } from './orbit.js'
import { CORE, MID, SPECTRUM_SAMPLES, STATES, colorOf, coreFade, fieldImage, framePhase, spectrum, stateRecord, stripImage } from './field.js'
import { NOTE_GREY } from './text.js'
import { toSvg } from '../figure/svg.js'

/** Frames per loop for a field with poles, which cannot be a transform. Its disk alone is
 *  a stack of rasters, so it gets fewer frames than the strips (STATES). */
const DISK_FRAMES = 24
/** Samples per orbit loop. */
const STEPS = 120
const BIT_INK = '#1e2230'

const n = (x: number): string => String(Math.round(x * 1000) / 1000)
const loop = (dur: number): string => `dur="${n(dur)}s" repeatCount="indefinite"`

export function toAnimatedSvg(doc: ChartDoc): string {
  const fig = toFigure(doc.objects, doc.title, 12, { animated: true })
  const byId = new Map(doc.objects.map((o) => [o.id, o]))
  let clips = 0
  const swapped = toSvg(fig, { background: doc.background }).replace(
    /<image x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*?href="anim:([a-z]+):([^"]+)"[^>]*\/>/g,
    (_m, xs: string, ys: string, ws: string, hs: string, kind: string, id: string) => {
      const o = byId.get(id)
      const box = { x: +xs, y: +ys, w: +ws, h: +hs }
      if (o?.type === 'orbit') return orbitAnim(o, box)
      if (o?.type !== 'field') return ''
      if (kind === 'field') return fieldAnim(o, box, `anim-clip-${++clips}`)
      if (kind === 'spectrum') return spectrumAnim(o, box)
      if (kind === 'binary') return binaryAnim(o, box)
      if (kind === 'record') return recordMarker(o, box)
      return ''
    },
  )
  const defs = `<defs><marker id="anim-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" ` +
    `markerHeight="7" orient="auto" markerUnits="strokeWidth"><path d="M 0 1 L 10 5 L 0 9 z" fill="#1f4fd8"/></marker></defs>`
  return swapped.replace(/(<svg[^>]*>)/, `$1\n${defs}`)
}

interface Box { x: number; y: number; w: number; h: number }

function orbitAnim(o: ObjOf<'orbit'>, box: Box): string {
  const el = elementsOf(o.c, o.mu, o.at, o.vel)
  const c = toPt(o.c)
  const F = (p: Vec): [number, number] => {
    const q = toPt(p)
    return [q[0] - c[0] + box.x, q[1] - c[1] + box.y]
  }
  let nus: number[]
  let dur: number
  if (el.e < 1 && Number.isFinite(el.period) && el.period > 0) {
    dur = el.period
    nus = Array.from({ length: STEPS + 1 }, (_, k) => advance(el, (k * el.period) / STEPS))
  } else {
    const [lo, hi] = drawRange(el, o.reach)
    const t0 = timeFromPeri(el, lo), t1 = timeFromPeri(el, hi)
    dur = Math.abs(t1 - t0)
    if (!(dur > 0) || !Number.isFinite(dur)) return ''
    nus = Array.from({ length: STEPS + 1 }, (_, k) => nuAt(el, Math.min(t0, t1) + (k * dur) / STEPS))
  }
  const pos = nus.map((nu) => F(pointAt(el, o.c, nu)))
  const vel = nus.map((nu) => {
    const v = velocityAt(el, nu)
    return [v[0] * o.arrowScale * K, -v[1] * o.arrowScale * K]
  })
  const out: string[] = []
  if (o.showRadius) {
    out.push(`<line x1="${n(box.x)}" y1="${n(box.y)}" x2="${n(pos[0]![0])}" y2="${n(pos[0]![1])}" stroke="${NOTE_GREY}" stroke-width="0.4">` +
      `<animate attributeName="x2" values="${pos.map((p) => n(p[0])).join(';')}" ${loop(dur)}/>` +
      `<animate attributeName="y2" values="${pos.map((p) => n(p[1])).join(';')}" ${loop(dur)}/></line>`)
  }
  out.push(`<g><animateMotion values="${pos.map((p) => `${n(p[0])},${n(p[1])}`).join(';')}" calcMode="linear" ${loop(dur)}/>`)
  if (o.showVelocity) {
    out.push(`<line x1="0" y1="0" x2="${n(vel[0]![0]!)}" y2="${n(vel[0]![1]!)}" stroke="#1f4fd8" stroke-width="1" marker-end="url(#anim-arrow)">` +
      `<animate attributeName="x2" values="${vel.map((v) => n(v[0]!)).join(';')}" ${loop(dur)}/>` +
      `<animate attributeName="y2" values="${vel.map((v) => n(v[1]!)).join(';')}" ${loop(dur)}/></line>`)
  }
  if (o.showSatellite) out.push(`<circle cx="0" cy="0" r="2.75" fill="${o.satColor}"/>`)
  out.push('</g>')
  return out.join('')
}

/** Flow phase of frame k: the editor's phase convention, so both show the same thing. */
const phaseOf = (o: ObjOf<'field'>, k: number, frames: number): number => framePhase(o.flow, k, frames)

/** A stack of images where frame k alone is visible during the k-th slice of the loop. */
function frames(urls: string[], box: Box, dur: number, extra = ''): string {
  return urls.map((u, k) => {
    const vis = urls.map((_, j) => (j === k ? 1 : 0)).join(';')
    return `<image x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" preserveAspectRatio="none" ` +
      `opacity="${k === 0 ? 1 : 0}"${extra} href="${u}"><animate attributeName="opacity" values="${vis}" calcMode="discrete" ${loop(dur)}/></image>`
  }).join('')
}

function fieldAnim(o: ObjOf<'field'>, box: Box, clip: string): string {
  const R = box.w / 2, cx = box.x + R, cy = box.y + R
  const op = o.opacity < 1 ? ` opacity="${n(o.opacity)}"` : ''
  const detail = Math.round(Math.min(720, Math.max(120, o.detail)))
  if (o.poles) {
    // The pole fields sit still while the main one flows, so this field is not one
    // image under a transform: it is frames.
    const urls = Array.from({ length: DISK_FRAMES }, (_, k) => fieldImage(o, o.palette, Math.min(detail, 280), phaseOf(o, k, DISK_FRAMES)))
    return `<g${op}>${frames(urls, box, o.period)}</g>`
  }
  const lam = Math.max(1.05, o.ratio)
  const E = R * lam
  const url = fieldImage(o, o.palette, Math.round(detail * lam), 0, lam, false)
  const [cr, cg, cb] = colorOf(o.palette, MID)
  const stops = Array.from({ length: 9 }, (_, i) => {
    const f = i / 8
    return `<stop offset="${n(f)}" stop-color="rgb(${cr},${cg},${cb})" stop-opacity="${n(1 - coreFade(f * CORE[1]))}"/>`
  }).join('')
  const scales = Array.from({ length: 13 }, (_, i) => n(lam ** (-i / 12)))
  const turns = ['0', n(-o.twist)]
  if (o.flow === 'out') { scales.reverse(); turns.reverse() }
  return `<clipPath id="${clip}"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}"/></clipPath>` +
    `<g clip-path="url(#${clip})"${op}><g transform="translate(${n(cx)} ${n(cy)})">` +
    `<g><animateTransform attributeName="transform" type="rotate" values="${turns.join(';')}" ${loop(o.period)}/>` +
    `<g><animateTransform attributeName="transform" type="scale" values="${scales.join(';')}" ${loop(o.period)}/>` +
    `<image x="${n(-E)}" y="${n(-E)}" width="${n(2 * E)}" height="${n(2 * E)}" preserveAspectRatio="none" href="${url}"/>` +
    `</g></g></g>` +
    `<radialGradient id="${clip}-core">${stops}</radialGradient>` +
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(CORE[1] * R)}" fill="url(#${clip}-core)"/></g>`
}

function spectrumAnim(o: ObjOf<'field'>, box: Box): string {
  const urls = Array.from({ length: STATES }, (_, k) => stripImage(spectrum(o, o.sliceAngle, SPECTRUM_SAMPLES, phaseOf(o, k, STATES)), o.palette))
  return frames(urls, box, o.period)
}

/** The row of the record being shown, stepping down one row per frame. */
function recordMarker(o: ObjOf<'field'>, box: Box): string {
  const rh = box.h / STATES
  const ys = Array.from({ length: STATES }, (_, k) => n(box.y + k * rh - 0.5))
  return `<rect x="${n(box.x - 3.4)}" y="${ys[0]}" width="${n(box.w + 6.8)}" height="${n(rh + 1)}" fill="none" stroke="${o.color}" stroke-width="0.9">` +
    `<animate attributeName="y" values="${ys.join(';')}" calcMode="discrete" ${loop(o.period)}/></rect>`
}

function binaryAnim(o: ObjOf<'field'>, box: Box): string {
  const sites = Math.max(1, Math.min(128, Math.round(o.sites)))
  const strings = stateRecord(o, o.sliceAngle, sites, o.flow)
  const cw = box.w / sites
  const size = Math.min(7, cw * 0.6)
  const out: string[] = []
  const anim = (attr: string, vals: string[]): string =>
    vals.every((v) => v === vals[0]) ? '' : `<animate attributeName="${attr}" values="${vals.join(';')}" calcMode="discrete" ${loop(o.period)}/>`
  for (let k = 0; k < sites; k++) {
    const bits = strings.map((s) => s[k]!)
    const x = box.x + k * cw
    out.push(`<rect x="${n(x)}" y="${n(box.y)}" width="${n(cw)}" height="${n(box.h)}" stroke="${BIT_INK}" stroke-width="0.3" ` +
      `fill="${bits[0] === '1' ? BIT_INK : '#ffffff'}">${anim('fill', bits.map((b) => (b === '1' ? BIT_INK : '#ffffff')))}</rect>`)
    for (const digit of ['0', '1']) {
      const vis = bits.map((b) => (b === digit ? '1' : '0'))
      out.push(`<text x="${n(x + cw / 2)}" y="${n(box.y + box.h / 2 + size * 0.36)}" text-anchor="middle" ` +
        `font-family="Helvetica, Arial, sans-serif" font-size="${n(size)}" fill="${digit === '1' ? '#ffffff' : BIT_INK}" ` +
        `opacity="${vis[0]}">${digit}${anim('opacity', vis)}</text>`)
    }
  }
  return out.join('')
}
