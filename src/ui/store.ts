import { create } from 'zustand'
import { ComponentDef, write } from '../core/dsl.js'
import { loadLibrary } from '../core/library.js'
import { WORLD } from '../core/frame.js'
import { Axis, DEFAULT_AXIS, axisView } from './view.js'
import { Built, Operation, OpContext, applyOperation, rebuild } from './model.js'

// The shipped library and the examples are bundled: there is no network call, no account,
// and no registry. Opening the application offline gives the whole product.
const LIBRARY_SOURCES = import.meta.glob('/library/**/*.kdl', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

export const EXAMPLES = import.meta.glob('/examples/*.byrne', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

export const LIBRARY: ReadonlyMap<string, ComponentDef> = loadLibrary(Object.values(LIBRARY_SOURCES))

export type SnapMode = 'off' | 'grid' | 'angle'
export type Mode = '2d' | '3d'
export type Theme = 'light' | 'dark'

export interface UiState {
  built: Built
  selection: string[]
  past: string[]
  future: string[]
  /** The four modes that must always be visible and changeable (design doc, §7.1). */
  activeFrame: string
  activePlane: 'xy' | 'yz' | 'zx'
  /**
   * 2D is a LOCKED VIEW, not a separate application: the camera is fixed down an axis and
   * input is constrained to the active construction plane. Every 2D diagram here is a 3D
   * scene the user chose not to rotate, and most never will -- so this is the default.
   */
  mode: Mode
  viewAxis: Axis
  theme: Theme
  snap: SnapMode
  gridStep: number
  showSource: boolean
  showGrid: boolean
  showAxes: boolean
  showLabels: boolean
  paletteOpen: boolean
  cursorWorld: [number, number, number] | null
  message: string | null

  run<A>(op: Operation<A>, args: A): void
  setSource(source: string, record?: boolean): void
  select(name: string | null, additive?: boolean): void
  undo(): void
  redo(): void
  set<K extends keyof UiState>(key: K, value: UiState[K]): void
  loadExample(path: string): void
}

const FIRST = Object.entries(EXAMPLES)
  .sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[1] ?? 'project "byrne" version=1 {\n  units length="m"\n}\n'

export const useStore = create<UiState>((setState, get) => ({
  built: rebuild(FIRST, LIBRARY),
  selection: [],
  past: [],
  future: [],
  activeFrame: WORLD,
  activePlane: axisView(DEFAULT_AXIS).plane,
  mode: '2d',
  viewAxis: DEFAULT_AXIS,
  theme: 'light',
  snap: 'grid',
  gridStep: 0.1,
  showSource: false,
  showGrid: true,
  showAxes: true,
  showLabels: true,
  paletteOpen: false,
  cursorWorld: null,
  message: null,

  run(op, args) {
    const { built } = get()
    const ctx: OpContext = { doc: built.doc, scene: built.scene, library: LIBRARY }
    try {
      const next = applyOperation(ctx, op, args)
      setState((s) => ({
        past: [...s.past, s.built.source].slice(-200),
        future: [],
        built: rebuild(next, LIBRARY),
        message: null,
      }))
    } catch (e) {
      setState({ message: `${op.title}: ${(e as Error).message}` })
    }
  },

  setSource(source, record = true) {
    setState((s) => ({
      past: record ? [...s.past, s.built.source].slice(-200) : s.past,
      future: record ? [] : s.future,
      built: rebuild(source, LIBRARY),
    }))
  },

  select(name, additive = false) {
    setState((s) => {
      if (name === null) return { selection: [] }
      if (!additive) return { selection: [name] }
      return {
        selection: s.selection.includes(name)
          ? s.selection.filter((n) => n !== name)
          : [...s.selection, name],
      }
    })
  },

  undo() {
    setState((s) => {
      const prev = s.past[s.past.length - 1]
      if (prev === undefined) return {}
      return {
        past: s.past.slice(0, -1),
        future: [s.built.source, ...s.future].slice(0, 200),
        built: rebuild(prev, LIBRARY),
      }
    })
  },

  redo() {
    setState((s) => {
      const next = s.future[0]
      if (next === undefined) return {}
      return {
        past: [...s.past, s.built.source],
        future: s.future.slice(1),
        built: rebuild(next, LIBRARY),
      }
    })
  },

  set(key, value) {
    setState({ [key]: value } as Partial<UiState>)
    // The view axis and the construction plane are one fact (src/ui/view.ts); setting
    // either alone is how a viewport starts lying about which plane you are drawing on.
    if (key === 'viewAxis') setState({ activePlane: axisView(value as Axis).plane })
    if (key === 'theme' && typeof document !== 'undefined') {
      document.documentElement.dataset.theme = value as Theme
    }
  },

  loadExample(path) {
    const src = EXAMPLES[path]
    if (!src) return
    setState((s) => ({
      past: [...s.past, s.built.source],
      future: [],
      built: rebuild(src, LIBRARY),
      selection: [],
      message: null,
    }))
  },
}))

/** Canonical source, for the text panel and for saving. */
export const canonicalSource = (built: Built): string => {
  try { return write(built.doc) } catch { return built.source }
}
