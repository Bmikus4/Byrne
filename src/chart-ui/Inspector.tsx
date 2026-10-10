import type { JSX } from 'react'
import { useMemo } from 'react'
import { Anchor, Obj, ObjOf, SIZES, TYPE_NAMES, Vec, make } from '../chart/model.js'
import { ringRadii } from '../chart/render.js'
import { elementsOf, kindName, stateFrom } from '../chart/orbit.js'
import { sample } from '../chart/curves.js'
import { Field, Num, Section, Segmented, Slider, Swatches, TextArea, Toggle, XY, fmt } from './controls.js'
import { duplicates, selected, useChart } from './store.js'
import { replacePicture } from './images.js'
import { STATES, binaryOf, framePhase, spectrum, stateRecord } from '../chart/field.js'
import { downloadText, stateRecordText } from './io.js'
import { SPECTRUM_SAMPLES } from '../chart/render.js'

type Patch<T extends Obj> = (p: Partial<T>, field: string) => void

export function Inspector(): JSX.Element {
  const doc = useChart((s) => s.doc)
  const selection = useChart((s) => s.selection)
  const objs = useMemo(() => selected({ doc, selection }), [doc, selection])
  if (objs.length === 0) return <PagePanel />
  if (objs.length > 1) return <MultiPanel objs={objs} />
  return <ObjectPanel o={objs[0]!} />
}

function ObjectPanel({ o }: { o: Obj }): JSX.Element {
  const update = useChart((s) => s.update)
  const patch = (p: Partial<Obj>, field: string): void => update([o.id], (x) => ({ ...x, ...p } as Obj), `${o.id}:${field}`)
  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="kind">{TYPE_NAMES[o.type]}</span>
        <input className="name" value={o.name} onChange={(e) => patch({ name: e.target.value }, 'name')} aria-label="Name" />
      </div>
      <Body o={o} patch={patch} />
      <Actions o={o} />
    </div>
  )
}

function Body({ o, patch }: { o: Obj; patch: Patch<Obj> }): JSX.Element {
  switch (o.type) {
    case 'circle': return <CirclePanel o={o} patch={patch as Patch<typeof o>} />
    case 'band': return <BandPanel o={o} patch={patch as Patch<typeof o>} />
    case 'rings': return <RingsPanel o={o} patch={patch as Patch<typeof o>} />
    case 'line': return <LinePanel o={o} patch={patch as Patch<typeof o>} />
    case 'arc': return <ArcPanel o={o} patch={patch as Patch<typeof o>} />
    case 'dot': return <DotPanel o={o} patch={patch as Patch<typeof o>} />
    case 'label': return <LabelPanel o={o} patch={patch as Patch<typeof o>} />
    case 'box': return <BoxPanel o={o} patch={patch as Patch<typeof o>} />
    case 'ticks': return <TicksPanel o={o} patch={patch as Patch<typeof o>} />
    case 'curve': return <CurvePanel o={o} patch={patch as Patch<typeof o>} />
    case 'path': return <PathPanel o={o} patch={patch as Patch<typeof o>} />
    case 'orbit': return <OrbitPanel o={o} patch={patch as Patch<typeof o>} />
    case 'field': return <FieldPanel o={o} patch={patch as Patch<typeof o>} />
    case 'image': return <ImagePanel o={o} patch={patch as Patch<typeof o>} />
  }
}

// ---------------------------------------------------------------------------
// Shared pieces

