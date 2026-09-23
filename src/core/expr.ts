// Expressions: parse, dimension-check, evaluate.
//
// The grammar is mathjs's. We use `math.parse` and never `math.evaluate` — the AST is
// walked by our own total evaluator against a frozen function table, so an expression
// cannot reach the filesystem, the network, or the host. That is the entire trust model
// (there is no scripting language; see docs/DESIGN.md §11).
//
// Two source rewrites happen before mathjs sees the text:
//
//   1. Dotted names (`ramp.frame`) become single identifiers, because model paths are
//      names, not property access.
//   2. `<number> <unit>` juxtapositions are lifted out into bound literals. This removes
//      the collision between a parameter named `m` (mass) and the metre. THE RULE, and it
//      is documented in DSL.md: after a number, juxtaposition is a unit; multiplying by a
//      name requires an explicit `*`.
//
// Checking is a separate pass from evaluation so that a field can be rejected at parse
// time with no values in scope. `expr.test.ts` asserts the two passes agree.

import { parse as mathParse } from 'mathjs'
import {
  Dim, DIMLESS, Rat, dimDiv, dimEq, dimMul, dimPow, dimToString, isDimless, rat, approxRat, NAMED,
} from './dimension.js'
import { Scalar, isKnownUnit, parseLiteral, unit } from './units.js'
import {
  Type, T, Value, typeOf, typeToString, vBool, vDirection, vScalar, vVector,
} from './values.js'
import {
  Vec3, add as vadd, sub as vsub, scale as vscale, dot as vdot, cross as vcross,
  norm as vnorm, normalize as vnormalize,
} from './frame.js'

export class ExprError extends Error {
  constructor(message: string, readonly span?: string) { super(message) }
}

// ---------------------------------------------------------------------------
// Source rewrites

