import type { JSX } from 'react'
import { useMemo } from 'react'
import { Obj, TYPE_NAMES } from '../chart/model.js'
import { Tool, useChart } from './store.js'
import { pickPictures } from './images.js'

interface ToolDef { id: Tool; label: string; key: string; hint: string; icon: JSX.Element }

const I = (children: JSX.Element | JSX.Element[]): JSX.Element => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Click to select, drag to move. Drag on empty space to select several.', icon: I(<path d="M5 3l13 8-6 1.5L9 19z" />) },
  { id: 'circle', label: 'Circle', key: 'C', hint: 'Press at the centre, drag out the radius.', icon: I(<circle cx="12" cy="12" r="8" />) },
  { id: 'band', label: 'Band', key: 'B', hint: 'A thick ring. Press at the centre, drag out the radius.', icon: I(<circle cx="12" cy="12" r="7" strokeWidth="4" opacity="0.55" />) },
  { id: 'rings', label: 'Rings', key: 'R', hint: 'A set of rings that crowd toward the edge or the centre.', icon: I([<circle key="a" cx="12" cy="12" r="9" />, <circle key="b" cx="12" cy="12" r="7.6" />, <circle key="c" cx="12" cy="12" r="5.4" />, <circle key="d" cx="12" cy="12" r="2.6" />]) },
  { id: 'line', label: 'Line', key: 'L', hint: 'Press at one end, drag to the other.', icon: I(<path d="M4 19L20 5" />) },
  { id: 'arrow', label: 'Arrow', key: 'A', hint: 'Press at the tail, drag to the tip.', icon: I([<path key="a" d="M4 19L19 6" />, <path key="b" d="M12 6h7v7" />]) },
  { id: 'wavy', label: 'Wavy', key: 'W', hint: 'A wavy line, like the daemon. Press, drag.', icon: I(<path d="M3 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0" />) },
  { id: 'arc', label: 'Arc', key: 'U', hint: 'Press at the centre, drag to set the radius and direction.', icon: I(<path d="M5 17A9 9 0 0 1 19 9" />) },
  { id: 'dot', label: 'Dot', key: 'D', hint: 'Click to place a dot.', icon: I(<circle cx="12" cy="12" r="4" fill="currentColor" />) },
  { id: 'label', label: 'Label', key: 'T', hint: 'Click to place words. Type them in the panel on the right.', icon: I([<path key="a" d="M5 6h14" />, <path key="b" d="M12 6v13" />]) },
  { id: 'box', label: 'Note box', key: 'N', hint: 'Click for a boxed note; drag to set its width.', icon: I([<rect key="a" x="3.5" y="5" width="17" height="14" rx="2" />, <path key="b" d="M7 10h10M7 14h7" />]) },
  { id: 'ticks', label: 'Ticks', key: 'K', hint: 'A string of labelled ticks around a circle (the binary string).', icon: I(<path d="M5 9l1.5 3M9 6.5l1 3.2M13 5.6l.2 3.3M17 6.3l-.8 3.2M20.5 8.3l-1.6 2.9" />) },
  { id: 'curve', label: 'Formula', key: 'F', hint: 'A curve from a formula: y = f(x), parametric, or polar.', icon: I(<path d="M3 17c3 0 4-10 9-10s6 10 9 10" />) },
  { id: 'path', label: 'Draw', key: 'P', hint: 'Click points for a smooth curve, or drag to draw freehand. Enter or double-click to finish.', icon: I(<path d="M4 18c2-6 5-11 8-11 2.5 0 2 4 4 4s2-3 4-4" />) },
  { id: 'field', label: 'Heatmap', key: 'H', hint: 'The radial field of Figure 8: rings, pockets, and its slice read as binary. Press at the centre, drag out the radius.', icon: I([<circle key="a" cx="12" cy="12" r="9" />, <circle key="b" cx="12" cy="12" r="5.5" fill="currentColor" opacity="0.25" />, <circle key="c" cx="12" cy="12" r="2.2" fill="currentColor" opacity="0.6" />]) },
  { id: 'image', label: 'Picture', key: 'I', hint: 'Put a picture on the chart. You can also drop a file on the page, or paste one.', icon: I([<rect key="a" x="3.5" y="5" width="17" height="14" rx="1.5" />, <circle key="b" cx="9" cy="10" r="1.6" />, <path key="c" d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" />]) },
  { id: 'orbit', label: 'Orbit', key: 'O', hint: 'Press at the central body, drag to where the satellite is. Then drag its blue arrow.', icon: I([<ellipse key="a" cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-25 12 12)" />, <circle key="b" cx="9" cy="13" r="2" fill="currentColor" />, <circle key="c" cx="19.5" cy="8" r="1.4" fill="currentColor" />]) },
]

export function ToolBar(): JSX.Element {
  const tool = useChart((s) => s.tool)
  const setTool = useChart((s) => s.setTool)
  return (
    <nav className="tools" aria-label="Tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={`tool${tool === t.id ? ' on' : ''}`} onClick={() => (t.id === 'image' ? pickPictures() : setTool(t.id))}
          title={`${t.label} (${t.key})\n${t.hint}`} aria-pressed={tool === t.id}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

const ICON: Record<Obj['type'], string> = {
  circle: '○', band: '◎', rings: '◎', line: '╱', arc: '◜', dot: '●', label: 'T', box: '▭',
  ticks: '⋮', curve: '∿', path: '✎', orbit: '⊙', field: '◉', image: '▣',
}

const small = (children: JSX.Element | JSX.Element[]): JSX.Element => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">{children}</svg>
)
const LOCK = small([<rect key="a" x="3.5" y="7" width="9" height="6.5" rx="1" />, <path key="b" d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />])
const EYE = small([<path key="a" d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />, <circle key="b" cx="8" cy="8" r="2" />])
const EYE_OFF = small([<path key="a" d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" opacity="0.4" />, <path key="b" d="M2.5 13.5l11-11" />])

export function Layers(): JSX.Element {
  const objects = useChart((s) => s.doc.objects)
  const selection = useChart((s) => s.selection)
  const s = useChart.getState()
  const list = useMemo(() => [...objects].reverse(), [objects])
  return (
    <div className="layers">
      <div className="layers-head">Everything on the chart <span className="count">{objects.length}</span></div>
      <ul>
        {list.map((o) => (
          <li key={o.id} className={`${selection.includes(o.id) ? 'on' : ''}${o.hidden ? ' hidden' : ''}`}
            onClick={(e) => {
              const st = useChart.getState()
              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                st.select(st.selection.includes(o.id) ? st.selection.filter((x) => x !== o.id) : [...st.selection, o.id])
              } else st.select([o.id])
            }}>
            <span className="li-icon" style={{ color: o.color }}>{ICON[o.type]}</span>
            <span className="li-name" title={TYPE_NAMES[o.type]}>{o.name || TYPE_NAMES[o.type]}</span>
            <button className="li-btn" title={o.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); s.update([o.id], (x) => ({ ...x, locked: !x.locked })) }}>
              {o.locked ? LOCK : <span className="faint">{LOCK}</span>}
            </button>
            <button className="li-btn" title={o.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); s.update([o.id], (x) => ({ ...x, hidden: !x.hidden })) }}>
              {o.hidden ? EYE_OFF : EYE}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
