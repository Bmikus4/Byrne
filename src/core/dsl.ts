// The on-disk format: a vocabulary over KDL.
//
// KDL supplies the syntax (node, arguments, properties, children) and kdljs supplies the
// parser. We supply the vocabulary and a CANONICAL WRITER. Writing our own printer is not
// inventing a grammar; it is choosing a normal form, the way gofmt does.
//
// Two deviations from docs/DESIGN.md §3.1, both forced by kdljs 0.3.0 and both recorded
// in docs/DSL.md:
//
//   * No raw strings. `latex="\\vec{N}"` instead of `latex=r"\vec{N}"`. Backslashes in
//     LaTeX are therefore doubled in the file. Ugly, honest, and reversible if the parser
//     gains KDL v2 raw strings.
//   * kdljs discards comments. We recover the ones that matter — comments preceding a
//     TOP-LEVEL node — with a brace-depth scan of the source, and reattach them on write.
//     Comments inside a node's children are lost on reformat. Stated, not hidden.
//
// Round-trip contract (tested in test/roundtrip.test.ts):
//   1. read(write(d)) is structurally equal to d, for every document d.
//   2. write(read(t)) is byte-identical to t, for every t the writer could have produced.

import { parse as kdlParse, Node as KdlNode, Value as KDLValue } from 'kdljs'

// ---------------------------------------------------------------------------
// Document model

export interface ProjectHeader {
  readonly version: number
  readonly units: Readonly<Record<string, string>>
  readonly precision: number
  readonly libraries: readonly string[]
}

export interface ParamDecl {
  readonly kind: 'param'
  readonly name: string
  /** Expression source. `?` marks a solver unknown seeded from `init`. */
  readonly expr: string
  readonly type?: string
  readonly init?: string
  readonly locked?: boolean
  readonly range?: string
}

export interface FrameDecl {
  readonly kind: 'frame'
  readonly name: string
  readonly parent?: string
  readonly origin?: string
  /** Rotation relative to the parent: `angle` about `axis`. */
  readonly axis?: string
  readonly angle?: string
  /** Or give the x direction and an up hint, Gram-Schmidt'd. */
  readonly x?: string
  readonly up?: string
}

export interface AttachDecl {
  readonly port: string
  readonly to: string
  readonly at?: string
  readonly constraint?: string
}

export interface InstanceDecl {
  readonly kind: 'instance'
  readonly name: string
  readonly component: string
  readonly params: Readonly<Record<string, string>>
  /** Fields the user set explicitly. Everything else is inherited from the definition. */
  readonly overrides: readonly string[]
  readonly attach: readonly AttachDecl[]
  readonly at?: string
  readonly in?: string
}

export interface MeasureDecl {
  readonly kind: 'measure'
  readonly name: string
  readonly op: string
  readonly of: readonly string[]
  readonly expressIn?: string
  readonly along?: string
  readonly about?: string
}

export interface CheckDecl {
  readonly kind: 'check'
  readonly name: string
  readonly op: string
  readonly body?: string
  readonly tolerance?: string
  readonly about?: string
  /** Directions balanced by an equilibrium check. Default: the three world axes. */
  readonly directions?: readonly string[]
}

export interface ConstraintDecl {
  readonly kind: 'constraint'
  readonly name: string
  readonly op: string
  readonly operands: readonly string[]
  readonly value?: string
}

export interface LabelDecl {
  readonly kind: 'label'
  readonly target: string
  readonly latex: string
  readonly anchor?: string
  readonly offset?: string
}

export interface StyleDecl {
  readonly kind: 'style'
  readonly selector: string
  readonly props: Readonly<Record<string, string>>
}

export interface ViewDecl {
  readonly kind: 'view'
  readonly name: string
  readonly along?: string
  readonly up?: string
  readonly fit?: string
  readonly plane?: string
  readonly visible: readonly string[]
}

export type TopLevel =
  | ParamDecl | FrameDecl | InstanceDecl | MeasureDecl | CheckDecl
  | ConstraintDecl | LabelDecl | StyleDecl | ViewDecl

export interface ComponentParam {
  readonly name: string
  readonly type: string
  readonly default?: string
  readonly min?: string
  readonly max?: string
  readonly unknown?: boolean
  readonly description?: string
}

export interface ComponentPort {
  readonly name: string
  readonly type: string
  readonly role?: string
  /** Expression over `x`, the drop candidate. Evaluated during a drag. */
  readonly accept?: string
}

