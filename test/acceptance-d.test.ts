// Acceptance example D: point charge, field, and Gauss's law.
//
// The flux is a quadrature over the sphere. Gauss's law is the independent answer, so
// agreement tests the field evaluator rather than restating a formula.

import { describe, expect, it } from 'vitest'
import { buildSource, example } from './helpers.js'
import { EPS0, fieldAt, fluxThroughSphere, seedSphere, traceFieldLine } from '../src/core/fields.js'
import { dimEq, NAMED } from '../src/core/dimension.js'

const Q = 1e-9
const EXPECTED = Q / EPS0            // 112.9409... V m

function at(d: string) {
  return buildSource(example('D-point-charge-flux.byrne').replace('param "d" "0 m"', `param "d" "${d}"`))
}

describe('acceptance D: point charge flux', () => {
  it('reports Q/eps0 through a sphere centred on the charge', () => {
    const scene = at('0 m')
    const flux = scene.deferred.find((d) => d.name === 'flux')!
    expect(EXPECTED).toBeCloseTo(112.9409, 4)
    expect(flux.converged).toBe(true)
    expect(Math.abs((flux.si as number) - EXPECTED) / EXPECTED).toBeLessThan(1e-6)
    expect(dimEq(flux.dim, NAMED.eflux!)).toBe(true)
    expect(flux.unit).toBe('V*m')
  })

  it('is unchanged when the charge moves off centre but stays inside', () => {
    for (const d of ['0.1 m', '0.25 m', '0.4 m']) {
      const flux = at(d).deferred.find((f) => f.name === 'flux')!
      expect(Math.abs((flux.si as number) - EXPECTED) / EXPECTED, d).toBeLessThan(1e-5)
    }
  })

  it('is zero when the charge is outside', () => {
    for (const d of ['0.7 m', '0.9 m']) {
      const flux = at(d).deferred.find((f) => f.name === 'flux')!
      expect(Math.abs(flux.si as number), d).toBeLessThan(1e-8)
    }
  })

  it('reads the field at a probe, with units', () => {
    const scene = at('0 m')
    const E = scene.deferred.find((d) => d.name === 'E_probe')!
    const r = 0.3
    const want = Q / (4 * Math.PI * EPS0 * r * r)
    expect((E.si as readonly number[])[0]!).toBeCloseTo(want, 9)
    expect(dimEq(E.dim, NAMED.efield!)).toBe(true)
  })
})

describe('field evaluator', () => {
  const charges = [{ q: 1e-9, at: [0, 0, 0] as const }].map((c) => ({ q: c.q, at: [...c.at] as [number, number, number] }))

  it('falls off as one over r squared', () => {
    const a = fieldAt(charges, [0.1, 0, 0])!
    const b = fieldAt(charges, [0.2, 0, 0])!
    expect(a[0]! / b[0]!).toBeCloseTo(4, 9)
  })

  it('returns null at a charge rather than infinity', () => {
    expect(fieldAt(charges, [0, 0, 0])).toBeNull()
  })

  it('a dipole has zero net flux through a surface enclosing both', () => {
    const dipole = [
      { q: 1e-9, at: [0.05, 0, 0] as [number, number, number] },
      { q: -1e-9, at: [-0.05, 0, 0] as [number, number, number] },
    ]
    const f = fluxThroughSphere(dipole, [0, 0, 0], 0.5)
    expect(Math.abs(f.value)).toBeLessThan(1e-8)
  })

  it('caps the field-line count at 512 however many are asked for', () => {
    expect(seedSphere([0, 0, 0], 0.05, 10_000).length).toBe(512)
    expect(seedSphere([0, 0, 0], 0.05, 24).length).toBe(24)
  })

  it('traces a field line radially outward from a single charge', () => {
    const line = traceFieldLine(charges, [0.05, 0, 0], {
      step: 0.01, maxSteps: 50, nearRadius: 0.01, sign: 1,
    })
    expect(line.length).toBeGreaterThan(10)
    // Radial: every point lies on the +x axis, monotonically further out.
    for (let i = 1; i < line.length; i++) {
      expect(line[i]![0]!).toBeGreaterThan(line[i - 1]![0]!)
      expect(Math.abs(line[i]![1]!)).toBeLessThan(1e-12)
    }
  })
})
