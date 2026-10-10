// The chart editor's model: orbits against closed forms, curves, text, snapping, and the
// figure the canvas and every export share.

import { describe, expect, it } from 'vitest'
import {
  advance, elementsOf, equalTimeNus, nuAt, pointAt, radiusAt, stateFrom, timeFromPeri, velocityAt,
} from '../src/chart/orbit.js'
import { compile, friendly, sample } from '../src/chart/curves.js'
import { toLatex, layoutField } from '../src/chart/text.js'
import { snap, snapToGrid } from '../src/chart/snap.js'
import { K, render, ringRadii, toFigure, toPt } from '../src/chart/render.js'
import { hitTest, primDistance } from '../src/chart/hit.js'
import { emptyDoc, make, normalize, setHandle, ObjOf } from '../src/chart/model.js'
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