export interface GeometryDecl {
  readonly op: string
  readonly name: string
  readonly props: Readonly<Record<string, string>>
}

export interface ExposeDecl {
  readonly name: string
  readonly expr: string
}

export interface ContributionDecl {
  readonly op: string
  readonly props: Readonly<Record<string, string>>
}

export interface ComponentDef {
  readonly path: string
  readonly version: number
  readonly meta: Readonly<Record<string, string>>
  readonly params: readonly ComponentParam[]
  readonly ports: readonly ComponentPort[]
  readonly frame?: { readonly name: string; readonly origin?: string; readonly x?: string; readonly up?: string }
  readonly geometry: readonly GeometryDecl[]
  readonly expose: readonly ExposeDecl[]
  readonly constraints: readonly ContributionDecl[]
  /** Nested components. A pulley system is a component containing a pulley and a rope. */
  readonly instances: readonly InstanceDecl[]
  readonly style: Readonly<Record<string, string>>
  readonly label?: { readonly latex: string; readonly anchor?: string; readonly offset?: string }
}

export interface Document {
  readonly project: ProjectHeader
  readonly nodes: readonly TopLevel[]
  readonly components: readonly ComponentDef[]
  /** Comments preceding top-level node i, keyed by index. Index -1 is the file header. */
  readonly comments: ReadonlyMap<number, readonly string[]>
}

export class DslError extends Error {}

export const EMPTY_PROJECT: ProjectHeader = {
  version: 1,
  units: { length: 'm', mass: 'kg', angle: 'deg', force: 'N', time: 's' },
  precision: 6,
  libraries: [],
}

// ---------------------------------------------------------------------------
// Reading

/** kdljs's own node shape. Aliased so the vocabulary reads as ours. */
type KNode = KdlNode

const str = (v: KDLValue | undefined, what: string): string => {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  throw new DslError(`expected a string for ${what}`)
}
const optStr = (v: KDLValue | undefined): string | undefined =>
  v === undefined || v === null ? undefined : String(v)

const props = (n: KNode): Record<string, string> => {
  const o: Record<string, string> = {}
  for (const [k, v] of Object.entries(n.properties)) o[k] = String(v)
  return o
}

export function read(source: string): Document {
  const parsed = kdlParse(source)
  if (parsed.errors.length) {
    const e = parsed.errors[0] as { message?: string; token?: { startLine?: number } }
    throw new DslError(`KDL parse error at line ${e.token?.startLine ?? '?'}: ${e.message ?? 'unexpected token'}`)
  }
  const doc = (parsed.output ?? []) as unknown as KNode[]

  let project = EMPTY_PROJECT
  const nodes: TopLevel[] = []
  const components: ComponentDef[] = []

  for (const n of doc) {
    switch (n.name) {
      case 'project': project = readProject(n); break
      case 'component': components.push(readComponent(n)); break
      case 'param': nodes.push(readParam(n)); break
      case 'frame': nodes.push(readFrame(n)); break
      case 'instance': nodes.push(readInstance(n)); break
      case 'measure': nodes.push(readMeasure(n)); break
      case 'check': nodes.push(readCheck(n)); break
      case 'constraint': nodes.push(readConstraint(n)); break
      case 'label': nodes.push(readLabel(n)); break
      case 'style': nodes.push(readStyle(n)); break
      case 'view': nodes.push(readView(n)); break
      default:
        throw new DslError(`unknown top-level node \`${n.name}\``)
    }
  }
  return { project, nodes, components, comments: scanComments(source) }
}

function readProject(n: KNode): ProjectHeader {
  const units: Record<string, string> = { ...EMPTY_PROJECT.units }
  let precision = EMPTY_PROJECT.precision
  const libraries: string[] = []
  for (const c of n.children) {
    if (c.name === 'units') Object.assign(units, props(c))
    else if (c.name === 'precision') precision = Number(c.properties.sig ?? c.values[0] ?? precision)
    else if (c.name === 'library') libraries.push(str(c.values[0], 'library path'))
    else throw new DslError(`unknown project child \`${c.name}\``)
  }
  return { version: Number(n.properties.version ?? 1), units, precision, libraries }
}

function readParam(n: KNode): ParamDecl {
  const p = props(n)
  return {
    kind: 'param',
    name: str(n.values[0], 'param name'),
    expr: str(n.values[1] ?? '?', 'param value'),
    ...(p.type ? { type: p.type } : {}),
    ...(p.init ? { init: p.init } : {}),
    ...(p.range ? { range: p.range } : {}),
    ...(n.properties.locked !== undefined ? { locked: Boolean(n.properties.locked) } : {}),
  }
}