const DOTTED = /\b([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b/g

function liftDots(src: string): string {
  return src.replace(DOTTED, (m) => m.replace(/\./g, '$'))
}

export const unliftDots = (name: string): string => name.replace(/\$/g, '.')

const NUMBER = /(?<![A-Za-z0-9_$.])(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/g
const UNIT_TAIL = /^[A-Za-zµ°]+(?:\^-?\d+)?(?:(?:\s*[*/]\s*|\s+)[A-Za-zµ°]+(?:\^-?\d+)?)*/

interface Lifted { src: string; binds: Map<string, Scalar> }

/** Pull `5 cm`, `9.81 m/s^2` out of the source and bind them to fresh symbols. */
function liftUnits(src: string): Lifted {
  const binds = new Map<string, Scalar>()
  let out = ''
  let i = 0
  let n = 0
  NUMBER.lastIndex = 0
  for (let m = NUMBER.exec(src); m; m = NUMBER.exec(src)) {
    const numStart = m.index
    const numEnd = numStart + m[0]!.length
    out += src.slice(i, numStart)
    let j = numEnd
    while (src[j] === ' ' || src[j] === '\t') j++
    const tail = UNIT_TAIL.exec(src.slice(j))
    let usym = ''
    let consumed = 0
    if (tail) {
      // Back off from the right at component boundaries until it is a real unit.
      // `parts` alternates token, separator, token, ... so odd prefix lengths end on
      // a token and `consumed` is exactly the source text those parts occupied.
      const parts = tail[0]!.split(/(\s*[*/]\s*|\s+)/)
      for (let keep = parts.length % 2 === 0 ? parts.length - 1 : parts.length; keep >= 1; keep -= 2) {
        const text = parts.slice(0, keep).join('')
        const cand = text.trim()
        if (cand && isKnownUnit(cand)) { usym = cand; consumed = text.length; break }
      }
    }
    if (usym) {
      const lit = parseLiteral(`${m[0]} ${usym}`)
      if (!lit) throw new ExprError(`cannot read literal \`${m[0]} ${usym}\``)
      const name = `_bq${n++}_`
      binds.set(name, lit)
      out += name
      i = j + consumed
      NUMBER.lastIndex = i
    } else {
      out += m[0]
      i = numEnd
    }
  }
  out += src.slice(i)
  return { src: out, binds }
}

export interface Parsed {
  readonly source: string
  readonly node: MathNode
  readonly binds: ReadonlyMap<string, Scalar>
  /** Model names this expression reads, dotted form. */
  readonly refs: readonly string[]
}

// Minimal structural view of a mathjs node; we only read these fields.
interface MathNode {
  type: string
  op?: string
  fn?: MathNode | string
  name?: string
  value?: unknown
  args?: MathNode[]
  items?: MathNode[]
  content?: MathNode
  object?: MathNode
  index?: unknown
  implicit?: boolean
  toString(): string
}

export function parse(source: string): Parsed {
  const lifted = liftUnits(liftDots(source))
  let node: MathNode
  try {
    node = mathParse(lifted.src) as unknown as MathNode
  } catch (e) {
    throw new ExprError(`cannot parse \`${source}\`: ${(e as Error).message}`)
  }
  const refs = new Set<string>()
  walk(node, (nd) => {
    if (nd.type === 'SymbolNode' && nd.name && !lifted.binds.has(nd.name) && !FUNCS[nd.name]) {
      refs.add(unliftDots(nd.name))
    }
  })
  return { source, node, binds: lifted.binds, refs: [...refs] }
}

function walk(n: MathNode, f: (n: MathNode) => void): void {
  f(n)
  for (const c of children(n)) walk(c, f)
}

function children(n: MathNode): MathNode[] {
  const out: MathNode[] = []
  if (n.args) out.push(...n.args)
  if (n.items) out.push(...n.items)
  if (n.content) out.push(n.content)
  if (n.object) out.push(n.object)
  if (n.fn && typeof n.fn === 'object') out.push(n.fn as MathNode)
  return out
}

// ---------------------------------------------------------------------------
// Environments

export interface TypeEnv {
  type(name: string): Type | undefined
  readonly defaultFrame: string
}

export interface ValueEnv extends TypeEnv {
  value(name: string): Value | undefined
}

// ---------------------------------------------------------------------------
// The function table. Frozen; nothing else is callable.

type FuncSpec = {
  arity: number | [number, number]
  /** Dimension/kind rule. Throws ExprError with a specific message on mismatch. */
  infer(args: Type[], env: TypeEnv): Type
  eval(args: Value[], env: ValueEnv): Value
}

const ANGLE = NAMED.angle!

function needScalar(t: Type, fn: string, i: number): void {
  if (t.kind !== 'scalar' && t.kind !== 'integer') {
    throw new ExprError(`${fn}: argument ${i + 1} must be a scalar, got ${typeToString(t)}`)
  }
}

function needDimless(t: Type, fn: string, i: number): void {
  needScalar(t, fn, i)
  if (!isDimless(t.dim)) {
    throw new ExprError(`${fn}: argument ${i + 1} must be dimensionless, got ${dimToString(t.dim)}`)
  }
}

/** sin/cos/tan accept a plane angle or a dimensionless number (radians). */
function needAngle(t: Type, fn: string): void {
  if (t.kind !== 'scalar' && t.kind !== 'integer') {
    throw new ExprError(`${fn}: argument must be an angle or a dimensionless scalar, got ${typeToString(t)}`)
  }
  if (!isDimless(t.dim) && !dimEq(t.dim, ANGLE)) {
    throw new ExprError(`${fn}: argument must be an angle or dimensionless, got ${dimToString(t.dim)}`)
  }
}

function needVector(t: Type, fn: string, i: number): void {
  if (t.kind !== 'vector' && t.kind !== 'direction' && t.kind !== 'point') {
    throw new ExprError(`${fn}: argument ${i + 1} must be a vector, got ${typeToString(t)}`)
  }
}

function sameFrame(a: Type, b: Type, fn: string): void {
  if (a.frame !== b.frame) {
    throw new ExprError(
      `${fn}: operands are in different frames (\`${a.frame}\` and \`${b.frame}\`); ` +
      `re-express one with in(x, ${a.frame})`,
    )
  }
}

const num = (v: Value): number => {
  if (v.k !== 'scalar' && v.k !== 'integer') throw new ExprError(`expected a scalar, got ${v.k}`)
  return v.si
}
const vec = (v: Value): Vec3 => {
  if (v.k !== 'vector' && v.k !== 'direction' && v.k !== 'point') {
    throw new ExprError(`expected a vector, got ${v.k}`)
  }
  return v.si
}
const vdim = (v: Value): Dim => (v.k === 'direction' ? DIMLESS : (v as { dim: Dim }).dim)
const vframe = (v: Value): string => (v as { frame: string }).frame

const trig = (name: string, f: (x: number) => number): FuncSpec => ({
  arity: 1,
  infer: ([a]) => { needAngle(a!, name); return T('scalar') },
  eval: ([a]) => vScalar(f(num(a!))),
})

const inverseTrig = (name: string, f: (x: number) => number): FuncSpec => ({
  arity: 1,
  infer: ([a]) => { needDimless(a!, name, 0); return T('scalar', ANGLE) },
  eval: ([a]) => vScalar(f(num(a!)), ANGLE, 'rad'),
})

export const FUNCS: Record<string, FuncSpec> = Object.freeze({
  sin: trig('sin', Math.sin),
  cos: trig('cos', Math.cos),
  tan: trig('tan', Math.tan),
  asin: inverseTrig('asin', Math.asin),
  acos: inverseTrig('acos', Math.acos),
  atan: inverseTrig('atan', Math.atan),
  atan2: {
    arity: 2,
    infer: ([a, b]) => {
      needScalar(a!, 'atan2', 0); needScalar(b!, 'atan2', 1)
      if (!dimEq(a!.dim, b!.dim)) {
        throw new ExprError(`atan2: arguments must share a dimension, got ${dimToString(a!.dim)} and ${dimToString(b!.dim)}`)
      }
      return T('scalar', ANGLE)
    },
    eval: ([a, b]) => vScalar(Math.atan2(num(a!), num(b!)), ANGLE, 'rad'),
  },
  sqrt: {
    arity: 1,
    infer: ([a]) => { needScalar(a!, 'sqrt', 0); return T('scalar', dimPow(a!.dim, rat(1, 2))) },
    eval: ([a]) => vScalar(Math.sqrt(num(a!)), dimPow(vdim(a!), rat(1, 2))),
  },
  abs: {
    arity: 1,
    infer: ([a]) => { needScalar(a!, 'abs', 0); return T('scalar', a!.dim) },
    eval: ([a]) => vScalar(Math.abs(num(a!)), vdim(a!)),
  },
  exp: { arity: 1, infer: ([a]) => { needDimless(a!, 'exp', 0); return T('scalar') }, eval: ([a]) => vScalar(Math.exp(num(a!))) },
  log: { arity: 1, infer: ([a]) => { needDimless(a!, 'log', 0); return T('scalar') }, eval: ([a]) => vScalar(Math.log(num(a!))) },
  min: {
    arity: [2, 8],
    infer: (as) => { as.forEach((a, i) => { needScalar(a, 'min', i); if (!dimEq(a.dim, as[0]!.dim)) throw new ExprError(`min: arguments must share a dimension`) }); return T('scalar', as[0]!.dim) },
    eval: (as) => vScalar(Math.min(...as.map(num)), vdim(as[0]!)),
  },
  max: {
    arity: [2, 8],
    infer: (as) => { as.forEach((a, i) => { needScalar(a, 'max', i); if (!dimEq(a.dim, as[0]!.dim)) throw new ExprError(`max: arguments must share a dimension`) }); return T('scalar', as[0]!.dim) },
    eval: (as) => vScalar(Math.max(...as.map(num)), vdim(as[0]!)),
  },
  vec: {
    arity: 3,
    infer: (as, env) => {
      as.forEach((a, i) => needScalar(a, 'vec', i))
      if (!dimEq(as[0]!.dim, as[1]!.dim) || !dimEq(as[0]!.dim, as[2]!.dim)) {
        throw new ExprError(`vec: components must share a dimension, got ` +
          as.map((a) => dimToString(a.dim)).join(', '))
      }
      return T('vector', as[0]!.dim, env.defaultFrame)
    },
    eval: (as, env) => vVector([num(as[0]!), num(as[1]!), num(as[2]!)], vdim(as[0]!), env.defaultFrame),
  },
  norm: {
    arity: 1,
    infer: ([a]) => { needVector(a!, 'norm', 0); return T('scalar', a!.dim) },
    eval: ([a]) => vScalar(vnorm(vec(a!)), vdim(a!)),
  },
  normalize: {
    arity: 1,
    infer: ([a]) => { needVector(a!, 'normalize', 0); return T('direction', DIMLESS, a!.frame) },
    eval: ([a]) => vDirection(vnormalize(vec(a!)), vframe(a!)),
  },
  dot: {
    arity: 2,
    infer: ([a, b]) => {
      needVector(a!, 'dot', 0); needVector(b!, 'dot', 1); sameFrame(a!, b!, 'dot')
      return T('scalar', dimMul(a!.dim, b!.dim))
    },
    eval: ([a, b]) => vScalar(vdot(vec(a!), vec(b!)), dimMul(vdim(a!), vdim(b!))),
  },
  cross: {
    arity: 2,
    infer: ([a, b]) => {
      needVector(a!, 'cross', 0); needVector(b!, 'cross', 1); sameFrame(a!, b!, 'cross')
      return T('vector', dimMul(a!.dim, b!.dim), a!.frame)
    },
    eval: ([a, b]) => vVector(vcross(vec(a!), vec(b!)), dimMul(vdim(a!), vdim(b!)), vframe(a!)),
  },
  component: {
    arity: 2,
    infer: ([a, b]) => {
      needVector(a!, 'component', 0); needVector(b!, 'component', 1); sameFrame(a!, b!, 'component')
      return T('scalar', dimMul(a!.dim, b!.dim))
    },
    eval: ([a, b]) => vScalar(vdot(vec(a!), vnormalize(vec(b!))), vdim(a!)),
  },
  project: {
    arity: 2,
    infer: ([a, b]) => {
      needVector(a!, 'project', 0); needVector(b!, 'project', 1); sameFrame(a!, b!, 'project')
      return T('vector', a!.dim, a!.frame)
    },
    eval: ([a, b]) => {
      const u = vnormalize(vec(b!))
      return vVector(vscale(u, vdot(vec(a!), u)), vdim(a!), vframe(a!))
    },
  },
})

// ---------------------------------------------------------------------------
// Inference

export function infer(p: Parsed, env: TypeEnv): Type {
  return inferNode(p.node, p, env)
}

function inferNode(n: MathNode, p: Parsed, env: TypeEnv): Type {
  switch (n.type) {
    case 'ConstantNode': {
      const v = n.value
      if (typeof v !== 'number') throw new ExprError(`unsupported constant \`${String(v)}\``)
      return Number.isInteger(v) ? T('integer') : T('scalar')
    }
    case 'SymbolNode': {
      const name = n.name!
      const b = p.binds.get(name)
      if (b) return T('scalar', b.dim)
      const t = env.type(unliftDots(name))
      if (!t) throw new ExprError(`unknown name \`${unliftDots(name)}\``)
      return t
    }
    case 'ParenthesisNode': return inferNode(n.content!, p, env)
    case 'FunctionNode': {
      const fname = typeof n.fn === 'object' ? (n.fn as MathNode).name! : String(n.fn)
      const spec = FUNCS[fname]
      if (!spec) throw new ExprError(`unknown function \`${fname}\``)
      checkArity(spec, fname, n.args!.length)
      return spec.infer(n.args!.map((a) => inferNode(a, p, env)), env)
    }
    case 'OperatorNode': {
      const args = n.args!.map((a) => inferNode(a, p, env))
      return inferOp(n.op!, args, n)
    }
    default:
      throw new ExprError(`unsupported expression form \`${n.type}\` in \`${p.source}\``)
  }
}

function checkArity(spec: FuncSpec, name: string, got: number): void {
  const [lo, hi] = Array.isArray(spec.arity) ? spec.arity : [spec.arity, spec.arity]
  if (got < lo || got > hi) {
    throw new ExprError(`${name}: expected ${lo === hi ? lo : `${lo}..${hi}`} arguments, got ${got}`)
  }
}

const VECKINDS = new Set(['vector', 'direction', 'point'])

function inferOp(op: string, args: Type[], n: MathNode): Type {
  if (args.length === 1) {
    const a = args[0]!
    if (op === '-' || op === '+') {
      if (a.kind === 'boolean' || a.kind === 'frame') throw new ExprError(`unary ${op} on ${typeToString(a)}`)
      return a
    }
    throw new ExprError(`unsupported unary operator \`${op}\``)
  }
  const [a, b] = args as [Type, Type]
  switch (op) {
    case '+': case '-': {
      if (a.kind !== b.kind && !(VECKINDS.has(a.kind) && VECKINDS.has(b.kind))) {
        throw new ExprError(`cannot ${op === '+' ? 'add' : 'subtract'} ${typeToString(a)} and ${typeToString(b)}`)
      }
      if (!dimEq(a.dim, b.dim)) {
        throw new ExprError(
          `dimension mismatch: cannot ${op === '+' ? 'add' : 'subtract'} ` +
          `${dimToString(a.dim)} and ${dimToString(b.dim)}`,
        )
      }
      if (VECKINDS.has(a.kind)) sameFrame(a, b, op)
      // point - point is a vector; point + vector is a point.
      if (a.kind === 'point' && b.kind === 'point') return T('vector', a.dim, a.frame)
      if (a.kind === 'point') return T('point', a.dim, a.frame)
      if (a.kind === 'direction' || b.kind === 'direction') return T('vector', a.dim, a.frame)
      return a
    }
    case '*': {
      const aS = a.kind === 'scalar' || a.kind === 'integer'
      const bS = b.kind === 'scalar' || b.kind === 'integer'
      if (aS && bS) return T('scalar', dimMul(a.dim, b.dim))
      if (aS && VECKINDS.has(b.kind)) return T('vector', dimMul(a.dim, b.dim), b.frame)
      if (bS && VECKINDS.has(a.kind)) return T('vector', dimMul(a.dim, b.dim), a.frame)
      if (VECKINDS.has(a.kind) && VECKINDS.has(b.kind)) {
        throw new ExprError(`cannot multiply two vectors; use dot(a, b) or cross(a, b)`)
      }
      throw new ExprError(`cannot multiply ${typeToString(a)} by ${typeToString(b)}`)
    }
    case '/': {
      if (!(b.kind === 'scalar' || b.kind === 'integer')) {
        throw new ExprError(`cannot divide by ${typeToString(b)}`)
      }
      if (a.kind === 'scalar' || a.kind === 'integer') return T('scalar', dimDiv(a.dim, b.dim))
      if (VECKINDS.has(a.kind)) return T('vector', dimDiv(a.dim, b.dim), a.frame)
      throw new ExprError(`cannot divide ${typeToString(a)}`)
    }
    case '^': {
      if (!(a.kind === 'scalar' || a.kind === 'integer')) {
        throw new ExprError(`cannot raise ${typeToString(a)} to a power`)
      }
      if (!isDimless(b.dim)) {
        throw new ExprError(`exponent must be dimensionless, got ${dimToString(b.dim)}`)
      }
      const e = constExponent(n)
      if (e === undefined) {
        if (!isDimless(a.dim)) {
          throw new ExprError(`a dimensional base needs a literal exponent; \`${n.toString()}\` has a computed one`)
        }
        return T('scalar')
      }
      return T('scalar', dimPow(a.dim, e))
    }
    case '==': case '!=': case '<': case '>': case '<=': case '>=': {
      if (!dimEq(a.dim, b.dim)) {
        throw new ExprError(`cannot compare ${dimToString(a.dim)} with ${dimToString(b.dim)}`)
      }
      return T('boolean')
    }
    case 'and': case 'or': {
      if (a.kind !== 'boolean' || b.kind !== 'boolean') {
        throw new ExprError(`\`${op}\` needs booleans, got ${typeToString(a)} and ${typeToString(b)}`)
      }
      return T('boolean')
    }
    default:
      throw new ExprError(`unsupported operator \`${op}\``)
  }
}

/** The exponent of `a ^ b` when b is a literal (possibly negated). Else undefined. */
function constExponent(n: MathNode): Rat | undefined {
  let e = n.args![1]!
  let sign = 1
  while (e.type === 'ParenthesisNode') e = e.content!
  if (e.type === 'OperatorNode' && e.op === '-' && e.args!.length === 1) {
    sign = -1
    e = e.args![0]!
    while (e.type === 'ParenthesisNode') e = e.content!
  }
  if (e.type !== 'ConstantNode' || typeof e.value !== 'number') return undefined
  return approxRat(sign * e.value)
}

// ---------------------------------------------------------------------------
// Evaluation

export function evaluate(p: Parsed, env: ValueEnv): Value {
  return evalNode(p.node, p, env)
}

function evalNode(n: MathNode, p: Parsed, env: ValueEnv): Value {
  switch (n.type) {
    case 'ConstantNode': {
      const v = n.value as number
      return Number.isInteger(v) ? { k: 'integer', si: v } : vScalar(v)
    }
    case 'SymbolNode': {
      const name = n.name!
      const b = p.binds.get(name)
      if (b) return vScalar(b.si, b.dim, b.unit)
      const v = env.value(unliftDots(name))
      if (!v) throw new ExprError(`unknown name \`${unliftDots(name)}\``)
      return v
    }
    case 'ParenthesisNode': return evalNode(n.content!, p, env)
    case 'FunctionNode': {
      const fname = typeof n.fn === 'object' ? (n.fn as MathNode).name! : String(n.fn)
      const spec = FUNCS[fname]
      if (!spec) throw new ExprError(`unknown function \`${fname}\``)
      checkArity(spec, fname, n.args!.length)
      return spec.eval(n.args!.map((a) => evalNode(a, p, env)), env)
    }
    case 'OperatorNode': {
      const args = n.args!.map((a) => evalNode(a, p, env))
      return evalOp(n.op!, args, n, p, env)
    }
    default:
      throw new ExprError(`unsupported expression form \`${n.type}\``)
  }
}

function evalOp(op: string, args: Value[], n: MathNode, p: Parsed, env: ValueEnv): Value {
  // Types are checked here too: evaluation is never reached with an unchecked tree in
  // the app, but the evaluator is also used directly in tests and by the CLI.
  const types = args.map(typeOf)
  const rt = inferOp(op, types, n)

  if (args.length === 1) {
    const a = args[0]!
    const s = op === '-' ? -1 : 1
    if (a.k === 'scalar') return vScalar(s * a.si, a.dim, a.unit)
    if (a.k === 'integer') return { k: 'integer', si: s * a.si }
    if (a.k === 'vector' || a.k === 'point') return vVector(vscale(a.si, s), a.dim, a.frame, a.unit)
    if (a.k === 'direction') return vDirection(vscale(a.si, s), a.frame)
    throw new ExprError(`unary ${op} on ${a.k}`)
  }
  const [a, b] = args as [Value, Value]
  const sa = a.k === 'scalar' || a.k === 'integer'
  const sb = b.k === 'scalar' || b.k === 'integer'
  switch (op) {
    case '+': case '-': {
      const sign = op === '+' ? 1 : -1
      if (sa && sb) return mk(rt, num(a) + sign * num(b))
      return mkv(rt, vadd(vec(a), vscale(vec(b), sign)))
    }
    case '*': {
      if (sa && sb) return mk(rt, num(a) * num(b))
      if (sa) return mkv(rt, vscale(vec(b), num(a)))
      return mkv(rt, vscale(vec(a), num(b)))
    }
    case '/': {
      if (sa) return mk(rt, num(a) / num(b))
      return mkv(rt, vscale(vec(a), 1 / num(b)))
    }
    case '^': return mk(rt, Math.pow(num(a), num(b)))
    case '==': return vBool(num(a) === num(b))
    case '!=': return vBool(num(a) !== num(b))
    case '<': return vBool(num(a) < num(b))
    case '>': return vBool(num(a) > num(b))
    case '<=': return vBool(num(a) <= num(b))
    case '>=': return vBool(num(a) >= num(b))
    case 'and': return vBool((a as { v: boolean }).v && (b as { v: boolean }).v)
    case 'or': return vBool((a as { v: boolean }).v || (b as { v: boolean }).v)
    default: throw new ExprError(`unsupported operator \`${op}\``)
  }
}

const mk = (t: Type, x: number): Value =>
  t.kind === 'integer' ? { k: 'integer', si: x } : vScalar(x, t.dim)

const mkv = (t: Type, v: Vec3): Value =>
  t.kind === 'point' ? { k: 'point', si: v, dim: t.dim, frame: t.frame as string, unit: '' }
    : t.kind === 'direction' ? vDirection(v, t.frame as string)
      : vVector(v, t.dim, t.frame as string)

/** Convenience: parse, check against a type env, and report the first error. */
export function check(source: string, env: TypeEnv): { type?: Type; error?: string } {
  try {
    return { type: infer(parse(source), env) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export { unit, isKnownUnit }
