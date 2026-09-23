// Component authoring: extraction from a construction, and definition edits.
//
// Extraction INFERS and then offers the inference for editing. It never applies silently,
// because a wrong inferred port is worse than no inference: the user cannot see what was
// guessed once it has become a definition.
//
// A definition edit keeps every explicit per-instance override and reports, field by
// field, what changed for whom. A destructive change (a parameter or port that some
// instance is using disappears) is refused unless it is confirmed.

import {
  ComponentDef, ComponentParam, ComponentPort, Document, ExposeDecl, InstanceDecl,
  MeasureDecl, ParamDecl, TopLevel,
} from './dsl.js'
import { parse } from './expr.js'

export class ComponentError extends Error {}

export interface Inference {
  readonly def: ComponentDef
  /** What was guessed and why, one line each. Shown in the form before committing. */
  readonly notes: readonly string[]
}

const BUILTIN_NAMES = new Set(['world', 't'])

/**
 * Propose a component from a selection of top-level node names.
 *
 *  * PARAMETERS are the free names the selection reads but does not define.
 *  * NESTED INSTANCES are the selected instances, carried in whole.
 *  * EXPOSED QUANTITIES are the selected measures, plus anything referenced from outside
 *    the selection.
 *  * PORTS are the reference parameters that point out of the selection.
 */
export function proposeComponent(
  doc: Document, selection: readonly string[], path: string,
): Inference {
  const chosen = new Set(selection)
  const nodes = doc.nodes.filter((n) => chosen.has(nameOf(n)))
  if (!nodes.length) throw new ComponentError('nothing selected')

  const defined = new Set(nodes.map(nameOf))
  const notes: string[] = []

  // Every expression the selection contains, with the node it came from.
  const sources: Array<{ owner: string; src: string }> = []
  for (const n of nodes) for (const src of expressionsOf(n)) sources.push({ owner: nameOf(n), src })

  const free = new Map<string, string>()   // name -> the expression that first read it
  for (const { src } of sources) {
    let refs: readonly string[]
    try { refs = parse(src).refs } catch { continue }
    for (const r of refs) {
      const head = r.split('.')[0]!
      if (defined.has(head) || BUILTIN_NAMES.has(head)) continue
      if (!free.has(head)) free.set(head, src)
    }
  }

  // A free name that the document declares as a param becomes a parameter with that
  // param's own type and current value as the default; anything else becomes a ref.
  const docParams = new Map(
    doc.nodes.filter((n): n is ParamDecl => n.kind === 'param').map((p) => [p.name, p]),
  )
  const params: ComponentParam[] = []
  const ports: ComponentPort[] = []
  for (const [name, src] of [...free].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const p = docParams.get(name)
    if (p) {
      params.push({
        name, type: p.type ?? 'scalar',
        ...(p.expr !== '?' ? { default: p.expr } : {}),
        ...(p.init !== undefined ? { default: p.init } : {}),
      })
      notes.push(`\`${name}\` became a parameter: read by \`${src}\`, declared as ${p.type ?? 'scalar'}.`)
    } else {
      params.push({ name, type: 'ref' })
      ports.push({ name, type: 'point', role: 'in', accept: 'is-point(x)' })
      notes.push(`\`${name}\` became a reference parameter and a port: read by \`${src}\` but not declared in the selection.`)
    }
  }

  const expose: ExposeDecl[] = []
  for (const n of nodes) {
    if (n.kind === 'measure') {
      expose.push({ name: n.name, expr: measureAsExpression(n) })
      notes.push(`\`${n.name}\` is exposed: a measure inside the selection.`)
    }
  }
  // Anything outside the selection reads from inside it must also be exposed.
  for (const n of doc.nodes) {
    if (chosen.has(nameOf(n))) continue
    for (const src of expressionsOf(n)) {
      let refs: readonly string[]
      try { refs = parse(src).refs } catch { continue }
      for (const r of refs) {
        const head = r.split('.')[0]!
        if (!defined.has(head)) continue
        const tail = r.slice(head.length + 1)
        const exposedName = tail || head
        if (expose.some((e) => e.name === exposedName)) continue
        expose.push({ name: exposedName, expr: r })
        notes.push(`\`${exposedName}\` is exposed: \`${nameOf(n)}\` reads it from outside the selection.`)
      }
    }
  }

  const instances = nodes.filter((n): n is InstanceDecl => n.kind === 'instance')

  const def: ComponentDef = {
    path,
    version: 1,
    meta: {
      title: titleOf(path),
      category: 'Authored',
      description: `Extracted from ${instances.map((i) => i.name).join(', ') || selection.join(', ')}.`,
    },
    params, ports,
    geometry: [],
    expose,
    constraints: [],
    instances,
    style: {},
  }
  return { def, notes }
}

