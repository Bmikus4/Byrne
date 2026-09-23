// SVG serialiser. Generated from the Figure IR, never from a screen.

import { Figure, Prim, Pt, Style } from './ir.js'
import { EX_IN_POINTS, escapeXml, plain, typeset } from './labels.js'

export interface SvgOptions {
  /**
   * `outlines` inlines MathJax glyph paths: pixel-identical anywhere, not editable as
   * text. `text` emits <text> with a font-family: editable in Illustrator or Inkscape,
   * but the reader needs the font. The export dialog states this trade-off at the point
   * of choosing; it is not a silent default.
   */
  readonly labels?: 'outlines' | 'text'
  readonly background?: string | null
  readonly includeCaveats?: boolean
}

const n = (x: number): string => {
  const r = Math.round(x * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

const pt = (p: Pt): string => `${n(p[0])},${n(p[1])}`

function strokeAttrs(s: Style): string {
  const out = [`stroke="${s.stroke ?? '#1b1b1a'}"`, `stroke-width="${n(s.weight ?? 1)}"`]
  out.push(`fill="${s.fill ?? 'none'}"`)
  if (s.dash?.length) out.push(`stroke-dasharray="${s.dash.map(n).join(' ')}"`)
  if (s.opacity !== undefined) out.push(`opacity="${n(s.opacity)}"`)
  out.push('stroke-linecap="round"', 'stroke-linejoin="round"')
  return out.join(' ')
}

export function toSvg(fig: Figure, opts: SvgOptions = {}): string {
  const mode = opts.labels ?? 'outlines'
  const body: string[] = []
  let needsArrow = false

  for (const p of fig.prims) {
    switch (p.kind) {
      case 'line': {
        if (p.style.arrowHead) needsArrow = true
        body.push(
          `<line x1="${n(p.a[0])}" y1="${n(p.a[1])}" x2="${n(p.b[0])}" y2="${n(p.b[1])}" ` +
          `${strokeAttrs(p.style)}${p.style.arrowHead ? ' marker-end="url(#byrne-arrow)"' : ''}/>`,
        )
        break
      }
      case 'polyline':
        body.push(
          `<${p.closed ? 'polygon' : 'polyline'} points="${p.pts.map(pt).join(' ')}" ${strokeAttrs(p.style)}/>`,
        )
        break
      case 'circle':
        body.push(`<circle cx="${n(p.c[0])}" cy="${n(p.c[1])}" r="${n(p.r)}" ${strokeAttrs(p.style)}/>`)
        break
      case 'ellipse':
        body.push(
          `<ellipse cx="${n(p.c[0])}" cy="${n(p.c[1])}" rx="${n(p.rx)}" ry="${n(p.ry)}" ` +
          `transform="rotate(${n((p.rot * 180) / Math.PI)} ${n(p.c[0])} ${n(p.c[1])})" ${strokeAttrs(p.style)}/>`,
        )
        break
      case 'arc':
        body.push(`<path d="${arcPath(p.c, p.r, p.a0, p.a1)}" ${strokeAttrs(p.style)}/>`)
        break
      case 'cubic':
        body.push(`<path d="${cubicPath(p.pts)}" ${strokeAttrs(p.style)}/>`)
        break
      case 'label':
        body.push(label(p, mode))
        break
    }
  }

  const defs = needsArrow
    ? `<defs><marker id="byrne-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" ` +
      `markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth">` +
      `<path d="M 0 1 L 10 5 L 0 9 z" fill="context-stroke"/></marker></defs>`
    : ''

  const bg = opts.background === null ? ''
    : `<rect width="${n(fig.width)}" height="${n(fig.height)}" fill="${opts.background ?? '#ffffff'}"/>`

  const caveats = opts.includeCaveats !== false && fig.caveats.length
    ? `\n<!--\n  Exported by Byrne. Approximations in this figure:\n` +
      fig.caveats.map((c) => `   * ${c}`).join('\n') + `\n-->`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${n(fig.width)}pt" height="${n(fig.height)}pt" ` +
    `viewBox="0 0 ${n(fig.width)} ${n(fig.height)}">${caveats}
${defs}${bg}
${body.join('\n')}
</svg>
`
}

function label(p: Extract<Prim, { kind: 'label' }>, mode: 'outlines' | 'text'): string {
  if (mode === 'text') {
    return `<text x="${n(p.at[0])}" y="${n(p.at[1])}" font-family="STIXGeneral, Times, serif" ` +
      `font-style="italic" font-size="${n(p.fontSize)}" fill="${p.style.stroke}" ` +
      `text-anchor="${p.anchorX > 0.2 ? 'start' : p.anchorX < -0.2 ? 'end' : 'middle'}">` +
      `${escapeXml(plain(p.latex))}</text>`
  }
  const t = typeset(p.latex)
  const w = t.widthEx * EX_IN_POINTS
  const h = t.heightEx * EX_IN_POINTS
  const gap = 4
  const x = p.at[0] + p.anchorX * gap - (p.anchorX > 0.2 ? 0 : p.anchorX < -0.2 ? w : w / 2)
  const y = p.at[1] - p.anchorY * gap - (p.anchorY > 0.2 ? h : p.anchorY < -0.2 ? 0 : h / 2)
  const inner = t.svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
  const vb = /viewBox="([-\d.\s]+)"/.exec(t.svg)
  if (!vb) return `<g transform="translate(${n(x)} ${n(y)})">${inner}</g>`
  const [vx, vy, vw, vh] = vb[1]!.trim().split(/\s+/).map(Number) as [number, number, number, number]
  const s = w / vw
  // MathJax's y axis points up; ours points down, so the glyph group is flipped.
  return `<g transform="translate(${n(x)} ${n(y + h)}) scale(${n(s)} ${n(-s)}) translate(${n(-vx)} ${n(-vy - vh)})" ` +
    `fill="${p.style.stroke}" stroke="none">${inner}</g>`
}

function arcPath(c: Pt, r: number, a0: number, a1: number): string {
  let sweepAngle = a1 - a0
  while (sweepAngle <= -Math.PI) sweepAngle += 2 * Math.PI
  while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI
  // Image y points down, so a positive model angle sweeps the other way on the page.
  const p0: Pt = [c[0] + r * Math.cos(a0), c[1] - r * Math.sin(a0)]
  const p1: Pt = [c[0] + r * Math.cos(a1), c[1] - r * Math.sin(a1)]
  const large = Math.abs(sweepAngle) > Math.PI ? 1 : 0
  const sweep = sweepAngle > 0 ? 0 : 1
  return `M ${pt(p0)} A ${n(r)} ${n(r)} 0 ${large} ${sweep} ${pt(p1)}`
}

function cubicPath(pts: readonly Pt[]): string {
  if (pts.length < 4) return `M ${pts.map(pt).join(' L ')}`
  const out = [`M ${pt(pts[0]!)}`]
  for (let i = 1; i + 2 < pts.length; i += 3) {
    out.push(`C ${pt(pts[i]!)} ${pt(pts[i + 1]!)} ${pt(pts[i + 2]!)}`)
  }
  return out.join(' ')
}
