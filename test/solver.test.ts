import { describe, expect, it } from 'vitest'
import { Tape } from '../src/core/ad.js'
import { solve, Unknown, ResidualSpec } from '../src/core/solver.js'
import { NAMED } from '../src/core/dimension.js'

describe('automatic differentiation', () => {
  it('matches hand-computed derivatives exactly', () => {
    const t = new Tape()
    const x = t.variable(), y = t.variable()
    // f = x^2 * sin(y) + x / y
    const f = t.add(t.mul(t.pow(x, 2), t.sin(y)), t.div(x, y))
    const { f: val, J } = t.evaluate([f], [3, 0.7])
    expect(val[0]!).toBeCloseTo(9 * Math.sin(0.7) + 3 / 0.7, 14)
    expect(J[0]![0]!).toBeCloseTo(2 * 3 * Math.sin(0.7) + 1 / 0.7, 13)
    expect(J[0]![1]!).toBeCloseTo(9 * Math.cos(0.7) - 3 / 0.49, 13)
  })

  it('is exact, not finite-differenced', () => {
    const t = new Tape()
    const x = t.variable()
    const f = t.sqrt(x)
    const { J } = t.evaluate([f], [2])
    // A central difference at h=1e-8 lands near 1e-9 relative error; this must be better.
    expect(Math.abs(J[0]![0]! - 0.5 / Math.SQRT2)).toBeLessThan(1e-16)
  })
})

describe('solver', () => {
  /** Three ropes on a ring; two known, solve the third's tension and direction. */
  function threeForce(T1: number, a1: number, T2: number, a2: number) {
    const t = new Tape()
    const T3 = t.variable()
    const phi = t.variable()
    const rx = t.sum([
      t.const(T1 * Math.cos(a1)), t.const(T2 * Math.cos(a2)), t.mul(T3, t.cos(phi)),
    ])
    const ry = t.sum([
      t.const(T1 * Math.sin(a1)), t.const(T2 * Math.sin(a2)), t.mul(T3, t.sin(phi)),
    ])
    const unknowns: Unknown[] = [
      { id: 'rope3.tension', init: 10, dim: NAMED.force! },
      { id: 'rope3.angle', init: 3.5, dim: NAMED.angle! },
    ]
    const residuals: ResidualSpec[] = [
      { owner: 'equilibrium', label: 'sum Fx', tol: 1e-12, tag: rx },
      { owner: 'equilibrium', label: 'sum Fy', tol: 1e-12, tag: ry },
    ]
    return { report: solve(t, unknowns, residuals), t }
  }

  it('solves three-force equilibrium to machine precision', () => {
    const { report } = threeForce(50, Math.PI / 6, 40, (5 * Math.PI) / 6)
    expect(report.converged).toBe(true)
    expect(report.verdict).toBe('well-constrained')
    expect(report.dof).toBe(0)
    expect(report.x[0]!).toBeCloseTo(Math.sqrt(2100), 10)
    const deg = ((report.x[1]! * 180) / Math.PI % 360 + 360) % 360
    expect(deg).toBeCloseTo(259.1066, 3)
    expect(report.worst * 1e-12).toBeLessThan(1e-12)
  })

  it('reports under-constrained systems with a DOF count', () => {
    const t = new Tape()
    const a = t.variable(), b = t.variable()
    const r = t.sub(t.add(a, b), t.const(1))
    const rep = solve(t,
      [{ id: 'a', init: 0, dim: NAMED.length! }, { id: 'b', init: 0, dim: NAMED.length! }],
      [{ owner: 'c1', label: 'a+b=1', tol: 1e-12, tag: r }])
    expect(rep.verdict).toBe('under-constrained')
    expect(rep.dof).toBe(1)
    expect(rep.freeDirections.length).toBe(1)
  })

  it('names the constraints that conflict, and never drops one', () => {
    const t = new Tape()
    const a = t.variable()
    const r1 = t.sub(a, t.const(1))
    const r2 = t.sub(a, t.const(2))   // incompatible with r1
    const rep = solve(t,
      [{ id: 'a', init: 0, dim: NAMED.length! }],
      [
        { owner: 'distance-1', label: 'a=1', tol: 1e-12, tag: r1 },
        { owner: 'distance-2', label: 'a=2', tol: 1e-12, tag: r2 },
      ])
    expect(rep.verdict).toBe('over-constrained')
    expect(rep.residuals).toBe(2)          // both rows still present
    expect(rep.converged).toBe(false)      // and it says so
    expect(rep.conflicts.length).toBe(1)
    expect(rep.conflicts[0]!.conflicting).toBe(true)
    expect(rep.conflicts[0]!.constraints.sort()).toEqual(['distance-1', 'distance-2'])
  })

  it('distinguishes merely redundant from conflicting', () => {
    const t = new Tape()
    const a = t.variable()
    const r1 = t.sub(a, t.const(1))
    const r2 = t.sub(t.scale(a, 2), t.const(2))   // the same constraint, scaled
    const rep = solve(t,
      [{ id: 'a', init: 0, dim: NAMED.length! }],
      [
        { owner: 'c1', label: 'a=1', tol: 1e-12, tag: r1 },
        { owner: 'c2', label: '2a=2', tol: 1e-12, tag: r2 },
      ])
    expect(rep.verdict).toBe('over-constrained')
    expect(rep.converged).toBe(true)
    expect(rep.conflicts[0]!.conflicting).toBe(false)
  })

  it('is deterministic: the same input gives bit-identical output', () => {
    const first = threeForce(50, Math.PI / 6, 40, (5 * Math.PI) / 6).report.x
    for (let i = 0; i < 20; i++) {
      const again = threeForce(50, Math.PI / 6, 40, (5 * Math.PI) / 6).report.x
      expect(Array.from(again)).toEqual(Array.from(first))
    }
  })
})
