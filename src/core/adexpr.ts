// Evaluating expressions onto the AD tape.
//
// The scene is evaluated ONCE, onto one tape. Constants become tape constants, solver
// unknowns become tape variables, and every derived quantity is a tape slot. That makes
// the Jacobian of any residual with respect to any unknown a single adjoint pass, and it
// makes "the solver is one node in the dependency graph" literally true rather than
// architecturally aspirational.
//
// After `solve` returns x, one `tape.forward(x)` gives the numeric value of EVERY
// quantity in the scene. There is no second evaluator and therefore nothing to diverge.
//
// Frame discipline: components are always stored in WORLD coordinates and the `frame`
// tag records the basis the quantity is REPORTED in. A vector is a frame-invariant
// object; re-expressing it changes the report, not the physics. Arithmetic still
// requires the tags to agree, so a user cannot silently add a quantity they were
// thinking of in ramp coordinates to one in world coordinates.

import { Tag, Tape } from './ad.js'
import { Dim, DIMLESS, NAMED, dimDiv, dimEq, dimMul, dimPow, dimToString, isDimless, rat, approxRat } from './dimension.js'
import { ExprError, Parsed, parse } from './expr.js'
import { WORLD } from './frame.js'
import { Scalar } from './units.js'

export type ADKind = 'scalar' | 'vector' | 'direction' | 'point' | 'boolean' | 'frame' | 'ref'

export interface ADValue {
  readonly k: ADKind
  /** One tag for scalars, three for vector-like values, none for frames. */
  readonly t: readonly Tag[]
  readonly dim: Dim
  /** The basis this quantity is reported in. World components are what `t` holds. */
  readonly frame: string
  /** Display unit preference carried through from the literal that produced it. */
  readonly unit: string
  /** Set for `k === 'frame'`. */
  readonly frameId?: string
  /** Set for `k === 'ref'`: the name this parameter points at. */
  readonly refTarget?: string
}

export interface ADEnv {
  resolve(name: string): ADValue
  readonly defaultFrame: string
  readonly tape: Tape
}

const S = (t: Tag, dim: Dim = DIMLESS, unit = '', frame = 'none'): ADValue =>
  ({ k: 'scalar', t: [t], dim, frame, unit })
const V = (t: readonly Tag[], dim: Dim, frame: string, kind: ADKind = 'vector', unit = ''): ADValue =>
  ({ k: kind, t, dim, frame, unit })

export const isVecKind = (k: ADKind): boolean => k === 'vector' || k === 'direction' || k === 'point'

const ANGLE = NAMED.angle!

interface MathNode {
  type: string
  op?: string
  fn?: MathNode | string
  name?: string
  value?: unknown
  args?: MathNode[]
  content?: MathNode
  toString(): string
}

export function evalAD(p: Parsed, env: ADEnv): ADValue {
  return node(p.node as unknown as MathNode, p, env)
}

/** Parse and evaluate in one step. Used everywhere a source string appears in the DSL. */
export function evalSource(src: string, env: ADEnv): ADValue {
  return evalAD(parse(src), env)
}

function node(n: MathNode, p: Parsed, env: ADEnv): ADValue {
  const tp = env.tape
  switch (n.type) {
    case 'ConstantNode':
      return S(tp.const(n.value as number))
    case 'SymbolNode': {
      const name = n.name!.replace(/\$/g, '.')
      const bound = p.binds.get(n.name!) as Scalar | undefined
      if (bound) return S(tp.const(bound.si), bound.dim, bound.unit)
      return env.resolve(name)
    }
    case 'ParenthesisNode':
      return node(n.content!, p, env)
    case 'FunctionNode': {
      const fname = typeof n.fn === 'object' ? (n.fn as MathNode).name! : String(n.fn)
      return call(fname, n.args!.map((a) => node(a, p, env)), env, n)
    }
    case 'OperatorNode':
      return op(n.op!, n.args!.map((a) => node(a, p, env)), env, n)
    default:
      throw new ExprError(`unsupported expression form \`${n.type}\``)
  }
}

const one = (v: ADValue, what: string): Tag => {
  if (v.k !== 'scalar' && v.k !== 'boolean') throw new ExprError(`${what}: expected a scalar, got ${v.k}`)
  return v.t[0]!
}
const three = (v: ADValue, what: string): [Tag, Tag, Tag] => {
  if (!isVecKind(v.k)) throw new ExprError(`${what}: expected a vector, got ${v.k}`)
  return [v.t[0]!, v.t[1]!, v.t[2]!]
}

