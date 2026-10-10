// Starting charts. Charts I-III are the Fundamental Unit of Experience charts rebuilt from
// their TikZ sources (theory/charts/chart1-3.tex) as editable objects, coordinates
// unchanged, so a chart started from a template is the published chart, not a likeness.
// Chart III carries the two later rulings on it: "Velocity is the Son", and the
// "Alignment of the daemon" box removed.

import { COLORS as C, ChartDoc, Obj, ObjOf, Vec, emptyDoc, make } from './model.js'
import { stateFrom } from './orbit.js'
import { layoutBlock } from './text.js'
import { K } from './render.js'

type LabelOpts = Partial<Omit<ObjOf<'label'>, 'type' | 'at'>>

const label = (at: Vec, o: LabelOpts): Obj => make('label', at, { text: '', ...o, name: o.name ?? firstWords(o.title || o.text || o.note || 'Label') })
const form = (at: Vec, text: string, anchor: ObjOf<'label'>['anchor'] = 'c', extra: LabelOpts = {}): Obj =>
  label(at, { text, anchor, size: 7, color: C.note, ...extra })
const dot = (at: Vec, color: string, size: number, name: string): Obj => make('dot', at, { color, size, name })
const line = (a: Vec, b: Vec, o: Partial<ObjOf<'line'>> = {}): Obj => make('line', a, { b, ...o })

function firstWords(s: string): string {
  const t = s.replace(/\*\*|\$[^$]*\$/g, '').replace(/\s+/g, ' ').trim()
  return t.length > 28 ? `${t.slice(0, 26)}...` : t || 'Label'
}

const rad = (d: number): number => (d * Math.PI) / 180

function title(text: string, sub: string): Obj[] {
  return [
    label([0, 7.3], { title: text, size: 12, name: 'Title' }),
    form([0, 6.75], sub, 'c', { name: 'Subtitle' }),
  ]
}

function disk(): Obj[] {
  return [make('circle', [0, 0], { r: 5, fill: C.shell, width: 0, name: 'Disk', locked: true })]
}

function hyperbolicRings(): Obj {
  return make('rings', [0, 0], {
    r: 5, count: 5, spacing: 'hyperbolic', ratio: 2, thick: 0.2, thickness: 'hyperbolic',
    width: 0.4, name: 'Pocket shells',
  })
}

function horizon(): Obj {
  return make('circle', [0, 0], { r: 5, width: 1.2, name: 'Horizon' })
}

/** The aim construction shared by Charts I and III: vector, reference line, angle. */
function vector(): Obj[] {
  const tip: Vec = [2.6 * Math.sin(rad(18)), 2.6 * Math.cos(rad(18))]
  return [
    line([-5, 0], [5, 0], { color: '#626269', dash: 'dashed', name: 'H axis' }),
    line([0, 0], [0, 5], { color: C.daemon, width: 1.2, wavy: true, name: 'Daemon' }),
    line([0, 0], tip, { width: 1.4, arrow: 'end', name: 'Vector' }),
    line([0, 0], [0, 2.9], { color: C.soft, width: 0.4, name: 'Aim reference' }),
    make('arc', [0, 0], { r: 2.3, from: 90, to: 72, arrow: 'end', color: C.soft, width: 0.4, name: 'Aim angle' }),
  ]
}

function zeroPoints(): Obj[] {
  return [
    dot([0, 0], C.ink, 5, 'Observer point'),
    dot([0, 5], C.source, 7, 'Source point'),
    dot([-5, 0], C.chaos, 6, 'Chaos pole'),
    dot([5, 0], C.order, 6, 'Order pole'),
  ]
}

function bits(): Obj {
  return make('ticks', [0, 0], { r: 5, from: 62, to: 118, bits: '10110 01011', length: 0.28, width: 0.8, name: 'Binary string' })
}

/** Boxes at fixed tops (as the .tex placed them) or stacked 4 pt apart from a first top. */
function boxes(x: number, w: number, items: Array<{ title: string; text: string; note?: string; top?: number }>): Obj[] {
  const out: Obj[] = []
  let y = items[0]?.top ?? 0
  for (const it of items) {
    if (it.top !== undefined) y = it.top
    const b = make('box', [x, y], {
      w, title: it.title, text: it.text, note: it.note ?? '', size: 7, color: C.boxEdge, width: 0.4,
      fill: C.white, name: firstWords(it.title),
    }) as ObjOf<'box'>
    out.push(b)
    const block = layoutBlock({ title: b.title, text: b.text, note: b.note, size: b.size, color: C.ink }, w * K - 8)
    y -= (block.h + 8) / K + 4 / K
  }
  return out
}