function LineStyle({ o, patch, title = 'Line', fill }: { o: Obj; patch: Patch<Obj>; title?: string; fill?: boolean }): JSX.Element {
  return (
    <Section title={title}>
      <Field label="Colour"><Swatches value={o.color} onChange={(v) => patch({ color: v }, 'color')} /></Field>
      <Field label="Thickness"><Slider value={o.width} min={0} max={4} step={0.1} unit="pt" onChange={(v) => patch({ width: v }, 'width')} /></Field>
      <Field label="Pattern">
        <Segmented value={o.dash} onChange={(v) => patch({ dash: v }, 'dash')} options={[
          { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' },
        ]} />
      </Field>
      {fill && <Field label="Fill"><Swatches allowNone value={o.fill} onChange={(v) => patch({ fill: v }, 'fill')} /></Field>}
      <Field label="Opacity"><Slider value={o.opacity} min={0.05} max={1} step={0.05} onChange={(v) => patch({ opacity: v }, 'opacity')} /></Field>
    </Section>
  )
}

const ARROWS = [
  { value: 'none' as const, label: 'None' }, { value: 'end' as const, label: '→' },
  { value: 'start' as const, label: '←' }, { value: 'both' as const, label: '↔' },
]

// ---------------------------------------------------------------------------

function CirclePanel({ o, patch }: { o: ObjOf<'circle'>; patch: Patch<ObjOf<'circle'>> }): JSX.Element {
  return (<>
    <Section title="Shape">
      <Field label="Centre"><XY value={o.c} onChange={(c) => patch({ c }, 'c')} /></Field>
      <Field label="Radius"><Slider value={o.r} min={0.05} max={12} step={0.05} unit="cm" onChange={(r) => patch({ r }, 'r')} /></Field>
    </Section>
    <LineStyle o={o} patch={patch as Patch<Obj>} fill />
  </>)
}

function BandPanel({ o, patch }: { o: ObjOf<'band'>; patch: Patch<ObjOf<'band'>> }): JSX.Element {
  return (<>
    <Section title="Band">
      <Field label="Centre"><XY value={o.c} onChange={(c) => patch({ c }, 'c')} /></Field>
      <Field label="Radius"><Slider value={o.r} min={0.05} max={12} step={0.05} unit="cm" onChange={(r) => patch({ r }, 'r')} /></Field>
      <Field label="Thickness"><Slider value={o.thick} min={0.01} max={2} step={0.01} unit="cm" onChange={(thick) => patch({ thick }, 'thick')} /></Field>
      <Field label="Colour"><Swatches value={o.color} onChange={(v) => patch({ color: v }, 'color')} /></Field>
      <Field label="Opacity"><Slider value={o.opacity} min={0.05} max={1} step={0.05} onChange={(v) => patch({ opacity: v }, 'opacity')} /></Field>
    </Section>
    <Section title="Centre line">
      <Field label="Colour"><Swatches allowNone value={o.edge} onChange={(v) => patch({ edge: v }, 'edge')} /></Field>
      <Field label="Thickness"><Slider value={o.width} min={0} max={3} step={0.1} unit="pt" onChange={(v) => patch({ width: v }, 'width')} /></Field>
    </Section>
  </>)
}

function RingsPanel({ o, patch }: { o: ObjOf<'rings'>; patch: Patch<ObjOf<'rings'>> }): JSX.Element {
  const s = useChart.getState()
  const split = (): void => {
    const bands = ringRadii(o).map(({ r, t }, i) => make('band', o.c, {
      r, thick: t, color: o.color, edge: o.edge, width: o.width, opacity: o.opacity, name: `${o.name} ${i + 1}`,
    }))
    s.edit((d) => {
      const i = d.objects.findIndex((x) => x.id === o.id)
      const objects = d.objects.slice()
      objects.splice(i, 1, ...bands)
      return { ...d, objects }
    })
    s.select(bands.map((b) => b.id))
  }
  return (<>
    <Section title="Rings">
      <Field label="Centre"><XY value={o.c} onChange={(c) => patch({ c }, 'c')} /></Field>
      <Field label="Outer edge" hint="The radius the rings crowd toward, or out from"><Slider value={o.r} min={0.2} max={12} step={0.05} unit="cm" onChange={(r) => patch({ r }, 'r')} /></Field>
      <Field label="How many"><Slider value={o.count} min={1} max={20} step={1} onChange={(count) => patch({ count: Math.round(count) }, 'count')} /></Field>
      <Field label="Spacing">
        <Segmented value={o.spacing} onChange={(spacing) => patch({ spacing }, 'spacing')} options={[
          { value: 'hyperbolic', label: 'Crowd outward', title: 'Equal steps in hyperbolic distance: rings bunch up toward the edge (Chart I)' },
          { value: 'converging', label: 'Crowd inward', title: 'Each ring a fixed ratio closer to the centre (Chart II)' },
          { value: 'even', label: 'Even', title: 'Evenly spaced' },
        ]} />
      </Field>
      {o.spacing !== 'even' && (
        <Field label="Ratio" hint="λ: how fast the rings crowd. 2 means each step halves or doubles.">
          <Slider value={o.ratio} min={1.05} max={5} step={0.05} onChange={(ratio) => patch({ ratio }, 'ratio')} />
        </Field>
      )}
      {o.spacing === 'converging' && (
        <Field label="First ring" hint="Hyperbolic radius of the outermost ring">
          <Slider value={o.start} min={0.1} max={6} step={0.05} onChange={(start) => patch({ start }, 'start')} />
        </Field>
      )}
    </Section>
    <Section title="Band look">
      <Field label="Thickness"><Slider value={o.thick} min={0} max={1} step={0.01} onChange={(thick) => patch({ thick }, 'thick')} /></Field>
      <Field label="Thickness rule">
        <Segmented value={o.thickness} onChange={(thickness) => patch({ thickness }, 'thickness')} options={[
          { value: 'hyperbolic', label: 'Thins outward', title: 'Same hyperbolic thickness, so bands thin toward the edge' },
          { value: 'proportional', label: 'With radius', title: 'Thickness proportional to radius' },
          { value: 'fixed', label: 'Same', title: 'Every band the same thickness' },
        ]} />
      </Field>
      <Field label="Colour"><Swatches value={o.color} onChange={(v) => patch({ color: v }, 'color')} /></Field>
      <Field label="Centre line"><Swatches allowNone value={o.edge} onChange={(v) => patch({ edge: v }, 'edge')} /></Field>
      <Field label="Line thickness"><Slider value={o.width} min={0} max={3} step={0.1} unit="pt" onChange={(v) => patch({ width: v }, 'width')} /></Field>
      <button className="wide" onClick={split} title="Replace the set with separate bands you can move one at a time">Split into separate bands</button>
    </Section>
  </>)
}

function LinePanel({ o, patch }: { o: ObjOf<'line'>; patch: Patch<ObjOf<'line'>> }): JSX.Element {
  const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1])
  const ang = (Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]) * 180) / Math.PI
  const polar = (L: number, deg: number): Vec => [o.a[0] + L * Math.cos((deg * Math.PI) / 180), o.a[1] + L * Math.sin((deg * Math.PI) / 180)]
  return (<>
    <Section title="Line">
      <Field label="Start"><XY value={o.a} onChange={(a) => patch({ a }, 'a')} /></Field>
      <Field label="End"><XY value={o.b} onChange={(b) => patch({ b }, 'b')} /></Field>
      <Field label="Length"><Num value={len} unit="cm" onChange={(L) => patch({ b: polar(L, ang) }, 'b')} /></Field>
      <Field label="Angle"><Num value={ang} step={1} unit="°" onChange={(d) => patch({ b: polar(len, d) }, 'b')} /></Field>
      <Field label="Arrowhead"><Segmented value={o.arrow} onChange={(arrow) => patch({ arrow }, 'arrow')} options={ARROWS} /></Field>
      <Field label="Shape"><Segmented value={o.wavy} onChange={(wavy) => patch({ wavy }, 'wavy')} options={[
        { value: false, label: 'Straight' }, { value: true, label: 'Wavy' },
      ]} /></Field>
    </Section>
    <LineStyle o={o} patch={patch as Patch<Obj>} />
  </>)
}

