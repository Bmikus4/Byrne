// The chart editor's model: orbits against closed forms, curves, text, snapping, and the
// figure the canvas and every export share.

import { describe, expect, it } from 'vitest'
import {
  advance, elementsOf, equalTimeNus, nuAt, pointAt, radiusAt, stateFrom, timeFromPeri, velocityAt,
} from '../src/chart/orbit.js'
import { compile, friendly, sample, smoothThrough } from '../src/chart/curves.js'
import { toLatex, layoutField } from '../src/chart/text.js'
import { snap, snapToGrid } from '../src/chart/snap.js'
import { K, render, ringRadii, toFigure, toPt } from '../src/chart/render.js'
import { hitTest, primDistance } from '../src/chart/hit.js'
import { emptyDoc, make, normalize, setHandle, translate, ObjOf } from '../src/chart/model.js'
import { TEMPLATES, chartThree } from '../src/chart/templates.js'
import { toSvg } from '../src/figure/svg.js'
import { toTikz } from '../src/figure/tikz.js'
import type { Vec } from '../src/chart/model.js'

const close = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)))
}

describe('Kepler orbits', () => {
  const c: Vec = [0.7, -1.3]
  const mu = 9
  const cases: Array<[string, number]> = [['circle', 0], ['ellipse', 0.3], ['eccentric', 0.92], ['parabola', 1], ['hyperbola', 1.7]]

  it.each(cases)('%s: shape numbers -> state -> shape numbers round-trips', (_n, e) => {
    for (const dir of [1, -1] as const) {
      const rp = 2.2, omega = 0.6, nu = e >= 1 ? 0.8 : 2.1
      const s = stateFrom(c, mu, rp, e, omega, nu, dir)
      const el = elementsOf(c, mu, s.at, s.vel)
      close(el.e, e, 1e-9)
      close(el.rp, rp, 1e-9)
      expect(el.dir).toBe(dir)
      if (e > 1e-6) {
        close(Math.cos(el.omega - omega), 1, 1e-9)
        close(el.nu, nu, 1e-8)
      }
    }
  })

  it.each(cases)('%s: speed obeys vis-viva everywhere on the conic', (_n, e) => {
    const s = stateFrom(c, mu, 2, e, 0.3, 0, 1)
    const el = elementsOf(c, mu, s.at, s.vel)
    for (const nu of [-1.2, -0.4, 0, 0.5, 1.1]) {
      const r = radiusAt(el, nu)
      const v = velocityAt(el, nu)
      const v2 = v[0] ** 2 + v[1] ** 2
      // v^2 = mu (2/r - 1/a); 1/a = 0 for the parabola.
      const invA = Number.isFinite(el.a) ? 1 / el.a : 0
      close(v2, mu * (2 / r - invA), 1e-10)
      // Angular momentum is the same at every point.
      const p = pointAt(el, c, nu)
      close((p[0] - c[0]) * v[1] - (p[1] - c[1]) * v[0], el.h, 1e-10)
    }
  })

  it('an ellipse returns to the same point after one period', () => {
    const s = stateFrom(c, mu, 1.5, 0.6, 1, 0.4, 1)
    const el = elementsOf(c, mu, s.at, s.vel)
    close(advance(el, el.period), el.nu, 1e-9)
    // Half a period from periapsis is apoapsis.
    close(Math.abs(nuAt(el, el.period / 2)), Math.PI, 1e-9)
  })

  it.each([0.6, 1, 1.7])('time and true anomaly invert each other (e = %s)', (e) => {
    const s = stateFrom(c, mu, 2, e, 0, 0, 1)
    const el = elementsOf(c, mu, s.at, s.vel)
    for (const nu of [-1.5, -0.3, 0.2, 1.4]) close(nuAt(el, timeFromPeri(el, nu)), nu, 1e-9)
  })

  it('equal-time marks sweep equal areas (Kepler II)', () => {
    const s = stateFrom(c, mu, 1.4, 0.6, 0, 0, 1)
    const el = elementsOf(c, mu, s.at, s.vel)
    const nus = equalTimeNus(el, 12)
    const area = (a: number, b: number): number => {
      let span = b - a
      while (span <= 0) span += 2 * Math.PI
      let sum = 0
      const N = 4000
      for (let i = 0; i < N; i++) sum += radiusAt(el, a + (span * (i + 0.5)) / N) ** 2 / 2 * (span / N)
      return sum
    }
    const areas = nus.map((a, i) => area(a, nus[(i + 1) % nus.length]!))
    const expected = (el.h * el.period) / 2 / 12
    for (const A of areas) close(A, expected, 1e-6)
  })

  it('the drawn ellipse passes through the satellite (IR rotation sign)', () => {
    const o = make('orbit', [0, 0], { at: [1, 2.5], vel: [-1.9, 0.4] }) as ObjOf<'orbit'>
    const el = elementsOf(o.c, o.mu, o.at, o.vel)
    expect(el.kind).toBe('ellipse')
    const r = render([o])
    const ellipse = r.prims.find((p) => p.kind === 'ellipse')!
    for (const nu of [0, 1, 2.5, -2]) expect(primDistance(toPt(pointAt(el, o.c, nu)), ellipse)).toBeLessThan(1e-6)
  })

  it('dragging the central body carries the satellite with it', () => {
    const o = make('orbit', [0, 0]) as ObjOf<'orbit'>
    const moved = setHandle(o, 'c', [2, 1]) as ObjOf<'orbit'>
    expect(moved.at).toEqual([o.at[0] + 2, o.at[1] + 1])
    expect(moved.vel).toEqual(o.vel)
  })
})

