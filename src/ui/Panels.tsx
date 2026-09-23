// The left palette, the right column (outliner + inspector), the bottom strip, the
// command palette and the source panel.
//
// The palette makes no distinction between shipped and authored components, because
// there is none: both are entries in the same library map, loaded from the same DSL.

import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ComponentDef } from '../core/dsl.js'
import { Scene, reported, numberOf } from '../core/scene.js'
import { displayUnit, formatNumber, formatScalar, unit } from '../core/units.js'
import { dimName, dimToString, isDimless } from '../core/dimension.js'
import { projectScene } from '../figure/project.js'
import { toSvg } from '../figure/svg.js'
import { toTikz } from '../figure/tikz.js'
import { LIBRARY, EXAMPLES, canonicalSource, useStore } from './store.js'
import { AXES, Axis, axisView } from './view.js'
import {
  addEquilibrium, clearOverride, deleteObject, extractComponent, instantiate,
  nodeName, operations, setParameter, setProjectUnit, sumVectors, reexpressIn,
} from './model.js'
import { NumericField } from './NumericField.js'

// ---------------------------------------------------------------------------

export function Palette(): JSX.Element {
  const [query, setQuery] = useState('')
  const run = useStore((s) => s.run)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<string, ComponentDef[]>()
    for (const def of LIBRARY.values()) {
      const hay = `${def.path} ${def.meta.title ?? ''} ${def.meta.description ?? ''}`.toLowerCase()
      if (q && !hay.includes(q)) continue
      const cat = def.meta.category ?? 'Other'
      byCategory.set(cat, [...(byCategory.get(cat) ?? []), def])
    }
    return [...byCategory].sort(([a], [b]) => (a < b ? -1 : 1))
  }, [query])

  return (
    <aside className="palette">
      <input
        className="search"
        placeholder="Search components"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      <div className="palette-scroll">
        {groups.map(([cat, defs]) => (
          <div key={cat} className="palette-group">
            <div className="palette-cat">{cat}</div>
            {defs.map((def) => (
              <div
                key={def.path}
                className="palette-item"
                draggable
                title={def.meta.description}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-byrne-component', def.path)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDoubleClick={() => run(instantiate, { component: def.path })}
              >
                <span className="palette-name">{def.meta.title ?? def.path}</span>
                <span className="palette-path">{def.path.split('/')[0]}</span>
              </div>
            ))}
          </div>
        ))}
        {!groups.length && <div className="empty">nothing matches</div>}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

export function Outliner(): JSX.Element {
  const built = useStore((s) => s.built)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return built.doc.nodes
      .map((n) => ({ name: nodeName(n), kind: n.kind, node: n }))
      .filter((r) => !f || r.name.toLowerCase().includes(f) || r.kind.includes(f))
  }, [built.doc, filter])

  const scene = built.scene

  return (
    <section className="panel outliner">
      <header className="panel-head">
        <span>Outliner</span>
        <input
          className="filter"
          placeholder="filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
      </header>
      <div className="panel-scroll">
        {rows.map((r) => (
          <div
            key={`${r.kind}:${r.name}`}
            className={`row${selection.includes(r.name) ? ' sel' : ''}`}
            onClick={(e) => select(r.name, e.shiftKey || e.metaKey || e.ctrlKey)}
          >
            <span className={`kind kind-${r.kind}`}>{r.kind}</span>
            <span className="row-name">{r.name}</span>
            <span className="row-value">{scene ? quickValue(scene, r.name) : ''}</span>
          </div>
        ))}
        {!rows.length && <div className="empty">no objects</div>}
      </div>
    </section>
  )
}

function quickValue(scene: Scene, name: string): string {
  const v = scene.names.get(name)
  if (!v) {
    const d = scene.deferred.find((x) => x.name === name)
    if (d) return typeof d.si === 'number' ? `${formatNumber(d.si, 5)} ${d.unit}` : ''
    const c = scene.checkResults.find((x) => x.name === name)
    if (c) return c.pass ? 'PASS' : 'FAIL'
    return ''
  }
  const u = displayUnit(scene.doc.project.units, v.dim, v.unit)
  if (v.t.length === 1) {
    try { return formatScalar({ si: numberOf(scene, v), dim: v.dim, unit: u }, { sig: 5 }) } catch { return '' }
  }
  if (v.t.length === 3) {
    const c = reported(scene, v)
    const f = u ? 1 / unitFactor(u) : 1
    return `(${c.map((x) => formatNumber(x * f, 4)).join(', ')}) ${u}`
  }
  return ''
}

