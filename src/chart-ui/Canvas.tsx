import type { JSX } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Obj, ObjOf, Vec, handles, make, setHandle, translate, anchorOf, COLORS } from '../chart/model.js'
import { Rendered, render, toPt, toWorld, K } from '../chart/render.js'
import { hitTest, inRect } from '../chart/hit.js'
import { keyPoints, snap } from '../chart/snap.js'
import { toSvg } from '../figure/svg.js'
import type { Pt } from '../figure/ir.js'
import { Tool, useChart } from './store.js'

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'move'; start: Vec; anchor0: Vec; originals: Obj[]; moved: boolean }
  | { kind: 'handle'; id: string; key: string; orig: Obj }
  | { kind: 'create'; tool: Tool; id: string; start: Vec; moved: boolean; sx: number; sy: number }
  | { kind: 'marquee'; a: Pt; b: Pt; additive: boolean }
  | { kind: 'pen'; id: string; sx: number; sy: number; free: boolean }

const HANDLE_PX = 6

/** The canvas draws the same SVG the export writes, from the same IR. */
function figureMarkup(r: Rendered): string {
  const svg = toSvg({ width: 0, height: 0, prims: r.prims, scale: 1, title: '', caveats: [] }, {
    background: null, includeCaveats: false,
  })
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

export function objectForTool(tool: Tool, p: Vec): Obj | null {
  switch (tool) {
    case 'select': return null
    case 'arrow': return make('line', p, { arrow: 'end', name: 'Arrow', b: [p[0] + 2, p[1]] })
    case 'wavy': return make('line', p, { wavy: true, color: COLORS.daemon, width: 1.2, name: 'Wavy line', b: [p[0], p[1] + 2] })
    default: return make(tool, p)
  }
}

/** Shape a just-created object from the drag so far. */
function shapeFromDrag(o: Obj, s: Vec, q: Vec): Obj {
  const dx = q[0] - s[0], dy = q[1] - s[1]
  const r = Math.max(0.1, Math.hypot(dx, dy))
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI
  switch (o.type) {
    case 'circle': case 'band': case 'rings': return { ...o, r }
    case 'arc': return { ...o, r, from: Math.round(ang - 45), to: Math.round(ang + 45) }
    case 'ticks': return { ...o, r, from: Math.round(ang - 30), to: Math.round(ang + 30) }
    case 'line': return { ...o, b: q }
    case 'box': return { ...o, w: Math.max(1, dx) }
    case 'orbit': {
      const v = Math.sqrt(o.mu / r)
      return { ...o, at: q, vel: [(-dy / r) * v, (dx / r) * v] }
    }
    case 'label': case 'dot': case 'curve': return { ...o, at: q }
    case 'path': return o
  }
}

export function Canvas(): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 600 })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [snapAt, setSnapAt] = useState<{ p: Vec; kind: string } | null>(null)
  const [penCursor, setPenCursor] = useState<Vec | null>(null)
  const [space, setSpace] = useState(false)
  const penId = useRef<string | null>(null)
  const fitted = useRef<number | null>(null)

  const doc = useChart((s) => s.doc)
  const view = useChart((s) => s.view)
  const selection = useChart((s) => s.selection)
  const tool = useChart((s) => s.tool)
  const time = useChart((s) => s.time)

  const rendered = useMemo(() => render(doc.objects, { time }), [doc.objects, time])
  const markup = useMemo(() => figureMarkup(rendered), [rendered])

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Fit whenever the store asks (a document loaded, or the Fit button), once sized.
  const fitAt = useChart((s) => s.fitAt)
  useEffect(() => {
    if (size.w < 50 || fitted.current === fitAt) return
    fitted.current = fitAt
    fit()
  }, [size.w, size.h, fitAt])

  function fit(): void {
    const r = render(useChart.getState().doc.objects)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const b of r.boxes.values()) {
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3])
    }
    if (!Number.isFinite(x0)) { x0 = -10 * K; y0 = -7 * K; x1 = 10 * K; y1 = 7 * K }
    const pad = 40
    const zoom = Math.max(0.1, Math.min(8, Math.min((size.w - 2 * pad) / (x1 - x0), (size.h - 2 * pad) / (y1 - y0))))
    useChart.getState().setView({
      zoom,
      ox: (x0 + x1) / 2 - size.w / 2 / zoom,
      oy: (y0 + y1) / 2 - size.h / 2 / zoom,
    })
  }

  // Wheel zooms about the pointer; it has to be a native listener to be allowed to cancel.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const v = useChart.getState().view
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top
      if (e.shiftKey && !e.ctrlKey) {
        useChart.getState().setView({ ox: v.ox + (e.deltaY || e.deltaX) / v.zoom })
        return
      }
      const zoom = Math.max(0.08, Math.min(30, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))))
      const X = v.ox + sx / v.zoom, Y = v.oy + sy / v.zoom
      useChart.getState().setView({ zoom, ox: X - sx / zoom, oy: Y - sy / zoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Space held = hand tool, as in every drawing program.
  useEffect(() => {
    const typing = (): boolean => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !typing()) { e.preventDefault(); setSpace(true) }
      if ((e.key === 'Enter' || e.key === 'Escape') && penId.current) finishPen()
    }
    const up = (e: KeyboardEvent): void => { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // Leaving the pen tool by any route finishes the path being drawn.
  useEffect(() => { if (tool !== 'path' && penId.current) finishPen() }, [tool])

  function finishPen(): void {
    const id = penId.current
    penId.current = null
    setPenCursor(null)
    const s = useChart.getState()
    const o = s.doc.objects.find((x) => x.id === id)
    if (o && o.type === 'path' && o.pts.length < 2) s.remove([o.id])
    if (s.tool === 'path') s.setTool('select')
  }

  const toPoint = (e: { clientX: number; clientY: number }): { pt: Pt; w: Vec; sx: number; sy: number } => {
    const rect = host.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    const v = useChart.getState().view
    const pt: Pt = [v.ox + sx / v.zoom, v.oy + sy / v.zoom]
    return { pt, w: toWorld(pt), sx, sy }
  }

  const snapper = (raw: Vec, exclude: ReadonlySet<string>, free: boolean): Vec => {
    const s = useChart.getState()
    const tol = 9 / s.view.zoom / K
    const r = snap(raw, s.doc.grid, keyPoints(s.doc.objects, exclude), tol, free)
    setSnapAt(r.kind === 'point' ? { p: r.p, kind: r.kind } : null)
    return r.p
  }

  function handleAt(pt: Pt): { id: string; key: string } | null {
    const s = useChart.getState()
    const tol = (HANDLE_PX + 3) / s.view.zoom
    for (const id of [...s.selection].reverse()) {
      const o = s.doc.objects.find((x) => x.id === id)
      if (!o || o.locked) continue
      for (const h of [...handles(o)].reverse()) {
        const q = toPt(h.at)
        if (Math.hypot(q[0] - pt[0], q[1] - pt[1]) <= tol) return { id, key: h.key }
      }
    }
    return null
  }

  function onPointerDown(e: React.PointerEvent): void {
    host.current?.focus()
    const { pt, w, sx, sy } = toPoint(e)
    const s = useChart.getState()
    if (e.button === 1 || e.button === 2 || space) {
      e.preventDefault()
      host.current?.setPointerCapture(e.pointerId)
      setGesture({ kind: 'pan', sx, sy, ox: s.view.ox, oy: s.view.oy })
      return
    }
    if (e.button !== 0) return
    // Capture on the host: the figure's elements are replaced on every redraw, and a
    // captured element that leaves the DOM takes the rest of the drag with it.
    host.current?.setPointerCapture(e.pointerId)

    if (s.tool === 'select') {
      const h = handleAt(pt)
      if (h) {
        const o = s.doc.objects.find((x) => x.id === h.id)!
        s.checkpoint()
        setGesture({ kind: 'handle', id: h.id, key: h.key, orig: o })
        return
      }
      const hit = hitTest(rendered, s.doc.objects, pt, 5 / s.view.zoom)
      if (hit) {
        let sel = s.selection
        if (e.shiftKey) {
          sel = sel.includes(hit) ? sel.filter((x) => x !== hit) : [...sel, hit]
          s.select(sel)
          if (!sel.includes(hit)) return
        } else if (!sel.includes(hit)) {
          sel = [hit]
          s.select(sel)
        }
        const originals = s.doc.objects.filter((o) => sel.includes(o.id) && !o.locked)
        const primary = originals.find((o) => o.id === hit) ?? originals[0]
        if (!primary) return
        setGesture({ kind: 'move', start: w, anchor0: anchorOf(primary), originals, moved: false })
        return
      }
      if (!e.shiftKey) s.select([])
      setGesture({ kind: 'marquee', a: pt, b: pt, additive: e.shiftKey })
      return
    }

    const p = snapper(w, new Set(), e.altKey)
    if (s.tool === 'path') {
      const cur = penId.current ? s.doc.objects.find((x) => x.id === penId.current) : undefined
      if (cur && cur.type === 'path') {
        const first = toPt(cur.pts[0]!)
        if (cur.pts.length >= 3 && Math.hypot(first[0] - pt[0], first[1] - pt[1]) < 10 / s.view.zoom) {
          s.update([cur.id], (o) => ({ ...o, closed: true } as Obj))
          finishPen()
          return
        }
        s.update([cur.id], (o) => ({ ...o, pts: [...(o as ObjOf<'path'>).pts, p] } as Obj))
        setGesture({ kind: 'pen', id: cur.id, sx, sy, free: false })
        return
      }
      const o = make('path', p)
      s.add(o)
      penId.current = o.id
      setGesture({ kind: 'pen', id: o.id, sx, sy, free: false })
      return
    }

    const o = objectForTool(s.tool, p)
    if (!o) return
    s.add(o)
    setGesture({ kind: 'create', tool: s.tool, id: o.id, start: p, moved: false, sx, sy })
  }

  function onPointerMove(e: React.PointerEvent): void {
    const { pt, w, sx, sy } = toPoint(e)
    const s = useChart.getState()
    s.set('cursor', w)
    const g = gesture
    if (!g) {
      if (s.tool === 'select') {
        setHover(hitTest(rendered, s.doc.objects, pt, 5 / s.view.zoom))
        setSnapAt(null)
      } else {
        snapper(w, new Set(), e.altKey)
      }
      if (penId.current) setPenCursor(snapper(w, new Set([penId.current]), e.altKey))
      return
    }
    switch (g.kind) {
      case 'pan':
        s.setView({ ox: g.ox - (sx - g.sx) / s.view.zoom, oy: g.oy - (sy - g.sy) / s.view.zoom })
        break
      case 'move': {
        const ids = new Set(g.originals.map((o) => o.id))
        const want: Vec = [g.anchor0[0] + w[0] - g.start[0], g.anchor0[1] + w[1] - g.start[1]]
        const at = snapper(want, ids, e.altKey)
        const d: Vec = [at[0] - g.anchor0[0], at[1] - g.anchor0[1]]
        if (!g.moved) {
          if (Math.hypot(d[0], d[1]) < 1e-9) break
          s.checkpoint()
          setGesture({ ...g, moved: true })
        }
        const moved = new Map(g.originals.map((o) => [o.id, translate(o, d)]))
        s.silent((doc) => ({ ...doc, objects: doc.objects.map((o) => moved.get(o.id) ?? o) }))
        break
      }
      case 'handle': {
        const at = snapper(w, new Set([g.id]), e.altKey)
        const next = setHandle(g.orig, g.key, at)
        s.silent((doc) => ({ ...doc, objects: doc.objects.map((o) => (o.id === g.id ? next : o)) }))
        break
      }
      case 'create': {
        const far = Math.hypot(sx - g.sx, sy - g.sy) > 4
        if (!far && !g.moved) break
        if (!g.moved) setGesture({ ...g, moved: true })
        const q = snapper(w, new Set([g.id]), e.altKey)
        s.silent((doc) => ({ ...doc, objects: doc.objects.map((o) => (o.id === g.id ? shapeFromDrag(o, g.start, q) : o)) }))
        break
      }
      case 'marquee':
        setGesture({ ...g, b: pt })
        break
      case 'pen': {
        // A drag with the pen draws freehand; clicks place points.
        if (!g.free && Math.hypot(sx - g.sx, sy - g.sy) < 6) break
        if (!g.free) setGesture({ ...g, free: true })
        s.silent((doc) => ({
          ...doc,
          objects: doc.objects.map((o) => {
            if (o.id !== g.id || o.type !== 'path') return o
            const last = o.pts[o.pts.length - 1]!
            if (Math.hypot(last[0] - w[0], last[1] - w[1]) < 8 / s.view.zoom / K) return o
            return { ...o, pts: [...o.pts, w] }
          }),
        }))
        break
      }
    }
  }

  function onPointerUp(e: React.PointerEvent): void {
    const g = gesture
    setGesture(null)
    setSnapAt(null)
    try { host.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    if (!g) return
    const s = useChart.getState()
    if (g.kind === 'marquee') {
      const ids = inRect(rendered, s.doc.objects, g.a, g.b)
      if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) * s.view.zoom > 4) {
        s.select(g.additive ? [...new Set([...s.selection, ...ids])] : ids)
      }
    }
    if (g.kind === 'create') {
      s.setTool('select')
      if (g.tool === 'label' || g.tool === 'box') s.set('focusText', Date.now())
    }
    if (g.kind === 'pen' && g.free) {
      // Freehand strokes are thinned so the curve is editable point by point afterwards.
      s.silent((doc) => ({
        ...doc,
        objects: doc.objects.map((o) => (o.id === g.id && o.type === 'path' ? { ...o, pts: thin(o.pts, 0.25) } : o)),
      }))
      finishPen()
    }
  }

  const z = view.zoom
  const sel = new Set(selection)
  const selObjs = doc.objects.filter((o) => sel.has(o.id))

  const cursor = gesture?.kind === 'pan' ? 'grabbing' : space ? 'grab' : tool !== 'select' ? 'crosshair'
    : hover ? 'move' : 'default'

  return (
    <div
      ref={host}
      className="chart-canvas"
      tabIndex={0}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { setHover(null); useChart.getState().set('cursor', null) }}
      onDoubleClick={() => { if (penId.current) finishPen() }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width={size.w} height={size.h} style={{ display: 'block' }}>
        <rect width={size.w} height={size.h} fill={doc.background} />
        <g transform={`scale(${z}) translate(${-view.ox} ${-view.oy})`}>
          {doc.grid.show && <GridLines ox={view.ox} oy={view.oy} w={size.w / z} h={size.h / z} zoom={z} />}
          <g dangerouslySetInnerHTML={{ __html: markup }} />
          {hover && !sel.has(hover) && tool === 'select' && <BoxOutline r={rendered} id={hover} z={z} faint />}
          {selObjs.map((o) => <BoxOutline key={o.id} r={rendered} id={o.id} z={z} />)}
          {selObjs.length <= 12 && selObjs.filter((o) => !o.locked).map((o) => handles(o).map((h) => {
            const [x, y] = toPt(h.at)
            const r = HANDLE_PX / z
            const isVel = o.type === 'orbit' && h.key === 'vel'
            return h.role === 'move'
              ? <rect key={o.id + h.key} x={x - r} y={y - r} width={2 * r} height={2 * r} className="h move" style={{ strokeWidth: 1.5 / z }}><title>{h.hint}</title></rect>
              : <circle key={o.id + h.key} cx={x} cy={y} r={r} className={`h${isVel ? ' vel' : ''}`} style={{ strokeWidth: 1.5 / z }}><title>{h.hint}</title></circle>
          }))}
          {penCursor && penId.current && (() => {
            const o = doc.objects.find((x) => x.id === penId.current)
            if (!o || o.type !== 'path') return null
            const a = toPt(o.pts[o.pts.length - 1]!), b = toPt(penCursor)
            return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="rubber" style={{ strokeWidth: 1 / z }} />
          })()}
          {snapAt && (() => {
            const [x, y] = toPt(snapAt.p)
            const r = 8 / z
            return <g className="snapmark" style={{ strokeWidth: 1.5 / z }}><circle cx={x} cy={y} r={r} /><line x1={x - r * 1.6} y1={y} x2={x + r * 1.6} y2={y} /><line x1={x} y1={y - r * 1.6} x2={x} y2={y + r * 1.6} /></g>
          })()}
          {gesture?.kind === 'marquee' && (
            <rect className="marquee" style={{ strokeWidth: 1 / z }}
              x={Math.min(gesture.a[0], gesture.b[0])} y={Math.min(gesture.a[1], gesture.b[1])}
              width={Math.abs(gesture.b[0] - gesture.a[0])} height={Math.abs(gesture.b[1] - gesture.a[1])} />
          )}
        </g>
      </svg>
    </div>
  )
}

function BoxOutline({ r, id, z, faint }: { r: Rendered; id: string; z: number; faint?: boolean }): JSX.Element | null {
  const b = r.boxes.get(id)
  if (!b) return null
  const pad = 4 / z
  return <rect className={faint ? 'hoverbox' : 'selbox'} x={b[0] - pad} y={b[1] - pad} width={b[2] - b[0] + 2 * pad} height={b[3] - b[1] + 2 * pad} style={{ strokeWidth: 1 / z }} />
}

function GridLines({ ox, oy, w, h, zoom }: { ox: number; oy: number; w: number; h: number; zoom: number }): JSX.Element {
  const grid = useChart((s) => s.doc.grid)
  const lines: JSX.Element[] = []
  const sw = 1 / zoom
  let step = (grid.step > 0 ? grid.step : 0.5) * K
  while (step * zoom < 7) step *= 2
  if (grid.kind === 'square') {
    const x0 = Math.floor(ox / step) * step, y0 = Math.floor(oy / step) * step
    for (let x = x0; x <= ox + w; x += step) {
      const major = Math.abs(Math.round(x / K) - x / K) < 1e-6
      const axis = Math.abs(x) < 1e-6
      lines.push(<line key={`x${x}`} x1={x} y1={oy} x2={x} y2={oy + h} className={axis ? 'g-axis' : major ? 'g-major' : 'g-minor'} style={{ strokeWidth: sw }} />)
    }
    for (let y = y0; y <= oy + h; y += step) {
      const major = Math.abs(Math.round(y / K) - y / K) < 1e-6
      const axis = Math.abs(y) < 1e-6
      lines.push(<line key={`y${y}`} x1={ox} y1={y} x2={ox + w} y2={y} className={axis ? 'g-axis' : major ? 'g-major' : 'g-minor'} style={{ strokeWidth: sw }} />)
    }
  } else {
    const far = Math.max(Math.hypot(ox, oy), Math.hypot(ox + w, oy), Math.hypot(ox, oy + h), Math.hypot(ox + w, oy + h))
    const n = Math.min(400, Math.ceil(far / step))
    for (let i = 1; i <= n; i++) {
      const r = i * step
      const major = Math.abs(Math.round(r / K) - r / K) < 1e-6
      lines.push(<circle key={`r${i}`} cx={0} cy={0} r={r} className={major ? 'g-major' : 'g-minor'} style={{ strokeWidth: sw }} fill="none" />)
    }
    const da = grid.angle > 0 ? grid.angle : 15
    for (let a = 0; a < 360 - 1e-9; a += da) {
      const t = (a * Math.PI) / 180
      const axis = a % 90 === 0
      lines.push(<line key={`a${a}`} x1={0} y1={0} x2={far * Math.cos(t)} y2={-far * Math.sin(t)} className={axis ? 'g-axis' : 'g-minor'} style={{ strokeWidth: sw }} />)
    }
  }
  return <g className="grid">{lines}</g>
}

/** Drop points closer than `min` cm to the last kept one. */
function thin(pts: readonly Vec[], min: number): Vec[] {
  if (pts.length < 3) return pts.slice()
  const out: Vec[] = [pts[0]!]
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1]!
    if (Math.hypot(pts[i]![0] - last[0], pts[i]![1] - last[1]) >= min) out.push(pts[i]!)
  }
  out.push(pts[pts.length - 1]!)
  return out
}
