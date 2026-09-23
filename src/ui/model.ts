// The UI's view of the model: the document source, the built scene, and an operation log.
//
// NOTHING in the interface mutates the model directly. Every change is a named OPERATION
// with an inverse, which buys four things from one mechanism:
//
//   1. Undo and redo are the log walked backwards and forwards.
//   2. The command palette is a listing of this registry, so it cannot drift from what
//      the application can actually do.
//   3. A drag is a begin/update/commit triple over the same code path as typing in a
//      field, so the handle and the field cannot diverge -- they are one control.
//   4. Every interaction script in the design document is executable headlessly as a
//      list of operations.

import { Document, InstanceDecl, ParamDecl, TopLevel, read, write } from '../core/dsl.js'
import { ComponentDef } from '../core/dsl.js'
import { Scene, build } from '../core/scene.js'
import { withLocal } from '../core/library.js'
import { proposeComponent } from '../core/component.js'

export interface Built {
  readonly source: string
  readonly doc: Document
  readonly scene: Scene | null
  readonly error: string | null
}

export function rebuild(source: string, library: ReadonlyMap<string, ComponentDef>): Built {
  try {
    const doc = read(source)
    const scene = build(doc, withLocal(library, doc.components))
    return { source, doc, scene, error: null }
  } catch (e) {
    let doc: Document
    try { doc = read(source) } catch { doc = { project: { version: 1, units: {}, precision: 6, libraries: [] }, nodes: [], components: [], comments: new Map() } }
    return { source, doc, scene: null, error: (e as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Operations

export interface OpContext {
  readonly doc: Document
  readonly scene: Scene | null
  readonly library: ReadonlyMap<string, ComponentDef>
}

export interface Operation<A = unknown> {
  readonly id: string
  readonly title: string
  readonly shortcut?: string
  readonly group: 'edit' | 'create' | 'view' | 'export' | 'component'
  /** Whether this operation can run in the current state; the palette greys it out. */
  enabled?(ctx: OpContext, args: A): boolean
  apply(ctx: OpContext, args: A): Document
}

const registry = new Map<string, Operation<never>>()

export function register<A>(op: Operation<A>): Operation<A> {
  registry.set(op.id, op as Operation<never>)
  return op
}

export function operations(): Operation<never>[] {
  return [...registry.values()]
}

export function operation(id: string): Operation<never> {
  const op = registry.get(id)
  if (!op) throw new Error(`no such operation \`${id}\``)
  return op
}

/**
 * Replace one node, matched by KIND and name. A label carries the name of the thing it
 * labels, so matching on name alone would turn `label "theta"` into a second parameter
 * called theta -- which the scene then rejects as a duplicate, correctly and confusingly.
 */
const replaceNode = (doc: Document, kind: TopLevel['kind'], name: string, next: TopLevel): Document => ({
  ...doc,
  nodes: doc.nodes.map((n) => (n.kind === kind && nodeName(n) === name ? next : n)),
})

export function nodeName(n: TopLevel): string {
  return n.kind === 'label' ? n.target : n.kind === 'style' ? n.selector : n.name
}

// -- the registry ------------------------------------------------------------

export const setParameter = register<{ name: string; expr: string }>({
  id: 'set-parameter',
  title: 'Set parameter',
  group: 'edit',
  apply(ctx, { name, expr }) {
    const dot = name.lastIndexOf('.')
    if (dot < 0) {
      const p = ctx.doc.nodes.find((n): n is ParamDecl => n.kind === 'param' && n.name === name)
      if (!p) throw new Error(`no parameter \`${name}\``)
      return replaceNode(ctx.doc, 'param', name, { ...p, expr })
    }
    const owner = name.slice(0, dot)
    const field = name.slice(dot + 1)
    const inst = ctx.doc.nodes.find((n): n is InstanceDecl => n.kind === 'instance' && n.name === owner)
    if (!inst) throw new Error(`no instance \`${owner}\``)
    return replaceNode(ctx.doc, 'instance', owner, {
      ...inst,
      params: { ...inst.params, [field]: expr },
      overrides: inst.overrides.includes(field) ? inst.overrides : [...inst.overrides, field],
    })
  },
})

export const clearOverride = register<{ instance: string; field: string }>({
  id: 'clear-override',
  title: 'Revert to definition default',
  group: 'edit',
  apply(ctx, { instance, field }) {
    const inst = ctx.doc.nodes.find((n): n is InstanceDecl => n.kind === 'instance' && n.name === instance)
    if (!inst) throw new Error(`no instance \`${instance}\``)
    const params = { ...inst.params }
    delete params[field]
    return replaceNode(ctx.doc, 'instance', instance, {
      ...inst, params, overrides: inst.overrides.filter((o) => o !== field),
    })
  },
})

export const instantiate = register<{ component: string; name?: string; at?: string; params?: Record<string, string> }>({
  id: 'instantiate',
  title: 'Place component',
  group: 'create',
  apply(ctx, { component, name, at, params }) {
    const def = ctx.library.get(component)
    if (!def) throw new Error(`no component \`${component}\``)
    const base = name ?? shortName(component)
    const unique = uniqueName(ctx.doc, base)
    const initial: Record<string, string> = { ...(params ?? {}) }
    if (at && def.params.some((p) => p.name === 'at')) initial.at = at
    if (at && def.params.some((p) => p.name === 'center') && !initial.center) initial.center = at
    const inst: InstanceDecl = {
      kind: 'instance', name: unique, component,
      params: initial, overrides: Object.keys(initial), attach: [],
    }
    return { ...ctx.doc, nodes: [...ctx.doc.nodes, inst] }
  },
})

export const addParameter = register<{ name?: string; expr: string; type?: string }>({
  id: 'add-parameter',
  title: 'Add parameter',
  shortcut: 'p',
  group: 'create',
  apply(ctx, { name, expr, type }) {
    const p: ParamDecl = {
      kind: 'param', name: uniqueName(ctx.doc, name ?? 'p'), expr,
      ...(type ? { type } : {}),
    }
    return { ...ctx.doc, nodes: [...ctx.doc.nodes, p] }
  },
})

export const deleteObject = register<{ name: string }>({
  id: 'delete-object',
  title: 'Delete',
  shortcut: 'Delete',
  group: 'edit',
  apply(ctx, { name }) {
    return { ...ctx.doc, nodes: ctx.doc.nodes.filter((n) => nodeName(n) !== name) }
  },
})

export const renameObject = register<{ from: string; to: string }>({
  id: 'rename-object',
  title: 'Rename',
  shortcut: 'F2',
  group: 'edit',
  apply(ctx, { from, to }) {
    const text = write(ctx.doc)
    const renamed = text.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'g'), to)
    return read(renamed)
  },
})

export const reexpressIn = register<{ target: string; frame: string }>({
  id: 'reexpress-in',
  title: 'Re-express in frame',
  group: 'create',
  apply(ctx, { target, frame }) {
    // Creates a NEW named object. Nothing mutates, which is the whole rule about frames.
    return {
      ...ctx.doc,
      nodes: [...ctx.doc.nodes, {
        kind: 'measure' as const,
        name: uniqueName(ctx.doc, `${target.replace(/\./g, '_')}_in_${frame.replace(/\./g, '_')}`),
        op: 'expression', of: [target], expressIn: frame,
      }],
    }
  },
})

export const sumVectors = register<{ of: string[]; frame?: string }>({
  id: 'sum-vectors',
  title: 'Resultant of selection',
  group: 'create',
  apply(ctx, { of, frame }) {
    return {
      ...ctx.doc,
      nodes: [...ctx.doc.nodes, {
        kind: 'measure' as const,
        name: uniqueName(ctx.doc, 'resultant'),
        op: 'resultant', of, ...(frame ? { expressIn: frame } : {}),
      }],
    }
  },
})

export const addEquilibrium = register<{ body: string; directions?: string[] }>({
  id: 'add-equilibrium',
  title: 'Equilibrium check on body',
  group: 'create',
  apply(ctx, { body, directions }) {
    const dirs = directions ?? ['world.x', 'world.y', 'world.z']
    const nodes: TopLevel[] = [...ctx.doc.nodes]
    // The check MEASURES; the constraints are what impose it. Both are added, so the
    // document says plainly what is being solved for.
    for (const d of dirs) {
      nodes.push({
        kind: 'constraint', name: uniqueName({ ...ctx.doc, nodes }, `balance_${d.split('.').pop()}`),
        op: 'residual', operands: [`dot(${body}.netforce, ${d})`], value: '1e-12 N',
      })
    }
    nodes.push({
      kind: 'check', name: uniqueName({ ...ctx.doc, nodes }, `${body}_balance`),
      op: 'equilibrium', body, tolerance: '1e-9 N', directions: dirs,
    })
    return { ...ctx.doc, nodes }
  },
})

export const extractComponent = register<{ selection: string[]; path: string }>({
  id: 'extract-component',
  title: 'Extract component from selection',
  shortcut: 'Ctrl+E',
  group: 'component',
  apply(ctx, { selection, path }) {
    const inf = proposeComponent(ctx.doc, selection, path)
    // The inference is offered, not applied: the definition is added to the document so
    // the user can see and edit it, and the construction is left standing.
    return { ...ctx.doc, components: [...ctx.doc.components, inf.def] }
  },
})

export const setProjectUnit = register<{ dimension: string; unit: string }>({
  id: 'set-project-unit',
  title: 'Set project unit',
  group: 'view',
  apply(ctx, { dimension, unit }) {
    return {
      ...ctx.doc,
      project: { ...ctx.doc.project, units: { ...ctx.doc.project.units, [dimension]: unit } },
    }
  },
})

export const setPrecision = register<{ sig: number }>({
  id: 'set-precision',
  title: 'Set display precision',
  group: 'view',
  apply(ctx, { sig }) {
    return { ...ctx.doc, project: { ...ctx.doc.project, precision: sig } }
  },
})

// -- helpers -----------------------------------------------------------------

function shortName(component: string): string {
  const last = component.split('/').pop() ?? component
  return last.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase()).replace(/-/g, '')
}

export function uniqueName(doc: Document, base: string): string {
  const taken = new Set(doc.nodes.map(nodeName))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Apply an operation and return the new SOURCE. The log stores sources; documents are small. */
export function applyOperation<A>(
  ctx: OpContext, op: Operation<A>, args: A,
): string {
  return write(op.apply(ctx, args))
}