function doc(titleText: string, objects: Obj[]): ChartDoc {
  return { ...emptyDoc(titleText), objects }
}

export function chartOne(): ChartDoc {
  return doc('Chart I - The Chart of Experience', [
    ...title('Chart I — The Chart of Experience (observer-centred)',
      'Poincaré disk $\\mathbb{D}$, hyperbolic radius $\\rho$, Euclidean radius $e=\\tanh(\\rho/2)$. Observer at centre; horizon $\\partial\\mathbb{D}$; source on the horizon.'),
    ...disk(), hyperbolicRings(), horizon(), ...vector(),
    form([0.55, 2.45], '$\\theta$ (aim)', 'w', { name: 'aim' }),
    label([2.6 * Math.sin(rad(18)) + 0.15, 2.6 * Math.cos(rad(18))], { text: '$\\vec v=(\\theta,\\ v)$', note: '$v = dk/dt$ (rate along scale axis)', anchor: 'w', name: 'Vector label' }),
    ...zeroPoints(),
    label([-0.9, -0.9], { text: '$x_0$: observer', note: 'zero-point, $\\rho=0$', anchor: 'ne', leader: [-0.08, -0.08], name: 'Observer' }),
    label([1.3, 5.9], { text: '$r^{*}$: source', note: 'zero-point on $\\partial\\mathbb{D}$; $\\rho\\to\\infty$', anchor: 'w', color: C.sourceDark, leader: [0.08, 5.08], leaderColor: C.sourceDark, name: 'Source' }),
    label([-5.15, 0], { text: 'curl$^{-}$', note: 'pole (–)', anchor: 'e', color: C.chaos, name: 'Chaos pole label' }),
    label([5.15, 0], { text: 'curl$^{+}$', note: 'pole (+)', anchor: 'w', color: C.order, name: 'Order pole label' }),
    label([0.2, 3.9], { text: '$\\gamma$: geodesic $x_0\\!\\to\\! r^{*}$', note: 'connection $=$ entanglement link (ER$=$EPR)', anchor: 'w', color: C.daemon, name: 'Geodesic' }),
    form([0.9, -0.1], '$H$ axis: horizontal relation\ngeodesic curl$^-\\!\\leftrightarrow$ curl$^+$', 'nw', { name: 'H axis label' }),
    form([-4.2, -4.6], 'pocket shells $\\rho_n = n\\ln\\lambda$\nequal hyperbolic spacing $\\Rightarrow$\ncrowding toward $\\partial\\mathbb{D}$', 'ne', { leader: [3 * Math.cos(rad(230)), 3 * Math.sin(rad(230))], name: 'Shells label' }),
    bits(),
    form([-3.2, 5.0], '$b=\\mathbb{1}[B-B_0>\\theta_d]$\nprojected onto $\\partial\\mathbb{D}$\n(holographic: $2\\mathrm{D}\\to1\\mathrm{D}$)', 'se', { name: 'String label' }),
    ...boxes(6.8, 6.4, [
      { top: 5.6, title: 'Observation event $e$', text: "$W \\;\\longrightarrow\\; W' = \\mathcal{U}_e W$ (global update of the whole kernel)\nInfinitely many updates per unit time $\\Rightarrow$ generator\n$\\partial_t W = \\mathcal{L}W$,  $W_{t+\\Delta t}=e^{\\Delta t\\,\\mathcal{L}}W_t$" },
      { top: 3.2, title: 'Coordinates', text: '$\\rho(x)=\\phi(x)-\\phi(x_0)$ anchored potential (depth)\n$M=H+V$,  $V=\\nabla\\phi+\\operatorname{curl}\\psi+h$\npoles $=$ orientation of $\\operatorname{curl}\\psi$;  $\\eta=\\|\\nabla\\phi\\|^2/\\|V\\|^2$\n$d_s(x,\\tau)=-2\\,\\dfrac{d\\ln p_x(\\tau)}{d\\ln\\tau}$ local spectrum of $x$' },
      { top: 0.55, title: 'Radial structure', text: '$B(\\rho)=B_0(\\rho)\\,P\\!\\left(\\rho/\\ln\\lambda\\right),\\;P(u+1)=P(u)$\n$B_0(\\rho)\\propto\\sinh\\rho$ (shell volume of $\\mathbb{D}$)\npockets where $B-B_0>\\theta_d$; here $\\lambda=2$' },
      { top: -1.7, title: 'Horizon', text: 'observable content $I(\\partial\\mathbb{D})\\le A/4\\ell_P^2$ (area law)\nunit density inside may be unbounded; bits are not\ncrossing $\\partial\\mathbb{D}$ at $r^*$: the source (singularity in Chart II)' },
    ]),
    form([0, -6.1], 'Chart I is the static-patch orientation: the unknown lies beyond the horizon. Chart II is its inversion about the observer.', 'n', { name: 'Footer' }),
  ])
}