function sameFrame(a: ADValue, b: ADValue, what: string): void {
  if (a.frame !== b.frame) {
    throw new ExprError(
      `${what}: operands are reported in different frames (\`${a.frame}\` and \`${b.frame}\`); ` +
      `re-express one with in(x, ${a.frame})`,
    )
  }
}

function op(o: string, args: ADValue[], env: ADEnv, n: MathNode): ADValue {
  const tp = env.tape
  if (args.length === 1) {
    const a = args[0]!
    if (o === '+') return a
    if (o === '-') {
      return a.k === 'scalar'
        ? S(tp.neg(a.t[0]!), a.dim, a.unit)
        : V(a.t.map((t) => tp.neg(t)), a.dim, a.frame, a.k === 'point' ? 'vector' : a.k, a.unit)
    }
    throw new ExprError(`unsupported unary operator \`${o}\``)
  }
  const [a, b] = args as [ADValue, ADValue]
  const sa = a.k === 'scalar', sb = b.k === 'scalar'
  switch (o) {
    case '+': case '-': {
      if (!dimEq(a.dim, b.dim)) {
        throw new ExprError(
          `dimension mismatch: cannot ${o === '+' ? 'add' : 'subtract'} ` +
          `${dimToString(a.dim)} and ${dimToString(b.dim)}`,
        )
      }
      const f = o === '+' ? tp.add.bind(tp) : tp.sub.bind(tp)
      if (sa && sb) return S(f(a.t[0]!, b.t[0]!), a.dim, a.unit)
      if (isVecKind(a.k) && isVecKind(b.k)) {
        sameFrame(a, b, o)
        const kind: ADKind = a.k === 'point' && b.k === 'point' ? 'vector'
          : a.k === 'point' ? 'point' : 'vector'
        return V([0, 1, 2].map((i) => f(a.t[i]!, b.t[i]!)), a.dim, a.frame, kind, a.unit)
      }
      throw new ExprError(`cannot ${o === '+' ? 'add' : 'subtract'} ${a.k} and ${b.k}`)
    }
    case '*': {
      const dim = dimMul(a.dim, b.dim)
      if (sa && sb) return S(tp.mul(a.t[0]!, b.t[0]!), dim)
      if (sa && isVecKind(b.k)) return V(b.t.map((t) => tp.mul(a.t[0]!, t)), dim, b.frame)
      if (sb && isVecKind(a.k)) return V(a.t.map((t) => tp.mul(t, b.t[0]!)), dim, a.frame)
      if (isVecKind(a.k) && isVecKind(b.k)) {
        throw new ExprError('cannot multiply two vectors; use dot(a, b) or cross(a, b)')
      }
      throw new ExprError(`cannot multiply ${a.k} by ${b.k}`)
    }
    case '/': {
      if (!sb) throw new ExprError(`cannot divide by ${b.k}`)
      const dim = dimDiv(a.dim, b.dim)
      if (sa) return S(tp.div(a.t[0]!, b.t[0]!), dim)
      return V(a.t.map((t) => tp.div(t, b.t[0]!)), dim, a.frame)
    }
    case '^': {
      if (!sa || !sb) throw new ExprError('only scalars can be raised to a power')
      if (!isDimless(b.dim)) throw new ExprError(`exponent must be dimensionless, got ${dimToString(b.dim)}`)
      const e = literalExponent(n)
      if (e === undefined) {
        if (!isDimless(a.dim)) {
          throw new ExprError(`a dimensional base needs a literal exponent; \`${n.toString()}\` has a computed one`)
        }
        throw new ExprError('a computed exponent is not differentiable here; use a literal')
      }
      return S(tp.pow(a.t[0]!, e.n / e.d), dimPow(a.dim, e))
    }
    default:
      throw new ExprError(`operator \`${o}\` is not available in a solved expression`)
  }
}

