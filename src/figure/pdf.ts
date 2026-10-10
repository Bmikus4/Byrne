// PDF serialiser. Paths in, paths out; there is no rasteriser anywhere in this file.
//
// Labels are the same MathJax typesetting run the SVG uses, flattened to absolute path
// data by svgpath.ts and drawn as vector outlines. A PDF label is therefore the same
// shape as the SVG label, not a Times approximation of it.

import { PDFDocument, PDFImage, rgb, PDFPage } from 'pdf-lib'
import { Figure, Prim, Pt, Style } from './ir.js'
import { placeLabel, typeset } from './labels.js'
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

  // Images are embedded once per distinct source, before drawing, because embedding is
  // async and the drawing loop is not.
  const images = new Map<string, PDFImage>()
  for (const p of fig.prims) {
    if (p.kind !== 'image' || images.has(p.href)) continue
    const jpeg = /^data:image\/jpe?g/i.test(p.href)
    images.set(p.href, jpeg ? await pdf.embedJpg(p.href) : await pdf.embedPng(p.href))
  }

  for (const p of fig.prims) draw(page, p, P, Y, fig, images)
  return pdf.save({ useObjectStreams: false })
}

function draw(
  page: PDFPage, p: Prim,
  P: (p: Pt) => { x: number; y: number }, Y: (y: number) => number, fig: Figure,
  images: ReadonlyMap<string, PDFImage>,
): void {
  const s: Style = p.style
  const stroke = color(s.stroke)
  const thickness = s.weight ?? 1
  const noStroke = s.stroke === 'none' || thickness <= 0
  // Shapes go through drawSvgPath in figure coordinates (y down, origin top-left), which
  // is pdf-lib's own convention for that call when placed at the page's top edge. One
  // path builder per shape, shared with nothing else, so fills, dashes and rotation are
  // the same PDF operators for every kind.
  const shape = (d: string, closed: boolean): void => {
    const fill = closed && s.fill && s.fill !== 'none' ? color(s.fill) : undefined
    page.drawSvgPath(d, {
      x: 0, y: fig.height, scale: 1,
      color: fill,
      borderColor: noStroke ? undefined : stroke,
      borderWidth: noStroke ? 0 : thickness,
      borderDashArray: s.dash?.length ? [...s.dash] : undefined,
      borderLineCap: 1,
      opacity: s.opacity, borderOpacity: s.opacity,
    })
  }
  const f = (x: number): string => String(Math.round(x * 1000) / 1000)
  switch (p.kind) {
    case 'line': {
      if (noStroke) break
      page.drawLine({
        start: P(p.a), end: P(p.b), thickness, color: stroke, opacity: s.opacity,
        dashArray: s.dash?.length ? [...s.dash] : undefined, lineCap: 1,
      })
      if (s.arrowHead) arrowHead(page, p.a, p.b, stroke, thickness, Y)
      break
    }
    case 'polyline':
      shape(`M ${p.pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(' L ')}${p.closed ? ' Z' : ''}`, p.closed)
      break
    case 'circle': {
      const [cx, cy] = p.c
      shape(`M ${f(cx - p.r)} ${f(cy)} A ${f(p.r)} ${f(p.r)} 0 1 0 ${f(cx + p.r)} ${f(cy)} ` +
        `A ${f(p.r)} ${f(p.r)} 0 1 0 ${f(cx - p.r)} ${f(cy)} Z`, true)
      break
    }
    case 'ellipse': {
      // The IR's rotation is in the y-down figure frame, which is the frame the path is in.
      const c = Math.cos(p.rot), sn = Math.sin(p.rot)
      const a: Pt = [p.c[0] - p.rx * c, p.c[1] - p.rx * sn]
      const b: Pt = [p.c[0] + p.rx * c, p.c[1] + p.rx * sn]
      const deg = f((p.rot * 180) / Math.PI)
      shape(`M ${f(a[0])} ${f(a[1])} A ${f(p.rx)} ${f(p.ry)} ${deg} 1 0 ${f(b[0])} ${f(b[1])} ` +
        `A ${f(p.rx)} ${f(p.ry)} ${deg} 1 0 ${f(a[0])} ${f(a[1])} Z`, true)
      break
    }
    case 'arc': {
      // Sampled here, and only here: PDF has no arc operator, only Beziers, and a
      // 64-segment polyline of a 0.45 m arc is under a tenth of a point of chord error.
      const steps = 64
      const pts: Pt[] = []
      for (let i = 0; i <= steps; i++) {
        const ang = p.a0 + ((p.a1 - p.a0) * i) / steps
        pts.push([p.c[0] + p.r * Math.cos(ang), p.c[1] - p.r * Math.sin(ang)])
      }
      shape(`M ${pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(' L ')}`, false)
      break
    }
    case 'cubic': {
      if (p.pts.length < 4) break
      const out = [`M ${f(p.pts[0]![0])} ${f(p.pts[0]![1])}`]
      for (let i = 1; i + 2 < p.pts.length; i += 3) {
        out.push(`C ${[p.pts[i]!, p.pts[i + 1]!, p.pts[i + 2]!].map((q) => `${f(q[0])} ${f(q[1])}`).join(' ')}`)
      }
      shape(out.join(' '), true)
      break
    }
    case 'image': {
      const img = images.get(p.href)
      if (img) page.drawImage(img, { x: p.at[0], y: Y(p.at[1] + p.h), width: p.w, height: p.h, opacity: s.opacity })
      break
    }
    case 'label': {
      const t = typeset(p.latex)
      if (t.fallback) {
        page.drawText(p.latex, { x: p.at[0], y: Y(p.at[1]), size: p.fontSize, color: stroke })
        break
      }
      const box = placeLabel(p, t)
      if (!box) break
      const { x, y: yTop, w, vb: [vx, vy, vw] } = box
      const scale = w / vw
      // Glyphs are placed in FIGURE coordinates (y down, the frame MathJax's viewBox is in
      // once its inner scale(1,-1) is applied), because drawSvgPath at the page's top edge
      // makes the one flip to PDF space. Converting to PDF space here as well drew every
      // label mirrored top-to-bottom about the page.
      const base: Matrix = matMul([scale, 0, 0, scale, x - vx * scale, yTop - vy * scale], IDENTITY)
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