const unitFactor = (sym: string): number => unit(sym).factor

// ---------------------------------------------------------------------------

export function Inspector(): JSX.Element {
  const built = useStore((s) => s.built)
  const selection = useStore((s) => s.selection)
  const run = useStore((s) => s.run)
  const [advanced, setAdvanced] = useState(false)

  const name = selection[0]
  const node = name ? built.doc.nodes.find((n) => nodeName(n) === name) : undefined
  const scene = built.scene
  const units = built.doc.project.units

  if (selection.length > 1) {
    return (
      <section className="panel inspector">
        <header className="panel-head"><span>Inspector</span></header>
        <div className="panel-scroll">
          <div className="hint">{selection.length} objects selected</div>
          <button className="action" onClick={() => run(sumVectors, { of: selection })}>
            Resultant of selection
          </button>
          <button className="action" onClick={() => run(extractComponent, {
            selection: [...selection], path: `user/${selection[0]}-group`,
          })}>
            Extract component
          </button>
        </div>
      </section>
    )
  }

  if (!node) {
    return (
      <section className="panel inspector">
        <header className="panel-head"><span>Inspector</span></header>
        <div className="panel-scroll"><div className="hint">Nothing selected.</div></div>
      </section>
    )
  }

  return (
    <section className="panel inspector">
      <header className="panel-head">
        <span>{node.kind} &middot; {name}</span>
        <button className="more" title="more" onClick={() => setAdvanced(!advanced)}>&#8943;</button>
      </header>
      <div className="panel-scroll">
        {node.kind === 'param' && (
          <NumericField
            label={node.name}
            value={node.expr}
            units={units}
            {...(scene?.names.get(node.name) ? {
              si: numberOf(scene!, scene!.names.get(node.name)!),
              dim: scene!.names.get(node.name)!.dim,
            } : {})}
            locked={node.locked ?? false}
            onCommit={(expr) => run(setParameter, { name: node.name, expr })}
            onToggleLock={() => { /* locking is a document edit; see §5 of the design */ }}
          />
        )}

        {node.kind === 'instance' && (() => {
          const def = LIBRARY.get(node.component)
          return (
            <>
              <div className="sub">{def?.meta.title ?? node.component}</div>
              {def?.params.map((p) => {
                const full = `${node.name}.${p.name}`
                const v = scene?.names.get(full)
                const overridden = node.params[p.name] !== undefined
                const expr = node.params[p.name] ?? p.default ?? ''
                if (p.type === 'ref') {
                  return (
                    <div className="ref-field" key={p.name}>
                      <label>{p.name}</label>
                      <input
                        value={expr}
                        spellCheck={false}
                        onChange={(e) => run(setParameter, { name: full, expr: e.target.value })}
                      />
                    </div>
                  )
                }
                return (
                  <NumericField
                    key={p.name}
                    label={p.name}
                    value={expr}
                    units={units}
                    overridden={overridden}
                    {...(v ? { si: numberOf(scene!, v), dim: v.dim } : {})}
                    onCommit={(next) => run(setParameter, { name: full, expr: next })}
                    {...(overridden ? { onRevert: () => run(clearOverride, { instance: node.name, field: p.name }) } : {})}
                  />
                )
              })}
              {def?.expose.length ? (
                <>
                  <div className="sub">Exposes</div>
                  {def.expose.map((q) => {
                    const v = scene?.names.get(`${node.name}.${q.name}`)
                    return (
                      <div className="readout" key={q.name}>
                        <span>{q.name}</span>
                        <span className="mono">{v && scene ? quickValue(scene, `${node.name}.${q.name}`) : '--'}</span>
                      </div>
                    )
                  })}
                </>
              ) : null}
              {advanced && (
                <>
                  <div className="sub">Advanced</div>
                  <button className="action" onClick={() => run(addEquilibrium, { body: node.name })}>
                    Equilibrium check on this body
                  </button>
                  <button className="action" onClick={() => run(deleteObject, { name: node.name })}>
                    Delete
                  </button>
                </>
              )}
            </>
          )
        })()}

        {node.kind === 'measure' && scene && (
          <>
            <div className="sub">{node.op}</div>
            <div className="readout"><span>value</span><span className="mono">{quickValue(scene, node.name)}</span></div>
            <div className="readout"><span>frame</span><span className="mono">{scene.names.get(node.name)?.frame ?? '--'}</span></div>
            <div className="sub">Re-express in</div>
            {[...scene.frameSpecs.keys()].map((f) => (
              <button key={f} className="action" onClick={() => run(reexpressIn, { target: node.name, frame: f })}>
                {f}
              </button>
            ))}
          </>
        )}

        {node.kind === 'check' && scene && (() => {
          const r = scene.checkResults.find((c) => c.name === node.name)
          return (
            <>
              <div className={`verdict ${r?.pass ? 'pass' : 'fail'}`}>{r?.pass ? 'PASS' : 'FAIL'}</div>
              <div className="readout"><span>residual</span><span className="mono">{r ? formatNumber(r.residual, 4) : '--'} N</span></div>
              <div className="readout"><span>tolerance</span><span className="mono">{r ? formatNumber(r.tolerance, 2) : '--'} N</span></div>
              <div className="readout"><span>balanced</span><span className="mono">{r?.detail}</span></div>
            </>
          )
        })()}

        {node.kind === 'constraint' && scene && (
          <>
            <div className="readout">
              <span>residual</span>
              <span className="mono">{formatNumber(scene.report.rowResiduals.get(node.name) ?? 0, 4)}</span>
            </div>
            <div className="sub">{node.op} {node.operands.join(' ')}</div>
          </>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

export function StatusStrip(): JSX.Element {
  const built = useStore((s) => s.built)
  const st = useStore()
  const r = built.scene?.report

  return (
    <footer className="status">
      <div className="seg" role="group" aria-label="view mode">
        <button
          className={st.mode === '2d' ? 'on' : ''}
          onClick={() => st.set('mode', '2d')}
          title="locked view down an axis; input constrained to the construction plane"
        >2D</button>
        <button
          className={st.mode === '3d' ? 'on' : ''}
          onClick={() => st.set('mode', '3d')}
          title="free orbit"
        >3D</button>
      </div>
      <Mode label="view" value={st.viewAxis} options={[...AXES]}
        onPick={(a) => { st.set('viewAxis', a as Axis); st.set('mode', '2d') }} />
      <Mode label="units" value={built.doc.project.units.length ?? 'm'}
        options={['m', 'cm', 'mm', 'km', 'ft', 'in']}
        onPick={(u) => st.run(setProjectUnit, { dimension: 'length', unit: u })} />
      <Mode label="frame" value={st.activeFrame}
        options={built.scene ? [...built.scene.frameSpecs.keys()] : ['world']}
        onPick={(f) => st.set('activeFrame', f)} />
      <Mode label="plane" value={st.activePlane}
        options={['xy', 'zx', 'yz']}
        onPick={(p) => st.set('activePlane', p as 'xy' | 'zx' | 'yz')} />
      <Mode label="snap" value={st.snap}
        options={['off', 'grid', 'angle']}
        onPick={(s) => st.set('snap', s as 'off' | 'grid' | 'angle')} />
      <span className="spacer" />
      {r && (
        <span className={`dof ${r.verdict}`} title={`rank ${r.rank} of ${r.residuals} rows and ${r.unknowns} unknowns`}>
          {r.dof} DOF &middot; {r.verdict}{r.converged ? '' : ' \u00b7 NOT CONVERGED'}
        </span>
      )}
      {built.error && <span className="err" title={built.error}>{built.error}</span>}
      {st.message && <span className="err" title={st.message}>{st.message}</span>}
      <button
        className="theme"
        title={st.theme === 'light' ? 'switch to a dark background' : 'switch to a white background'}
        onClick={() => st.set('theme', st.theme === 'light' ? 'dark' : 'light')}
      >{st.theme === 'light' ? 'dark' : 'light'}</button>
    </footer>
  )
}

function Mode(props: {
  label: string; value: string; options: string[]; onPick(v: string): void
}): JSX.Element {
  return (
    <label className="mode">
      <span className="mode-label">{props.label}</span>
      <select value={props.value} onChange={(e) => props.onPick(e.target.value)}>
        {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------

export function CommandPalette(): JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  const set = useStore((s) => s.set)
  const run = useStore((s) => s.run)
  const selection = useStore((s) => s.selection)
  const loadExample = useStore((s) => s.loadExample)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQuery(''); input.current?.focus() } }, [open])
  if (!open) return null

  const entries: Array<{ id: string; title: string; shortcut?: string; go(): void }> = [
    ...operations().map((op) => ({
      id: op.id, title: op.title, ...(op.shortcut ? { shortcut: op.shortcut } : {}),
      go: () => {
        if (op.id === 'add-parameter') run(op, { expr: '1 m', type: 'length' } as never)
        else if (op.id === 'delete-object' && selection[0]) run(op, { name: selection[0] } as never)
        else if (op.id === 'add-equilibrium' && selection[0]) run(op, { body: selection[0] } as never)
        else if (op.id === 'sum-vectors' && selection.length) run(op, { of: selection } as never)
        else if (op.id === 'extract-component' && selection.length) {
          run(op, { selection, path: `user/${selection[0]}-group` } as never)
        } else set('message', `${op.title}: select something first`)
      },
    })),
    ...Object.keys(EXAMPLES).map((path) => ({
      id: `open:${path}`, title: `Open ${path.split('/').pop()}`, go: () => loadExample(path),
    })),
    { id: 'export-svg', title: 'Export SVG', shortcut: 'Ctrl+Shift+S', go: () => exportFile('svg') },
    { id: 'export-tikz', title: 'Export TikZ', go: () => exportFile('tex') },
    { id: 'export-pdf', title: 'Export PDF', go: () => exportFile('pdf') },
    { id: 'save', title: 'Save project file', shortcut: 'Ctrl+S', go: () => saveProject() },
    { id: 'toggle-source', title: 'Toggle source panel', shortcut: 'Ctrl+`', go: () => set('showSource', !useStore.getState().showSource) },
  ]

  const q = query.trim().toLowerCase()
  const shown = entries.filter((e) => !q || e.title.toLowerCase().includes(q)).slice(0, 14)

  return (
    <div className="cmdk-backdrop" onClick={() => set('paletteOpen', false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          placeholder="Command"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') set('paletteOpen', false)
            if (e.key === 'Enter' && shown[0]) { shown[0].go(); set('paletteOpen', false) }
          }}
        />
        <div className="cmdk-list">
          {shown.map((e) => (
            <div key={e.id} className="cmdk-row" onClick={() => { e.go(); set('paletteOpen', false) }}>
              <span>{e.title}</span>
              {e.shortcut && <kbd>{e.shortcut}</kbd>}
            </div>
          ))}
          {!shown.length && <div className="empty">no command matches</div>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function SourcePanel(): JSX.Element {
  const built = useStore((s) => s.built)
  const setSource = useStore((s) => s.setSource)
  const [draft, setDraft] = useState(built.source)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { if (!dirty) setDraft(built.source) }, [built.source, dirty])

  return (
    <section className="source">
      <header className="panel-head">
        <span>Source &mdash; this is the file, not a view of it</span>
        <button className="more" onClick={() => { setDraft(canonicalSource(built)); setDirty(true) }}>
          format
        </button>
      </header>
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(e) => { setDraft(e.target.value); setDirty(true) }}
        onBlur={() => { if (dirty) { setSource(draft); setDirty(false) } }}
      />
      {built.error && <div className="source-error">{built.error}</div>}
    </section>
  )
}

// ---------------------------------------------------------------------------

export function exportFile(kind: 'svg' | 'tex' | 'pdf'): void {
  const built = useStore.getState().built
  if (!built.scene) { useStore.getState().set('message', 'nothing to export: the model did not build'); return }
  const fig = projectScene(built.scene)
  const name = `byrne-${fig.title}`
  if (kind === 'svg') download(`${name}.svg`, toSvg(fig), 'image/svg+xml')
  else if (kind === 'tex') download(`${name}.tex`, toTikz(fig), 'text/plain')
  else {
    void import('../figure/pdf.js').then(async ({ toPdf }) => {
      const bytes = await toPdf(fig)
      download(`${name}.pdf`, bytes, 'application/pdf')
    })
  }
  if (fig.caveats.length) useStore.getState().set('message', `exported; ${fig.caveats.join(' ')}`)
}

export function saveProject(): void {
  const built = useStore.getState().built
  download('scene.byrne', canonicalSource(built), 'text/plain')
}

function download(filename: string, data: string | Uint8Array, type: string): void {
  const blob = new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

void dimName; void dimToString; void isDimless