describe('formula curves', () => {
  it('reads 2x as 2*x but leaves function names and exponents alone', () => {
    expect(friendly('2x + 3sin(x)')).toBe('2*x + 3*sin(x)')
    expect(friendly('atan2(y, x)')).toBe('atan2(y, x)')
    expect(friendly('1e3*x')).toBe('1e3*x')
    expect(friendly('2θ + π')).toBe('2*theta + pi')
    expect(compile('2x^2')({ x: 3 })).toBe(18)
    expect(compile('ln(e)')({})).toBeCloseTo(1, 12)
  })

  it('a polar r = 2 is a circle of radius 2 about the origin', () => {
    const s = sample({ mode: 'polar', at: [1, 1], fx: '', px: '', py: '', pr: '2', from: 0, to: 6.283, k: 0, scale: 1 })
    expect(s.error).toBeNull()
    for (const p of s.runs.flat()) close(Math.hypot(p[0] - 1, p[1] - 1), 2, 1e-12)
  })

  it('breaks at asymptotes instead of drawing a vertical spike', () => {
    const s = sample({ mode: 'function', at: [0, 0], fx: 'tan(x)', px: '', py: '', pr: '', from: -4, to: 4, k: 0, scale: 1 })
    expect(s.runs.length).toBeGreaterThanOrEqual(3)
  })

  it('says what is wrong with a formula in plain words', () => {
    const s = sample({ mode: 'function', at: [0, 0], fx: 'sin(q)', px: '', py: '', pr: '', from: 0, to: 1, k: 0, scale: 1 })
    expect(s.error).toMatch(/unknown name "q"/)
  })
})

describe('label text', () => {
  it('a $ with no partner is a literal dollar, and does not hang', () => {
    expect(toLatex('costs $5')).toBe('\\textsf{costs }\\$\\textsf{5}')
    expect(toLatex('half-typed $x')).toContain('\\$')
  })

  it('bold is bold SANS (\\boldsymbol\\mathsf), not MathJax serif bold', () => {
    expect(toLatex('**The Self** = $x_0$')).toBe('\\boldsymbol{\\mathsf{The\\ Self}}\\textsf{ = }{x_0}')
  })

  it('characters LaTeX treats as commands are spelled so both MathJax and LaTeX accept them', () => {
    expect(toLatex('50% & #1_a')).toBe('\\textsf{50}\\%\\textsf{ }\\&\\textsf{ }\\#\\textsf{1}\\_\\textsf{a}')
  })

  it('wraps long text to a width without splitting maths', () => {
    const lines = layoutField('alpha beta gamma delta $a + b + c$ epsilon zeta eta theta', 8, '#000', { maxW: 60 })
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.some((l) => l.latex.includes('{a + b + c}'))).toBe(true)
    for (const l of lines) expect(l.latex).not.toMatch(/\{a \+ b$/)
  })
})

