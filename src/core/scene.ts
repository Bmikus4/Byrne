// The scene: a document plus a library, evaluated onto one AD tape and solved.
//
// Resolution is pull-based and memoised, which IS the dependency graph: asking for a
// name evaluates exactly its transitive inputs, once. A name being visited when it is
// asked for again is a cycle, and the cycle path is named in the error rather than
// producing a stack overflow.
//
// Everything lands on one tape (see adexpr.ts), so after `solve` a single forward pass
// gives the numeric value of every quantity in the scene. The solver is one node in the
// graph, not a separate pipeline stage that can fall out of sync.

import { Tag, Tape } from './ad.js'
import { ADEnv, ADValue, evalSource, isVecKind } from './adexpr.js'
import { Dim, DIMLESS, NAMED, dimEq, dimToString, isDimless } from './dimension.js'
import {
  CheckDecl, ComponentDef, ConstraintDecl, Document, InstanceDecl, LabelDecl,
  MeasureDecl, ParamDecl, ViewDecl, FrameDecl,
} from './dsl.js'
import { ExprError } from './expr.js'
import {
  FrameTree, Rigid, Vec3, WORLD, frameFrom, normalize as vnormalize, qFromMat3,
} from './frame.js'
import { PointCharge, fieldAt, fluxThroughSphere } from './fields.js'
import { ResidualSpec, SolveReport, Unknown, solve } from './solver.js'
import { parseLiteral, unit as resolveUnit } from './units.js'

export class SceneError extends Error {}

export interface GeometryItem {
  readonly op: string
  readonly owner: string
  readonly name: string
  /** Property values as tape tags, three per vector-like property. */
  readonly props: ReadonlyMap<string, ADValue>
  readonly style: Readonly<Record<string, string>>
}

export interface LabelItem {
  readonly target: string
  readonly latex: string
  readonly anchor: string
  readonly offset: string
}

export interface NamedQuantity {
  readonly name: string
  readonly value: ADValue
  readonly owner?: string
}

/**
 * A quantity computed from the SOLVED configuration rather than on the tape. Fields are
 * the only ones: putting a quadrature into the residual vector would put its error into
 * every Jacobian. The consequence, stated rather than hidden: a construction cannot be
 * constrained by a field value.
 */
export interface DeferredResult {
  readonly name: string
  readonly op: string
  readonly kind: 'scalar' | 'vector'
  readonly si: number | Vec3
  readonly dim: Dim
  readonly unit: string
  /** Quadrature error estimate, where the computation has one. */
  readonly error?: number
  readonly converged: boolean
}

export interface CheckResult {
  readonly name: string
  readonly op: string
  readonly pass: boolean
  readonly residual: number
  readonly tolerance: number
  readonly detail: string
  readonly frame: string
}

export interface Scene {
  readonly doc: Document
  readonly library: ReadonlyMap<string, ComponentDef>
  readonly tape: Tape
  readonly unknowns: readonly Unknown[]
  readonly residuals: readonly ResidualSpec[]
  readonly names: ReadonlyMap<string, ADValue>
  readonly geometry: readonly GeometryItem[]
  readonly labels: readonly LabelItem[]
  readonly checks: readonly CheckDecl[]
  readonly views: readonly ViewDecl[]
  readonly frameSpecs: ReadonlyMap<string, FrameSpec>
  readonly report: SolveReport
  /** Every tape slot at the solution. Read any quantity's components from here. */
  readonly values: Float64Array
  readonly frames: FrameTree
  readonly checkResults: readonly CheckResult[]
  readonly deferred: readonly DeferredResult[]
  readonly warnings: readonly string[]
}

export interface FrameSpec {
  readonly id: string
  readonly parent: string
  readonly origin: ADValue
  readonly x: ADValue
  readonly y: ADValue
  readonly z: ADValue
}

/** Type names that describe a KIND rather than a dimension; no dimension check. */
const STRUCTURAL = new Set(['ref', 'body', 'point', 'direction', 'vector', 'frame', 'tensor2'])

const LENGTH = NAMED.length!
const FORCE = NAMED.force!

// ---------------------------------------------------------------------------

type Provider = () => ADValue