function readFrame(n: KNode): FrameDecl {
  const p = props(n)
  return {
    kind: 'frame',
    name: str(n.values[0], 'frame name'),
    ...(p.parent ? { parent: p.parent } : {}),
    ...(p.origin ? { origin: p.origin } : {}),
    ...(p.axis ? { axis: p.axis } : {}),
    ...(p.angle ? { angle: p.angle } : {}),
    ...(p.x ? { x: p.x } : {}),
    ...(p.up ? { up: p.up } : {}),
  }
}

function readInstance(n: KNode): InstanceDecl {
  const params: Record<string, string> = {}
  const overrides: string[] = []
  const attach: AttachDecl[] = []
  const p = props(n)
  for (const c of n.children) {
    if (c.name === 'param') {
      const k = str(c.values[0], 'parameter name')
      params[k] = str(c.values[1], `value of \`${k}\``)
      overrides.push(k)
    } else if (c.name === 'attach') {
      const cp = props(c)
      const kids = c.children
      const constraintNode = kids.find((x) => x.name === 'constraint')
      const atNode = kids.find((x) => x.name === 'at')
      attach.push({
        port: cp.port ?? str(c.values[0], 'port'),
        to: cp.to ?? str(c.values[1], 'attach target'),
        ...(atNode ? { at: str(atNode.values[0], 'attach position') } : cp.at ? { at: cp.at } : {}),
        ...(constraintNode ? { constraint: str(constraintNode.values[0], 'constraint kind') } : {}),
      })
    } else if (c.name === 'place') {
      // tolerated alias for the `at=`/`in=` properties
      const cp = props(c)
      if (cp.at) p.at = cp.at
      if (cp.in) p.in = cp.in
    } else {
      throw new DslError(`unknown instance child \`${c.name}\``)
    }
  }
  return {
    kind: 'instance',
    name: str(n.values[0], 'instance name'),
    component: str(n.values[1], 'component path'),
    params, overrides, attach,
    ...(p.at ? { at: p.at } : {}),
    ...(p.in ? { in: p.in } : {}),
  }
}

function readMeasure(n: KNode): MeasureDecl {
  const of: string[] = []
  let expressIn: string | undefined
  let along: string | undefined
  let about: string | undefined
  for (const c of n.children) {
    if (c.name === 'of') for (const v of c.values) of.push(String(v))
    else if (c.name === 'express-in') expressIn = str(c.values[0], 'frame')
    else if (c.name === 'along') along = str(c.values[0], 'axis')
    else if (c.name === 'about') about = str(c.values[0], 'point')
    else throw new DslError(`unknown measure child \`${c.name}\``)
  }
  return {
    kind: 'measure',
    name: str(n.values[0], 'measure name'),
    op: str(n.values[1], 'measure operation'),
    of,
    ...(expressIn ? { expressIn } : {}),
    ...(along ? { along } : {}),
    ...(about ? { about } : {}),
  }
}

function readCheck(n: KNode): CheckDecl {
  let body: string | undefined, tolerance: string | undefined, about: string | undefined
  let directions: string[] | undefined
  for (const c of n.children) {
    if (c.name === 'body') body = str(c.values[0], 'body')
    else if (c.name === 'tolerance') tolerance = str(c.values[0], 'tolerance')
    else if (c.name === 'about') about = str(c.values[0], 'point')
    else if (c.name === 'directions') directions = c.values.map(String)
    else throw new DslError(`unknown check child \`${c.name}\``)
  }
  return {
    kind: 'check',
    name: str(n.values[0], 'check name'),
    op: str(n.values[1], 'check kind'),
    ...(body ? { body } : {}),
    ...(tolerance ? { tolerance } : {}),
    ...(about ? { about } : {}),
    ...(directions ? { directions } : {}),
  }
}

function readConstraint(n: KNode): ConstraintDecl {
  const p = props(n)
  const vals = n.values.map(String)
  return {
    kind: 'constraint',
    name: vals[0]!,
    op: vals[1]!,
    operands: vals.slice(2),
    ...(p.value ? { value: p.value } : {}),
  }
}

function readLabel(n: KNode): LabelDecl {
  const p = props(n)
  return {
    kind: 'label',
    target: str(n.values[0], 'label target'),
    latex: p.latex ?? '',
    ...(p.anchor ? { anchor: p.anchor } : {}),
    ...(p.offset ? { offset: p.offset } : {}),
  }
}