export function chartTwo(): ChartDoc {
  const observers: Obj[] = []
  for (const a of [90, 150, 210, 270, 330, 30]) {
    const u: Vec = [Math.cos(rad(a)), Math.sin(rad(a))]
    observers.push(dot([5 * u[0], 5 * u[1]], C.ink, 4.5, `Observer ${a}°`))
    observers.push(line([4.85 * u[0], 4.85 * u[1]], [4 * u[0], 4 * u[1]], { color: '#626269', width: 0.4, arrow: 'end', name: `Reads inward ${a}°` }))
  }
  return doc('Chart II - The Chart of the Cosmos', [
    ...title('Chart II — The Chart of the Cosmos (source-centred)',
      'Same disk, inverted about the observer. Source $Z$ at the centre ($r^{*}$, infinite density); the observable world $D$ is the boundary; observers read inward.'),
    ...disk(),
    make('rings', [0, 0], {
      r: 5, count: 5, spacing: 'converging', ratio: 2, start: 2.4, thick: 0.2, thickness: 'proportional',
      width: 0.4, name: 'Converging shells',
    }),
    ...[0.55, 0.42, 0.3, 0.18].map((r) => make('circle', [0, 0], { r, fill: C.source, width: 0, opacity: 0.18, name: 'Source glow' })),
    dot([0, 0], C.sourceDark, 7, 'Source Z'),
    horizon(),
    ...observers,
    line([0, 5], [0, 0], { color: C.daemon, width: 1.2, wavy: true, name: 'Daemon' }),
    label([0.2, 3.6], { text: '$\\gamma$: geodesic $x\\to Z$', note: "the observer's link to the source", anchor: 'w', color: C.daemon, name: 'Geodesic' }),
    line([-4.75, -2.2], [-1.0, -0.6], { width: 1.2, arrow: 'end', name: 'Fundamentality arrow' }),
    label([-5.15, -2.2], { text: '$r$: fundamentality', note: 'fifth coordinate; increases inward', anchor: 'e', name: 'Fundamentality' }),
    label([0.35, -0.25], { text: '$Z$: source, $r^{*}$', note: 'zero-point; Planck end; never sampled', anchor: 'nw', color: C.sourceDark, name: 'Source label' }),
    label([0.5, 5.15], { text: '$D=\\partial$: observable world', note: '4D boundary / brane; horizon read from outside', anchor: 'sw', name: 'Boundary label' }),
    label([-3.6, 3.6], { text: 'observers $x\\in\\partial$', note: 'read inward; each carries $\\vec v=(\\theta,v)$', anchor: 'se', name: 'Observers label' }),
    form([3.2, -4.4], 'pocket shells $r_n$\n$r_n-r^{*}=c\\,\\lambda^{-n}$\nconverge on the source', 'nw', { leader: [2.68 * Math.cos(rad(300)), 2.68 * Math.sin(rad(300))], name: 'Shells label' }),
    ...boxes(6.8, 6.4, [
      { top: 5.6, title: 'Genesis (P1) — existing model', text: '5D bulk with a black hole; the universe is a spherical 3-brane emerging from its formation (Pourhasan–Afshordi–Mann 2014, DGP braneworld)\nthermal atmosphere on the brane seeds scale-invariant perturbations' },
      { title: 'Radial structure', text: '$B(r)=B_0(r)\\,P\\!\\left(\\dfrac{\\ln(r-r^{*})}{\\ln\\lambda}\\right)$,  $B_0\\propto\\sinh r$\nsource location by extrapolation (Aitken):\n$r^{*}=r_n-\\dfrac{(r_{n+1}-r_n)^2}{r_{n+2}-2r_{n+1}+r_n}$,  $\\lambda=\\dfrac{r_n-r^{*}}{r_{n+1}-r^{*}}$\nlimit cycle: $\\ln\\lambda=\\pi/s_0$ (Efimov-type; $s_0$ open)' },
      { title: 'Flow and horizon', text: '$\\dfrac{dV}{dk}=\\ell_0^{2}\\,(N_\\partial-N_{\\mathrm{bulk}})$ (Padmanabhan form; $k$ must be fixed)\nequipartition $N_\\partial=N_{\\mathrm{bulk}}$ at the fixed point\n$S_\\partial = A/4\\ell_P^{2}$: observable content bounded by area\nChart I $\\leftrightarrow$ Chart II: inversion $e\\mapsto 1/e$ about the observer' },
      { title: 'Physical instance', text: 'photon subrings converge on the critical curve with ratio $e^{\\pi}$ (Schwarzschild), read from outside the horizon: a radially sequenced pocket set with an unreachable accumulation point' },
    ]),
    form([0, -6.1], 'Chart II is the black-hole orientation: the source is interior and unreachable; pockets are shells crowding toward it.', 'n', { name: 'Footer' }),
  ])
}

