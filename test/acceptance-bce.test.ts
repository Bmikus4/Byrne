import { describe, expect, it } from 'vitest'
import { buildSource, example } from './helpers.js'
import { lookup, numberOf, reported, vectorOf } from '../src/core/scene.js'
import { WORLD, qFromAxisAngle, qRotate, normalize } from '../src/core/frame.js'
import { NAMED, dimEq } from '../src/core/dimension.js'

const G = 9.80665

describe('acceptance B: three-force equilibrium', () => {
  const scene = buildSource(example('B-three-force.byrne'))

  it('is well-constrained with exactly two unknowns', () => {
    expect(scene.report.unknowns).toBe(2)
    expect(scene.report.residuals).toBe(2)
    expect(scene.report.verdict).toBe('well-constrained')
    expect(scene.report.dof).toBe(0)
    expect(scene.report.converged).toBe(true)
  })

  it('finds the third tension and angle', () => {
    // Sum of the two known ropes: (T1 cos a1 + T2 cos a2, T1 sin a1 + T2 sin a2).
    const sx = 50 * Math.cos(Math.PI / 6) + 40 * Math.cos((5 * Math.PI) / 6)
    const sy = 50 * Math.sin(Math.PI / 6) + 40 * Math.sin((5 * Math.PI) / 6)
    const T3 = Math.hypot(sx, sy)
    const phi = Math.atan2(-sy, -sx)

    expect(T3).toBeCloseTo(Math.sqrt(2100), 12)   // the closed form, independently
    expect(numberOf(scene, lookup(scene, 'T3'))).toBeCloseTo(T3, 11)

    const got = numberOf(scene, lookup(scene, 'phi'))
    const deg = (((got * 180) / Math.PI) % 360 + 360) % 360
    const want = (((phi * 180) / Math.PI) % 360 + 360) % 360
    expect(deg).toBeCloseTo(want, 9)
    expect(deg).toBeCloseTo(259.1066, 3)
  })

  it('reports equilibrium with a residual at machine precision', () => {
    const bal = scene.checkResults.find((c) => c.name === 'bal')!
    expect(bal.pass).toBe(true)
    expect(bal.residual).toBeLessThan(1e-12)
  })

  it('tracks live when a given tension changes', () => {
    const changed = buildSource(example('B-three-force.byrne').replace('param "T1" "50 N"', 'param "T1" "80 N"'))
    const sx = 80 * Math.cos(Math.PI / 6) + 40 * Math.cos((5 * Math.PI) / 6)
    const sy = 80 * Math.sin(Math.PI / 6) + 40 * Math.sin((5 * Math.PI) / 6)
    expect(numberOf(changed, lookup(changed, 'T3'))).toBeCloseTo(Math.hypot(sx, sy), 11)
    expect(changed.checkResults[0]!.pass).toBe(true)
  })
})