describe('snapping', () => {
  const sq = { ...emptyDoc().grid, kind: 'square' as const, step: 0.5 }
  const po = { ...emptyDoc().grid, kind: 'polar' as const, step: 1, angle: 15 }

  it('square grid rounds to the step', () => {
    expect(snapToGrid([1.26, -0.74], sq)).toEqual([1.5, -0.5])
  })

  it('circular grid rounds radius and angle', () => {
    const p = snapToGrid([2.9 * Math.cos(0.27), 2.9 * Math.sin(0.27)], po)
    close(Math.hypot(p[0], p[1]), 3, 1e-6)
    close(Math.atan2(p[1], p[0]), Math.PI / 12, 1e-6)
  })

  it('a nearby key point beats the grid; Alt or snap-off places freely', () => {
    expect(snap([1.13, 1.1], sq, [[1.1, 1.12]], 0.1).p).toEqual([1.1, 1.12])
    expect(snap([1.13, 1.1], sq, [], 0.1).p).toEqual([1, 1])
    expect(snap([1.13, 1.1], sq, [], 0.1, true).p).toEqual([1.13, 1.1])
  })
})

describe('the figure', () => {
  it('rings crowd outward on the radii of Chart I (R tanh(n ln 2 / 2))', () => {
    const rings = make('rings', [0, 0], { r: 5, count: 5, spacing: 'hyperbolic', ratio: 2 }) as ObjOf<'rings'>
    const got = ringRadii(rings).map((x) => x.r)
    ;[1.667, 3.0, 3.889, 4.412, 4.697].forEach((e, i) => close(got[i]!, e, 2e-4))
  })

  it('every template renders without a problem, the same way twice', () => {
    for (const t of TEMPLATES) {
      const d = t.make()
      const a = render(d.objects)
      expect([...a.problems.values()], t.id).toEqual([])
      expect(JSON.stringify(render(d.objects).prims)).toBe(JSON.stringify(a.prims))
    }
  })

  it('exports carry no NaN and the TikZ is a document on its own', () => {
    const d = chartThree()
    const fig = toFigure(d.objects, d.title)
    const svg = toSvg(fig)
    const tex = toTikz(fig, { standalone: true })
    expect(svg).not.toMatch(/NaN|undefined/)
    expect(tex).not.toMatch(/NaN|undefined/)
    expect(tex).toMatch(/\\documentclass\[tikz/)
    expect(tex).toMatch(/\\usetikzlibrary\{arrows\.meta\}/)
    expect(fig.width).toBeGreaterThan(15 * K)
  })

  it('labels are drawn upright: no negative y scale on the glyph group', () => {
    const fig = toFigure([make('label', [0, 0], { text: 'Order' })], 't')
    const svg = toSvg(fig)
    expect(svg).toMatch(/scale\([\d.]+\)/)
    expect(svg).not.toMatch(/scale\([\d.]+ -[\d.]+\)/)
  })

  it('a click on the horizon selects the horizon, not the locked disk under it', () => {
    const d = chartThree()
    const r = render(d.objects)
    const id = hitTest(r, d.objects, toPt([0, -5]), 3)
    expect(d.objects.find((o) => o.id === id)?.name).toBe('Horizon')
  })

  it('a saved chart reloads, gaining any field a newer version added', () => {
    const d = chartThree()
    const raw = JSON.parse(JSON.stringify(d))
    delete raw.objects[0].opacity
    const back = normalize(raw)
    expect(back.objects[0]!.opacity).toBe(1)
    expect(back.objects.length).toBe(d.objects.length)
  })
})

describe('drawn curves', () => {
  const zig: Vec[] = [[0, 0], [1, 2], [2, 0], [3, 2], [4, 0], [5, 2]]
  const draw = (o: ObjOf<'path'>): Vec[] => smoothThrough(o.pts, o.closed, o.tan)
  const span = (c: Vec[], s: number): Vec[] => c.slice(3 * s, 3 * s + 4)

  it('dragging a point reshapes only the two spans that touch it', () => {
    const o = { ...make('path', [0, 0]), pts: zig } as ObjOf<'path'>
    const before = draw(o)
    const moved = setHandle(o, 'p2', [2, -3]) as ObjOf<'path'>
    const after = draw(moved)
    expect(moved.pts.filter((p, i) => p !== zig[i]).length).toBe(1)
    for (const s of [0, 3, 4]) expect(span(after, s)).toEqual(span(before, s))
    expect(span(after, 1)).not.toEqual(span(before, 1))
    // A second drag elsewhere keeps the first one's neighbours where they were.
    const again = setHandle(moved, 'p4', [4, 1]) as ObjOf<'path'>
    expect(span(draw(again), 0)).toEqual(span(before, 0))
    expect(span(draw(again), 1)).toEqual(span(after, 1))
  })

  it('an undragged curve is the same Catmull-Rom curve it always was', () => {
    const o = { ...make('path', [0, 0]), pts: zig } as ObjOf<'path'>
    const c = draw(o)
    // First span: control points at p0 + (p1 - p0)/6 and p1 - (p2 - p0)/6.
    expect(c[1]).toEqual([1 / 6, 2 / 6])
    expect(c[2]).toEqual([1 - 2 / 6, 2])
  })
})

describe('pictures, the radial field, and animation', () => {
  it('encodes a PNG whose pixels decode back exactly', async () => {
    const { encodePng, pngDataUrl, dataUrlBytes } = await import('../src/chart/png.js')
    const { unzlibSync } = await import('fflate')
    const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6, 200, 100, 50, 25, 1, 2, 3, 4])
    const png = encodePng(3, 2, px)
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const len = new DataView(png.buffer).getUint32(33)
    const raw = unzlibSync(png.subarray(41, 41 + len))
    const back: number[] = []
    for (let y = 0; y < 2; y++) {
      const row = raw.subarray(y * 13 + 1, y * 13 + 13)
      const out: number[] = []
      row.forEach((b, i) => out.push((b + (i >= 4 ? out[i - 4]! : 0)) & 0xff))
      back.push(...out)
    }
    expect(back).toEqual([...px])
    expect([...dataUrlBytes(pngDataUrl(3, 2, px))]).toEqual([...png])
  })

  it('the field is self-similar: one crest in and one twist round is the same field', async () => {
    const { fieldValue } = await import('../src/chart/field.js')
    const s = { ratio: 1.45, pockets: 5, strength: 0.9, twist: 55, seed: 3, poles: false }
    const tw = (55 * Math.PI) / 180
    for (const [r, th] of [[0.8, 0.3], [0.5, 2.0], [0.3, -1.1], [0.95, 4.0]] as const) {
      const v = fieldValue(s, r * Math.cos(th), r * Math.sin(th))
      const r2 = r / 1.45, th2 = th + tw
      expect(fieldValue(s, r2 * Math.cos(th2), r2 * Math.sin(th2))).toBeCloseTo(v, 9)
      // A full period of flow is the identity: the loop has no seam.
      expect(fieldValue(s, r * Math.cos(th), r * Math.sin(th), 1)).toBeCloseTo(v, 9)
    }
  })

  it('reads a spectrum as binary against its median', async () => {
    const { binaryOf } = await import('../src/chart/field.js')
    expect(binaryOf([0, 0.1, 0.2, 0.3, 0.6, 0.7, 0.8, 0.9], 4)).toBe('0011')
  })

  it('Figure 8 renders and exports with its pictures in every format', async () => {
    const { experienceMap } = await import('../src/chart/templates.js')
    const { toPdf } = await import('../src/figure/pdf.js')
    const { tikzImages } = await import('../src/figure/tikz.js')
    const d = experienceMap()
    const fig = toFigure(d.objects, d.title)
    const images = fig.prims.filter((p) => p.kind === 'image')
    expect(images.length).toBe(2)
    expect(fig.prims.filter((p) => p.kind === 'label' && /^\\textsf\{[01]\}$/.test(p.latex)).length).toBe(32)
    expect(toSvg(fig)).toMatch(/<image [^>]*href="data:image\/png;base64,/)
    const pdf = new TextDecoder('latin1').decode(await toPdf(fig))
    // Two pictures, plus the soft mask that keeps the disk's transparent corners.
    expect(pdf.match(/\/Subtype \/Image/g)?.length).toBe(3)
    expect(pdf).toContain('/SMask')
    const tex = toTikz(fig, { standalone: true })
    expect(tikzImages(fig).map((f) => f.name)).toEqual(['picture-1.png', 'picture-2.png'])
    expect(tex).toContain('\\includegraphics[width=')
    expect(tex).not.toMatch(/NaN/)
  })

  it('a picture keeps its proportions when resized by its corner', () => {
    const o = make('image', [0, 0], { w: 4, h: 3, src: 'data:image/png;base64,' }) as ObjOf<'image'>
    const big = setHandle(o, 'size', [5, -1]) as ObjOf<'image'>
    expect(big.w).toBeCloseTo(10, 9)
    expect(big.h / big.w).toBeCloseTo(0.75, 9)
  })

  it('the animated SVG flows the field and runs orbits at Kepler speed', async () => {
    const { toAnimatedSvg } = await import('../src/chart/animate.js')
    const { experienceMap, keplerOrbits } = await import('../src/chart/templates.js')
    const field = experienceMap()
    const k = keplerOrbits()
    const svg = toAnimatedSvg({ ...k, objects: [...k.objects, ...field.objects.map((o) => translate(o, [20, 0]))] })
    expect(svg).not.toContain('anim:')
    expect(svg).toContain('type="rotate" values="0;-55"')
    expect(svg).toMatch(new RegExp(`type="scale" values="1;[^"]*;${Math.round(1000 / 1.45) / 1000}"`))
    const motions = [...svg.matchAll(/<animateMotion values="([^"]+)"/g)].map((m) => m[1]!.split(';').map((p) => p.split(',').map(Number)))
    expect(motions.length).toBe(4)
    for (const m of motions) expect(m.length).toBe(121)
    // Equal times per step, so step length is speed: the ellipse (e = 0.6) is fastest at
    // periapsis by (1 + e) / (1 - e) = 4, and the circle is uniform.
    const steps = motions.map((m) => m.slice(1).map((p, i) => Math.hypot(p[0]! - m[i]![0]!, p[1]! - m[i]![1]!)))
    const ratios = steps.map((s) => Math.max(...s) / Math.min(...s))
    expect(ratios.some((r) => Math.abs(r - 4) < 0.05)).toBe(true)
    expect(ratios.some((r) => Math.abs(r - 1) < 1e-3)).toBe(true)
  })
})