function readStyle(n: KNode): StyleDecl {
  const p: Record<string, string> = {}
  for (const c of n.children) p[c.name] = String(c.values[0] ?? '')
  return { kind: 'style', selector: str(n.values[0], 'style selector'), props: p }
}

function readView(n: KNode): ViewDecl {
  let along: string | undefined, up: string | undefined, fit: string | undefined, plane: string | undefined
  const visible: string[] = []
  for (const c of n.children) {
    if (c.name === 'camera') {
      const cp = props(c)
      along = cp.along; up = cp.up; fit = cp.fit
    } else if (c.name === 'plane') plane = str(c.values[0], 'plane')
    else if (c.name === 'visible') for (const v of c.values) visible.push(String(v))
    else throw new DslError(`unknown view child \`${c.name}\``)
  }
  return {
    kind: 'view',
    name: str(n.values[0], 'view name'),
    ...(along ? { along } : {}), ...(up ? { up } : {}),
    ...(fit ? { fit } : {}), ...(plane ? { plane } : {}),
    visible,
  }
}

function readComponent(n: KNode): ComponentDef {
  const meta: Record<string, string> = {}
  const params: ComponentParam[] = []
  const ports: ComponentPort[] = []
  const geometry: GeometryDecl[] = []
  const expose: ExposeDecl[] = []
  const constraints: ContributionDecl[] = []
  const nested: InstanceDecl[] = []
  const style: Record<string, string> = {}
  let frame: ComponentDef['frame']
  let label: ComponentDef['label']

  for (const c of n.children) {
    switch (c.name) {
      case 'meta':
        for (const mc of c.children) meta[mc.name] = String(mc.values[0] ?? '')
        break
      case 'param': {
        const p = props(c)
        params.push({
          name: str(c.values[0], 'parameter name'),
          type: p.type ?? 'scalar',
          ...(p.default !== undefined ? { default: p.default } : {}),
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
          ...(c.properties.unknown !== undefined ? { unknown: Boolean(c.properties.unknown) } : {}),
          ...(p.description ? { description: p.description } : {}),
        })
        break
      }
      case 'port': {
        const p = props(c)
        ports.push({
          name: str(c.values[0], 'port name'),
          type: p.type ?? 'point',
          ...(p.role ? { role: p.role } : {}),
          ...(p.accept ? { accept: p.accept } : {}),
        })
        break
      }
      case 'frame': {
        const p = props(c)
        frame = {
          name: str(c.values[0], 'frame name'),
          ...(p.origin ? { origin: p.origin } : {}),
          ...(p.x ? { x: p.x } : {}),
          ...(p.up ? { up: p.up } : {}),
        }
        break
      }
      case 'geometry':
        for (const g of c.children) {
          geometry.push({ op: g.name, name: String(g.values[0] ?? g.name), props: props(g) })
        }
        break
      case 'expose':
        for (const q of c.children) {
          if (q.name !== 'quantity') throw new DslError(`unknown expose child \`${q.name}\``)
          expose.push({ name: str(q.values[0], 'quantity name'), expr: str(q.values[1], 'quantity expression') })
        }
        break
      case 'constraints':
        for (const k of c.children) constraints.push({ op: k.name, props: props(k) })
        break
      case 'instance':
        nested.push(readInstance(c))
        break
      case 'style':
        for (const s of c.children) style[s.name] = String(s.values[0] ?? '')
        break
      case 'label': {
        const p = props(c)
        label = {
          latex: p.latex ?? '',
          ...(p.anchor ? { anchor: p.anchor } : {}),
          ...(p.offset ? { offset: p.offset } : {}),
        }
        break
      }
      default:
        throw new DslError(`unknown component child \`${c.name}\``)
    }
  }
  return {
    path: str(n.values[0], 'component path'),
    version: Number(n.properties.version ?? 1),
    meta, params, ports, geometry, expose, constraints, instances: nested, style,
    ...(frame ? { frame } : {}), ...(label ? { label } : {}),
  }
}

/**
 * Comments preceding each top-level node, recovered by brace-depth scan.
 * Key -1 collects comments that precede the first node (the file header).
 */
function scanComments(source: string): Map<number, string[]> {
  const out = new Map<number, string[]>()
  let depth = 0
  let index = -1
  let pending: string[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (depth === 0 && line.startsWith('//')) { pending.push(line); continue }
    if (depth === 0 && line === '') continue
    if (depth === 0 && line !== '') {
      index++
      if (pending.length) { out.set(index - 1, pending); pending = [] }
    }
    for (const ch of raw) {
      if (ch === '{') depth++
      else if (ch === '}') depth = Math.max(0, depth - 1)
    }
  }
  if (pending.length) out.set(index, pending)
  return out
}

