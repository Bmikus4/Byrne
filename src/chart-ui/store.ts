import { create } from 'zustand'
import { ChartDoc, Obj, ObjType, Vec, newId, normalize, translate } from '../chart/model.js'
import { chartThree } from '../chart/templates.js'

export type Tool = 'select' | 'arrow' | 'wavy' | ObjType

export interface View {
  /** Figure point at the top-left of the canvas, and screen pixels per point. */
  ox: number
  oy: number
  zoom: number
}

interface State {
  doc: ChartDoc
  selection: string[]
  tool: Tool
  view: View
  past: ChartDoc[]
  future: ChartDoc[]
  /** Last history key and when it was written, so typing in a field is one undo step. */
  lastKey: string
  lastAt: number
  time: number
  playing: boolean
  dialog: 'templates' | 'help' | null
  cursor: Vec | null
  clipboard: Obj[]
  /** Set when the canvas wants the inspector to put the caret in a text field. */
  focusText: number
  /** Bumped to ask the canvas to fit the drawing to the window. */
  fitAt: number

  /** Change the document. `key` coalesces rapid edits of the same thing into one undo step. */
  edit: (f: (d: ChartDoc) => ChartDoc, key?: string) => void
  /** Change objects by id. */
  update: (ids: readonly string[], f: (o: Obj) => Obj, key?: string) => void
  add: (o: Obj | Obj[], select?: boolean) => void
  remove: (ids: readonly string[]) => void
  select: (ids: string[]) => void
  setTool: (t: Tool) => void
  setView: (v: Partial<View>) => void
  undo: () => void
  redo: () => void
  load: (d: ChartDoc) => void
  set: <K extends keyof State>(k: K, v: State[K]) => void
  /** Push the current document onto history now, before a drag that will edit silently. */
  checkpoint: () => void
  /** Edit without touching history (the drag in progress; checkpoint came first). */
  silent: (f: (d: ChartDoc) => ChartDoc) => void
}

const KEY = 'byrne-chart-doc-v1'

function initialDoc(): ChartDoc {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return normalize(JSON.parse(raw))
  } catch { /* storage blocked or the saved copy is unreadable: start from the template */ }
  return chartThree()
}

const LIMIT = 300

export const useChart = create<State>()((setState, get) => ({
  doc: initialDoc(),
  selection: [],
  tool: 'select',
  view: { ox: -420, oy: -260, zoom: 1.4 },
  past: [],
  future: [],
  lastKey: '',
  lastAt: 0,
  time: 0,
  playing: false,
  dialog: null,
  cursor: null,
  clipboard: [],
  focusText: 0,
  fitAt: 1,

  edit: (f, key = '') => {
    const s = get()
    const now = Date.now()
    const coalesce = key !== '' && key === s.lastKey && now - s.lastAt < 1200
    const next = f(s.doc)
    if (next === s.doc) return
    setState({
      doc: next,
      past: coalesce ? s.past : [...s.past.slice(-LIMIT), s.doc],
      future: [],
      lastKey: key,
      lastAt: now,
    })
  },
  update: (ids, f, key) => {
    const set = new Set(ids)
    get().edit((d) => ({ ...d, objects: d.objects.map((o) => (set.has(o.id) ? f(o) : o)) }), key)
  },
  add: (o, select = true) => {
    const list = Array.isArray(o) ? o : [o]
    get().edit((d) => ({ ...d, objects: [...d.objects, ...list] }))
    if (select) setState({ selection: list.map((x) => x.id) })
  },
  remove: (ids) => {
    const set = new Set(ids)
    get().edit((d) => ({ ...d, objects: d.objects.filter((o) => !set.has(o.id)) }))
    setState({ selection: get().selection.filter((id) => !set.has(id)) })
  },
  select: (ids) => setState({ selection: ids }),
  setTool: (t) => setState({ tool: t }),
  setView: (v) => setState({ view: { ...get().view, ...v } }),
  undo: () => {
    const s = get()
    const prev = s.past[s.past.length - 1]
    if (!prev) return
    setState({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], lastKey: '' })
  },
  redo: () => {
    const s = get()
    const next = s.future[0]
    if (!next) return
    setState({ doc: next, past: [...s.past, s.doc], future: s.future.slice(1), lastKey: '' })
  },
  load: (d) => {
    const s = get()
    setState({ doc: d, selection: [], past: [...s.past.slice(-LIMIT), s.doc], future: [], lastKey: '', time: 0, playing: false, fitAt: Date.now() })
  },
  set: (k, v) => setState({ [k]: v } as Partial<State>),
  checkpoint: () => {
    const s = get()
    setState({ past: [...s.past.slice(-LIMIT), s.doc], future: [], lastKey: '' })
  },
  silent: (f) => setState({ doc: f(get().doc) }),
}))

// Dev builds expose the store so a browser driver can read where things are.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__chart = useChart

// Autosave. The page is the document's home between sessions; Save writes a file.
let saveTimer: ReturnType<typeof setTimeout> | undefined
useChart.subscribe((s, prev) => {
  if (s.doc === prev.doc) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s.doc)) } catch { /* full or blocked */ }
  }, 400)
})

/** Copies of objects with fresh ids, offset so a paste is visibly a new thing. */
export function duplicates(objs: readonly Obj[], offset: Vec = [0.5, -0.5]): Obj[] {
  return objs.map((o) => ({ ...translate(structuredClone(o), offset), id: newId() }))
}

export const selected = (s: { doc: ChartDoc; selection: string[] }): Obj[] =>
  s.doc.objects.filter((o) => s.selection.includes(o.id))