function ArcPanel({ o, patch }: { o: ObjOf<'arc'>; patch: Patch<ObjOf<'arc'>> }): JSX.Element {
  return (<>
    <Section title="Arc">
      <Field label="Centre"><XY value={o.c} onChange={(c) => patch({ c }, 'c')} /></Field>
      <Field label="Radius"><Slider value={o.r} min={0.05} max={12} step={0.05} unit="cm" onChange={(r) => patch({ r }, 'r')} /></Field>
      <Field label="From angle"><Num value={o.from} step={1} unit="°" onChange={(from) => patch({ from }, 'from')} /></Field>
      <Field label="To angle"><Num value={o.to} step={1} unit="°" onChange={(to) => patch({ to }, 'to')} /></Field>
      <Field label="Arrowhead"><Segmented value={o.arrow} onChange={(arrow) => patch({ arrow }, 'arrow')} options={ARROWS} /></Field>
    </Section>
    <LineStyle o={o} patch={patch as Patch<Obj>} />
  </>)
}

function DotPanel({ o, patch }: { o: ObjOf<'dot'>; patch: Patch<ObjOf<'dot'>> }): JSX.Element {
  return (
    <Section title="Dot">
      <Field label="Position"><XY value={o.at} onChange={(at) => patch({ at }, 'at')} /></Field>
      <Field label="Size"><Slider value={o.size} min={1} max={24} step={0.5} unit="pt" onChange={(size) => patch({ size }, 'size')} /></Field>
      <Field label="Colour"><Swatches value={o.color} onChange={(v) => patch({ color: v }, 'color')} /></Field>
    </Section>
  )
}

const TEXT_HINT = 'Type normally. $x^2$ for maths, **bold** for bold, Enter for a new line.'

function TextFields({ o, patch }: { o: ObjOf<'label'> | ObjOf<'box'>; patch: Patch<ObjOf<'label'> | ObjOf<'box'>> }): JSX.Element {
  const focus = useChart((s) => s.focusText)
  return (<>
    <Field label="Heading" hint="Bold first line"><TextArea value={o.title} rows={1} onChange={(title) => patch({ title }, 'title')} placeholder="(optional)" /></Field>
    <Field label="Text" hint={TEXT_HINT}><TextArea value={o.text} rows={2} focusToken={focus} onChange={(text) => patch({ text }, 'text')} /></Field>
    <Field label="Grey note" hint="Smaller grey line underneath, for the formal tag"><TextArea value={o.note} rows={1} onChange={(note) => patch({ note }, 'note')} placeholder="(optional)" /></Field>
    <p className="tip">{TEXT_HINT}</p>
  </>)
}

