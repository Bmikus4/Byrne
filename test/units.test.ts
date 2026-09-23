import { describe, expect, it } from 'vitest'
import { dimEq, dimToString, NAMED, rat, dimPow, ratEq } from '../src/core/dimension.js'
import { formatScalar, parseLiteral, toUnit, unit } from '../src/core/units.js'
import { check, parse, evaluate, infer } from '../src/core/expr.js'
import { T } from '../src/core/values.js'
import { WORLD } from '../src/core/frame.js'

const env = {
  defaultFrame: WORLD,
  type: (n: string) => ({
    m: T('scalar', NAMED.mass!),
    g: T('scalar', NAMED.acceleration!),
    theta: T('scalar', NAMED.angle!),
    mu: T('scalar'),
    k: T('scalar', NAMED.stiffness!),
    L: T('scalar', NAMED.length!),
    t: T('scalar', NAMED.time!),
  } as Record<string, ReturnType<typeof T>>)[n],
  value: (n: string) => ({
    m: { k: 'scalar', si: 2, dim: NAMED.mass!, unit: 'kg' },
    g: { k: 'scalar', si: 9.80665, dim: NAMED.acceleration!, unit: 'm/s^2' },
    theta: { k: 'scalar', si: Math.PI / 6, dim: NAMED.angle!, unit: 'deg' },
    mu: { k: 'scalar', si: 0.3, dim: NAMED.scalar!, unit: '' },
    k: { k: 'scalar', si: 100, dim: NAMED.stiffness!, unit: 'N/m' },
    L: { k: 'scalar', si: 3, dim: NAMED.length!, unit: 'm' },
    t: { k: 'scalar', si: 0, dim: NAMED.time!, unit: 's' },
  } as Record<string, any>)[n],
}

describe('units', () => {
  it('parses prefixes and imperial', () => {
    expect(unit('km').factor).toBe(1000)
    expect(unit('nm').factor).toBeCloseTo(1e-9, 20)
    expect(unit('MN').factor).toBe(1e6)
    expect(unit('ft').factor).toBeCloseTo(0.3048, 15)
    expect(dimEq(unit('lbf').dim, NAMED.force!)).toBe(true)
  })

  it('stores SI and displays in any compatible unit', () => {
    const s = parseLiteral('5 cm')!
    expect(s.si).toBeCloseTo(0.05, 15)
    expect(toUnit(s, 'mm')).toBeCloseTo(50, 12)
    expect(formatScalar(s, { unit: 'm' })).toBe('0.05 m')
  })

  it('refuses to express one dimension in another unit', () => {
    expect(() => toUnit(parseLiteral('5 m')!, 's')).toThrow(/cannot express/)
  })

  it('names dimensions in SI symbols for error messages', () => {
    expect(dimToString(NAMED.force!)).toBe('kg m s⁻²')
    expect(dimToString(NAMED.scalar!)).toBe('dimensionless')
  })

  it('has rational exponents so sqrt is exact', () => {
    const half = dimPow(NAMED.area!, rat(1, 2))
    expect(dimEq(half, NAMED.length!)).toBe(true)
    expect(ratEq(dimPow(NAMED.length!, rat(1, 2))[1]!, rat(1, 2))).toBe(true)
  })
})

describe('expressions', () => {
  it('parses a literal with a unit', () => {
    const p = parse('5 m')
    expect(evaluate(p, env as any)).toMatchObject({ si: 5 })
  })

  it('treats juxtaposition after a number as a unit, not a variable', () => {
    // `m` is a mass parameter in scope; `9.81 m/s^2` must still be metres.
    const v = evaluate(parse('9.81 m/s^2'), env as any) as any
    expect(v.si).toBeCloseTo(9.81, 12)
    expect(dimEq(v.dim, NAMED.acceleration!)).toBe(true)
  })

  it('multiplies by a name only with an explicit star', () => {
    const v = evaluate(parse('m * g * sin(theta)'), env as any) as any
    expect(v.si).toBeCloseTo(2 * 9.80665 * 0.5, 12)
    expect(dimEq(v.dim, NAMED.force!)).toBe(true)
  })

  it('rejects a length plus a time, naming both dimensions', () => {
    const r = check('L + t', env)
    expect(r.error).toMatch(/dimension mismatch/)
    expect(r.error).toMatch(/m/)
    expect(r.error).toMatch(/s/)
  })

  it('rejects a dimensional argument to a transcendental', () => {
    expect(check('exp(L)', env).error).toMatch(/dimensionless/)
  })

  it('accepts an angle or a dimensionless number in sin', () => {
    expect(check('sin(theta)', env).error).toBeUndefined()
    expect(check('sin(mu)', env).error).toBeUndefined()
    expect(check('sin(L)', env).error).toMatch(/angle or dimensionless/)
  })

  it('rejects multiplying two vectors', () => {
    const venv = {
      ...env,
      type: (n: string) => (n === 'a' || n === 'b' ? T('vector', NAMED.length!, WORLD) : env.type(n)),
    }
    expect(check('a * b', venv as any).error).toMatch(/dot\(a, b\)|cross\(a, b\)/)
  })

  it('checks and evaluates agree on the resulting type', () => {
    for (const src of ['m * g', 'sqrt(k / m)', 'L / 2', 'norm(vec(1 m, 2 m, 2 m))', 'mu * m * g * cos(theta)']) {
      const p = parse(src)
      const t = infer(p, env)
      const v = evaluate(p, env as any)
      expect(dimEq(t.dim, (v as any).dim ?? NAMED.scalar!), src).toBe(true)
    }
  })

  it('gives sqrt(k/m) a frequency dimension', () => {
    const v = evaluate(parse('sqrt(k / m)'), env as any) as any
    expect(dimEq(v.dim, NAMED.frequency!)).toBe(true)
    expect(v.si).toBeCloseTo(Math.sqrt(50), 12)
  })

  it('refuses a computed exponent on a dimensional base', () => {
    expect(check('L ^ mu', env).error).toMatch(/literal exponent/)
  })

  it('cannot call anything outside the frozen table', () => {
    expect(check('require("fs")', env).error).toMatch(/unknown function `require`/)
    expect(check('eval("1")', env).error).toMatch(/unknown function `eval`/)
  })
})