export function build(doc: Document, library: ReadonlyMap<string, ComponentDef>): Scene {
  const tape = new Tape()
  const providers = new Map<string, Provider>()
  const cache = new Map<string, ADValue>()
  const visiting = new Set<string>()
  const trail: string[] = []
  const unknowns: Unknown[] = []
  const residuals: ResidualSpec[] = []
  const geometry: GeometryItem[] = []
  const labels: LabelItem[] = []
  const warnings: string[] = []
  const frameSpecs = new Map<string, FrameSpec>()
  /** body name -> instance names contributing a `force` quantity to it. */
  const bodyForces = new Map<string, string[]>()
  /** Qualified names of every instance declared so far, for resolving sibling refs. */
  const declaredInstances = new Set<string>()

  const env: ADEnv = { tape, defaultFrame: WORLD, resolve }

  /** Residuals are assembled after every name exists, so a constraint may read anything. */
  const pendingResiduals: Array<() => void> = []

  // -- primitive values -----------------------------------------------------

  const zero = tape.const(0)
  const oneT = tape.const(1)
  const dir = (x: Tag, y: Tag, z: Tag, frame = WORLD): ADValue =>
    ({ k: 'direction', t: [x, y, z], dim: DIMLESS, frame, unit: '' })

  const worldSpec: FrameSpec = {
    id: WORLD,
    parent: WORLD,
    origin: { k: 'point', t: [zero, zero, zero], dim: LENGTH, frame: WORLD, unit: 'm' },
    x: dir(oneT, zero, zero), y: dir(zero, oneT, zero), z: dir(zero, zero, oneT),
  }
  frameSpecs.set(WORLD, worldSpec)

  // -- name resolution ------------------------------------------------------

  function resolve(name: string): ADValue {
    const hit = cache.get(name)
    if (hit) return hit
    if (visiting.has(name)) {
      throw new SceneError(`circular definition: ${[...trail, name].join(' -> ')}`)
    }
    visiting.add(name); trail.push(name)
    try {
      const v = resolveUncached(name)
      cache.set(name, v)
      return v
    } finally {
      visiting.delete(name); trail.pop()
    }
  }

  function resolveUncached(name: string): ADValue {
    const own = providers.get(name)
    if (own) return own()
    const parts = name.split('.')
    for (let k = parts.length - 1; k >= 1; k--) {
      const key = parts.slice(0, k).join('.')
      if (providers.has(key)) return member(resolve(key), parts.slice(k), key)
    }
    throw new SceneError(`unknown name \`${name}\``)
  }

  /** Member access: frame axes, vector components, and reference redirection. */
  function member(base: ADValue, rest: string[], baseName: string): ADValue {
    let v = base
    let path = baseName
    for (let i = 0; i < rest.length; i++) {
      const seg = rest[i]!
      path = `${path}.${seg}`
      if (v.k === 'ref') {
        // A reference parameter is a name, so `weight.body.mass` becomes `block.mass`.
        return resolve([v.refTarget, ...rest.slice(i)].join('.'))
      }
      if (v.k === 'frame') {
        const spec = frameSpecs.get(v.frameId!)
        if (!spec) throw new SceneError(`frame \`${v.frameId}\` is not defined`)
        if (seg === 'x' || seg === 'y' || seg === 'z') { v = spec[seg]; continue }
        if (seg === 'origin') { v = spec.origin; continue }
        throw new SceneError(`a frame has no member \`${seg}\` (try x, y, z, origin)`)
      }
      if (isVecKind(v.k)) {
        const i = { x: 0, y: 1, z: 2 }[seg]
        if (i === undefined) throw new SceneError(`a vector has no member \`${seg}\``)
        v = { k: 'scalar', t: [v.t[i]!], dim: v.dim, frame: 'none', unit: v.unit }
        continue
      }
      throw new SceneError(`\`${path}\` is not addressable`)
    }
    return v
  }

  const define = (name: string, p: Provider): void => {
    if (providers.has(name)) throw new SceneError(`duplicate name \`${name}\``)
    providers.set(name, p)
  }

  // -- top level ------------------------------------------------------------

  providers.set(WORLD, () => ({ k: 'frame', t: [], dim: DIMLESS, frame: WORLD, unit: '', frameId: WORLD }))

  // The scrub parameter. One global scalar. It is NOT an integration variable.
  const tTag = tape.const(0)
  providers.set('t', () => ({ k: 'scalar', t: [tTag], dim: NAMED.time!, frame: 'none', unit: 's' }))

  const instances = doc.nodes.filter((n): n is InstanceDecl => n.kind === 'instance')
  const params = doc.nodes.filter((n): n is ParamDecl => n.kind === 'param')
  const frameDecls = doc.nodes.filter((n): n is FrameDecl => n.kind === 'frame')
  const measures = doc.nodes.filter((n): n is MeasureDecl => n.kind === 'measure')
  const checks = doc.nodes.filter((n): n is CheckDecl => n.kind === 'check')
  const constraints = doc.nodes.filter((n): n is ConstraintDecl => n.kind === 'constraint')
  const views = doc.nodes.filter((n): n is ViewDecl => n.kind === 'view')

  for (const n of doc.nodes) {
    if (n.kind === 'label') labels.push({
      target: n.target, latex: n.latex, anchor: n.anchor ?? 'auto', offset: n.offset ?? '0 mm',
    })
  }

  for (const p of params) {
    define(p.name, () => makeParam(p.name, p.expr, p.type, p.init, p.locked))
  }

  for (const f of frameDecls) declareFrame(f)

  for (const inst of instances) declareInstance(inst, inst.name)

  // Deferred measures are not tape nodes, so they get no provider; they are computed
  // from the solution below.
  const DEFERRED_OPS = new Set(['flux', 'field'])
  const deferredDecls = measures.filter((m) => DEFERRED_OPS.has(m.op))
  for (const m of measures) {
    if (!DEFERRED_OPS.has(m.op)) define(m.name, () => makeMeasure(m))
  }

  // -- parameters and unknowns ---------------------------------------------

  function dimOfType(typeName: string | undefined, where: string): Dim | undefined {
    if (!typeName || STRUCTURAL.has(typeName)) return undefined
    const d = NAMED[typeName]
    if (!d) throw new SceneError(`${where}: unknown parameter type \`${typeName}\``)
    return d
  }

  function makeParam(
    name: string, expr: string, typeName?: string, init?: string, locked?: boolean,
    scope?: (n: string) => ADValue,
  ): ADValue {
    if (expr.trim() === '?') {
      const d = dimOfType(typeName, name) ?? DIMLESS
      const seed = init ? literal(init, name) : 0
      const tag = tape.variable()
      unknowns.push({ id: name, init: seed, dim: d, ...(locked ? { locked } : {}) })
      return { k: 'scalar', t: [tag], dim: d, frame: 'none', unit: displayUnit(typeName) }
    }
    const v = evalIn(expr, name, scope)
    const want = dimOfType(typeName, name)
    if (want && !dimEq(v.dim, want)) {
      throw new SceneError(
        `${name}: declared \`${typeName}\` (${dimToString(want)}) ` +
        `but the expression is ${dimToString(v.dim)}`,
      )
    }
    return v
  }

  function displayUnit(typeName: string | undefined): string {
    const table: Record<string, string> = {
      length: 'm', mass: 'kg', force: 'N', angle: 'deg', time: 's',
      acceleration: 'm/s^2', stiffness: 'N/m', charge: 'C', energy: 'J', torque: 'N*m',
    }
    return typeName ? table[typeName] ?? '' : ''
  }

  function literal(src: string, where: string): number {
    const lit = parseLiteral(src)
    if (!lit) throw new SceneError(`${where}: \`${src}\` is not a literal with a unit`)
    return lit.si
  }

  function evalIn(src: string, where: string, scope?: (n: string) => ADValue): ADValue {
    try {
      return evalSource(src, scope ? { ...env, resolve: scope } : env)
    } catch (e) {
      if (e instanceof ExprError || e instanceof SceneError) {
        throw new SceneError(`${where}: ${(e as Error).message}`)
      }
      throw e
    }
  }

  // -- frames ---------------------------------------------------------------

  function declareFrame(f: FrameDecl): void {
    const id = f.name
    define(id, () => ({ k: 'frame', t: [], dim: DIMLESS, frame: id, unit: '', frameId: id }))
    // The basis is built eagerly: a frame is referenced by name from expressions,
    // and those expressions must see the axes, not a promise of them.
    const parent = f.parent ?? WORLD
    const pspec = frameSpecs.get(parent)
    if (!pspec) throw new SceneError(`frame \`${id}\`: unknown parent \`${parent}\``)
    const origin = f.origin ? asPoint(evalIn(f.origin, `frame ${id}.origin`), id) : pspec.origin
    let x = pspec.x, y = pspec.y, z = pspec.z
    if (f.axis && f.angle) {
      const axis = asDirection(evalIn(f.axis, `frame ${id}.axis`), id)
      const ang = asScalar(evalIn(f.angle, `frame ${id}.angle`), id, NAMED.angle!)
      x = rotate(axis, ang, pspec.x); y = rotate(axis, ang, pspec.y); z = rotate(axis, ang, pspec.z)
    } else if (f.x) {
      const ex = asDirection(evalIn(f.x, `frame ${id}.x`), id)
      const up = f.up ? asDirection(evalIn(f.up, `frame ${id}.up`), id) : pspec.z
      const ez = normalizeAD(crossAD(ex, up))
      const ey = crossAD(ez, ex)
      x = ex; y = ey; z = ez
    }
    frameSpecs.set(id, { id, parent, origin, x, y, z })
  }

  /** Rodrigues on the tape: v cos t + (k x v) sin t + k (k . v)(1 - cos t). */
  function rotate(axis: ADValue, angle: ADValue, v: ADValue): ADValue {
    const c = tape.cos(angle.t[0]!)
    const s = tape.sin(angle.t[0]!)
    const k = normalizeAD(axis)
    const kv = tape.dot3(k.t as [Tag, Tag, Tag], v.t as [Tag, Tag, Tag])
    const kxv = crossAD(k, v)
    const omc = tape.sub(tape.const(1), c)
    const comps = [0, 1, 2].map((i) =>
      tape.sum([
        tape.mul(v.t[i]!, c),
        tape.mul(kxv.t[i]!, s),
        tape.mul(tape.mul(k.t[i]!, kv), omc),
      ]),
    )
    return { k: 'direction', t: comps, dim: DIMLESS, frame: v.frame, unit: '' }
  }

  function crossAD(a: ADValue, b: ADValue): ADValue {
    const [u0, u1, u2] = a.t as [Tag, Tag, Tag]
    const [v0, v1, v2] = b.t as [Tag, Tag, Tag]
    return {
      k: 'direction',
      t: [
        tape.sub(tape.mul(u1, v2), tape.mul(u2, v1)),
        tape.sub(tape.mul(u2, v0), tape.mul(u0, v2)),
        tape.sub(tape.mul(u0, v1), tape.mul(u1, v0)),
      ],
      dim: DIMLESS, frame: a.frame, unit: '',
    }
  }

  function normalizeAD(a: ADValue): ADValue {
    const n = tape.norm3(a.t as [Tag, Tag, Tag])
    return { k: 'direction', t: a.t.map((x) => tape.div(x, n)), dim: DIMLESS, frame: a.frame, unit: '' }
  }

  function asPoint(v: ADValue, where: string): ADValue {
    if (!isVecKind(v.k)) throw new SceneError(`${where}: expected a point, got ${v.k}`)
    if (!dimEq(v.dim, LENGTH)) throw new SceneError(`${where}: a point must be a length, got ${dimToString(v.dim)}`)
    return { ...v, k: 'point' }
  }
  function asDirection(v: ADValue, where: string): ADValue {
    if (!isVecKind(v.k)) throw new SceneError(`${where}: expected a direction, got ${v.k}`)
    return normalizeAD(v)
  }
  function asScalar(v: ADValue, where: string, d?: Dim): ADValue {
    if (v.k !== 'scalar') throw new SceneError(`${where}: expected a scalar, got ${v.k}`)
    if (d && !dimEq(v.dim, d)) {
      throw new SceneError(`${where}: expected ${dimToString(d)}, got ${dimToString(v.dim)}`)
    }
    return v
  }

  // -- instances ------------------------------------------------------------

  /**
   * Declare one instance under `qname`. `callScope` resolves the names a call-site
   * parameter value is written against: the document for a top-level instance, the
   * PARENT component's scope for a nested one. That single parameter is what makes
   * components nest arbitrarily with no special case at any depth.
   */
  function declareInstance(
    inst: InstanceDecl, qname: string, callScope?: (n: string) => ADValue,
  ): void {
    const def = library.get(inst.component)
    if (!def) throw new SceneError(`instance \`${qname}\`: no component \`${inst.component}\``)
    declaredInstances.add(qname)

    const own = (n: string): ADValue => instScope(def, qname, n)
    /** A reference written at the call site names something in the CALLER's world. */
    const qualifyRef = (target: string): string => {
      const t = target.trim()
      if (!t) return t
      const parent = qname.includes('.') ? qname.slice(0, qname.lastIndexOf('.')) : ''
      if (!parent) return t
      // Prefer a sibling inside the same parent; fall back to a document-level name.
      return declaredInstances.has(`${parent}.${t}`) || providers.has(`${parent}.${t}`)
        ? `${parent}.${t}` : t
    }

    // Parameters: an explicit binding overrides the definition default.
    for (const p of def.params) {
      const full = `${qname}.${p.name}`
      const given = inst.params[p.name]
      define(full, () => {
        if (p.type === 'ref') {
          const raw = (given ?? p.default ?? '').trim()
          if (!raw) throw new SceneError(`${full}: a reference parameter needs a value`)
          const target = given !== undefined ? qualifyRef(raw) : `${qname}.${raw}`
          return { k: 'ref', t: [], dim: DIMLESS, frame: 'none', unit: '', refTarget: target }
        }
        const expr = given ?? p.default
        if (expr === undefined) throw new SceneError(`${full}: no value and no default`)
        if (expr.trim() === '?' || (given === undefined && p.unknown)) {
          return makeParam(full, '?', p.type, p.default, false)
        }
        // A value written at the call site sees the CALLER's names; a definition default
        // sees the component's own. Without that split, `param "g" "g"` on a component
        // that also has a parameter `g` resolves to itself.
        const scope = given !== undefined ? callScope : own
        return makeParam(full, expr, p.type, undefined, false, scope)
      })
    }
    for (const k of Object.keys(inst.params)) {
      if (!def.params.some((p) => p.name === k)) {
        throw new SceneError(`instance \`${qname}\`: \`${inst.component}\` has no parameter \`${k}\``)
      }
    }

    // Nested instances, declared before the exposed quantities that read them.
    for (const child of def.instances) {
      declareInstance(child, `${qname}.${child.name}`, own)
    }

    // Exposed quantities.
    for (const q of def.expose) {
      define(`${qname}.${q.name}`, () => evalIn(q.expr, `${qname}.${q.name}`, own))
      // Modelica's through-quantity rule, spelled as a naming convention:
      //   `force`          acts on the body named by the ref parameter `body`
      //   `force-on-<ref>` acts on the body named by the ref parameter `<ref>`
      // Connecting a force to a body is what puts it into that body's sum, so no
      // component ever writes "sum of forces" by hand.
      const refName = q.name === 'force' ? 'body'
        : q.name.startsWith('force-on-') ? q.name.slice('force-on-'.length) : undefined
      if (refName) {
        const decl = def.params.find((p) => p.name === refName)
        if (decl?.type === 'ref') {
          const raw = (inst.params[refName] ?? decl.default ?? '').trim()
          const target = inst.params[refName] !== undefined ? qualifyRef(raw)
            : raw ? `${qname}.${raw}` : ''
          if (target) {
            const list = bodyForces.get(target) ?? []
            list.push(`${qname}.${q.name}`)
            bodyForces.set(target, list)
          }
        }
      }
    }

    // Local frame. Built eagerly, because other expressions reference its axes by name;
    // it therefore has to come after the exposed quantities it reads.
    if (def.frame) {
      const fid = `${qname}.${def.frame.name}`
      define(fid, () => ({ k: 'frame', t: [], dim: DIMLESS, frame: fid, unit: '', frameId: fid }))
      if (def.frame.name !== 'frame') {
        providers.set(`${qname}.frame`, () => ({ k: 'frame', t: [], dim: DIMLESS, frame: fid, unit: '', frameId: fid }))
      }
      const origin = def.frame.origin ? asPoint(evalIn(def.frame.origin, `${fid}.origin`, own), fid) : worldSpec.origin
      const ex = def.frame.x ? asDirection(evalIn(def.frame.x, `${fid}.x`, own), fid) : worldSpec.x
      const up = def.frame.up ? asDirection(evalIn(def.frame.up, `${fid}.up`, own), fid) : worldSpec.z
      const ez = normalizeAD(crossAD(ex, up))
      const ey = crossAD(ez, ex)
      frameSpecs.set(fid, { id: fid, parent: WORLD, origin, x: ex, y: ey, z: ez })
    }

    // Geometry.
    for (const g of def.geometry) {
      const props = new Map<string, ADValue>()
      for (const [k, v] of Object.entries(g.props)) {
        props.set(k, evalIn(v, `${qname}.${g.name}.${k}`, own))
      }
      geometry.push({ op: g.op, owner: qname, name: `${qname}.${g.name}`, props, style: def.style })
    }

    // Constraint contributions. `residual` is the ONLY constraint primitive; everything
    // else in the shipped library is written in terms of it.
    for (const c of def.constraints) {
      if (c.op !== 'residual') {
        throw new SceneError(
          `${qname}: \`${c.op}\` is not a constraint primitive; the only primitive is ` +
          `\`residual\` (see docs/PRIMITIVES.md)`,
        )
      }
      const owner = `${qname}.${c.props.name ?? 'residual'}`
      pendingResiduals.push(() => {
        const v = asScalar(evalIn(c.props.expr!, owner, own), owner)
        residuals.push({
          owner, label: c.props.label ?? owner,
          tol: c.props.tol ? literal(c.props.tol, owner) : 1e-12,
          tag: v.t[0]!,
        })
      })
    }
  }

  /** Inside a component, bare names see the component's own params, ports and frame. */
  /** Inside a component, bare names see the component's own params, ports and frame. */
  function instScope(def: ComponentDef, qname: string, name: string): ADValue {
    const head = name.split('.')[0]!
    if (def.params.some((p) => p.name === head)
      || def.expose.some((q) => q.name === head)
      || def.instances.some((i) => i.name === head)
      || (def.frame && (head === def.frame.name || head === 'frame'))) {
      return resolve(`${qname}.${name}`)
    }
    return resolve(name)
  }

  // -- body aggregates ------------------------------------------------------

  function netForce(body: string): ADValue {
    const contributors = bodyForces.get(body) ?? []
    if (contributors.length === 0) {
      throw new SceneError(`\`${body}\` has no forces attached, so its net force is undefined`)
    }
    let acc: ADValue | undefined
    for (const c of contributors) {
      const f = resolve(c)
      if (!isVecKind(f.k)) throw new SceneError(`${c} is not a vector`)
      if (!dimEq(f.dim, FORCE)) {
        throw new SceneError(`${c} is ${dimToString(f.dim)}, expected a force`)
      }
      acc = acc
        ? { ...acc, t: [0, 1, 2].map((i) => tape.add(acc!.t[i]!, f.t[i]!)) }
        : { ...f, k: 'vector' }
    }
    return acc!
  }

  // `X.netforce` is engine-provided, like `world`. It is the Modelica through-quantity
  // sum at a body: connecting a force to a body puts it in this sum, which is why no
  // component ever writes "sum of forces" by hand.
  for (const [body] of bodyForces) {
    if (!providers.has(`${body}.netforce`)) {
      providers.set(`${body}.netforce`, () => netForce(body))
    }
  }

  // -- measures -------------------------------------------------------------

  function makeMeasure(m: MeasureDecl): ADValue {
    const args = m.of.map((s) => evalIn(s, `measure ${m.name}`))
    const where = `measure ${m.name}`
    let out: ADValue
    switch (m.op) {
      case 'resultant': {
        if (!args.length) throw new SceneError(`${where}: nothing to add`)
        out = args.reduce((a, b) => {
          if (!dimEq(a.dim, b.dim)) throw new SceneError(`${where}: mixing ${dimToString(a.dim)} and ${dimToString(b.dim)}`)
          return { ...a, k: 'vector', t: [0, 1, 2].map((i) => tape.add(a.t[i]!, b.t[i]!)) }
        })
        break
      }
      case 'difference':
        out = { ...args[0]!, k: 'vector', t: [0, 1, 2].map((i) => tape.sub(args[0]!.t[i]!, args[1]!.t[i]!)) }
        break
      case 'magnitude':
        out = { k: 'scalar', t: [tape.norm3(args[0]!.t as [Tag, Tag, Tag])], dim: args[0]!.dim, frame: 'none', unit: args[0]!.unit }
        break
      case 'component': {
        if (!m.along) throw new SceneError(`${where}: \`component\` needs an \`along\``)
        // A projection onto a direction is frame-invariant, so the direction is re-tagged
        // to the value's report frame instead of the pair being refused. Addition stays
        // strict: adding quantities reported in different bases is the mistake worth
        // catching, because it means the author is confusing two different things.
        const a = { ...evalIn(m.along, where), frame: args[0]!.frame }
        out = evalIn('component(_a, _b)', where, (n) => (n === '_a' ? args[0]! : n === '_b' ? a : resolve(n)))
        break
      }
      case 'expression':
        out = args[0]!
        break
      case 'moment': {
        // of = [force, point of application]; about = the pivot.
        if (!m.about) throw new SceneError(`${where}: \`moment\` needs an \`about\` point`)
        if (m.of.length < 2) throw new SceneError(`${where}: \`moment\` needs a force and its point of application`)
        const about = evalIn(m.about, where)
        const force = args[0]!
        const app = args[1]!
        const arm: ADValue = {
          ...app, k: 'vector',
          t: [0, 1, 2].map((i) => tape.sub(app.t[i]!, about.t[i]!)),
        }
        out = evalIn('cross(_r, _f)', where, (n) =>
          n === '_r' ? arm : n === '_f' ? force : resolve(n))
        break
      }
      default:
        throw new SceneError(`${where}: unknown measure operation \`${m.op}\``)
    }
    if (m.expressIn) {
      const f = evalIn(m.expressIn, where)
      if (f.k !== 'frame') throw new SceneError(`${where}: \`express-in\` needs a frame`)
      out = { ...out, frame: f.frameId! }
    }
    return out
  }

  // -- explicit constraints -------------------------------------------------

  for (const c of constraints) {
    pendingResiduals.push(() => {
      const where = `constraint ${c.name}`
      switch (c.op) {
        case 'distance': {
          const a = evalIn(c.operands[0]!, where)
          const b = evalIn(c.operands[1]!, where)
          const d = evalIn('norm(_b - _a) - _v', where, (n) =>
            n === '_a' ? a : n === '_b' ? b : n === '_v' ? evalIn(c.value!, where) : resolve(n))
          residuals.push({ owner: c.name, label: `${c.name}: distance`, tol: 1e-12, tag: d.t[0]! })
          break
        }
        case 'equal': {
          const a = evalIn(c.operands[0]!, where)
          const b = evalIn(c.operands[1]!, where)
          if (!dimEq(a.dim, b.dim)) throw new SceneError(`${where}: ${dimToString(a.dim)} vs ${dimToString(b.dim)}`)
          const n = a.k === 'scalar' ? 1 : 3
          for (let i = 0; i < n; i++) {
            residuals.push({
              owner: c.name, label: `${c.name}[${i}]`, tol: 1e-12,
              tag: tape.sub(a.t[i]!, b.t[i]!),
            })
          }
          break
        }
        case 'residual': {
          const v = asScalar(evalIn(c.operands[0]!, where), where)
          residuals.push({
            owner: c.name, label: c.name,
            tol: c.value ? literal(c.value, where) : 1e-12, tag: v.t[0]!,
          })
          break
        }
        default:
          throw new SceneError(`${where}: unknown constraint \`${c.op}\``)
      }
    })
  }

  // -- checks that contribute residuals (equilibrium) ------------------------

  // A check MEASURES; it never contributes a solver row. Imposing equilibrium is a
  // CONSTRAINT the user adds explicitly, so that "what is being solved for" is always
  // visible in the document rather than implied by a readout.
  const checkRows: Array<{ decl: CheckDecl; tags: Tag[]; tol: number; dirs: string[] }> = []

  for (const ch of checks) {
    pendingResiduals.push(() => {
      const where = `check ${ch.name}`
      if (ch.op !== 'equilibrium') throw new SceneError(`${where}: unknown check \`${ch.op}\``)
      if (!ch.body) throw new SceneError(`${where}: needs a \`body\``)
      const net = netForce(ch.body)
      const tol = ch.tolerance ? literal(ch.tolerance, where) : 1e-12
      const dirs = ch.directions?.length ? [...ch.directions] : ['world.x', 'world.y', 'world.z']
      const tags: Tag[] = dirs.map((d) => {
        const dv = asDirection(evalIn(d, where), where)
        return tape.dot3(net.t as [Tag, Tag, Tag], dv.t as [Tag, Tag, Tag])
      })
      checkRows.push({ decl: ch, tags, tol, dirs })
    })
  }

  // -- force the graph ------------------------------------------------------
  // Resolving every declared name is what turns the lazy graph into a built scene.
  for (const name of [...providers.keys()]) {
    if (name === 'world') continue
    try { resolve(name) } catch (e) {
      if (e instanceof SceneError && /has no forces attached/.test(e.message)) { warnings.push(e.message); continue }
      throw e
    }
  }
  for (const f of pendingResiduals) f()

  // -- solve ----------------------------------------------------------------

  const report = solve(tape, unknowns, residuals)
  const values = tape.forward(report.x)

  // -- materialise frames for display and re-expression ---------------------

  const frames = new FrameTree()
  // Every frame's basis was built in WORLD components, so the tree is stored flat and
  // `parent` survives only as outliner structure. Composition through the tree still
  // works because each stored transform is the frame-to-world one.
  for (const s of frameSpecs.values()) {
    if (s.id === WORLD) continue
    frames.define(s.id, WORLD, rigidOf(s, values))
  }

  const checkResults: CheckResult[] = checkRows.map(({ decl, tags, tol, dirs }) => {
    let worst = 0
    tags.forEach((t) => { worst = Math.max(worst, Math.abs(values[t]!)) })
    return {
      name: decl.name, op: decl.op, pass: worst <= tol, residual: worst, tolerance: tol,
      detail: `sum F along ${dirs.join(', ')}`,
      frame: WORLD,
    }
  })

  // -- deferred (field) measures -------------------------------------------

  const readNumber = (name: string): number => values[resolve(name).t[0]!]!
  const readVector = (name: string): Vec3 => {
    const v = resolve(name)
    return [values[v.t[0]!]!, values[v.t[1]!]!, values[v.t[2]!]!]
  }
  const chargesOf = (names: readonly string[]): PointCharge[] =>
    names.map((n) => ({ q: readNumber(`${n}.charge`), at: readVector(`${n}.position`) }))

  const deferred: DeferredResult[] = deferredDecls.map((m) => {
    const where = `measure ${m.name}`
    if (!m.about) throw new SceneError(`${where}: \`${m.op}\` needs an \`about\` target`)
    const charges = chargesOf(m.of)
    if (m.op === 'flux') {
      const centre = readVector(`${m.about}.position`)
      const R = readNumber(`${m.about}.R`)
      const f = fluxThroughSphere(charges, centre, R)
      if (!f.converged) warnings.push(`${where}: the flux quadrature did not converge`)
      return {
        name: m.name, op: m.op, kind: 'scalar', si: f.value, dim: NAMED.eflux!,
        unit: 'V*m', error: f.error, converged: f.converged,
      }
    }
    const at = readVector(`${m.about}.position`)
    const E = fieldAt(charges, at)
    if (!E) {
      warnings.push(`${where}: the probe sits on a charge, where the field is undefined`)
      return { name: m.name, op: m.op, kind: 'vector', si: [0, 0, 0], dim: NAMED.efield!, unit: 'V/m', converged: false }
    }
    return { name: m.name, op: m.op, kind: 'vector', si: E, dim: NAMED.efield!, unit: 'V/m', converged: true }
  })

  return {
    doc, library, tape, unknowns, residuals,
    names: cache, geometry, labels, checks, views, frameSpecs,
    report, values, frames, checkResults, deferred, warnings,
  }
}