function titleOf(path: string): string {
  const last = path.split('/').pop() ?? path
  return last.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function nameOf(n: TopLevel): string {
  return n.kind === 'label' ? n.target : n.kind === 'style' ? n.selector : n.name
}

function expressionsOf(n: TopLevel): string[] {
  switch (n.kind) {
    case 'param': return [n.expr, ...(n.init ? [n.init] : [])].filter((s) => s !== '?')
    case 'frame': return [n.origin, n.axis, n.angle, n.x, n.up].filter((s): s is string => !!s)
    case 'instance': return [...Object.values(n.params), ...(n.at ? [n.at] : []),
      ...n.attach.flatMap((a) => [a.at].filter((s): s is string => !!s))]
    case 'measure': return [...n.of, ...(n.along ? [n.along] : []), ...(n.about ? [n.about] : [])]
    case 'check': return [...(n.body ? [n.body] : []), ...(n.directions ?? [])]
    case 'constraint': return [...n.operands, ...(n.value ? [n.value] : [])]
    default: return []
  }
}

function measureAsExpression(m: MeasureDecl): string {
  switch (m.op) {
    case 'expression': return m.of[0] ?? '0'
    case 'resultant': return m.of.join(' + ')
    case 'magnitude': return `norm(${m.of[0]})`
    case 'component': return `component(${m.of[0]}, ${m.along})`
    case 'difference': return `${m.of[0]} - ${m.of[1]}`
    default: throw new ComponentError(
      `measure \`${m.name}\`: \`${m.op}\` has no expression form, so it cannot be extracted yet`,
    )
  }
}

// ---------------------------------------------------------------------------
// Definition edits

export interface FieldChange {
  readonly instance: string
  readonly field: string
  readonly from: string
  readonly to: string
  readonly provenance: 'inherited' | 'overridden'
}

export interface DefinitionDiff {
  readonly changes: readonly FieldChange[]
  /** Parameters or ports that instances still use but the new definition removes. */
  readonly destructive: readonly string[]
}

/**
 * What changes for which instances if `next` replaces `prev`.
 * Overridden fields are listed with their provenance and are NOT changed.
 */
export function definitionDiff(
  doc: Document, prev: ComponentDef, next: ComponentDef,
): DefinitionDiff {
  const changes: FieldChange[] = []
  const destructive = new Set<string>()
  const users = doc.nodes.filter(
    (n): n is InstanceDecl => n.kind === 'instance' && n.component === prev.path,
  )
  const nextParams = new Map(next.params.map((p) => [p.name, p]))

  for (const inst of users) {
    for (const p of prev.params) {
      const np = nextParams.get(p.name)
      const overridden = inst.params[p.name] !== undefined
      if (!np) {
        if (overridden) destructive.add(p.name)
        changes.push({
          instance: inst.name, field: p.name, from: p.default ?? '', to: '(removed)',
          provenance: overridden ? 'overridden' : 'inherited',
        })
        continue
      }
      if (overridden) {
        // An override stands. It is still listed, so the user can see it survived.
        changes.push({
          instance: inst.name, field: p.name,
          from: inst.params[p.name]!, to: inst.params[p.name]!, provenance: 'overridden',
        })
      } else if ((p.default ?? '') !== (np.default ?? '')) {
        changes.push({
          instance: inst.name, field: p.name,
          from: p.default ?? '', to: np.default ?? '', provenance: 'inherited',
        })
      }
    }
  }
  for (const port of prev.ports) {
    if (!next.ports.some((q) => q.name === port.name)) destructive.add(`port ${port.name}`)
  }
  return { changes, destructive: [...destructive] }
}

/**
 * Replace a definition. Refuses a destructive change unless `confirm` is set; the caller
 * shows `diff` first. There is no half-applied state: either the whole edit lands or none
 * of it does.
 */
export function editDefinition(
  doc: Document, library: ReadonlyMap<string, ComponentDef>,
  next: ComponentDef, confirm = false,
): { library: Map<string, ComponentDef>; diff: DefinitionDiff } {
  const prev = library.get(next.path)
  if (!prev) throw new ComponentError(`no component \`${next.path}\` to edit`)
  const diff = definitionDiff(doc, prev, next)
  if (diff.destructive.length && !confirm) {
    throw new ComponentError(
      `this edit removes ${diff.destructive.join(', ')}, which instances are using; ` +
      `confirm to apply`,
    )
  }
  const out = new Map(library)
  out.set(next.path, { ...next, version: prev.version + 1 })
  return { library: out, diff }
}

/** Replace the selected nodes with one instance of the extracted component. */
export function applyExtraction(
  doc: Document, inference: Inference, selection: readonly string[], instanceName: string,
): { doc: Document; library: ComponentDef } {
  const chosen = new Set(selection)
  const kept = doc.nodes.filter((n) => !chosen.has(nameOf(n)))
  const inst: InstanceDecl = {
    kind: 'instance',
    name: instanceName,
    component: inference.def.path,
    params: Object.fromEntries(
      inference.def.params.map((p) => [p.name, p.type === 'ref' ? p.name : p.name]),
    ),
    overrides: [],
    attach: [],
  }
  return {
    doc: { ...doc, nodes: [...kept, inst] },
    library: inference.def,
  }
}
