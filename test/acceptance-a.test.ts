// Acceptance example A: inclined plane with friction, in 3D.
//
// The closed forms are written out here so the assertion is against physics rather than
// against whatever the code happened to produce.
//
//   N  = m g cos(theta)
//   f  = mu m g cos(theta)
//   F_parallel = m g (sin(theta) - mu cos(theta))     positive means down the slope

import { describe, expect, it } from 'vitest'
import { buildSource, example } from './helpers.js'
import { lookup, numberOf, reported, vectorOf } from '../src/core/scene.js'
import { toUnit } from '../src/core/units.js'
import { NAMED, dimEq } from '../src/core/dimension.js'

const G = 9.80665
const M = 2
const MU = 0.3

function atAngle(deg: number) {
  return buildSource(example('A-inclined-plane.byrne').replace('param "theta" "30 deg"', `param "theta" "${deg} deg"`))
}

describe('acceptance A: inclined plane with friction', () => {
  it('solves the normal force rather than being told it', () => {
    const scene = atAngle(30)
    expect(scene.report.converged).toBe(true)
    expect(scene.report.verdict).toBe('well-constrained')
    expect(scene.report.unknowns).toBe(1)
    expect(scene.unknowns[0]!.id).toBe('N.N')
  })

  it.each([15, 30, 45, 60])('matches the closed form at %i degrees', (deg) => {
    const scene = atAngle(deg)
    const th = (deg * Math.PI) / 180

    const N = numberOf(scene, lookup(scene, 'N.magnitude'))
    const f = numberOf(scene, lookup(scene, 'f.magnitude'))
    const along = numberOf(scene, lookup(scene, 'F_along'))

    expect(N).toBeCloseTo(M * G * Math.cos(th), 12)
    expect(f).toBeCloseTo(MU * M * G * Math.cos(th), 12)
    expect(along).toBeCloseTo(M * G * (Math.sin(th) - MU * Math.cos(th)), 12)

    // Relative agreement to machine precision, not just absolute closeness.
    const want = M * G * (Math.sin(th) - MU * Math.cos(th))
    expect(Math.abs(along - want) / Math.abs(want)).toBeLessThan(1e-13)
  })

  it('carries units on every computed quantity', () => {
    const scene = atAngle(30)
    expect(dimEq(lookup(scene, 'N.magnitude').dim, NAMED.force!)).toBe(true)
    expect(dimEq(lookup(scene, 'net').dim, NAMED.force!)).toBe(true)
    expect(dimEq(lookup(scene, 'a_along').dim, NAMED.acceleration!)).toBe(true)
    const a = numberOf(scene, lookup(scene, 'a_along'))
    expect(a).toBeCloseTo(G * (Math.sin(Math.PI / 6) - MU * Math.cos(Math.PI / 6)), 12)
  })

  it('reports the resultant in the ramp frame, where it has no normal component', () => {
    const scene = atAngle(30)
    const net = lookup(scene, 'net')
    expect(net.frame).toBe('ramp.local')

    const inRamp = reported(scene, net)
    const th = Math.PI / 6
    // x is up the slope, so the down-slope resultant is negative there.
    expect(inRamp[0]!).toBeCloseTo(-M * G * (Math.sin(th) - MU * Math.cos(th)), 11)
    expect(inRamp[1]!).toBeCloseTo(0, 11)
    expect(inRamp[2]!).toBeCloseTo(0, 11)   // nothing left along the normal: contact holds

    // The same vector in world coordinates is NOT the same triple of numbers.
    const inWorld = vectorOf(scene, net)
    expect(Math.abs(inWorld[0]! - inRamp[0]!)).toBeGreaterThan(0.1)
  })

  it('says the block is not in equilibrium, and by how much', () => {
    const scene = atAngle(30)
    const bal = scene.checkResults.find((c) => c.name === 'bal')!
    expect(bal.pass).toBe(false)
    const th = Math.PI / 6
    const want = M * G * (Math.sin(th) - MU * Math.cos(th))
    // The residual is the unbalanced force; it lies along the slope.
    expect(bal.residual).toBeCloseTo(Math.abs(want) * Math.cos(th), 9)
  })

  it('is in equilibrium when friction is enough to hold it', () => {
    const scene = buildSource(
      example('A-inclined-plane.byrne')
        .replace('param "theta" "30 deg"', 'param "theta" "15 deg"')
        .replace('param "mu" "0.3"', 'param "mu" "0.2679491924311227"'),   // tan(15 deg)
    )
    const along = numberOf(scene, lookup(scene, 'F_along'))
    expect(Math.abs(along)).toBeLessThan(1e-12)
    expect(scene.checkResults[0]!.pass).toBe(true)
  })

  it('switching the project display unit does not move the model', () => {
    const inMetres = atAngle(30)
    const N = lookup(inMetres, 'N.magnitude')
    expect(toUnit({ si: numberOf(inMetres, N), dim: N.dim, unit: 'N' }, 'kN'))
      .toBeCloseTo((M * G * Math.cos(Math.PI / 6)) / 1000, 14)
  })
})