describe('acceptance C: spring-mass chain', () => {
  const D = 1.2, L0 = 0.3, k1 = 100, k2 = 250, k3 = 140, mA = 0.5, mB = 0.8

  /**
   * The two balance equations, solved independently by Cramer's rule:
   *   -(k1+k2) y1 +      k2  y2 = (k1 - k2) L0 + mA g
   *        k2   y1 - (k2+k3) y2 = (k2 - k3) L0 + k3 D + mB g
   */
  function closedForm(kk2: number) {
    const a11 = -(k1 + kk2), a12 = kk2
    const a21 = kk2, a22 = -(kk2 + k3)
    const b1 = (k1 - kk2) * L0 + mA * G
    const b2 = (kk2 - k3) * L0 + k3 * D + mB * G
    const det = a11 * a22 - a12 * a21
    return { y1: (b1 * a22 - a12 * b2) / det, y2: (a11 * b2 - b1 * a21) / det }
  }

  it('solves the two mass positions', () => {
    const scene = buildSource(example('C-spring-chain.byrne'))
    expect(scene.report.verdict).toBe('well-constrained')
    expect(scene.report.converged).toBe(true)
    const { y1, y2 } = closedForm(k2)
    expect(numberOf(scene, lookup(scene, 'y1'))).toBeCloseTo(y1, 12)
    expect(numberOf(scene, lookup(scene, 'y2'))).toBeCloseTo(y2, 12)
  })

  it('gives each spring the extension the closed form predicts', () => {
    const scene = buildSource(example('C-spring-chain.byrne'))
    const { y1, y2 } = closedForm(k2)
    expect(numberOf(scene, lookup(scene, 's1.extension'))).toBeCloseTo(-y1 - L0, 12)
    expect(numberOf(scene, lookup(scene, 's2.extension'))).toBeCloseTo(y1 - y2 - L0, 12)
    expect(numberOf(scene, lookup(scene, 's3.extension'))).toBeCloseTo(y2 + D - L0, 12)
    expect(dimEq(lookup(scene, 's1.extension').dim, NAMED.length!)).toBe(true)
  })

  it('both masses balance, and the check says so', () => {
    const scene = buildSource(example('C-spring-chain.byrne'))
    for (const c of scene.checkResults) {
      expect(c.pass, c.name).toBe(true)
      expect(c.residual).toBeLessThan(1e-9)
    }
  })

  it('changing the middle instance leaves the others alone', () => {
    const base = buildSource(example('C-spring-chain.byrne'))
    const changed = buildSource(example('C-spring-chain.byrne').replace('param "k" "250 N/m"', 'param "k" "400 N/m"'))
    expect(numberOf(changed, lookup(changed, 's2.k'))).toBeCloseTo(400, 12)
    expect(numberOf(changed, lookup(changed, 's1.k'))).toBeCloseTo(100, 12)
    const { y1 } = closedForm(400)
    expect(numberOf(changed, lookup(changed, 'y1'))).toBeCloseTo(y1, 12)
    expect(numberOf(base, lookup(base, 's2.k'))).toBeCloseTo(250, 12)
  })
})

describe('acceptance E: frame transform round-trip', () => {
  const scene = buildSource(example('E-frame-roundtrip.byrne'))
  const v = [1.5, -0.7, 2.2] as const
  const axis = normalize([1, 2, 3])
  const angle = (37 * Math.PI) / 180

  it('reports the vector in B as the rotated components', () => {
    // Rotating the BASIS by q rotates the reported components by q inverse.
    const want = qRotate(qFromAxisAngle(axis, -angle), [...v])
    const got = reported(scene, lookup(scene, 'vB'))
    for (let i = 0; i < 3; i++) expect(got[i]!).toBeCloseTo(want[i]!, 12)
  })

  it('round-trips to within 1e-12 per component', () => {
    const back = reported(scene, lookup(scene, 'vA_again'))
    for (let i = 0; i < 3; i++) expect(Math.abs(back[i]! - v[i]!)).toBeLessThan(1e-12)
  })

  it('round-trips the FrameTree transform to better than 1e-15', () => {
    const toB = scene.frames.vectorTo([...v], WORLD, 'B')
    const back = scene.frames.vectorTo(toB, 'B', WORLD)
    for (let i = 0; i < 3; i++) expect(Math.abs(back[i]! - v[i]!)).toBeLessThan(1e-15)
  })

  it('re-expression creates a new object and mutates nothing', () => {
    expect(lookup(scene, 'vA').frame).toBe(WORLD)
    expect(lookup(scene, 'vB').frame).toBe('B')
    expect(lookup(scene, 'vA_again').frame).toBe(WORLD)
    // The underlying physical vector is the same one in all three.
    expect(vectorOf(scene, lookup(scene, 'vA'))).toEqual(vectorOf(scene, lookup(scene, 'vB')))
  })

  it('transforms a rank-2 tensor as R A R^T, not just its diagonal', () => {
    const A = [2, 0.3, -0.1, 0.3, 5, 0.4, -0.1, 0.4, 7]
    const B = scene.frames.tensorTo(A, WORLD, 'B')
    const back = scene.frames.tensorTo(B, 'B', WORLD)
    // The off-diagonal must actually move, or the round-trip proves nothing.
    expect(Math.abs(B[1]! - A[1]!)).toBeGreaterThan(0.1)
    for (let i = 0; i < 9; i++) expect(Math.abs(back[i]! - A[i]!)).toBeLessThan(1e-13)
  })
})