function literalExponent(n: MathNode): ReturnType<typeof rat> | undefined {
  let e = n.args![1]!
  let sign = 1
  while (e.type === 'ParenthesisNode') e = e.content!
  if (e.type === 'OperatorNode' && e.op === '-' && e.args!.length === 1) {
    sign = -1; e = e.args![0]!
    while (e.type === 'ParenthesisNode') e = e.content!
  }
  if (e.type !== 'ConstantNode' || typeof e.value !== 'number') return undefined
  return approxRat(sign * e.value)
}

function call(name: string, args: ADValue[], env: ADEnv, n: MathNode): ADValue {
  const tp = env.tape
  const a = args[0], b = args[1]
  switch (name) {
    case 'sin': case 'cos': case 'tan': {
      if (!a || a.k !== 'scalar') throw new ExprError(`${name}: expected a scalar`)
      if (!isDimless(a.dim) && !dimEq(a.dim, ANGLE)) {
        throw new ExprError(`${name}: argument must be an angle or dimensionless, got ${dimToString(a.dim)}`)
      }
      const x = a.t[0]!
      if (name === 'sin') return S(tp.sin(x))
      if (name === 'cos') return S(tp.cos(x))
      return S(tp.div(tp.sin(x), tp.cos(x)))
    }
    case 'atan2': {
      if (!a || !b) throw new ExprError('atan2 takes two arguments')
      if (!dimEq(a.dim, b.dim)) throw new ExprError('atan2: arguments must share a dimension')
      return S(tp.atan2(a.t[0]!, b.t[0]!), ANGLE, 'rad')
    }
    case 'sqrt':
      return S(tp.sqrt(one(a!, 'sqrt')), dimPow(a!.dim, rat(1, 2)))
    case 'abs':
      return S(tp.abs(one(a!, 'abs')), a!.dim)
    case 'vec': {
      const [x, y, z] = args
      if (!x || !y || !z) throw new ExprError('vec takes three components')
      if (!dimEq(x.dim, y.dim) || !dimEq(x.dim, z.dim)) {
        throw new ExprError(`vec: components must share a dimension, got ${args.map((v) => dimToString(v.dim)).join(', ')}`)
      }
      return V([one(x, 'vec'), one(y, 'vec'), one(z, 'vec')], x.dim, env.defaultFrame, 'vector', x.unit)
    }
    case 'norm':
      return S(tp.norm3(three(a!, 'norm')), a!.dim, a!.unit)
    case 'normalize': {
      const v = three(a!, 'normalize')
      const nrm = tp.norm3(v)
      return V(v.map((t) => tp.div(t, nrm)), DIMLESS, a!.frame, 'direction')
    }
    case 'dot': {
      sameFrame(a!, b!, 'dot')
      return S(tp.dot3(three(a!, 'dot'), three(b!, 'dot')), dimMul(a!.dim, b!.dim))
    }
    case 'cross': {
      sameFrame(a!, b!, 'cross')
      const u = three(a!, 'cross'), v = three(b!, 'cross')
      return V([
        tp.sub(tp.mul(u[1], v[2]), tp.mul(u[2], v[1])),
        tp.sub(tp.mul(u[2], v[0]), tp.mul(u[0], v[2])),
        tp.sub(tp.mul(u[0], v[1]), tp.mul(u[1], v[0])),
      ], dimMul(a!.dim, b!.dim), a!.frame)
    }
    case 'component': {
      // Signed magnitude of `a` along the direction of `b`.
      sameFrame(a!, b!, 'component')
      const v = three(b!, 'component')
      const nrm = tp.norm3(v)
      const unitv = v.map((t) => tp.div(t, nrm)) as [Tag, Tag, Tag]
      return S(tp.dot3(three(a!, 'component'), unitv), a!.dim, a!.unit)
    }
    case 'project': {
      sameFrame(a!, b!, 'project')
      const v = three(b!, 'project')
      const nrm = tp.norm3(v)
      const unitv = v.map((t) => tp.div(t, nrm)) as [Tag, Tag, Tag]
      const s = tp.dot3(three(a!, 'project'), unitv)
      return V(unitv.map((t) => tp.mul(t, s)), a!.dim, a!.frame)
    }
    case 'in': {
      // Re-express: same physical quantity, reported in another basis.
      if (!b || b.k !== 'frame') throw new ExprError('in(x, F): the second argument must be a frame')
      return { ...a!, frame: b.frameId ?? WORLD }
    }
    default:
      throw new ExprError(`unknown function \`${name}\``)
  }
}
