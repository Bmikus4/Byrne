// The measurement the project's claims rest on, printed as JSON.
//
// The gate runs this. Every number here is read out of a solved scene, never restated
// from a constant, so a number that moves means the model moved.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { read } from '../src/core/dsl.ts'
import { withLocal } from '../src/core/library.ts'
import { build, lookup, numberOf } from '../src/core/scene.ts'
import { readLibraryDir } from '../src/io/files.ts'
import { projectScene } from '../src/figure/project.ts'
import { toSvg } from '../src/figure/svg.ts'
import { EPS0 } from '../src/core/fields.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const library = readLibraryDir(join(root, 'library'))

const load = (name) => {
  const doc = read(readFileSync(join(root, 'examples', name), 'utf8'))
  return build(doc, withLocal(library, doc.components))
}

const G = 9.80665
const rel = (got, want) => (want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want))

// The inverted control. With BYRNE_CONTROL=1 the CLOSED FORMS are perturbed, not the
// model: a comparison that still reports zero error under a wrong expectation is not
// comparing anything, and the gate fails on that rather than on a red number.
const CONTROL = process.env.BYRNE_CONTROL === '1'
const bend = (x) => (CONTROL ? x * 1.001 : x)

const out = { examples: {}, worstRelativeError: 0, allConverged: true }

// A: inclined plane, at four angles, against the closed form.
{
  const src = readFileSync(join(root, 'examples/A-inclined-plane.byrne'), 'utf8')
  let worst = 0
  const rows = {}
  for (const deg of [15, 30, 45, 60]) {
    const doc = read(src.replace('param "theta" "30 deg"', `param "theta" "${deg} deg"`))
    const s = build(doc, withLocal(library, doc.components))
    const th = (deg * Math.PI) / 180
    const N = numberOf(s, lookup(s, 'N.magnitude'))
    const along = numberOf(s, lookup(s, 'F_along'))
    const eN = rel(N, bend(2 * G * Math.cos(th)))
    const eF = rel(along, bend(2 * G * (Math.sin(th) - 0.3 * Math.cos(th))))
    worst = Math.max(worst, eN, eF)
    rows[`${deg}deg`] = { N, along, errN: eN, errAlong: eF, converged: s.report.converged }
    out.allConverged &&= s.report.converged
  }
  out.examples.A = { rows, worstRelativeError: worst }
  out.worstRelativeError = Math.max(out.worstRelativeError, worst)
}

// B: three-force equilibrium.
{
  const s = load('B-three-force.byrne')
  const T3 = numberOf(s, lookup(s, 'T3'))
  const err = rel(T3, bend(Math.sqrt(2100)))
  out.examples.B = {
    T3, phiDeg: ((numberOf(s, lookup(s, 'phi')) * 180) / Math.PI % 360 + 360) % 360,
    errT3: err, residual: s.checkResults[0]?.residual ?? null,
    verdict: s.report.verdict, converged: s.report.converged,
  }
  out.worstRelativeError = Math.max(out.worstRelativeError, err)
  out.allConverged &&= s.report.converged
}

// C: spring chain, against Cramer's rule on the same two equations.
{
  const s = load('C-spring-chain.byrne')
  const [D, L0, k1, k2, k3, mA, mB] = [1.2, 0.3, 100, 250, 140, 0.5, 0.8]
  const a11 = -(k1 + k2), a12 = k2, a21 = k2, a22 = -(k2 + k3)
  const b1 = (k1 - k2) * L0 + mA * G
  const b2 = (k2 - k3) * L0 + k3 * D + mB * G
  const det = a11 * a22 - a12 * a21
  const y1 = (b1 * a22 - a12 * b2) / det
  const y2 = (a11 * b2 - b1 * a21) / det
  const e1 = rel(numberOf(s, lookup(s, 'y1')), bend(y1))
  const e2 = rel(numberOf(s, lookup(s, 'y2')), bend(y2))
  out.examples.C = {
    y1: numberOf(s, lookup(s, 'y1')), y2: numberOf(s, lookup(s, 'y2')),
    err: Math.max(e1, e2), verdict: s.report.verdict, converged: s.report.converged,
  }
  out.worstRelativeError = Math.max(out.worstRelativeError, e1, e2)
  out.allConverged &&= s.report.converged
}

// D: flux, against Gauss's law, charge centred and charge outside.
{
  const src = readFileSync(join(root, 'examples/D-point-charge-flux.byrne'), 'utf8')
  const at = (d) => {
    const doc = read(src.replace('param "d" "0 m"', `param "d" "${d}"`))
    const s = build(doc, withLocal(library, doc.components))
    return s.deferred.find((x) => x.name === 'flux')
  }
  const want = bend(1e-9 / EPS0)
  const centred = at('0 m'), off = at('0.4 m'), outside = at('0.9 m')
  const err = Math.max(rel(centred.si, want), rel(off.si, want))
  out.examples.D = {
    centred: centred.si, offCentre: off.si, outside: outside.si,
    closedForm: want, err, outsideAbs: Math.abs(outside.si),
  }
  out.worstRelativeError = Math.max(out.worstRelativeError, err)
}

// E: frame round-trip.
{
  const s = load('E-frame-roundtrip.byrne')
  const v = [1.5, -0.7, 2.2]
  const toB = s.frames.vectorTo(v, 'world', 'B')
  const back = s.frames.vectorTo(toB, 'B', 'world')
  out.examples.E = { worstComponent: Math.max(...back.map((x, i) => Math.abs(x - v[i]))) }
}

// F: the model does not move when the display unit does.
{
  const src = readFileSync(join(root, 'examples/A-inclined-plane.byrne'), 'utf8')
  const mk = (s) => { const d = read(s); return build(d, withLocal(library, d.components)) }
  const a = mk(src)
  const b = mk(src.replace('units length="m"', 'units length="cm"'))
  const identical = Array.from(a.values).every((x, i) => Object.is(x, b.values[i]))
  const svgSame = toSvg(projectScene(a)) === toSvg(projectScene(b))
  out.examples.F = { modelIdentical: identical, exportIdentical: svgSame }
}

// Figure sizes, because a vector figure that is suddenly megabytes has stopped being one.
out.figures = {}
const figDir = join(root, 'figures')
for (const f of readdirSync(figDir).filter((x) => x.endsWith('.svg'))) {
  out.figures[f] = readFileSync(join(figDir, f), 'utf8').length
}

out.control = CONTROL
out.examplesCount = readdirSync(join(root, 'examples')).filter((f) => f.endsWith('.byrne')).length
out.componentsCount = library.size

process.stdout.write(JSON.stringify(out, null, 2))