export function chartThree(): ChartDoc {
  return doc('Chart III - The Architecture of Experience', [
    ...title('Chart III — The Architecture of Experience (original labels)',
      "The Chart of Experience redrawn in the author's vocabulary. Grey tags give the formal object each label maps to (Chart I)."),
    ...disk(), hyperbolicRings(), horizon(), ...vector(),
    label([2.6 * Math.sin(rad(18)) + 0.15, 2.6 * Math.cos(rad(18))], { text: '**The Vector**: aim $+$ velocity', note: '$\\vec v=(\\theta,v)$', anchor: 'w', name: 'The Vector' }),
    form([0.55, 2.45], 'aim $\\theta$', 'w', { name: 'aim' }),
    ...zeroPoints(),
    label([-0.9, -0.9], { title: 'The Self', text: '= the Soul = zero-point\n“look inward: the zero-point that is you”', note: '$x_0$, observer at $\\rho=0$', anchor: 'ne', leader: [-0.08, -0.08], name: 'The Self' }),
    label([1.3, 5.9], { text: '**God / the Source**: zero-point on the boundary\ncrossing it is reaching a singularity', note: '$r^{*}\\in\\partial\\mathbb{D}$; interior point of Chart II', anchor: 'w', color: C.sourceDark, leader: [0.08, 5.08], leaderColor: C.sourceDark, name: 'God / the Source' }),
    label([-5.15, 0], { title: 'Chaos', text: 'zero-point pole', note: 'curl$^{-}$', anchor: 'e', color: C.chaos, name: 'Chaos' }),
    label([5.15, 0], { title: 'Order', text: 'zero-point pole', note: 'curl$^{+}$', anchor: 'w', color: C.order, name: 'Order' }),
    form([0.9, -0.1], 'the string between chaos and order\naim is their balancing\n$H$ axis', 'nw', { name: 'The string' }),
    label([0.2, 3.9], { text: '**The Daemon**: string / wormhole\nfrom the self to the source', note: 'geodesic $\\gamma$; ER$=$EPR link', anchor: 'w', color: C.daemon, name: 'The Daemon' }),
    label([-4.2, -4.6], { title: 'Pockets of observation', text: 'along the fluid hierarchy', note: 'shells $\\rho_n=n\\ln\\lambda$', anchor: 'ne', leader: [3 * Math.cos(rad(230)), 3 * Math.sin(rad(230))], name: 'Pockets of observation' }),
    label([1.6, -5.3], { title: 'The fluid hierarchy', text: 'aiming up, through the pockets,\nat the horizon', note: 'radial coordinate $\\rho$', anchor: 'n', leader: [3.889 * Math.cos(rad(305)), 3.889 * Math.sin(rad(305))], name: 'The fluid hierarchy' }),
    bits(),
    label([-3.2, 5.0], { title: 'The boundary line', text: 'the binary string is projected onto it,\ntoward God and into 2D', note: '$b$ on $\\partial\\mathbb{D}$; holographic projection', anchor: 'se', name: 'The boundary line' }),
    ...boxes(7.4, 7.9, [
      { top: 5.8, title: 'Velocity', text: '“Velocity is the Son, and it is also forgiveness.”\nCruising velocity $=$ normal time $=$ relative time.\nInside a black hole, outside time runs fast: velocities differ.', note: 'formal: $v=dk/dt$, the observer\'s rate along the scale axis; cruising $\\Leftrightarrow v=1$; time dilation $\\Leftrightarrow$ unequal $v$' },
      { title: 'An observation is made', text: 'A fundamental unit of experience is created and immediately reconciles the entire state of experience — not through the exact formula but through its most fundamental form — and projects a binary string into the boundary line.\nInfinitely many global state updates in an infinitely compressed unit of time.', note: 'formal: $W\\to\\mathcal{U}_eW$ globally; only the invariants project; update rate $\\to\\infty$ becomes a flow $\\partial_tW=\\mathcal{L}W$' },
      { title: 'Experience', text: 'A spectrally fluid semantic matrix: an infinite density of units of observation, computing every relation horizontally and vertically, emanant toward the source.', note: 'formal: kernel $W$ on $\\Omega$; $M=H+V$; anchored potential $\\phi$; each unit its own spectrum $d_s(x,\\tau)$' },
    ]),
    form([0, -7.9], "Chart III $=$ Chart I with the author's labels. Nothing here is dropped; every label has a formal seat.", 'n', { name: 'Footer' }),
  ])
}