function rigidOf(s: FrameSpec, values: Float64Array): Rigid {
  const g = (v: ADValue, i: number): number => values[v.t[i]!]!
  const x: Vec3 = [g(s.x, 0), g(s.x, 1), g(s.x, 2)]
  const y: Vec3 = [g(s.y, 0), g(s.y, 1), g(s.y, 2)]
  const z: Vec3 = [g(s.z, 0), g(s.z, 1), g(s.z, 2)]
  const o: Vec3 = [g(s.origin, 0), g(s.origin, 1), g(s.origin, 2)]
  // Columns of the rotation are the frame's axes expressed in the parent.
  const q = qFromMat3([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]])
  return { q, t: o }
}

// ---------------------------------------------------------------------------
// Reading values back out

export function numberOf(scene: Scene, v: ADValue, i = 0): number {
  return scene.values[v.t[i]!]!
}

export function vectorOf(scene: Scene, v: ADValue): Vec3 {
  return [numberOf(scene, v, 0), numberOf(scene, v, 1), numberOf(scene, v, 2)]
}

/** Components of a quantity as REPORTED in its own frame. */
export function reported(scene: Scene, v: ADValue): Vec3 {
  const world = vectorOf(scene, v)
  if (v.frame === WORLD || v.frame === 'none') return world
  return scene.frames.vectorTo(world, WORLD, v.frame)
}

export function lookup(scene: Scene, name: string): ADValue {
  const v = scene.names.get(name)
  if (!v) throw new SceneError(`no such quantity \`${name}\``)
  return v
}

export { WORLD }
