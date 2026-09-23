// The unified numeric input. Implemented ONCE, used in the inspector, the palette's
// instantiate popover, the component editor and the export dialog.
//
// It accepts literals, expressions and references; it requires a unit for a dimensional
// quantity and names the mismatch on the field when one is missing; the label is a
// drag-to-scrub handle; and it carries a snap toggle and a lock toggle. Dragging the
// handle types in the field -- literally: the drag emits the same `set-parameter`
// operation a keystroke does.

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Dim, dimToString, isDimless } from '../core/dimension.js'
import { displayUnit, formatNumber, parseLiteral, toUnit, unit as resolveUnit } from '../core/units.js'

export interface NumericFieldProps {
  label: string
  /** The expression as written in the document. */
  value: string
  /** The evaluated magnitude in SI, when the model solved. */
  si?: number
  dim?: Dim
  /** Project unit preferences, so a length shows in the project's chosen unit. */
  units?: Readonly<Record<string, string>>
  error?: string
  locked?: boolean
  overridden?: boolean
  snap?: boolean
  readOnly?: boolean
  onCommit(next: string): void
  onToggleLock?(next: boolean): void
  onToggleSnap?(next: boolean): void
  onRevert?(): void
}

export function NumericField(props: NumericFieldProps): JSX.Element {
  const [draft, setDraft] = useState(props.value)
  const [focused, setFocused] = useState(false)
  const dragging = useRef<{ startX: number; start: number; unit: string } | null>(null)

  useEffect(() => { if (!focused) setDraft(props.value) }, [props.value, focused])

  const sym = props.dim ? displayUnit(props.units ?? {}, props.dim, unitOf(props.value)) : ''
  const shown = props.si !== undefined && props.dim
    ? formatNumber(safeToUnit(props.si, props.dim, sym), 6) + (sym ? ` ${sym}` : '')
    : undefined
  const isLiteral = parseLiteral(props.value) !== undefined

  const beginScrub = (ev: React.PointerEvent): void => {
    if (props.readOnly || props.locked) return
    const lit = parseLiteral(props.value)
    if (!lit) return
    const u = unitOf(props.value) || sym
    dragging.current = { startX: ev.clientX, start: u ? lit.si / resolveUnit(u).factor : lit.si, unit: u }
    ;(ev.target as Element).setPointerCapture(ev.pointerId)
  }

  const scrub = (ev: React.PointerEvent): void => {
    const d = dragging.current
    if (!d) return
    // Shift coarsens, Shift+Ctrl fine-tunes -- the same modifiers as every viewport handle.
    const step = stepFor(d.start) * (ev.shiftKey && ev.ctrlKey ? 0.1 : ev.shiftKey ? 10 : 1)
    const next = d.start + Math.round((ev.clientX - d.startX) / 3) * step
    const text = `${formatNumber(next, 6)}${d.unit ? ` ${d.unit}` : ''}`
    setDraft(text)
    props.onCommit(text)
  }

  const endScrub = (): void => { dragging.current = null }

  return (
    <div className={`nf${props.error ? ' nf-error' : ''}${props.locked ? ' nf-locked' : ''}`}>
      <div className="nf-head">
        <span
          className={`nf-label${isLiteral && !props.readOnly ? ' nf-scrub' : ''}`}
          onPointerDown={beginScrub}
          onPointerMove={scrub}
          onPointerUp={endScrub}
          title={isLiteral ? 'drag to scrub' : 'an expression; edit it in the field'}
        >
          {props.label}
        </span>
        {props.overridden && (
          <span
            className="nf-override"
            title="overridden on this instance; click to revert to the definition default"
            onClick={props.onRevert}
          />
        )}
        <span className="nf-spacer" />
        {props.onToggleSnap && (
          <button
            className={`nf-toggle${props.snap ? ' on' : ''}`}
            title="snap this value to the grid or angle increment"
            onClick={() => props.onToggleSnap!(!props.snap)}
          >snap</button>
        )}
        {props.onToggleLock && (
          <button
            className={`nf-toggle${props.locked ? ' on' : ''}`}
            title="lock: the solver may not change this value"
            onClick={() => props.onToggleLock!(!props.locked)}
          >{props.locked ? 'locked' : 'lock'}</button>
        )}
      </div>
      <input
        className="nf-input"
        value={draft}
        readOnly={props.readOnly}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (draft !== props.value) props.onCommit(draft) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { props.onCommit(draft); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(props.value); (e.target as HTMLInputElement).blur() }
        }}
      />
      {shown !== undefined && shown !== draft && <div className="nf-value">= {shown}</div>}
      {props.dim && !isDimless(props.dim) && !unitOf(draft) && parseLiteral(draft) && (
        <div className="nf-warn">
          needs a unit: this is a {dimToString(props.dim)} quantity
        </div>
      )}
      {props.error && <div className="nf-msg">{props.error}</div>}
    </div>
  )
}

function unitOf(text: string): string {
  const m = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*(.*?)\s*$/.exec(text)
  return m?.[1] ?? ''
}

function safeToUnit(si: number, dim: Dim, sym: string): number {
  if (!sym) return si
  try { return toUnit({ si, dim, unit: sym }, sym) } catch { return si }
}

/** One unit in the last displayed digit, so a scrub moves what the reader can see. */
function stepFor(x: number): number {
  const a = Math.abs(x)
  if (a === 0) return 0.01
  const mag = Math.floor(Math.log10(a))
  return Math.pow(10, mag - 2)
}
