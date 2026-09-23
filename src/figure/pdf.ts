// PDF serialiser. Paths in, paths out; there is no rasteriser anywhere in this file.
//
// Labels are the same MathJax typesetting run the SVG uses, flattened to absolute path
// data by svgpath.ts and drawn as vector outlines. A PDF label is therefore the same
// shape as the SVG label, not a Times approximation of it.

import { PDFDocument, rgb, PDFPage } from 'pdf-lib'
import { Figure, Prim, Pt, Style } from './ir.js'
import { EX_IN_POINTS, typeset } from './labels.js'
import { IDENTITY, Matrix, flattenSvg, matMul } from './svgpath.js'

export interface PdfOptions {
  readonly background?: string | null
  readonly title?: string
}

function color(hex: string | undefined): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '#1b1b1a')
  if (!m) return rgb(0.1, 0.1, 0.1)
  const v = m[1]!
  return rgb(
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  )
}

export async function toPdf(fig: Figure, opts: PdfOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(opts.title ?? `Byrne - ${fig.title}`)
  pdf.setProducer('Byrne')
  pdf.setCreator('Byrne')
  // A fixed creation date keeps the bytes reproducible from the project file.
  pdf.setCreationDate(new Date(0))
  pdf.setModificationDate(new Date(0))

  const page = pdf.addPage([fig.width, fig.height])
  // PDF's origin is bottom-left; the IR's is top-left.
  const Y = (y: number): number => fig.height - y
  const P = (p: Pt): { x: number; y: number } => ({ x: p[0], y: Y(p[1]) })

  if (opts.background !== null) {
    page.drawRectangle({
      x: 0, y: 0, width: fig.width, height: fig.height,
      color: color(opts.background ?? '#ffffff'),
    })
  }

  for (const p of fig.prims) draw(page, p, P, Y, fig)
  return pdf.save({ useObjectStreams: false })
}

function draw(
  page: PDFPage, p: Prim,
  P: (p: Pt) => { x: number; y: number }, Y: (y: number) => number, fig: Figure,
): void {
  const s: Style = p.kind === 'label' ? p.style : p.style
  const stroke = color(s.stroke)
  const thickness = s.weight ?? 1
  switch (p.kind) {
    case 'line': {
      page.drawLine({ start: P(p.a), end: P(p.b), thickness, color: stroke })
      if (s.arrowHead) arrowHead(page, p.a, p.b, stroke, thickness, Y)
      break
    }
    case 'polyline': {
      const pts = p.closed ? [...p.pts, p.pts[0]!] : p.pts
      for (let i = 1; i < pts.length; i++) {
        page.drawLine({ start: P(pts[i - 1]!), end: P(pts[i]!), thickness, color: stroke })
      }
      break
    }
    case 'circle':
      page.drawCircle({ ...P(p.c), size: p.r, borderWidth: thickness, borderColor: stroke })
      break
    case 'ellipse':
      page.drawEllipse({
        ...P(p.c), xScale: p.rx, yScale: p.ry, borderWidth: thickness, borderColor: stroke,
      })
      break
    case 'arc': {
      // Sampled here, and only here: PDF has no arc operator, only Beziers, and a
      // 64-segment polyline of a 0.45 m arc is under a tenth of a point of chord error.
      const steps = 64
      let prev: Pt = [p.c[0] + p.r * Math.cos(p.a0), p.c[1] - p.r * Math.sin(p.a0)]
      for (let i = 1; i <= steps; i++) {
        const a = p.a0 + ((p.a1 - p.a0) * i) / steps
        const cur: Pt = [p.c[0] + p.r * Math.cos(a), p.c[1] - p.r * Math.sin(a)]
        page.drawLine({ start: P(prev), end: P(cur), thickness, color: stroke })
        prev = cur
      }
      break
    }
    case 'cubic':
      for (let i = 1; i < p.pts.length; i++) {
        page.drawLine({ start: P(p.pts[i - 1]!), end: P(p.pts[i]!), thickness, color: stroke })
      }
      break
    case 'label': {
      const t = typeset(p.latex)
      if (t.fallback) {
        page.drawText(p.latex, { x: p.at[0], y: Y(p.at[1]), size: p.fontSize, color: stroke })
        break
      }
      const vb = /viewBox="([-\d.\s]+)"/.exec(t.svg)
      if (!vb) break
      const [vx, vy, vw, vh] = vb[1]!.trim().split(/\s+/).map(Number) as [number, number, number, number]
      const w = t.widthEx * EX_IN_POINTS
      const h = t.heightEx * EX_IN_POINTS
      const scale = w / vw
      const gap = 4
      const x = p.at[0] + p.anchorX * gap - (p.anchorX > 0.2 ? 0 : p.anchorX < -0.2 ? w : w / 2)
      const yTop = p.at[1] - p.anchorY * gap - (p.anchorY > 0.2 ? h : p.anchorY < -0.2 ? 0 : h / 2)
      // MathJax's y axis already points up, which is PDF's convention, so no flip here.
      const base: Matrix = matMul(
        [scale, 0, 0, scale, x - vx * scale, Y(yTop + h) - vy * scale],
        IDENTITY,
      )
      for (const path of flattenSvg(t.svg, base)) {
        page.drawSvgPath(path.d, { color: stroke, borderWidth: 0, x: 0, y: fig.height, scale: 1 })
      }
      break
    }
  }
}

function arrowHead(
  page: PDFPage, a: Pt, b: Pt, color: ReturnType<typeof rgb>, thickness: number,
  Y: (y: number) => number,
): void {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return
  const ux = dx / len, uy = dy / len
  const size = 6 * Math.max(1, thickness)
  const wing = 2.2 * Math.max(1, thickness)
  for (const sign of [1, -1]) {
    const px = b[0] - ux * size + sign * -uy * wing
    const py = b[1] - uy * size + sign * ux * wing
    page.drawLine({
      start: { x: b[0], y: Y(b[1]) }, end: { x: px, y: Y(py) },
      thickness, color,
    })
  }
}
