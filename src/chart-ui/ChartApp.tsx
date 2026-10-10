import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Obj, translate } from '../chart/model.js'
import { TEMPLATES } from '../chart/templates.js'
import { toFigure } from '../chart/render.js'
import { toSvg } from '../figure/svg.js'
import { Canvas } from './Canvas.js'
import { Inspector } from './Inspector.js'
import { Layers, TOOLS, ToolBar } from './Sidebar.js'
import { duplicates, useChart } from './store.js'
import { ExportKind, exportChart, openChartFile } from './io.js'
import { addPictures, pickPictures } from './images.js'

export function ChartApp(): JSX.Element {
  useShortcuts()
  useAnimation()
  const dialog = useChart((s) => s.dialog)
  return (
    <div className="chart-app">
      <TopBar />
      <ToolBar />
      <main className="stage">
        <Canvas />
        <Hint />
      </main>
      <aside className="right">
        <div className="right-scroll"><Inspector /></div>
        <Layers />
      </aside>
      <StatusBar />
      {dialog === 'templates' && <Templates />}
      {dialog === 'help' && <Help />}
    </div>
  )
}

function TopBar(): JSX.Element {
  const s = useChart.getState()
  const title = useChart((st) => st.doc.title)
  const canUndo = useChart((st) => st.past.length > 0)
  const canRedo = useChart((st) => st.future.length > 0)
  const grid = useChart((st) => st.doc.grid)
  const zoom = useChart((st) => st.view.zoom)
  const moves = useChart((st) => st.doc.objects.some((o) => o.type === 'orbit' || (o.type === 'field' && o.flow !== 'still')))
  const playing = useChart((st) => st.playing)
  const time = useChart((st) => st.time)
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState('')
  const doExport = async (k: ExportKind): Promise<void> => {
    setMenu(false)
    try { await exportChart(useChart.getState().doc, k) } catch (e) { setError(`Export failed: ${(e as Error).message}`) }
  }
  const setGrid = (p: Partial<typeof grid>): void => s.edit((d) => ({ ...d, grid: { ...d.grid, ...p } }))
  const zoomBy = (f: number): void => {
    const v = useChart.getState().view
    const el = document.querySelector('.chart-canvas') as HTMLElement | null
    const cx = (el?.clientWidth ?? 800) / 2, cy = (el?.clientHeight ?? 600) / 2
    const z = Math.max(0.08, Math.min(30, v.zoom * f))
    s.setView({ zoom: z, ox: v.ox + cx / v.zoom - cx / z, oy: v.oy + cy / v.zoom - cy / z })
  }
  return (
    <header className="topbar">
      <div className="brand"><span className="mark">B</span> Byrne <span className="sub">Charts</span></div>
      <input className="doc-title" value={title} onChange={(e) => s.edit((d) => ({ ...d, title: e.target.value }), 'title')} aria-label="Chart title" />
      <div className="tb-group">
        <button onClick={() => s.set('dialog', 'templates')} title="Start a new chart from a template">New</button>
        <button onClick={async () => { try { const d = await openChartFile(); if (d) s.load(d) } catch (e) { setError(`Could not open that file: ${(e as Error).message}`) } }}>Open</button>
        <button onClick={() => doExport('json')} title="Save the chart as a file you can open again (Ctrl+S)">Save</button>
        <span className="menu-wrap">
          <button className="primary" onClick={() => setMenu(!menu)} aria-expanded={menu}>Export ▾</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => doExport('png')}><b>Picture</b> PNG, high resolution</button>
              <button onClick={() => doExport('svg')}><b>Vector</b> SVG, for the web and Illustrator</button>
              <button onClick={() => doExport('animated')}><b>Animated</b> SVG that plays in a browser: orbits and flowing fields</button>
              <button onClick={() => doExport('pdf')}><b>PDF</b> for print</button>
              <button onClick={() => doExport('tex')}><b>LaTeX</b> TikZ, compiles on its own (a .zip when there are pictures)</button>
            </div>
          )}
        </span>
      </div>
      <div className="tb-group">
        <button disabled={!canUndo} onClick={() => s.undo()} title="Undo (Ctrl+Z)">↶</button>
        <button disabled={!canRedo} onClick={() => s.redo()} title="Redo (Ctrl+Y)">↷</button>
      </div>
      <div className="tb-group">
        <button className={grid.snap ? 'on' : ''} onClick={() => setGrid({ snap: !grid.snap })} title="Snap to the grid and to points (G). Hold Alt to place freely.">Snap</button>
        <button className={grid.show ? 'on' : ''} onClick={() => setGrid({ show: !grid.show })} title="Show the grid (Shift+G)">Grid</button>
        <button onClick={() => setGrid({ kind: grid.kind === 'square' ? 'polar' : 'square' })} title="Square grid or circular grid">{grid.kind === 'square' ? 'Square' : 'Circular'}</button>
      </div>
      <div className="tb-group">
        <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out (-)">−</button>
        <span className="zoom">{Math.round((zoom * 100 * 72) / 96)}%</span>
        <button onClick={() => zoomBy(1.25)} title="Zoom in (+)">+</button>
        <button onClick={() => s.set('fitAt', Date.now())} title="Fit the chart to the window (0)">Fit</button>
      </div>
      {moves && (
        <div className="tb-group">
          <button className={playing ? 'on' : ''} onClick={() => s.set('playing', !playing)} title="Run time forward: satellites move along their orbits, fields flow">{playing ? 'Pause' : 'Play'}</button>
          {time !== 0 && <button onClick={() => { s.set('playing', false); s.set('time', 0) }} title="Back to the drawn positions">Reset</button>}
        </div>
      )}
      <div className="tb-spacer" />
      <button onClick={() => s.set('dialog', 'help')} title="Keyboard shortcuts">?</button>
      <a className="tb-link" href="./index.html" title="Byrne's 3D physics editor">3D editor</a>
      {error && <div className="toast" onClick={() => setError('')}>{error}</div>}
    </header>
  )
}