export function keplerOrbits(): ChartDoc {
  const c: Vec = [0, 0]
  const mu = 9
  const circ = stateFrom(c, mu, 2, 0, 0, rad(30), 1)
  const ell = stateFrom(c, mu, 1.4, 0.6, rad(200), rad(-40), 1)
  const hyp = stateFrom(c, mu, 2.6, 1.6, rad(-55), rad(-60), 1)
  const par = stateFrom(c, mu, 3.4, 1, rad(70), rad(40), 1)
  const orbit = (s: { at: Vec; vel: Vec }, o: Partial<ObjOf<'orbit'>>): Obj =>
    make('orbit', c, { mu, at: s.at, vel: s.vel, showBody: false, ...o })
  return doc('Kepler orbits', [
    label([0, 7.3], { title: 'Kepler orbits around one body', size: 12, name: 'Title' }),
    form([0, 6.75], 'Drag a satellite, or the tip of its blue velocity arrow: the orbit is solved exactly from where it is and how fast it is going.', 'c', { name: 'Subtitle' }),
    orbit(circ, { color: C.order, name: 'Circular orbit' }),
    orbit(ell, { color: C.chaos, showApsides: true, showFoci: true, marks: 12, spokes: true, name: 'Elliptical orbit' }),
    orbit(hyp, { color: C.daemon, reach: 9, name: 'Hyperbolic flyby' }),
    orbit(par, { color: C.note, dash: 'dashed', reach: 9, name: 'Parabolic escape' }),
    make('dot', c, { color: C.source, size: 10, name: 'Central body' }),
    label([0.3, -0.3], { text: '**central body**', note: 'all four orbits share it', anchor: 'nw', size: 7, name: 'Central body label' }),
    label([-6.2, -1.6], { title: 'Ellipse', text: 'e = 0.6, bound', note: '12 marks equal in TIME:\nequal areas swept (Kepler II)', anchor: 'ne', color: C.chaos, size: 7, name: 'Ellipse label' }),
    label([-2.2, 1.7], { title: 'Circle', text: 'e = 0', anchor: 'e', color: C.order, size: 7, name: 'Circle label' }),
    label([6.2, 4.5], { title: 'Hyperbola', text: 'e = 1.6, escapes', anchor: 'w', color: C.daemon, size: 7, name: 'Hyperbola label' }),
    label([6.2, -4.6], { title: 'Parabola', text: 'e = 1, just escapes', anchor: 'e', color: C.note, size: 7, name: 'Parabola label' }),
  ])
}

export function blank(): ChartDoc {
  return emptyDoc('Untitled chart')
}

export const TEMPLATES: ReadonlyArray<{ id: string; name: string; blurb: string; make: () => ChartDoc }> = [
  { id: 'three', name: 'Chart III', blurb: 'The Architecture of Experience, in your own words', make: chartThree },
  { id: 'one', name: 'Chart I', blurb: 'The Chart of Experience: observer at the centre', make: chartOne },
  { id: 'two', name: 'Chart II', blurb: 'The Chart of the Cosmos: source at the centre', make: chartTwo },
  { id: 'kepler', name: 'Kepler orbits', blurb: 'Circle, ellipse, parabola and hyperbola around one body', make: keplerOrbits },
  { id: 'blank', name: 'Blank', blurb: 'An empty page with a grid', make: blank },
]

