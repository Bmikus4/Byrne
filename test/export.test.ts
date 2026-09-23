import { describe, expect, it } from 'vitest'
import { buildSource, example } from './helpers.js'
import { projectScene } from '../src/figure/project.js'
import { toSvg } from '../src/figure/svg.js'
import { toTikz } from '../src/figure/tikz.js'
import { toPdf } from '../src/figure/pdf.js'
import { typeset } from '../src/figure/labels.js'
import { flattenSvg, parsePath, transformPath } from '../src/figure/svgpath.js'

const sceneA = buildSource(example('A-inclined-plane.byrne'))

describe('projection', () => {
  it('produces primitives, not pixels', () => {
    const fig = projectScene(sceneA)
    expect(fig.prims.length).toBeGreaterThan(5)
    const kinds = new Set(fig.prims.map((p) => p.kind))
    expect(kinds.has('line')).toBe(true)      // the force arrows
    expect(kinds.has('polyline')).toBe(true)  // the ramp
    expect(kinds.has('circle')).toBe(true)    // the block
    expect(kinds.has('label')).toBe(true)
  })

  it('draws far things first and labels last', () => {
    const fig = projectScene(sceneA)
    const lastNonLabel = fig.prims.map((p) => p.kind).lastIndexOf('line')
    const firstLabel = fig.prims.findIndex((p) => p.kind === 'label')
    expect(firstLabel).toBeGreaterThan(lastNonLabel)
  })

  it('lists its own approximations instead of hiding them', () => {
    const fig = projectScene(buildSource(example('C-spring-chain.byrne')))
    expect(fig.caveats.some((c) => /helix/i.test(c))).toBe(true)
  })

  it('preserves aspect ratio under a page resize', () => {
    // The margin scales with the page, so a doubled page is exactly twice the drawing.
    const a = projectScene(sceneA, { width: 560, height: 380, margin: 24 })
    const b = projectScene(sceneA, { width: 1120, height: 760, margin: 48 })
    expect(b.scale / a.scale).toBeCloseTo(0.5, 9)

    // And the projected shape is the same shape: one uniform scale, never two.
    const box = (f: ReturnType<typeof projectScene>) => {
      const circles = f.prims.filter((p) => p.kind === 'circle') as Array<{ r: number }>
      return circles[0]!.r
    }
    expect(box(b) / box(a)).toBeCloseTo(2, 9)
  })
})

describe('SVG export', () => {
  const svg = toSvg(projectScene(sceneA))

  it('is a vector document with no raster payload', () => {
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg).not.toMatch(/<image\b/)
    expect(svg).not.toMatch(/data:image\/(png|jpe?g|webp)/)
    expect(svg).toMatch(/<polygon|<polyline/)
    expect(svg).toMatch(/<circle/)
  })

  it('carries LaTeX labels as glyph outlines', () => {
    // theta, N-vector, f-vector and mg are all in the figure.
    expect(svg).toMatch(/<g transform="translate\([-\d. ]+\) scale/)
    const t = typeset('\\theta')
    expect(t.fallback).toBe(false)
    expect(t.svg).toMatch(/<path/)
  })

  it('offers real text instead, with the trade-off stated in the API', () => {
    const asText = toSvg(projectScene(sceneA), { labels: 'text' })
    expect(asText).toMatch(/<text[^>]*font-family/)
    expect(asText).toMatch(/θ/)      // theta, readable without the font
  })

  it('is reproducible: the same model gives byte-identical output', () => {
    const again = toSvg(projectScene(buildSource(example('A-inclined-plane.byrne'))))
    expect(again).toBe(svg)
  })

  it('excludes editor chrome', () => {
    expect(svg).not.toMatch(/grid|gizmo|selection|handle/i)
  })
})

describe('TikZ export', () => {
  const tex = toTikz(projectScene(sceneA), {
    parameters: [{ name: 'theta', value: '30' }, { name: 'L', value: '3' }],
  })

  it('emits a tikzpicture with the LaTeX labels intact', () => {
    expect(tex).toMatch(/\\begin\{tikzpicture\}/)
    expect(tex).toMatch(/\\end\{tikzpicture\}/)
    expect(tex).toMatch(/\\node\[anchor=[^\]]*\] at \([-\d.,]+\) \{\$\\theta\$\}/)
  })

  it('states in the file what it cannot export', () => {
    expect(tex).toMatch(/% NOT exported to TikZ:/)
    expect(tex).toMatch(/round-tripping back into Byrne/)
    expect(tex).toMatch(/projected figure, not the scene/)
  })

  it('exposes the named parameters so the reader can vary the figure', () => {
    expect(tex).toMatch(/\\pgfmathsetmacro\{\\theta\}\{30\}/)
  })
})

describe('PDF export', () => {
  it('writes a real PDF whose labels are vector paths', async () => {
    const bytes = await toPdf(projectScene(sceneA))
    expect(bytes.length).toBeGreaterThan(1000)
    const head = new TextDecoder().decode(bytes.slice(0, 8))
    expect(head.startsWith('%PDF-')).toBe(true)
    const body = new TextDecoder('latin1').decode(bytes)
    expect(body).not.toMatch(/\/Subtype\s*\/Image/)
  })

  it('is reproducible byte for byte', async () => {
    const a = await toPdf(projectScene(buildSource(example('A-inclined-plane.byrne'))))
    const b = await toPdf(projectScene(buildSource(example('A-inclined-plane.byrne'))))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})

describe('path flattening', () => {
  it('parses and transforms the subset MathJax emits', () => {
    const out = transformPath('M0 0 L10 0 Q15 5 10 10 Z', [2, 0, 0, 2, 5, 5])
    expect(out).toMatch(/^M5 5 L25 5 C/)
    expect(out.endsWith('Z')).toBe(true)
  })

  it('treats a repeated M pair as an implicit lineto', () => {
    expect(parsePath('M0 0 1 1').map((s) => s.cmd)).toEqual(['M', 'L'])
  })

  it('raises on an elliptical arc rather than dropping it', () => {
    expect(() => transformPath('M0 0 A1 1 0 0 1 2 2', [1, 0, 0, 1, 0, 0])).toThrow(/arcs/)
  })

  it('collapses a MathJax label into absolute paths', () => {
    const t = typeset('\\vec{N}')
    const flat = flattenSvg(t.svg)
    expect(flat.length).toBeGreaterThan(0)
    for (const f of flat) expect(f.d).toMatch(/^M/)
  })
})