function Hint(): JSX.Element | null {
  const tool = useChart((s) => s.tool)
  const t = TOOLS.find((x) => x.id === tool)
  if (!t || tool === 'select') return null
  return <div className="hint">{t.hint} <span className="esc">Esc to stop</span></div>
}

function StatusBar(): JSX.Element {
  const cursor = useChart((s) => s.cursor)
  const sel = useChart((s) => s.selection.length)
  const n = useChart((s) => s.doc.objects.length)
  const time = useChart((s) => s.time)
  const r = cursor ? Math.hypot(cursor[0], cursor[1]) : 0
  const a = cursor ? (Math.atan2(cursor[1], cursor[0]) * 180) / Math.PI : 0
  return (
    <footer className="status">
      {cursor ? <span className="mono">x {cursor[0].toFixed(2)}  y {cursor[1].toFixed(2)} cm   ·   r {r.toFixed(2)}  θ {a.toFixed(1)}°</span> : <span className="faint">Move over the page for coordinates</span>}
      <span className="faint">{sel ? `${sel} selected · ` : ''}{n} objects{time ? ` · t = ${time.toFixed(2)} s` : ''}</span>
    </footer>
  )
}

function Templates(): JSX.Element {
  const s = useChart.getState()
  const thumbs = useMemo(() => TEMPLATES.map((t) => {
    const d = t.make()
    return { t, d, svg: d.objects.length ? toSvg(toFigure(d.objects, d.title), { background: '#ffffff' }) : '' }
  }), [])
  return (
    <div className="modal-bg" onClick={() => s.set('dialog', null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Start a chart</h2>
        <p className="faint">Your current chart is kept in Undo, so nothing is lost by starting another.</p>
        <div className="tpl-grid">
          {thumbs.map(({ t, d, svg }) => (
            <button key={t.id} className="tpl" onClick={() => { s.load(d); s.set('dialog', null) }}>
              <div className="tpl-img" dangerouslySetInnerHTML={{ __html: svg.replace(/<\?xml[^>]*>/, '') || '<div class="blank-page"></div>' }} />
              <b>{t.name}</b>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Help(): JSX.Element {
  const s = useChart.getState()
  const rows: Array<[string, string]> = [
    ...TOOLS.map((t) => [t.key, t.label] as [string, string]),
    ['Space + drag', 'Move around the page'], ['Scroll', 'Zoom'], ['0', 'Fit to window'],
    ['G', 'Snap on or off'], ['Shift+G', 'Grid on or off'], ['Alt + drag', 'Place freely, no snapping'],
    ['Arrow keys', 'Nudge one grid step (Shift: a tenth)'], ['Ctrl+D', 'Duplicate'], ['Ctrl+C / Ctrl+V', 'Copy, paste'],
    ['Delete', 'Delete'], ['Ctrl+Z / Ctrl+Y', 'Undo, redo'], ['Ctrl+A', 'Select all'], ['Ctrl+S', 'Save a file'],
    ['Esc', 'Stop drawing, or clear the selection'],
  ]
  return (
    <div className="modal-bg" onClick={() => s.set('dialog', null)}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <h2>Shortcuts</h2>
        <table className="keys"><tbody>{rows.map(([k, v]) => <tr key={k + v}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
        <p className="faint">In a label, <code>$...$</code> is maths (<code>$\rho_n = n\ln\lambda$</code>), <code>**...**</code> is bold.</p>
      </div>
    </div>
  )
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag)
      const s = useChart.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 's') { e.preventDefault(); void exportChart(s.doc, 'json'); return }
      if (typing) return
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); return }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); s.redo(); return }
      if (mod && k === 'a') { e.preventDefault(); s.select(s.doc.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id)); return }
      const sel = s.doc.objects.filter((o) => s.selection.includes(o.id))
      if (mod && k === 'd') { e.preventDefault(); if (sel.length) s.add(duplicates(sel)); return }
      if (mod && k === 'c') { if (sel.length) s.set('clipboard', structuredClone(sel)); return }
      if (mod) return
      if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); s.remove(sel.map((o) => o.id)) } return }
      if (e.key === 'Escape') {
        if (s.dialog) s.set('dialog', null)
        else if (s.tool !== 'select') s.setTool('select')
        else s.select([])
        return
      }
      if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault()
        const step = e.shiftKey ? s.doc.grid.step / 10 : s.doc.grid.step
        const d: [number, number] = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, step] : [0, -step]
        s.update(sel.map((o) => o.id), (o: Obj) => translate(o, d), 'nudge')
        return
      }
      if (k === 'g') { s.edit((d) => ({ ...d, grid: e.shiftKey ? { ...d.grid, show: !d.grid.show } : { ...d.grid, snap: !d.grid.snap } })); return }
      if (k === '0') { s.set('fitAt', Date.now()); return }
      if (k === '?') { s.set('dialog', 'help'); return }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k)
      if (t) { if (t.id === 'image') pickPictures(); else s.setTool(t.id) }
    }
    // Paste is handled on the paste event, not on Ctrl+V, because only the event can see
    // a picture on the system clipboard; a picture there wins over copied chart objects.
    const onPaste = (e: ClipboardEvent): void => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      const s = useChart.getState()
      if (files.length) { e.preventDefault(); void addPictures(files); return }
      if (s.clipboard.length) { e.preventDefault(); s.add(duplicates(s.clipboard)) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste) }
  }, [])
}

function useAnimation(): void {
  const playing = useChart((s) => s.playing)
  const last = useRef(0)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    last.current = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last.current) / 1000)
      last.current = now
      const s = useChart.getState()
      s.set('time', s.time + dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}