describe('label colour', () => {
  it('reaches the glyphs, which MathJax fills with currentColor', () => {
    const o = make('label', [0, 0], { text: 'Chaos', color: '#be3c46' })
    const svg = toSvg(toFigure([o], 't'))
    expect(svg).toContain('color="#be3c46"')
    expect(svg).toContain('fill="currentColor"')
  })
})

describe('the state record', () => {
  it('is 120 states of 32 bits over one loop, and the loop closes', async () => {
    const { stateRecord, binaryOf, spectrum, STATES, SPECTRUM_SAMPLES } = await import('../src/chart/field.js')
    const o = make('field', [0, 0]) as ObjOf<'field'>
    const rows = stateRecord(o, o.sliceAngle, 32, 'in')
    expect(STATES).toBe(120)
    expect(rows.length).toBe(120)
    expect(rows.every((r) => /^[01]{32}$/.test(r))).toBe(true)
    expect(rows.join('').length).toBe(3840)
    expect(binaryOf(spectrum(o, o.sliceAngle, SPECTRUM_SAMPLES, 1), 32)).toBe(rows[0])
    // Outward flow visits the same states in the reverse order.
    const out = stateRecord(o, o.sliceAngle, 32, 'out')
    expect(out[0]).toBe(rows[0])
    expect(out.slice(1)).toEqual(rows.slice(1).reverse())
  })

  it('the strip under a playing field shows the record row of that frame', async () => {
    const { stateRecord } = await import('../src/chart/field.js')
    const { fieldFrame } = await import('../src/chart/render.js')
    const o = make('field', [0, 0], { record: true }) as ObjOf<'field'>
    const rows = stateRecord(o, o.sliceAngle, 32, o.flow)
    for (const t of [0.5, 1.7, 3.3]) {
      const f = fieldFrame(o, t)
      const bits = render([o], { time: t }).prims
        .filter((p) => p.kind === 'label' && /^\\textsf\{[01]\}$/.test(p.latex))
        .map((p) => (p as { latex: string }).latex.slice(-2, -1)).join('')
      expect(bits).toBe(rows[f])
    }
  })

  it('the animated binary strip steps through the 120 recorded states', async () => {
    const { toAnimatedSvg } = await import('../src/chart/animate.js')
    const { experienceMap } = await import('../src/chart/templates.js')
    const svg = toAnimatedSvg(experienceMap())
    expect(svg).not.toContain('anim:')
    const fills = [...svg.matchAll(/<animate attributeName="fill" values="([^"]+)"/g)].map((m) => m[1]!.split(';').length)
    expect(fills.length).toBeGreaterThan(0)
    expect(new Set(fills)).toEqual(new Set([120]))
    expect(svg).toMatch(/<animate attributeName="y" values="(?:[^;"]+;){119}[^;"]+"/)
  })
})