// ---------------------------------------------------------------------------
// Writing: the canonical form

const IND = '  '

function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function numText(x: number): string {
  return Object.is(x, -0) ? '0' : String(x)
}

function line(depth: number, name: string, args: string[], properties: Array<[string, string]>): string {
  const parts = [name, ...args]
  for (const [k, v] of properties) parts.push(`${k}=${v}`)
  return IND.repeat(depth) + parts.join(' ')
}

export function write(doc: Document): string {
  const out: string[] = []
  const header = doc.comments.get(-1)
  if (header) out.push(...header, '')

  out.push(...writeProject(doc.project))

  doc.nodes.forEach((n, i) => {
    const before = doc.comments.get(i)
    out.push('')
    if (before) out.push(...before)
    out.push(...writeNode(n))
  })

  for (const c of doc.components) {
    out.push('')
    out.push(...writeComponent(c))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n'
}

function writeProject(p: ProjectHeader): string[] {
  const out = [line(0, 'project', [q('byrne')], [['version', numText(p.version)]]) + ' {']
  const unitProps = Object.entries(p.units).map(([k, v]) => [k, q(v)] as [string, string])
  out.push(line(1, 'units', [], unitProps))
  out.push(line(1, 'precision', [], [['sig', numText(p.precision)]]))
  for (const lib of p.libraries) out.push(line(1, 'library', [q(lib)], []))
  out.push('}')
  return out
}

function writeNode(n: TopLevel): string[] {
  switch (n.kind) {
    case 'param': {
      const props: Array<[string, string]> = []
      if (n.type) props.push(['type', q(n.type)])
      if (n.init !== undefined) props.push(['init', q(n.init)])
      if (n.range) props.push(['range', q(n.range)])
      if (n.locked !== undefined) props.push(['locked', n.locked ? '#true' : '#false'])
      return [line(0, 'param', [q(n.name), q(n.expr)], props)]
    }
    case 'frame': {
      const props: Array<[string, string]> = []
      if (n.parent) props.push(['parent', q(n.parent)])
      if (n.origin) props.push(['origin', q(n.origin)])
      if (n.axis) props.push(['axis', q(n.axis)])
      if (n.angle) props.push(['angle', q(n.angle)])
      if (n.x) props.push(['x', q(n.x)])
      if (n.up) props.push(['up', q(n.up)])
      return [line(0, 'frame', [q(n.name)], props)]
    }
    case 'instance': {
      const props: Array<[string, string]> = []
      if (n.in) props.push(['in', q(n.in)])
      if (n.at) props.push(['at', q(n.at)])
      const head = line(0, 'instance', [q(n.name), q(n.component)], props)
      const kids: string[] = []
      for (const [k, v] of Object.entries(n.params)) kids.push(line(1, 'param', [q(k), q(v)], []))
      for (const a of n.attach) {
        const ap: Array<[string, string]> = [['port', q(a.port)], ['to', q(a.to)]]
        if (a.at === undefined && a.constraint === undefined) {
          kids.push(line(1, 'attach', [], ap))
        } else {
          kids.push(line(1, 'attach', [], ap) + ' {')
          if (a.constraint) kids.push(line(2, 'constraint', [q(a.constraint)], []))
          if (a.at) kids.push(line(2, 'at', [q(a.at)], []))
          kids.push(IND + '}')
        }
      }
      return kids.length ? [head + ' {', ...kids, '}'] : [head]
    }
    case 'measure': {
      const kids = [line(1, 'of', n.of.map(q), [])]
      if (n.expressIn) kids.push(line(1, 'express-in', [q(n.expressIn)], []))
      if (n.along) kids.push(line(1, 'along', [q(n.along)], []))
      if (n.about) kids.push(line(1, 'about', [q(n.about)], []))
      return [line(0, 'measure', [q(n.name), q(n.op)], []) + ' {', ...kids, '}']
    }
    case 'check': {
      const kids: string[] = []
      if (n.body) kids.push(line(1, 'body', [q(n.body)], []))
      if (n.about) kids.push(line(1, 'about', [q(n.about)], []))
      if (n.directions) kids.push(line(1, 'directions', n.directions.map(q), []))
      if (n.tolerance) kids.push(line(1, 'tolerance', [q(n.tolerance)], []))
      const head = line(0, 'check', [q(n.name), q(n.op)], [])
      return kids.length ? [head + ' {', ...kids, '}'] : [head]
    }
    case 'constraint': {
      const props: Array<[string, string]> = n.value ? [['value', q(n.value)]] : []
      return [line(0, 'constraint', [q(n.name), q(n.op), ...n.operands.map(q)], props)]
    }
    case 'label': {
      const props: Array<[string, string]> = [['latex', q(n.latex)]]
      if (n.anchor) props.push(['anchor', q(n.anchor)])
      if (n.offset) props.push(['offset', q(n.offset)])
      return [line(0, 'label', [q(n.target)], props)]
    }
    case 'style': {
      const kids = Object.entries(n.props).map(([k, v]) => line(1, k, [q(v)], []))
      return [line(0, 'style', [q(n.selector)], []) + ' {', ...kids, '}']
    }
    case 'view': {
      const cam: Array<[string, string]> = []
      if (n.along) cam.push(['along', q(n.along)])
      if (n.up) cam.push(['up', q(n.up)])
      if (n.fit) cam.push(['fit', q(n.fit)])
      const kids: string[] = []
      if (cam.length) kids.push(line(1, 'camera', [], cam))
      if (n.plane) kids.push(line(1, 'plane', [q(n.plane)], []))
      if (n.visible.length) kids.push(line(1, 'visible', n.visible.map(q), []))
      return [line(0, 'view', [q(n.name)], []) + ' {', ...kids, '}']
    }
  }
}

function writeComponent(c: ComponentDef): string[] {
  const out = [line(0, 'component', [q(c.path)], [['version', numText(c.version)]]) + ' {']
  if (Object.keys(c.meta).length) {
    out.push(IND + 'meta {')
    for (const [k, v] of Object.entries(c.meta)) out.push(line(2, k, [q(v)], []))
    out.push(IND + '}')
  }
  for (const p of c.params) {
    const props: Array<[string, string]> = [['type', q(p.type)]]
    if (p.default !== undefined) props.push(['default', q(p.default)])
    if (p.min !== undefined) props.push(['min', q(p.min)])
    if (p.max !== undefined) props.push(['max', q(p.max)])
    if (p.unknown !== undefined) props.push(['unknown', p.unknown ? '#true' : '#false'])
    if (p.description) props.push(['description', q(p.description)])
    out.push(line(1, 'param', [q(p.name)], props))
  }
  for (const p of c.ports) {
    const props: Array<[string, string]> = [['type', q(p.type)]]
    if (p.role) props.push(['role', q(p.role)])
    if (p.accept) props.push(['accept', q(p.accept)])
    out.push(line(1, 'port', [q(p.name)], props))
  }
  if (c.frame) {
    const props: Array<[string, string]> = []
    if (c.frame.origin) props.push(['origin', q(c.frame.origin)])
    if (c.frame.x) props.push(['x', q(c.frame.x)])
    if (c.frame.up) props.push(['up', q(c.frame.up)])
    out.push(line(1, 'frame', [q(c.frame.name)], props))
  }
  if (c.geometry.length) {
    out.push(IND + 'geometry {')
    for (const g of c.geometry) {
      out.push(line(2, g.op, [q(g.name)], Object.entries(g.props).map(([k, v]) => [k, q(v)] as [string, string])))
    }
    out.push(IND + '}')
  }
  if (c.expose.length) {
    out.push(IND + 'expose {')
    for (const e of c.expose) out.push(line(2, 'quantity', [q(e.name), q(e.expr)], []))
    out.push(IND + '}')
  }
  if (c.constraints.length) {
    out.push(IND + 'constraints {')
    for (const k of c.constraints) {
      out.push(line(2, k.op, [], Object.entries(k.props).map(([a, b]) => [a, q(b)] as [string, string])))
    }
    out.push(IND + '}')
  }
  for (const nestedInst of c.instances) {
    for (const ln of writeNode(nestedInst)) out.push(ln === '' ? '' : IND + ln)
  }
  if (Object.keys(c.style).length) {
    out.push(IND + 'style {')
    for (const [k, v] of Object.entries(c.style)) out.push(line(2, k, [q(v)], []))
    out.push(IND + '}')
  }
  if (c.label) {
    const props: Array<[string, string]> = [['latex', q(c.label.latex)]]
    if (c.label.anchor) props.push(['anchor', q(c.label.anchor)])
    if (c.label.offset) props.push(['offset', q(c.label.offset)])
    out.push(line(1, 'label', [], props))
  }
  out.push('}')
  return out
}
