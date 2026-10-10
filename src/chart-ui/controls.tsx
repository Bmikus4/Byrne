import type { JSX, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { SWATCHES, Vec } from '../chart/model.js'

export function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }): JSX.Element {
  const [isOpen, setOpen] = useState(open)
  return (
    <section className="sec">
      <button className="sec-head" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        <span className={`chev${isOpen ? ' open' : ''}`}>›</span>{title}
      </button>
      {isOpen && <div className="sec-body">{children}</div>}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="field">
      <div className="field-label" title={hint}>{label}{hint && <span className="hint-dot">?</span>}</div>
      <div className="field-ctl">{children}</div>
    </div>
  )
}

/** A number box that lets you type freely and only commits a real number. */
export function Num({ value, onChange, step = 0.1, min, max, unit, width }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; width?: number
}): JSX.Element {
  const [text, setText] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(fmt(value)) }, [value])
  const commit = (s: string): void => {
    const v = Number(s.replace(',', '.'))
    if (s.trim() !== '' && Number.isFinite(v)) onChange(clamp(v, min, max))
  }
  return (
    <span className="num" style={width ? { width } : undefined}>
      <input
        type="text" inputMode="decimal" value={text}
        onFocus={(e) => { focused.current = true; e.target.select() }}
        onBlur={() => { focused.current = false; setText(fmt(value)) }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const v = clamp(round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * k), min, max)
            onChange(v)
            setText(fmt(v))
          }
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  )
}

export function Slider({ value, onChange, min, max, step = 0.01, unit }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string
}): JSX.Element {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={clamp(value, min, max)}
        onChange={(e) => onChange(Number(e.target.value))} />
      <Num value={value} onChange={onChange} step={step >= 1 ? step : step * 10} unit={unit} width={68} />
    </span>
  )
}

export function XY({ value, onChange }: { value: Vec; onChange: (v: Vec) => void }): JSX.Element {
  return (
    <span className="xy">
      <label>x</label><Num value={value[0]} onChange={(x) => onChange([x, value[1]])} unit="cm" width={74} />
      <label>y</label><Num value={value[1]} onChange={(y) => onChange([value[0], y])} unit="cm" width={74} />
    </span>
  )
}

export function Swatches({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }): JSX.Element {
  const known = SWATCHES.some((s) => s.hex.toLowerCase() === value.toLowerCase())
  return (
    <span className="swatches">
      {allowNone && (
        <button className={`sw none${value === '' ? ' on' : ''}`} title="None" onClick={() => onChange('')} />
      )}
      {SWATCHES.map((s) => (
        <button key={s.hex} className={`sw${s.hex.toLowerCase() === value.toLowerCase() ? ' on' : ''}`}
          title={s.name} style={{ background: s.hex }} onClick={() => onChange(s.hex)} />
      ))}
      <label className={`sw custom${value && !known ? ' on' : ''}`} title="Any colour" style={value && !known ? { background: value } : undefined}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        <span>+</span>
      </label>
    </span>
  )
}

export function Segmented<T extends string | number | boolean>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: ReactNode; title?: string }>
}): JSX.Element {
  return (
    <span className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="knob" /></span>
      <span>{label}</span>
    </label>
  )
}

export function TextArea({ value, onChange, placeholder, rows = 2, focusToken }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; focusToken?: number
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusToken) { ref.current?.focus(); ref.current?.select() }
  }, [focusToken])
  const lines = Math.max(rows, value.split('\n').length)
  return (
    <textarea ref={ref} className="ta" value={value} rows={Math.min(10, lines)} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} spellCheck />
  )
}

const clamp = (v: number, min?: number, max?: number): number =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
const round = (x: number): number => Math.round(x * 1e6) / 1e6
export const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—'
  const r = Math.round(v * 1000) / 1000
  return String(Object.is(r, -0) ? 0 : r)
}