const ANCHORS: Anchor[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']

function LabelPanel({ o, patch }: { o: ObjOf<'label'>; patch: Patch<ObjOf<'label'>> }): JSX.Element {
  return (<>
    <Section title="Words">
      <TextFields o={o} patch={patch as never} />
      <Field label="Size"><Segmented value={o.size} onChange={(size) => patch({ size }, 'size')} options={SIZES.map((s) => ({ value: s.pt, label: s.name }))} /></Field>
      <Field label="Colour"><Swatches value={o.color} onChange={(v) => patch({ color: v }, 'color')} /></Field>
      <Field label="Align lines"><Segmented value={o.align} onChange={(align) => patch({ align }, 'align')} options={[
        { value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' },
      ]} /></Field>
    </Section>
    <Section title="Placement">
      <Field label="Position"><XY value={o.at} onChange={(at) => patch({ at }, 'at')} /></Field>
      <Field label="Pinned at" hint="Which point of the label sits on its position. Pick the side facing what it labels.">
        <span className="anchors">
          {ANCHORS.map((a) => (
            <button key={a} className={o.anchor === a ? 'on' : ''} onClick={() => patch({ anchor: a }, 'anchor')} title={a} />
          ))}
        </span>
      </Field>
      <Toggle checked={!!o.leader} label="Pointer line" onChange={(on) => patch({ leader: on ? [o.at[0] + 1, o.at[1] + 1] : null }, 'leader')} />
      {o.leader && <>
        <Field label="Pointer tip"><XY value={o.leader} onChange={(leader) => patch({ leader }, 'leader')} /></Field>
        <Field label="Pointer colour"><Swatches value={o.leaderColor} onChange={(v) => patch({ leaderColor: v }, 'leaderColor')} /></Field>
      </>}
    </Section>
  </>)
}

function BoxPanel({ o, patch }: { o: ObjOf<'box'>; patch: Patch<ObjOf<'box'>> }): JSX.Element {
  return (<>
    <Section title="Words">
      <TextFields o={o} patch={patch as never} />
      <Field label="Size"><Segmented value={o.size} onChange={(size) => patch({ size }, 'size')} options={SIZES.slice(0, 4).map((s) => ({ value: s.pt, label: s.name }))} /></Field>
    </Section>
    <Section title="Box">
      <Field label="Top-left"><XY value={o.at} onChange={(at) => patch({ at }, 'at')} /></Field>
      <Field label="Width"><Slider value={o.w} min={1} max={20} step={0.1} unit="cm" onChange={(w) => patch({ w }, 'w')} /></Field>
      <Field label="Border"><Swatches allowNone value={o.width > 0 ? o.color : ''} onChange={(v) => patch(v ? { color: v, width: o.width || 0.4 } : { width: 0 }, 'color')} /></Field>
      <Field label="Background"><Swatches allowNone value={o.fill} onChange={(v) => patch({ fill: v }, 'fill')} /></Field>
    </Section>
  </>)
}

function TicksPanel({ o, patch }: { o: ObjOf<'ticks'>; patch: Patch<ObjOf<'ticks'>> }): JSX.Element {
  return (<>
    <Section title="Tick string">
      <Field label="Digits" hint="One tick per character, labelled with it. A space leaves a gap.">
        <input className="mono-in" value={o.bits} onChange={(e) => patch({ bits: e.target.value }, 'bits')} />
      </Field>
      <Field label="Centre"><XY value={o.c} onChange={(c) => patch({ c }, 'c')} /></Field>
      <Field label="Radius"><Slider value={o.r} min={0.1} max={12} step={0.05} unit="cm" onChange={(r) => patch({ r }, 'r')} /></Field>
      <Field label="First tick"><Num value={o.from} step={1} unit="°" onChange={(from) => patch({ from }, 'from')} /></Field>
      <Field label="Last tick"><Num value={o.to} step={1} unit="°" onChange={(to) => patch({ to }, 'to')} /></Field>
      <Field label="Tick length"><Slider value={o.length} min={0.05} max={1.5} step={0.01} unit="cm" onChange={(length) => patch({ length }, 'length')} /></Field>
    </Section>
    <LineStyle o={o} patch={patch as Patch<Obj>} />
  </>)
}

const CURVE_EXAMPLES: ReadonlyArray<{ name: string; set: Partial<ObjOf<'curve'>> }> = [
  { name: 'Sine wave', set: { mode: 'function', fx: 'sin(x)', from: -6.28, to: 6.28 } },
  { name: 'Parabola', set: { mode: 'function', fx: 'x^2 / 4', from: -4, to: 4 } },
  { name: 'Bell curve', set: { mode: 'function', fx: '3*exp(-x^2/2)', from: -4, to: 4 } },
  { name: 'Spiral (Archimedes)', set: { mode: 'polar', pr: '0.25*theta', from: 0, to: 25 } },
  { name: 'Log spiral', set: { mode: 'polar', pr: '0.2*exp(0.15*theta)', from: 0, to: 18.85 } },
  { name: 'Rose (k petals)', set: { mode: 'polar', pr: '3*cos(k*theta)', from: 0, to: 6.2832, k: 5 } },
  { name: 'Cardioid', set: { mode: 'polar', pr: '2*(1 + cos(theta))', from: 0, to: 6.2832 } },
  { name: 'Lissajous', set: { mode: 'parametric', px: '3*sin(3*t)', py: '3*sin(k*t)', from: 0, to: 6.2832, k: 2 } },
  { name: 'Heart', set: { mode: 'parametric', px: '0.2*16*sin(t)^3', py: '0.2*(13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t))', from: 0, to: 6.2832 } },
  { name: 'Damped wave', set: { mode: 'function', fx: '3*exp(-x/4)*cos(k*x)', from: 0, to: 12, k: 3 } },
]

function CurvePanel({ o, patch }: { o: ObjOf<'curve'>; patch: Patch<ObjOf<'curve'>> }): JSX.Element {
  const err = sample(o).error
  const v = o.mode === 'function' ? 'x' : o.mode === 'polar' ? 'θ' : 't'
  return (<>
    <Section title="Formula">
      <Field label="Kind">
        <Segmented value={o.mode} onChange={(mode) => patch({ mode }, 'mode')} options={[
          { value: 'function', label: 'y = f(x)' }, { value: 'parametric', label: 'x(t), y(t)' }, { value: 'polar', label: 'r = f(θ)' },
        ]} />
      </Field>
      {o.mode === 'function' && <Field label="y ="><input className="mono-in" value={o.fx} onChange={(e) => patch({ fx: e.target.value }, 'fx')} /></Field>}
      {o.mode === 'parametric' && <>
        <Field label="x ="><input className="mono-in" value={o.px} onChange={(e) => patch({ px: e.target.value }, 'px')} /></Field>
        <Field label="y ="><input className="mono-in" value={o.py} onChange={(e) => patch({ py: e.target.value }, 'py')} /></Field>
      </>}
      {o.mode === 'polar' && <Field label="r ="><input className="mono-in" value={o.pr} onChange={(e) => patch({ pr: e.target.value }, 'pr')} /></Field>}
      {err ? <p className="err">{err}</p> : <p className="tip">Use {v}{o.mode === 'polar' ? ' (or theta)' : ''}, k, pi, e, and sin cos tan exp ln sqrt abs. 2x means 2*x.</p>}
      <Field label={`${v} from`}><Num value={o.from} onChange={(from) => patch({ from }, 'from')} /></Field>
      <Field label={`${v} to`}><Num value={o.to} onChange={(to) => patch({ to }, 'to')} /></Field>
      <Field label="k" hint="A free number for the formula: slide it and watch the curve change"><Slider value={o.k} min={-10} max={10} step={0.05} onChange={(k) => patch({ k }, 'k')} /></Field>
      <Field label="Scale"><Slider value={o.scale} min={0.05} max={5} step={0.05} onChange={(scale) => patch({ scale }, 'scale')} /></Field>
      <Field label="Origin"><XY value={o.at} onChange={(at) => patch({ at }, 'at')} /></Field>
      <Field label="Start from">
        <select className="sel" value="" onChange={(e) => { const ex = CURVE_EXAMPLES.find((x) => x.name === e.target.value); if (ex) patch(ex.set, 'example') }}>
          <option value="">An example...</option>
          {CURVE_EXAMPLES.map((x) => <option key={x.name}>{x.name}</option>)}
        </select>
      </Field>
    </Section>
    <LineStyle o={o} patch={patch as Patch<Obj>} />
  </>)
}

function PathPanel({ o, patch }: { o: ObjOf<'path'>; patch: Patch<ObjOf<'path'>> }): JSX.Element {
  return (<>
    <Section title="Drawn curve">
      <Toggle checked={o.smooth} label="Smooth through the points" onChange={(smooth) => patch({ smooth }, 'smooth')} />
      <Toggle checked={o.closed} label="Close the shape" onChange={(closed) => patch({ closed, tan: o.tan?.map((t, j) => (j === 0 || j === o.pts.length - 1 ? null : t)) }, 'closed')} />
      <p className="tip">{o.pts.length} points. Drag any point to reshape it.</p>
    </Section>
    <LineStyle o={o} patch={patch as Patch<Obj>} fill={o.closed} />
  </>)
}

function OrbitPanel({ o, patch }: { o: ObjOf<'orbit'>; patch: Patch<ObjOf<'orbit'>> }): JSX.Element {
  const el = elementsOf(o.c, o.mu, o.at, o.vel)
  const bound = el.e < 1 && el.kind !== 'parabola' && el.kind !== 'fall'
  const deg = (r: number): number => (r * 180) / Math.PI
  const setShape = (p: { rp?: number; e?: number; omega?: number; nu?: number; dir?: 1 | -1 }, field: string): void => {
    if (el.kind === 'fall') return
    const s = stateFrom(o.c, o.mu, p.rp ?? el.rp, p.e ?? el.e, p.omega ?? el.omega, p.nu ?? el.nu, p.dir ?? el.dir)
    patch({ at: s.at, vel: s.vel }, field)
  }
  const speedTo = (v: number, field: string): void => {
    const sp = Math.hypot(o.vel[0], o.vel[1])
    const r: Vec = [o.at[0] - o.c[0], o.at[1] - o.c[1]]
    const rl = Math.hypot(r[0], r[1]) || 1
    // With no velocity yet, start perpendicular to the radius, anticlockwise.
    const u: Vec = sp > 1e-9 ? [o.vel[0] / sp, o.vel[1] / sp] : [-r[1] / rl, r[0] / rl]
    patch({ vel: [u[0] * v, u[1] * v] }, field)
  }
  const circular = (): void => {
    const r: Vec = [o.at[0] - o.c[0], o.at[1] - o.c[1]]
    const rl = Math.hypot(r[0], r[1]) || 1
    const v = Math.sqrt(o.mu / rl)
    patch({ vel: [(-r[1] / rl) * v * el.dir, (r[0] / rl) * v * el.dir] }, 'circular')
  }
  return (<>
    <div className="readout">
      <div className="ro-kind">{kindName(el.kind)}</div>
      <dl>
        <dt>Eccentricity</dt><dd>{fmt(el.e)}</dd>
        <dt>Closest approach</dt><dd>{fmt(el.rp)} cm</dd>
        <dt>Farthest point</dt><dd>{bound ? `${fmt(el.ra)} cm` : 'none (escapes)'}</dd>
        <dt>Period</dt><dd>{bound ? `${fmt(el.period)} s` : 'never returns'}</dd>
        <dt>Speed now</dt><dd>{fmt(el.speed)}</dd>
        <dt>Circular speed here</dt><dd>{fmt(el.circularSpeed)}</dd>
        <dt>Escape speed here</dt><dd>{fmt(el.escapeSpeed)}</dd>
        <dt>Energy</dt><dd>{fmt(el.energy)}</dd>
      </dl>
    </div>
    <Section title="Motion">
      <div className="btnrow">
        <button onClick={circular} title="Set the speed and direction for a perfect circle at this distance">Make circular</button>
        <button onClick={() => speedTo(el.escapeSpeed, 'escape')} title="Exactly enough speed to never come back">Escape speed</button>
        <button onClick={() => patch({ vel: [-o.vel[0], -o.vel[1]] }, 'reverse')}>Reverse</button>
      </div>
      <Field label="Speed"><Slider value={el.speed} min={0} max={Math.max(1, el.escapeSpeed * 1.6)} step={0.01} onChange={(v) => speedTo(v, 'speed')} /></Field>
      <Field label="Gravity" hint="Strength of the central body (GM). Stronger gravity, same speed: a tighter orbit.">
        <Slider value={o.mu} min={0.1} max={60} step={0.1} onChange={(mu) => patch({ mu }, 'mu')} />
      </Field>
    </Section>
    {el.kind !== 'fall' && (
      <Section title="Shape">
        <Field label="Eccentricity" hint="0 circle, under 1 ellipse, 1 parabola, over 1 hyperbola">
          <Slider value={el.e} min={0} max={3} step={0.01} onChange={(e) => setShape({ e }, 'e')} />
        </Field>
        <Field label="Closest approach"><Slider value={el.rp} min={0.1} max={10} step={0.05} unit="cm" onChange={(rp) => setShape({ rp }, 'rp')} /></Field>
        <Field label="Tilt" hint="Direction of the closest point"><Slider value={deg(el.omega)} min={-180} max={180} step={1} unit="°" onChange={(d) => setShape({ omega: (d * Math.PI) / 180 }, 'omega')} /></Field>
        <Field label="Where on it" hint="Angle from the closest point to the satellite"><Slider value={deg(el.nu)} min={-180} max={180} step={1} unit="°" onChange={(d) => setShape({ nu: (d * Math.PI) / 180 }, 'nu')} /></Field>
        <Field label="Direction"><Segmented value={el.dir} onChange={(dir) => setShape({ dir }, 'dir')} options={[
          { value: 1, label: 'Anticlockwise' }, { value: -1, label: 'Clockwise' },
        ]} /></Field>
      </Section>
    )}
    <Section title="Show">
      <Toggle checked={o.showBody} label="Central body" onChange={(showBody) => patch({ showBody }, 'showBody')} />
      <Toggle checked={o.showSatellite} label="Satellite" onChange={(showSatellite) => patch({ showSatellite }, 'showSatellite')} />
      <Toggle checked={o.showVelocity} label="Velocity arrow" onChange={(showVelocity) => patch({ showVelocity }, 'showVelocity')} />
      <Toggle checked={o.showRadius} label="Line to the body" onChange={(showRadius) => patch({ showRadius }, 'showRadius')} />
      <Toggle checked={o.showApsides} label="Closest and farthest points" onChange={(showApsides) => patch({ showApsides }, 'showApsides')} />
      <Toggle checked={o.showFoci} label="Empty focus" onChange={(showFoci) => patch({ showFoci }, 'showFoci')} />
      <Field label="Time marks" hint="Dots at equal intervals of TIME. Closer together where the orbit is slow.">
        <Slider value={o.marks} min={0} max={36} step={1} onChange={(marks) => patch({ marks: Math.round(marks) }, 'marks')} />
      </Field>
      {o.marks > 0 && <Toggle checked={o.spokes} label="Spokes (equal areas, Kepler's second law)" onChange={(spokes) => patch({ spokes }, 'spokes')} />}
      <Field label="Arrow length"><Slider value={o.arrowScale} min={0.1} max={4} step={0.05} onChange={(arrowScale) => patch({ arrowScale }, 'arrowScale')} /></Field>
      {!bound && <Field label="Draw out to"><Slider value={o.reach} min={2} max={40} step={0.5} unit="cm" onChange={(reach) => patch({ reach }, 'reach')} /></Field>}
    </Section>
    <Section title="Colours">
      <Field label="Orbit"><Swatches value={o.color} onChange={(v) => patch({ color: v }, 'color')} /></Field>
      <Field label="Central body"><Swatches value={o.bodyColor} onChange={(v) => patch({ bodyColor: v }, 'bodyColor')} /></Field>
      <Field label="Satellite"><Swatches value={o.satColor} onChange={(v) => patch({ satColor: v }, 'satColor')} /></Field>
      <Field label="Thickness"><Slider value={o.width} min={0.1} max={4} step={0.1} unit="pt" onChange={(v) => patch({ width: v }, 'width')} /></Field>
      <Field label="Pattern">
        <Segmented value={o.dash} onChange={(v) => patch({ dash: v }, 'dash')} options={[
          { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' },
        ]} />
      </Field>
    </Section>
  </>)
}

// ---------------------------------------------------------------------------

function FieldPanel({ o, patch }: { o: ObjOf<'field'>; patch: Patch<ObjOf<'field'>> }): JSX.Element {
  const bits = useMemo(() => binaryOf(spectrum(o, o.sliceAngle, SPECTRUM_SAMPLES), Math.round(o.sites)), [o])
  return (<>
    <Section title="Field">
      <Field label="Centre"><XY value={o.c} onChange={(c) => patch({ c }, 'c')} /></Field>
      <Field label="Radius"><Slider value={o.r} min={0.5} max={12} step={0.05} unit="cm" onChange={(r) => patch({ r }, 'r')} /></Field>
      <Field label="Ring ratio" hint="Each crest is this many times further out than the next one in. Closer to 1 means more rings.">
        <Slider value={o.ratio} min={1.1} max={3} step={0.01} onChange={(ratio) => patch({ ratio }, 'ratio')} />
      </Field>
      <Field label="Pockets" hint="Dense spots per crest, on a spiral"><Slider value={o.pockets} min={0} max={12} step={1} onChange={(v) => patch({ pockets: Math.round(v) }, 'pockets')} /></Field>
      <Field label="Pocket strength"><Slider value={o.strength} min={0} max={1.5} step={0.05} onChange={(strength) => patch({ strength }, 'strength')} /></Field>
      <Field label="Spiral turn" hint="Degrees the pockets turn from one crest to the next"><Slider value={o.twist} min={-180} max={180} step={1} unit="°" onChange={(twist) => patch({ twist }, 'twist')} /></Field>
      <Field label="Pattern"><button onClick={() => patch({ seed: (o.seed * 7919 + 13) % 100000 }, 'seed')}>Shuffle pockets</button></Field>
      <Toggle checked={o.poles} label="Each pole carries its own field (half scale)" onChange={(poles) => patch({ poles }, 'poles')} />
    </Section>
    <Section title="Colour">
      <Field label="Colours">
        <Segmented value={o.palette} onChange={(palette) => patch({ palette }, 'palette')} options={[
          { value: 'jet', label: 'Rainbow' }, { value: 'viridis', label: 'Viridis' }, { value: 'magma', label: 'Magma' },
          { value: 'ice', label: 'Ice' }, { value: 'grey', label: 'Grey' },
        ]} />
      </Field>
      <Field label="Rim"><Swatches allowNone value={o.width > 0 ? o.color : ''} onChange={(v) => patch(v ? { color: v, width: o.width || 2.4 } : { width: 0 }, 'color')} /></Field>
      <Field label="Rim width"><Slider value={o.width} min={0} max={6} step={0.1} unit="pt" onChange={(width) => patch({ width }, 'width')} /></Field>
      <Field label="Detail" hint="Pixels across. More is sharper and slower."><Slider value={o.detail} min={120} max={720} step={20} onChange={(v) => patch({ detail: Math.round(v) }, 'detail')} /></Field>
      <Field label="Opacity"><Slider value={o.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => patch({ opacity }, 'opacity')} /></Field>
    </Section>
    <Section title="Overlay and slice">
      <Toggle checked={o.geometry} label="Horn torus and plumb line in white" onChange={(geometry) => patch({ geometry }, 'geometry')} />
      <Toggle checked={o.slice} label="Read a slice as a spectrum and a binary string" onChange={(slice) => patch({ slice }, 'slice')} />
      {o.slice && <>
        <Field label="Slice direction" hint="90° is straight up the plumb line"><Slider value={o.sliceAngle} min={0} max={360} step={1} unit="°" onChange={(sliceAngle) => patch({ sliceAngle }, 'sliceAngle')} /></Field>
        <Field label="Sites"><Slider value={o.sites} min={4} max={64} step={1} onChange={(v) => patch({ sites: Math.round(v) }, 'sites')} /></Field>
        <p className="tip mono">{bits}</p>
        <Toggle checked={o.record} label={`Record every state: ${STATES} frames under the strip`} onChange={(record) => patch({ record }, 'record')} />
      </>}
    </Section>
    {o.slice && o.record && <RecordSection o={o} />}
    <Section title="Motion">
      <Field label="Flow" hint="Play (top bar) runs it. Exported by Export, Animated SVG.">
        <Segmented value={o.flow} onChange={(flow) => patch({ flow }, 'flow')} options={[
          { value: 'in', label: 'Inward' }, { value: 'out', label: 'Outward' }, { value: 'still', label: 'Still' },
        ]} />
      </Field>
      {o.flow !== 'still' && <Field label="Seconds per crest"><Slider value={o.period} min={0.5} max={20} step={0.5} unit="s" onChange={(period) => patch({ period }, 'period')} /></Field>}
    </Section>
  </>)
}

function RecordSection({ o }: { o: ObjOf<'field'> }): JSX.Element {
  const sites = Math.round(o.sites)
  const rows = useMemo(() => stateRecord(o, o.sliceAngle, sites, o.flow), [o, sites])
  const distinct = new Set(rows).size
  // Frame STATES is phase 1, which the field's self-similarity makes frame 0 again.
  const closes = binaryOf(spectrum(o, o.sliceAngle, 400, framePhase(o.flow, 0) + 1), sites) === rows[0]
  const flat = rows.join('')
  const name = (o.name || 'heatmap').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')
  return (
    <Section title="State record">
      <p className="tip">{rows.length} states × {sites} sites = <b>{flat.length} bits</b>. {distinct} of the {rows.length} states are different; frame {rows.length} {closes ? 'is frame 0 again' : 'differs from frame 0'}, so this is the whole history.</p>
      <div className="row-buttons">
        <button onClick={() => { void navigator.clipboard.writeText(flat) }} title="One line of every bit, frame after frame">Copy the {flat.length}-bit string</button>
        <button onClick={() => downloadText(`${name}-states.txt`, stateRecordText(o, rows))} title="One row per frame, with the numbers that regenerate it">Download as text</button>
      </div>
    </Section>
  )
}

function ImagePanel({ o, patch }: { o: ObjOf<'image'>; patch: Patch<ObjOf<'image'>> }): JSX.Element {
  return (<>
    <Section title="Picture">
      <Field label="Centre"><XY value={o.at} onChange={(at) => patch({ at }, 'at')} /></Field>
      <Field label="Width" hint="The height follows, so the picture keeps its shape">
        <Slider value={o.w} min={0.2} max={30} step={0.1} unit="cm" onChange={(w) => patch({ w, h: (w * o.h) / o.w }, 'w')} />
      </Field>
      <Field label="Opacity"><Slider value={o.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => patch({ opacity }, 'opacity')} /></Field>
      <button className="wide" onClick={() => replacePicture(o.id)}>{o.src ? 'Replace picture' : 'Choose a picture'}</button>
    </Section>
    <Section title="Frame" open={o.width > 0}>
      <Field label="Colour"><Swatches value={o.color} onChange={(v) => patch({ color: v, width: o.width || 0.8 }, 'color')} /></Field>
      <Field label="Thickness"><Slider value={o.width} min={0} max={4} step={0.1} unit="pt" onChange={(width) => patch({ width }, 'width')} /></Field>
    </Section>
  </>)
}

function Actions({ o }: { o: Obj }): JSX.Element {
  const s = useChart.getState()
  const reorder = (to: 'up' | 'down' | 'top' | 'bottom'): void => {
    s.edit((d) => {
      const objs = d.objects.slice()
      const i = objs.findIndex((x) => x.id === o.id)
      const [x] = objs.splice(i, 1)
      const j = to === 'top' ? objs.length : to === 'bottom' ? 0 : to === 'up' ? Math.min(objs.length, i + 1) : Math.max(0, i - 1)
      objs.splice(j, 0, x!)
      return { ...d, objects: objs }
    })
  }
  return (
    <Section title="Arrange">
      <div className="btnrow">
        <button onClick={() => reorder('top')} title="In front of everything">To front</button>
        <button onClick={() => reorder('up')}>Forward</button>
        <button onClick={() => reorder('down')}>Back</button>
        <button onClick={() => reorder('bottom')} title="Behind everything">To back</button>
      </div>
      <div className="btnrow">
        <button onClick={() => s.add(duplicates([o]))}>Duplicate</button>
        <button onClick={() => s.update([o.id], (x) => ({ ...x, locked: !x.locked }))}>{o.locked ? 'Unlock' : 'Lock'}</button>
        <button onClick={() => s.update([o.id], (x) => ({ ...x, hidden: !x.hidden }))}>{o.hidden ? 'Show' : 'Hide'}</button>
        <button className="danger" onClick={() => s.remove([o.id])}>Delete</button>
      </div>
      {o.locked && <p className="tip">Locked: it cannot be clicked on the canvas. Select it in the list to change it.</p>}
    </Section>
  )
}

function MultiPanel({ objs }: { objs: Obj[] }): JSX.Element {
  const s = useChart.getState()
  const ids = objs.map((o) => o.id)
  const set = (p: Partial<Obj>, f: string): void => s.update(ids, (x) => ({ ...x, ...p } as Obj), `multi:${f}`)
  return (
    <div className="inspector">
      <div className="insp-head"><span className="kind">{objs.length} selected</span></div>
      <Section title="All of them">
        <Field label="Colour"><Swatches value={objs[0]!.color} onChange={(v) => set({ color: v }, 'color')} /></Field>
        <Field label="Thickness"><Slider value={objs[0]!.width} min={0} max={4} step={0.1} unit="pt" onChange={(v) => set({ width: v }, 'width')} /></Field>
        <Field label="Opacity"><Slider value={objs[0]!.opacity} min={0.05} max={1} step={0.05} onChange={(v) => set({ opacity: v }, 'opacity')} /></Field>
        <div className="btnrow">
          <button onClick={() => s.add(duplicates(objs))}>Duplicate</button>
          <button onClick={() => s.update(ids, (x) => ({ ...x, locked: true }))}>Lock</button>
          <button className="danger" onClick={() => s.remove(ids)}>Delete</button>
        </div>
      </Section>
    </div>
  )
}

function PagePanel(): JSX.Element {
  const doc = useChart((s) => s.doc)
  const edit = useChart((s) => s.edit)
  const g = doc.grid
  const setGrid = (p: Partial<typeof g>, f: string): void => edit((d) => ({ ...d, grid: { ...d.grid, ...p } }), `grid:${f}`)
  return (
    <div className="inspector">
      <div className="insp-head"><span className="kind">Chart</span>
        <input className="name" value={doc.title} onChange={(e) => edit((d) => ({ ...d, title: e.target.value }), 'title')} aria-label="Chart title" />
      </div>
      <Section title="Grid">
        <Field label="Kind"><Segmented value={g.kind} onChange={(kind) => setGrid({ kind }, 'kind')} options={[
          { value: 'square', label: 'Square' }, { value: 'polar', label: 'Circular', title: 'Rings and spokes around the origin: snap to radius and angle' },
        ]} /></Field>
        <Field label={g.kind === 'square' ? 'Spacing' : 'Ring spacing'}>
          <Segmented value={g.step} onChange={(step) => setGrid({ step }, 'step')} options={[0.1, 0.25, 0.5, 1].map((v) => ({ value: v, label: `${v}` }))} />
        </Field>
        {g.kind === 'polar' && (
          <Field label="Angle step">
            <Segmented value={g.angle} onChange={(angle) => setGrid({ angle }, 'angle')} options={[5, 10, 15, 30, 45].map((v) => ({ value: v, label: `${v}°` }))} />
          </Field>
        )}
        <Toggle checked={g.snap} label="Snap to grid and points" onChange={(snap) => setGrid({ snap }, 'snap')} />
        <Toggle checked={g.show} label="Show the grid" onChange={(show) => setGrid({ show }, 'show')} />
      </Section>
      <Section title="Page">
        <Field label="Background"><Swatches value={doc.background} onChange={(background) => edit((d) => ({ ...d, background }), 'bg')} /></Field>
      </Section>
      <Section title="How to">
        <ul className="howto">
          <li>Pick a tool on the left, then click or drag on the page.</li>
          <li>Drag the little squares and circles to move and reshape.</li>
          <li>Hold <kbd>Alt</kbd> while dragging to place freely, off the grid.</li>
          <li>Scroll to zoom. Hold <kbd>Space</kbd> and drag, or right-drag, to move around.</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes anything. Everything saves itself as you go.</li>
        </ul>
      </Section>
    </div>
  )
}
