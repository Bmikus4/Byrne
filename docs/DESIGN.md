# Byrne — Phase 1 Design Document

A locally runnable, open-source physics-diagram authoring environment.

**Status:** design only. No implementation exists. Every feature in the status matrix
(§13) reads `planned`.

The name is taken from Oliver Byrne's 1847 edition of Euclid's *Elements*, in which the
diagram is not an illustration of the argument — it *is* the argument, and colour carries
meaning rather than decoration. That is the thesis of this tool.

---

## 0. What this is, in one paragraph

A 3D geometric construction environment in which every object is a typed physical quantity
with units and a frame, every construction is simultaneously a diagram and a computation,
the shipped component library is written in the same component language the user gets, and
the output is a publication-quality vector figure generated from the model rather than
captured from the screen. The on-disk format is the same text the user can edit by hand.

---

## 1. Prior art: what to take, what to avoid

Each entry names what is worth stealing and the specific failure not to repeat.

| System | Take | Avoid |
|---|---|---|
| **GeoGebra 3D** | The construction *protocol*: an ordered, replayable list of construction steps that is the real document, with the picture as its projection. Also: naming every object on creation, so every object is referenceable in every expression. | Mode-based input (a toolbar of ~60 modal tools where the same drag means different things). The tool state becomes invisible and the user's next click is a guess. Byrne has one pointer tool and drop semantics that are typed, not modal. |
| **FreeCAD sketcher** | Constraint icons rendered *in place* on the geometry they constrain, with a live DOF counter ("3 degrees of freedom") always visible. | The topological naming problem: identifying geometry by an ordinal index (`Edge12`) that renumbers when upstream geometry changes, silently rebinding constraints to the wrong feature. Byrne gives every constructed entity a stable identity at creation and never addresses geometry positionally. |
| **FreeCAD assembly** | Joints as first-class objects in the tree, not properties buried on parts. | Three competing assembly workbenches with incompatible data models. One mechanism, exposed. |
| **Blender geometry nodes** | Sockets typed by colour and shape, with the noodle refusing to connect on a type mismatch *during* the drag. Also: the group-input/group-output nodes that make a node group's interface an object you edit, not a dialog. | Field/single-value implicit conversion that is invisible until it silently broadcasts wrong. Byrne's rank/frame/dimension mismatches are always errors, never coercions. |
| **Grasshopper** | Component authoring at parity with built-ins; a culture where users ship components. Also: data-tree previews on hover — you can always see what is flowing through a wire. | The canvas *is* the document, so spatial arrangement of the graph substitutes for structure. Byrne's outliner is hierarchical and typed; there is no free-floating node canvas. |
| **Mathematica / Wolfram notebooks** | `Quantity` and `UnitConvert`: dimensional arithmetic in the ordinary expression language, not in a separate library with its own syntax. Symbolic results that stay symbolic until asked to be numeric. | The notebook's global mutable kernel state, where cell evaluation order determines the result and re-running from the top gives a different answer. Byrne's model is a DAG with no evaluation-order semantics. |
| **Modelica** | Acausal connectors: a port declares *across* and *through* quantities (potential/flow) and connecting two ports generates the equations, so the user never writes the balance by hand. This is exactly the right model for force at a contact. Also: the `flow` sum-to-zero rule is how force balance is generated. | Compilation as a batch step with a 90-second turnaround and errors phrased in terms of the flattened system rather than the user's model. Byrne solves incrementally, on every drag. |
| **OpenSCAD** | The whole document is text, and the viewport is unambiguously a *view of* the text. No hidden state. | Text-only: no direct manipulation at all, and a functional language with no named intermediate geometry. Byrne is dual-surface; text and viewport are peers. |
| **CadQuery** | A fluent selector language for naming geometry by property (`faces(">Z")`) rather than by index — the correct answer to FreeCAD's topological naming. | Python as the document format: arbitrary code in the file means opening a file is executing it. Byrne's format is data; expressions are a total, sandboxed sublanguage. |
| **Onshape sketch constraints** | Inference-on-hover: as the cursor approaches, candidate constraints preview as glyphs and commit on click, so constraints are created by aiming rather than by choosing from a menu. Best-in-class. | Cloud-only, account-required, no local file. Byrne is offline, file-based, no account, no telemetry. |
| **Ipe** | Labels are LaTeX, typeset by a real TeX run, positioned by snapping to construction geometry. Ipe understood 25 years ago that a figure's labels are mathematics. Also: its "views" — one document, several layer-visibility states, exported as a sequence. | 2D-only data model and a PDF-derived internal representation that makes anything 3D impossible to retrofit. Byrne is 3D-native from the first commit. |
| **TikZ / PGF** | Coordinate arithmetic in the document language (`($(a)!0.5!(b)$)`), named coordinates, and styles as reusable keys. The right vocabulary for figure semantics. | Debugging by recompilation: no interactive feedback, and an error 400 lines into a macro expansion. Byrne exports *to* TikZ as a derived format and never asks the user to author in it. |
| **Asymptote** | A real numeric type system in a figure language, and genuine 3D with correct vector output including surface shading. | Its own bespoke language with a small ecosystem. We reuse an existing expression syntax rather than invent one. |
| **JSXGraph** | Cheap, robust dependency tracking between geometric objects with live update — the minimal correct core of "move this, everything downstream follows". | Untyped: everything is a number, so nothing is dimensionally checked. This is precisely the gap Byrne exists to close. |
| **Manim** | Objects have named anchor points (`.get_top()`, `.next_to()`), so labels are positioned relative to semantic features rather than absolute coordinates. Byrne's label anchors take this directly. | Animation-as-imperative-script: the scene has no persistent declarative state, so nothing is directly manipulable. |
| **Penrose** | The separation of **substance** (what exists), **style** (how it is drawn), and **domain** (what may exist) into three languages. Byrne's component definitions, style blocks, and type lattice map onto exactly this split. Also: layout by constrained optimisation — label placement as a solved objective, not a heuristic. | Compile-then-view, with layout non-determinism between runs. Byrne's solver is deterministic (§5.4) and label layout is deterministic given the same model. |
| **Sketchpad** (Sutherland 1963) | The original and still the sharpest statement: a drawing is a *definition* of constraints, satisfied by relaxation, and the "master drawing / instance" relationship is the whole of the component system. Sutherland's ring structure made every constraint bidirectionally reachable from every affected entity — that is the invalidation index. Also his observation that the user should be able to over-specify and be told so. | Nothing to avoid. The failure is that 60 years of tools have quietly dropped the constraint-as-definition idea and shipped coordinate editors instead. |
| **ThingLab** (Borning) | Constraints attached to *parts* in a part-whole hierarchy, inherited by composition — so a compound object's constraints are the union of its parts' constraints plus the connection constraints. This is the composition rule Byrne uses verbatim (§4.3). Also: multiple methods per constraint, letting the planner pick a direction. | Whole-system relaxation as the only solver, which does not scale and has no rank analysis. Byrne does rank analysis first and tells the user *why* a system is unsolvable. |
| **Fabrik** | Direct manipulation of a dataflow pipeline where the wire is visible and the intermediate value is inspectable at every point. | Its literal spatial metaphor for control flow, which does not survive more than ~20 nodes. |
| **Euclid's *Elements*, Byrne edition (1847)** | Colour as *identity*, not emphasis: a specific blue line is *the* line referred to in the proof, so the prose can drop the letter labels entirely. Byrne's physics-semantic palette (force red, velocity blue, …) applies this to quantity glyphs. Also: labels placed inside the figure at the point of reference, not in a legend. | The failure to avoid is modern: using colour for interface chrome as well as content, which destroys colour's ability to carry meaning. In Byrne, chrome is neutral grey and colour means something. |

**Synthesis.** Sketchpad and ThingLab supply the model (constraints as definition, composition
by part-whole). Modelica supplies the port semantics that make force balance automatic. Onshape
supplies the input method. Penrose supplies the substance/style split. Ipe and TikZ supply the
output. GeoGebra and JSXGraph supply the dependency core and a list of what not to do to a user.
No existing system holds all five.

---

## 2. Architecture

### 2.1 The line that matters

```
┌─────────────────────────────────────────────────────────────────┐
│  shell/      Electron main process. Filesystem, menus, windows.  │
├─────────────────────────────────────────────────────────────────┤
│  ui/         React. Viewport chrome, outliner, inspector,        │
│              palette, command palette, numeric widget.           │
├─────────────────────────────────────────────────────────────────┤
│  view/       three.js scene synchronisation. Gizmos, handles,    │
│              picking, label placement in screen space.           │
├─────────────────────────────────────────────────────────────────┤
│  figure/     Model → Figure IR → { SVG | PDF | TikZ }.           │
│              Analytic projection. No canvas, no rasteriser.      │
├─────────────────────────────────────────────────────────────────┤
│  core/       THE MODEL. Pure TypeScript. No DOM, no three.js,    │
│              no React, no filesystem. Runs in Node under `vitest`.│
│              • dimension + unit algebra                          │
│              • type lattice (kind × dimension × frame)           │
│              • expression parse, check, evaluate                 │
│              • dependency graph, transactions, invalidation      │
│              • frame tree                                        │
│              • component definitions, instantiation, overrides   │
│              • constraint assembly, Jacobian, solver             │
│              • DSL reader and canonical writer                   │
│              • operation log (undo/redo, command vocabulary)     │
└─────────────────────────────────────────────────────────────────┘
```

**The single rule that keeps this honest: `core/` must not import anything that touches
the DOM, the filesystem, or a GPU.** It is enforced by a dependency-cruiser rule in CI, not
by discipline. The consequence is that every acceptance example runs headless, the whole
model is testable without a window, and a CLI (`byrne render scene.byrne -o fig.svg`) is
fifty lines rather than a port.

`figure/` is also DOM-free: it emits strings and byte buffers. It is the *only* path to
exported output. The viewport cannot export. This is how "no screenshot masquerading as
vector export" becomes structurally impossible rather than a promise.

### 2.2 Why Electron and not Tauri

Tauri is smaller, and I would prefer it. It uses the host webview: WebView2 on Windows,
WKWebView on macOS, WebKitGTK on Linux. Those three disagree about font metrics, SVG text
layout, and `<foreignObject>`. The hard requirement is *"every export is reproducible from
the project file"* — byte-identical across machines. With a host webview that is not
achievable for anything involving text measurement, and label placement involves text
measurement everywhere.

Electron pins one Chromium. Same glyph advance widths on every platform, same `getBBox()`,
same PDF rasterisation for preview. The cost is ~150 MB of download. For a tool whose
output is a figure that goes in a paper, reproducibility wins.

Mitigation for the cost: the same `core/` + `figure/` + `ui/` bundle runs in a plain browser
with an in-memory filesystem, so a zero-install web build exists for trying the tool. It is
a convenience, not the product.

### 2.3 Incremental recomputation

A pull-based dependency graph with version stamps, not a push-based observer network.

- Every node holds `value`, `valueVersion`, and `inputsVersionSeen[]`.
- A **transaction** is one user operation. Edits mark nodes dirty; nothing recomputes yet.
- At transaction commit, the set of dirty roots is expanded to their transitive dependents,
  topologically ordered (the graph is a DAG by construction — cycles are rejected at edit
  time with the cycle path named), and evaluated in that order.
- A node recomputes only if some input's `valueVersion` exceeds the version it last saw. A
  node whose inputs changed but whose value is numerically unchanged does not bump its own
  version, so the recompute wave dies at the first no-op. This is the cheap fix for the
  diamond-glitch problem and it costs one comparison per node.
- Nothing outside the transaction observes intermediate state. The UI reads the model only
  between transactions. There is therefore no glitch to see.

The constraint solver is one node in this graph — a *supernode* whose inputs are the
constrained parameters and whose outputs are the solved unknowns. It participates in
topological ordering like anything else. This is what stops "solve" from being a separate
pipeline stage that can go out of sync with the expression graph.

### 2.4 Operations, not mutations

Nothing mutates the model directly. Every change is an **operation**: a named, serialisable
record with an inverse. `move-point`, `set-parameter`, `add-constraint`, `instantiate`,
`extract-component`, `override-field`, `reexpress-in-frame`.

This buys four things from one mechanism:

1. Undo/redo is the operation log walked backwards and forwards. No snapshot diffing.
2. The **command palette is a listing of the operation registry**. Every operation has a
   name, a shortcut, and an argument form — so "every action has a shortcut" is a property
   of the registry rather than a checklist someone maintains.
3. Drag interactions are a `begin/update/commit` operation triple, so a drag produces one
   undo entry, and the intermediate updates are the same code path as typing in a field.
4. Operations are testable without a UI. Every acceptance-example interaction script (§7)
   is executable as a list of operations in a headless test.

### 2.5 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.x, `strict`, `noUncheckedIndexedAccess` | The type lattice (§6) is partly expressible in the host type system, which catches frame/dimension confusion at compile time in engine code, not just at runtime in user expressions. |
| Runtime | Node 22 LTS / Electron 33 | LTS, and `node:test`-free (we use vitest) so no experimental surface. |
| UI | React 18 + Zustand | React for the inspector's dense form surface. Zustand rather than Redux because the authoritative state lives in `core/`, and the UI store holds only selection, camera, and panel state. |
| 3D | three.js | WebGL2, mature, MIT, and — decisively — it ships `GLTFExporter` and `USDZExporter`, which are two of the required export formats. |
| Expressions | `mathjs` parser + unit table, custom checker and evaluator | §3.2. |
| Linear algebra | `ml-matrix` | QR with column pivoting and SVD, MIT, dense. Our systems are small (§5.5). |
| Typesetting | MathJax 3, SVG output jax | §8.1. |
| Document format | KDL via `kdljs` | §3.1. |
| PDF | `pdf-lib` | Writes PDF from primitives with embedded font subsets. No rasteriser in the path. |
| Test | vitest | Same runtime as `core/`, fast, snapshot support for figure output. |
| Build | vite + electron-builder | Boring. |

### 2.6 Licences

The project is **Apache-2.0** (patent grant; permissive enough for a lab to vendor it).

| Dependency | Licence | Note |
|---|---|---|
| TypeScript | Apache-2.0 | |
| React | MIT | |
| Zustand | MIT | |
| three.js | MIT | |
| mathjs | Apache-2.0 | |
| ml-matrix | MIT | |
| MathJax 3 | Apache-2.0 | Fonts (MathJax Newcomputer/TeX) are OFL-1.1; embeddable. |
| kdljs | MIT | |
| pdf-lib | MIT | |
| vitest / vite | MIT | |
| Electron | MIT | Bundled Chromium is BSD-3-Clause + others; standard redistribution. |
| electron-builder | MIT | |

No copyleft in the dependency graph. **Specifically rejected:** SolveSpace's solver
(GPL-3.0, would relicense the project) and FreeCAD's `planegcs` (LGPL, and 2D-only — see
§5.2). Every exact version is pinned at Phase 2 start and recorded in `docs/DEPENDENCIES.md`
with the licence text vendored under `third_party/`.

**Offline:** confirmed. MathJax fonts, the unit table, and the component library are bundled
in the application package. There is no network call at any point in normal operation. There
is no telemetry, no update check, no account. The Electron `session` is configured to reject
all outbound requests by default, and CI asserts this with a test that fails if any
`net.request` is reachable from the renderer.

---

## 3. The DSL

### 3.1 Grammar: we do not invent one

The anti-pattern list forbids inventing a language without a specific reason. There is no
such reason, so the concrete syntax is **KDL** (the KDL Document Language, v2) — a specified,
implemented, node-oriented document language whose shape is `node arg1 arg2 prop=val { children }`.

That shape is a one-to-one fit for what we need to write down: a component instance is a node
with a name, a type, properties for parameters, and children for ports and overrides. We
contribute a *vocabulary* over KDL, not a grammar.

Three properties make KDL the right pick over JSON, YAML, or TOML:

- **Arguments and properties are distinct**, so `instance block "std/mechanics/point-mass"`
  reads as a sentence and does not need a `type:` key.
- **Raw strings** (`r"\vec{N}"`) carry LaTeX without backslash escaping, which is a real
  quality-of-life difference in a file full of labels.
- **Comments are part of the specified syntax** and can be preserved by the parser, which
  is what makes hand-editing survivable.

Expression strings inside values are **mathjs expression syntax**, also not invented.

### 3.2 What "round-trips losslessly" means, precisely

Vague claims here are how formats rot. The contract is two properties, each a test:

1. **Semantic round-trip.** `read(write(m)) ≡ m` for every model `m`, where `≡` is structural
   equality of the model after canonicalisation. This is property-tested with a model
   generator over the whole node vocabulary.
2. **Textual fixpoint.** `write(read(t)) = t` byte-for-byte for every `t` the writer could
   have produced. The writer is canonical: fixed node order (declaration order, stable under
   edits), fixed indentation, fixed number formatting (shortest round-trip decimal), one
   property per line above four properties.

A file a human hand-edited is *not* required to be a textual fixpoint — saving it reformats
it, exactly as `gofmt` does. That is stated in the docs, and `byrne fmt` exists so a user can
normalise before committing. Comments attach to the following node and survive the round trip;
comments in positions where no node follows (trailing) attach to the enclosing node's end.

### 3.3 Node vocabulary

```
document   := project-header , { top-level }
top-level  := param | frame | instance | measure | check | constraint
            | label | style | view | component

project    "byrne" version=<int>
  units    length=<unit> mass=<unit> angle=<unit> force=<unit> ...
  precision sig=<int>
  library  <path>                     // additional component libraries

param      <name> <expr-string> [type=<type>] [range=<expr>..<expr>] [locked=#bool]
frame      <name> [parent=<frame>] [origin=<expr>] [rot=<expr>]
instance   <name> <component-path> { param <name> <expr> ; attach ... ; override ... }
attach     port=<port> to=<target> { constraint <kind> [args] }
constraint <kind> <operand>... [value=<expr>]
measure    <name> <op> { of <expr>... ; express-in <frame> }
check      <name> <kind> { ... ; tolerance <expr> }
label      <target> latex=<raw-string> [anchor=<anchor>] [offset=<expr>]
style      <selector> { stroke ... ; weight ... ; dash ... }
view       <name> { camera ... ; plane ... ; visible <selector>... }
component  <path> version=<int> { meta ; param ; port ; frame ; geometry
                                ; expose ; constraints ; style ; label }
```

That is the entire language. Twelve node kinds.

### 3.4 Worked example — acceptance example A, in full

```kdl
project "byrne" version=1 {
  units length="m" mass="kg" angle="deg" force="N" time="s"
  precision sig=6
}

// Everything the reader is meant to vary sits at the top and is named.
param theta "30 deg"   range="0 deg .. 80 deg"
param L     "3 m"
param m     "2 kg"
param mu    "0.3"                      // dimensionless, and the parser knows it
param s     "1.2 m"                    // distance up the ramp from the base
param g     "9.80665 m/s^2"

frame world

instance ramp "std/mechanics/inclined-plane" {
  param angle  "theta"
  param length "L"
  place in="world" at="(0 m, 0 m, 0 m)"
}

instance block "std/mechanics/point-mass" {
  param mass "m"
  attach port="seat" to="ramp.surface" {
    constraint on-surface
    at "ramp.surface.along(s)"         // arclength from the base, dimensionally a length
  }
}

// Forces. Each is a component instance; each exposes .force : Vector<N, world>.
instance W "std/mechanics/weight"          { param body "block" ; param g "g" }
instance N "std/mechanics/normal-force"    { param contact "block@ramp.surface" }
instance f "std/mechanics/kinetic-friction"{ param contact "block@ramp.surface" ; param mu "mu" }

// Derived quantities are objects in the outliner, not menu commands.
measure net "resultant" {
  of "W.force" "N.force" "f.force"
  express-in "ramp.frame"
}
measure a_along "component" {
  of "net.value"
  along "ramp.frame.x"
}
check bal "equilibrium" { body "block" ; tolerance "1e-9 N" }

label block latex=r"m"            anchor="above-right" offset="(0 mm, 4 mm)"
label theta latex=r"\theta"       anchor="arc-mid"
label N     latex=r"\vec{N}"      anchor="tip"
label f     latex=r"\vec{f}"      anchor="tip"
label W     latex=r"\vec{g}"      anchor="tip"

view "side" {
  camera along="-ramp.frame.z" up="world.z" fit="all"
  plane "ramp.frame.xy"
  visible "geometry" "vectors" "labels" "angles"
}
```

Reading that file *is* reading the physics. That is the test the format has to pass.

---

## 4. The component system

### 4.1 Definition schema

A component definition is a KDL `component` node with nine sections, all optional but
`meta`:

```kdl
component "std/mechanics/spring" version=3 {
  meta {
    title       "Spring"
    category    "Mechanics"
    description "Ideal massless linear spring, drawn as a helix."
    author      "std"
  }

  // Typed parameters. Units come from the type; defaults are expressions.
  param k      type="stiffness" default="100 N/m" min="0 N/m"
  param L0     type="length"    default="0.5 m"   min="0 m"
  param coils  type="integer"   default=8         min=2 max=64
  param radius type="length"    default="20 mm"   min="0 m"

  // Ports. `accept` is an expression over the drop candidate, evaluated during drag.
  port a type="point" role="in"  accept="is-point(x) or has-port(x, 'mount')"
  port b type="point" role="out" accept="is-point(x) or has-port(x, 'mount')"

  // A local frame, defined by construction, not by a stored matrix.
  frame local origin="a" x="normalize(b - a)" up="world.z"

  // Parametric geometry. Re-evaluated on parameter change. Never a mesh.
  geometry {
    helix "coil" from="a" to="b" turns="coils" radius="radius" axis="local.x"
  }

  // What this contributes to the computation graph.
  expose {
    quantity extension   "norm(b - a) - L0"
    quantity force-on-b  "-k * extension * normalize(b - a)"
    quantity force-on-a  "k * extension * normalize(b - a)"
    quantity energy      "0.5 * k * extension^2"
  }

  // What this contributes to the solver. A spring constrains nothing by itself;
  // it contributes a *through* quantity at each port (see §4.4).
  constraints { }

  style { stroke "accent" ; weight "1.0 pt" }
  label anchor="mid" offset="(0 mm, 6 mm)" latex=r"k"
}
```

### 4.2 No privileged built-ins, and how that is tested

The engine knows a fixed set of **primitive nodes** — the instruction set. Everything else,
including every shipped component, is written in the component language above.

The primitives, in full:

- **Values:** `scalar`, `vector`, `tensor2`, `point`, `direction`, `frame`, `boolean`, `integer`.
- **Arithmetic:** `+ - * / ^`, `norm`, `normalize`, `dot`, `cross`, `transpose`, `inverse`,
  `component`, `project`, and the elementary transcendentals over dimensionless arguments.
- **Geometry constructors:** `line`, `segment`, `arc`, `circle`, `plane`, `sphere`, `cylinder`,
  `polyline`, `helix`, `parametric-curve`, `parametric-surface`.
- **Frame ops:** `frame-from`, `in` (re-express), `compose`, `between`.
- **Constraint emitters:** `coincident`, `distance`, `angle`, `parallel`, `perpendicular`,
  `tangent`, `on-curve`, `on-surface`, `rigid`, `slide`, `pin`, `hinge`, `balance-force`,
  `balance-torque`.
- **Field ops:** `field-sample`, `field-line`, `surface-integral`, `line-integral`.
- **Presentation:** `style`, `label-anchor`, `glyph`.

That is the whole privileged surface. The test is mechanical and runs in CI:

```
test/no-privileged-builtins.test.ts
  for every component under library/**/*.kdl:
    parse it, walk every node reference,
    assert each resolves to either a primitive in the frozen list
    or to another component definition.
  assert the frozen primitive list is byte-identical to docs/PRIMITIVES.md.
```

If a shipped component ever needs a mechanism the user cannot reach, this test fails and
the mechanism must be promoted to a documented primitive. That is the enforcement the brief
asks for, made into a red build rather than a principle.

### 4.3 Composition (from ThingLab)

A composite component's contributions are the **union** of its children's contributions plus
the constraints generated by its internal port connections. Nesting is arbitrary; there is no
special case at any depth. A `pulley-system` is a component containing a `pulley`, a `rope`,
and two `point-mass` instances, exposing an anchor port and a load port. Instantiating it
flattens to primitives at solve time; the outliner keeps the hierarchy.

### 4.4 Ports carry Modelica semantics

A port declares two kinds of quantity:

- **across** (potential-like): position, velocity, potential. Connected ports are *equal*.
- **through** (flow-like): force, current, flux. Connected ports *sum to zero*.

Connecting two ports therefore generates the equations automatically: a coincidence
constraint on the across quantities, and a balance equation on the through quantities. This
is why the user never writes ΣF = 0 by hand for a contact, and it is why the shipped
`normal-force` component can leave its magnitude as a solver unknown without any special
engine support.

### 4.5 Instances, overrides, and definition edits

An instance stores: definition path, definition version, parameter bindings, and an
**override set** — a map from field path to an explicitly user-set value, each flagged with
its provenance (`inherited` / `overridden`).

Editing a definition:

1. Recompute every instance against the new definition.
2. Overridden fields keep their overridden value. Inherited fields take the new default.
3. If the edit *removes* a parameter or port that some instance overrides or connects, the
   change is **destructive**. The editor shows a diff — instance by instance, field by field,
   old value against new — and requires confirmation. Declining leaves the definition edit
   uncommitted; there is no half-applied state, because the whole thing is one operation.
4. Definitions are versioned. A project file records the version it was authored against.
   Opening a project whose library has moved on shows the same diff at load time.

This is acceptance example C's requirement and it is the part most likely to be got wrong,
so the diff view is Phase 3's first UI work, not its last.

### 4.6 Extraction

The user selects a construction and runs `extract-component`. Inference:

- **Parameters:** every free scalar/vector the selection reads that is *not* produced inside
  the selection. Names are taken from the source parameter names.
- **Ports:** every point or frame in the selection that is referenced from *outside* it,
  plus every unconstrained endpoint. Types are read off the type lattice; `accept` rules
  default to "same type".
- **Exposed quantities:** every `measure` inside the selection.
- **Local frame:** inferred from the first two ports if they are points, else world-aligned.

The inference is presented as an editable form, not applied silently. The user renames,
drops, and reorders before committing. The resulting definition opens in the same editor as
any other component, because there is only one editor.

### 4.7 Library

A library is a directory: `manifest.kdl` plus `*.kdl` component files, plus an optional
`assets/` for nothing in particular (there are no meshes). Import is a file copy or a path
entry in the project header. **Importing never executes anything** — a `.kdl` file is data,
expressions are a total sublanguage with no I/O, and there is no scripting hook. There is no
registry, no account, no telemetry.

### 4.8 Shipped library

Written entirely in the component language, in `library/std/`:

- **Mechanics:** `point-mass`, `rigid-body`, `spring`, `damper`, `rope`, `pulley`,
  `inclined-plane`, `hinge`, `slider`, `fixed-support`, `weight`, `normal-force`,
  `kinetic-friction`, `static-friction`.
- **Vectors and frames:** `vector`, `coordinate-frame`, `transform`, `parallelogram-sum`,
  `projection`, `cross-product`.
- **Fields:** `point-charge`, `dipole`, `uniform-field`, `field-probe`, `field-line`,
  `flux-surface`.
- **Optics:** `ray`, `thin-lens`, `mirror`, `aperture`.
- **Measurement:** `distance`, `angle`, `arc-length`, `area`, `moment-arm`, `magnitude`,
  `dot-readout`, `cross-readout`, `equilibrium`, `resultant`, `component`.

---

## 5. Computation and constraints

### 5.1 One residual system

Geometric constraints and statics are the same problem: find `x ∈ ℝⁿ` such that `F(x) = 0`.
Treating them as two subsystems would mean two solvers, two failure modes, and an ordering
question between them that has no right answer (the friction force depends on the normal
force, which depends on the geometry, which the contact constraint determines). So: one
vector of unknowns, one residual vector, one solve.

Unknowns are: free coordinates of points and frames, and the magnitudes/directions left
unknown by force components. Residuals are: geometric constraint equations and port balance
equations, in the same vector.

### 5.2 Solver choice: damped Newton (Levenberg–Marquardt) with rank analysis

**What was rejected, and why.**

- **Cassowary** — linear constraints only. Distance and angle are quadratic and
  transcendental. It is the right solver for UI layout and the wrong one for geometry.
  Rejected on capability.
- **Gauss–Seidel / PGS for contacts** — that is an LCP solver for *dynamics*. §5.7 states
  that `t` is a scrub parameter, not an integration variable; there are no impulses here.
  Contacts are algebraic constraints. Rejected as out of scope, and the temptation to add it
  is exactly the "confuse `t` with a dynamics variable" anti-pattern.
- **SolveSpace's solver** — the right algorithm, GPL-3.0, C++. Relicensing the project is
  not acceptable. We reimplement the *approach*, which is not the code.
- **`planegcs` (FreeCAD, LGPL, WASM builds exist)** — the closest usable library, and the
  one I would take if the model were 2D. It is not: the data model is 3D-native and the
  statics residuals are not geometric constraints at all, so half the system could not be
  expressed to it. Rejected on capability, not licence.

Nothing available solves *this* system. That is the specific reason required before building
one, and what is built is a driver (~600 lines) over `ml-matrix`, not a new numerical method.

**The algorithm.**

1. Assemble residuals `F` and the analytic Jacobian `J = ∂F/∂x` by **reverse-mode
   differentiation of the expression DAG**. The DAG is already there; the adjoint pass is
   ~150 lines and gives exact derivatives, which is worth far more than a finite-difference
   approximation when the user is going to see residuals at 1e-15.
2. Rank-analyse `J` at the initial point by **QR with column pivoting** (`ml-matrix`).
   With `n` unknowns, `m` residuals, numerical rank `r`:
   - `r = m = n` → **well-constrained**.
   - `r = m < n` → **under-constrained**, DOF = `n − r`. The outliner shows "3 DOF" and the
     free directions are available as a viewport overlay.
   - `r < m` → **redundant or conflicting**. The left null space of `J` gives the dependent
     combinations; each null vector's support names the exact set of constraints involved.
     If the corresponding residual combination is nonzero, they *conflict*; if zero, they are
     merely redundant. Both are reported, by name, on the constraint objects themselves.
3. Iterate `x ← x + δ` where `(JᵀJ + λ diag(JᵀJ)) δ = −Jᵀ F`, with λ adapted on the standard
   accept/reject rule. Levenberg–Marquardt rather than plain Newton because drag
   interactions routinely pass through near-singular configurations (a link going straight),
   and plain Newton throws the model across the screen there.
4. Convergence: `‖F‖∞ < tol_abs` with `tol_abs` derived per-residual from its *unit* — a
   length residual converges to 1e-12 m, a force residual to 1e-12 N. A single scalar
   tolerance across mixed units is meaningless, and this is the payoff for having units in
   the core rather than at the edges.
5. Non-convergence after the iteration cap is **reported on the affected objects**, not
   silently accepted. The scene shows the last converged state with a warning badge, and the
   inspector shows the residual. It never displays a stale number as if it were current.

**The solver never drops a constraint.** There is no path in the code that removes a
constraint row. Redundancy is handled by the least-squares formulation itself (which is why
`JᵀJ` and not a square solve), and reported.

### 5.3 Constraints supported

Point-on-curve, point-on-surface, coincidence, fixed distance, fixed angle, fixed length,
parallel, perpendicular, tangent, rigid attachment, sliding contact, pin joint, hinge,
force balance at a body, torque balance at a body.

Each is one residual function plus its adjoint. The list is short because each entry is
about six lines.

### 5.4 Determinism

Same input, same output, bit for bit:

- Unknowns are ordered by stable object id (content-addressed at creation), not by hash
  iteration order or insertion time.
- The initial guess is the previous solution, or the construction-order positions for a cold
  load. No random restarts anywhere.
- No parallel reduction in the linear algebra (the problems are too small for it to pay).
- λ adaptation follows a fixed schedule with no time-dependent term.

A CI test loads each acceptance example 50 times and asserts bit-identical solved
coordinates.

### 5.5 Scale, and when this stops working

Dense QR is O(mn²). At `n = 500` unknowns that is ~10 ms — fine for interactive drag at 60 Hz
with room to spare. At `n = 5000` it is ~10 s and the tool is unusable. The acceptance
examples are all under `n = 60`.

This is a known ceiling, deliberately accepted for v1, and the exit is documented rather than
discovered later: the system decomposes into connected components of the constraint graph and
each is solved independently, which in practice keeps a large scene's largest block small.
Sparse `LDLᵀ` on the normal equations is the next step if a real scene ever exceeds it. We do
not build that until a real scene does.

### 5.6 Operations as objects

Vector sum, difference, scalar multiple, dot, cross, projection onto axis/plane/vector,
resolution along a frame's axes, frame transform of a sub-scene, centre of mass, moment of a
force about a point or axis, equilibrium check. Each is a `measure` node: it appears in the
outliner with a name, has an inspector, can be labelled, and can be an input to another
measure. **Nothing is a menu command that produces a fact and forgets where it came from.**

Equilibrium check reports ΣF, Στ about a stated point, a pass/fail against a stated
tolerance, and the residual magnitudes. It states the frame it is expressed in.

### 5.7 `t` is a scrub parameter

There is exactly one global scalar `t`. Any parameter may be an expression in `t`. The time
slider sets `t` and the graph recomputes — it is an ordinary parameter edit.

`t` is **not** an integration variable. Nothing integrates. `d/dt` is not a primitive and
will not be added by accident, because there is no integrator in the architecture to attach
it to. If Newton's equations are ever integrated, that is a deliberate new subsystem with its
own design document, its own state vector, and its own name — and it will not be called `t`.

---

## 6. Units, frames, tensors

### 6.1 Dimensions

A dimension is a 7-vector of **rational** exponents over (L, M, T, I, Θ, N, J). Rational
rather than integer because `sqrt(k/m)` is a legitimate thing for a user to type and its
intermediate is `T^-1` via `M^(1/2)`. Rationals are exact; floating exponents would make
dimensional equality a tolerance question, which is absurd.

`mathjs` supplies the unit table (SI base and derived, imperial, prefixes handled correctly:
`nm`, `km`, `MN`, `µN`) and unit-aware arithmetic. It does *not* supply parse-time checking —
`mathjs` checks at evaluation. So `core/dimension` adds a **dimensional inference pass over
the parsed AST**:

- Leaves: literals carry their unit's dimension; parameter references carry their declared
  type's dimension.
- `+`, `−`, comparison: operands must unify; failure names both dimensions and the source
  span.
- `*`, `/`: exponent vectors add/subtract.
- `^`: exponent must be a dimensionless rational literal or a dimensionless expression that
  evaluates to a rational; otherwise an error.
- Transcendentals: argument must be dimensionless; `sin`/`cos` additionally accept a plane
  angle and convert.
- Unification is plain equality on the exponent vector. There is no polymorphism to infer,
  so there is no Hindley–Milner machinery — this is a fold over an AST, about 300 lines.

Writing our own checker rather than a library is justified by there being no library that
does dimensional inference over an expression AST; we are not writing a units system, we are
writing a type-check pass over one.

**A length field rejects `5`.** Dimensionless quantities must be declared dimensionless
(`type="scalar"`), so the rejection is unambiguous rather than a guess about intent. The
error is shown on the field: `expected length (L¹), got dimensionless`.

### 6.2 Frames

Frames form a tree rooted at `world`. A frame node stores a rigid transform relative to its
parent: unit quaternion + translation vector. Quaternions rather than matrices because
repeated composition during drag drifts, and renormalising a quaternion is exact and cheap
where re-orthonormalising a matrix is neither.

Every point, vector, and tensor carries its frame in its type. Arithmetic between quantities
in different frames is a **type error**, not an implicit conversion. To combine them the user
applies `in` — which creates a **new named object**. Nothing is re-expressed in place.

Transforms between frames are first-class objects: they appear in the outliner, their matrix
is displayed in the inspector (4×4, with the rotation block and translation column visually
separated), and they can be composed, inverted, and labelled. `between(A, B)` walks the tree
to the common ancestor and composes.

### 6.3 Tensors

Rank-2 supported: moment of inertia, stress, strain, quadrupole. Stored as a 3×3 component
array plus a frame plus a dimension. Transformation is `A' = R A Rᵀ` with `R` from the frame
transform — done in one place, tested against a rotation that is not axis-aligned (this is
where naive implementations that transform only the diagonal get caught).

Display: matrix in the inspector with units on the block; glyph in the viewport where one is
meaningful — the inertia ellipsoid for a positive-definite inertia tensor, the principal-axis
cross for a stress tensor. Eigen-decomposition via `ml-matrix`, principal axes labelled.

### 6.4 The type lattice

A type is a triple: **kind × dimension × frame**.

```
kind   ∈ { scalar, vector, tensor2, point, direction, frame, curve, surface, body, boolean, integer }
dim    ∈ ℚ⁷
frame  ∈ frame-tree ∪ { none }        // scalars have frame = none
```

Assignability is equality on all three components. There is no subtyping and no coercion,
with two documented exceptions, both explicit and both reversible:

- `direction` is assignable to `vector` with `dim = 1` (a unit vector *is* a dimensionless
  vector).
- `integer` is assignable to `scalar`.

---

## 7. The interface

### 7.1 Layout

```
┌──────────────────────────────────────────────┬────────────────────────┐
│                                              │  OUTLINER              │
│                                              │  ▾ world               │
│               3D VIEWPORT                    │    ▾ ramp   [inclined] │
│               (≥ 60% width)                  │        surface         │
│                                              │      block  [mass]     │
│   · active construction plane, faint grid    │        W   →  19.6 N   │
│   · view indicator, top-right, discreet      │        N   →  17.0 N   │
│   · coordinate readout at cursor             │        f   →   5.1 N   │
│                                              │      net   →   4.7 N   │
│                                              ├────────────────────────┤
├──────────┐                                   │  INSPECTOR — block     │
│ PALETTE  │                                   │  mass    [ 2 kg     ]  │
│ search…  │                                   │  s       [ 1.2 m    ]🔒 │
│ Mechanics│                                   │  frame   ramp.frame    │
│  ○ mass  │                                   │  ⋯ advanced            │
│  ∿ spring│                                   │                        │
│  ◺ ramp  │                                   │                        │
└──────────┴───────────────────────────────────┴────────────────────────┘
│ m·kg·s  │  frame: ramp  │  plane: ramp.xy  │  snap: grid 10 mm  │ 3 DOF │
└──────────────────────────────────────────────────────────────────────┘
```

The bottom strip holds the four modes — **units, frame, construction plane, snap** — each a
click-to-change control, plus the DOF readout. These are the four things whose invisibility
causes every "why did it do that" in every tool in §1.

### 7.2 The numeric widget, built once

```
┌───────────────────────────────────────────┐
│ ⇄ mass   [ 2 kg                    ] 🔒 ⊹ │
│          = 2 kg                           │
└───────────────────────────────────────────┘
   │        │                            │  └ snap toggle
   │        │                            └─── lock toggle (solver may not change it)
   │        └──────── expression field: literal, expression, or reference
   └───────────────── drag-to-scrub on the label
```

- Accepts `2 kg`, `m*g*sin(theta)`, `0.5 * L`.
- Requires a unit for dimensional types; rejects `5` on a length field with the specific
  mismatch named.
- Shows the evaluated value under the expression when the expression is not a bare literal.
- Drag on the label scrubs; the increment is the display precision's last digit, × 10 with
  Shift, ÷ 10 with Shift+Ctrl.
- Lock marks the parameter as not-an-unknown; the solver's rank analysis updates live and
  the DOF readout changes as you toggle it. Locking something the solver needed shows the
  new DOF immediately — that is the fastest way to teach what the solver is doing.
- Errors render inline, in the error colour, naming the offending sub-expression span.

This widget is used in the inspector, the palette's instantiate-with-parameters popover, the
component definition editor, and the export dialog. One implementation.

### 7.3 Direct manipulation

Every spatially-meaningful parameter has a viewport handle, and the handle and the field are
**the same control**. Mechanically: dragging a handle emits `set-parameter` update operations
— the identical operation the field emits on keystroke. There is no separate drag path that
can diverge from the typed path.

Modifiers, identical on every handle: **Shift** constrains to axis, **Ctrl** snaps,
**Alt** duplicates, **Shift+Ctrl** fine-tunes (×0.1).

### 7.4 Drop semantics

Three, all first-class, all distinguished by what is under the cursor and shown as a live
badge on the ghost:

1. **Palette → viewport.** Instantiates at the active construction plane, oriented to the
   surface under the cursor if there is one. Ghost preview follows the cursor; the badge
   reads `place on ramp.surface` or `place on plane`.
2. **Object → port.** Ports light up during the drag. A port whose `accept` rule passes
   glows in the selection colour; one that fails greys out and, on hover, shows the reason:
   `needs point, got vector`. Drop connects.
3. **Object → object as operation.** Vector on vector → sum. Vector on plane → projection.
   Frame on scene → re-expression. **Every one creates a new named object in the outliner
   and destroys nothing.** The badge names the operation before you let go: `sum → net_2`.

### 7.5 Command palette

Ctrl/Cmd-K lists the operation registry: every operation, its name, its shortcut, its
arguments. Because the registry *is* the operation set (§2.4), it cannot drift from what the
app can do. Advanced controls live here, in the inspector's `⋯`, or in an expandable
`advanced` region — unsurfaced, never hidden.

### 7.6 Aesthetic rules

- One neutral canvas. One selection colour. One warning colour. One error colour.
- Physics-semantic colour — force red, velocity blue, acceleration green, field magenta — is
  a documented convention applied **only to quantity glyphs**. Never to chrome. This is the
  Byrne-edition rule: colour that means something cannot also be decoration.
- Three type sizes. Monospace for all numbers and all code.
- No transition over 150 ms. No animation that does not communicate a state change.

### 7.7 The cold-open test

Drag `mass` from the palette onto the canvas → a mass is on the canvas, selected, with its
inspector open and its mass field focused. Five interactions, no documentation:
place a mass, place a ramp, drag the mass onto the ramp (port highlight makes the target
obvious), drag a force onto the mass, read the resultant in the outliner.

### 7.8 Interaction scripts for the acceptance examples

Each script is also a list of operations and runs headless as a test.

**A — Inclined plane with friction**
1. Drag `inclined-plane` from palette to viewport. It lands on the ground plane, selected.
2. In the inspector, type `30 deg` in `angle`, `3 m` in `length`.
3. Drag `point-mass` onto the ramp's upper surface. The surface highlights during the drag;
   the badge reads `seat → ramp.surface`. Drop. The mass is constrained on-surface.
4. Inspector: `mass` = `2 kg`, `s` = `1.2 m`.
5. Drag `weight` onto the mass. Badge: `body → block`. It appears with a red glyph.
6. Drag `normal-force` onto the contact glyph. Its magnitude shows as an unknown (italic,
   with a `?`), then resolves once the balance closes.
7. Drag `kinetic-friction` onto the contact. Set `mu` = `0.3`.
8. Rubber-band select the three force glyphs; drag the selection onto empty space → the
   operation badge reads `resultant → net`. A `net` object appears in the outliner.
9. Click `net`, then click `ramp.frame` in the bottom strip's frame control → `express-in`
   is applied, producing `net_in_ramp`. Components read `(2.51, 0, 0) N`.
10. Bottom strip → units → `cm` changes every display; the model does not move.
11. `view` → `side`: camera snaps along the ramp's −z. Labels reflow.
12. Ctrl-K → `export svg`. The dialog previews the actual output. Export.

**B — Three-force equilibrium**
1. Place `coordinate-frame` at origin (or use `world`).
2. Place a `point-mass` at the origin; rename to `ring`.
3. Drag three `rope` components onto it. Each connects at the ring's `mount` port.
4. Set rope 1: angle `30 deg`, tension `50 N`. Rope 2: angle `150 deg`, tension `40 N`.
5. Rope 3: leave tension and angle blank. The DOF readout reads `2 DOF`.
6. Drag `equilibrium` from the Measurement palette onto the ring. It contributes
   `balance-force`, DOF goes to `0`, the readout reads `well-constrained`, and rope 3's
   tension and angle fill in.
7. The equilibrium object shows `ΣF = (0, 0, 0) N`, `residual = 4.4e-16 N`, `PASS`.
8. Scrub rope 1's tension. Rope 3 tracks live; the residual stays at machine precision.

**C — Spring-mass chain from a user-authored component**
1. Construct: two points, a helix between them, parameters `k` and `L0`, an exposed
   `force-on-b`.
2. Select all of it. Ctrl-K → `extract component`. The inference form proposes ports `a`,`b`
   and parameters `k`,`L0`,`coils`,`radius`. Accept.
3. From the palette (the new component is there, indistinguishable from shipped ones),
   instantiate three springs and two masses, dropping each onto the previous one's free port.
4. Change `k` on the middle spring to `250 N/m`. The field's provenance dot turns solid:
   overridden.
5. Open the definition, change default `coils` to 12. All three instances recoil. The middle
   spring's `k` override survives — its `k` field still reads `250 N/m`, still marked
   overridden.
6. Drop `weight` on each mass, anchor the top, read each spring's `extension`.

**D — Point charge field with flux**
1. Place `point-charge`; set `Q` = `1 nC`.
2. Drag `field-line` onto it. Set `count` = `24` (hard cap 512, enforced in the widget).
3. Drag `flux-surface` onto it → a sphere centred on the charge; set `R` = `0.5 m`.
4. The flux readout shows `112.9 V·m` with `Q/ε₀` alongside as the closed form.
5. Drag the charge off-centre but inside: flux unchanged to tolerance.
6. Drag it outside the sphere: flux reads `0 V·m`, residual shown.

**E — Frame transform round-trip**
1. Place `coordinate-frame` B; set `rot` = `rotate(37 deg, normalize((1,2,3)))`.
2. Place a `vector` in A. Drag frame B onto it → `v_in_B` appears.
3. Drag frame A onto `v_in_B` → `v_in_B_in_A` appears.
4. Drag both onto each other → `difference`. Inspector reads `< 1e-15` per component.

**F — Unit round-trip**
1. Author anything in metres.
2. Bottom strip → units → `cm`. Every display updates.
3. Ctrl-K → `export svg` in each setting. The two files differ only in label text.

---

## 8. Rendering and export

### 8.1 Typesetting: MathJax, not KaTeX

KaTeX is faster and smaller. It outputs HTML+CSS or MathML. Neither gives us glyph outlines.

MathJax 3's **SVG output jax** produces a `<svg>` whose glyphs are `<path>` data from the TeX
fonts. That single fact satisfies three requirements at once: labels in the viewport (as
textured quads or DOM overlay), labels in exported SVG (inlined paths, no font dependency),
and labels in exported PDF (the same path data written through `pdf-lib`). One typesetting
run, three consumers, no per-backend divergence in how a label looks.

The "real text vs. outlines" choice is then honest: **outlines** inlines the path data —
pixel-identical anywhere, not editable as text. **Text** emits `<text>` with the TeX font
embedded as WOFF2 — editable in Illustrator/Inkscape, requires the font to travel. The export
dialog states this trade-off in one line at the point of choosing.

### 8.2 Real-time viewport

Configurable line weights in *points at final size*, not pixels — so what you see is what the
figure will be. Restrained accents. Axes, grid, active plane, and construction guides each
toggle independently. Labels are placed by the same anchor resolver used for export, so
moving a label in the viewport moves it in the export.

### 8.3 Figure IR, one projector, three serialisers

```
Model ──project──> Figure IR ──┬──> SVG
                               ├──> PDF   (pdf-lib)
                               └──> TikZ
```

The projector is analytic. A circle projects to an ellipse, emitted as an SVG arc — not as a
polyline of 64 segments. An arc stays an arc. A straight edge stays one line segment. This is
the difference between a 12 KB figure and a 4 MB one, and between a figure that survives
being scaled in a journal's typesetting and one that does not.

Figure IR primitives: `line`, `polyline`, `arc`, `ellipse`, `cubic`, `filled-path`,
`glyph-run` (typeset label with resolved position), `marker` (arrowheads), `clip`.

**Hidden-line removal is the hard part** and is treated as such (§10). v1 ships painter's
algorithm over depth-sorted primitives with per-primitive splitting at crossings, which is
correct for the convex, small-primitive-count scenes the acceptance examples produce, and
documented as approximate for the general case. The exporter emits a warning in the dialog
when the scene contains configurations it cannot sort exactly.

### 8.4 TikZ subset, stated honestly

Exported: coordinates, lines, arcs, circles, ellipses, cubic paths, fills, arrow markers,
node labels with LaTeX content, styles as `\tikzset` keys, and a preamble listing the named
parameters as `\pgfmathsetmacro` so the reader can tweak them.

**Not** exported, and named in the file's header comment: gradient fills, clipping paths
beyond rectangular, the analytic surface shading used in the viewport, and any 3D
reconstruction — TikZ output is the projected 2D figure, not the scene. TikZ is a derived
format and does not round-trip back into Byrne. Said once, in the docs and in the file.

### 8.5 3D interchange

glTF 2.0 via three.js `GLTFExporter` for viewing; USD via `USDZExporter` for pipelines that
want it, with the limitation stated that parametric geometry is tessellated on the way out
and the tessellation tolerance is an export parameter.

### 8.6 Export honesty, enforced

- `figure/` has no canvas and no rasteriser in its dependency graph. A screenshot cannot be
  produced by the export path even by mistake. CI asserts the import graph.
- Editor chrome (grid, gizmos, selection highlight, active plane) is a separate layer never
  present in Figure IR.
- Aspect ratio preserved; clipping respected; page size and margins explicit.
- Every export is reproducible: `byrne render scene.byrne --view side -o fig.svg` produces
  byte-identical output to the GUI export, and a CI test asserts that for every acceptance
  example.

---

## 9. Acceptance examples: expected values

Computed here so the tests have a target that was not produced by the code under test.
`g = 9.80665 m/s²`, `m = 2 kg`, `μ = 0.3`.

**A — inclined plane.** `N = mg cos θ`, `f = μmg cos θ`, `F∥ = mg(sin θ − μ cos θ)`.

| θ | N (N) | f (N) | F∥ (N) |
|---|---|---|---|
| 15° | 18.9452 | 5.6836 | 1.3920 |
| 30° | 16.9857 | 5.0957 | 4.7110 |
| 45° | 13.8687 | 4.1606 | 9.7081 |
| 60° | 9.80665 | 2.9420 | 14.0426 |

Test asserts agreement with the closed form to `1e-12` relative, at every θ, with the vectors
expressed in `ramp.frame` and the units asserted as well as the magnitudes.

**B — three-force equilibrium.** T₁ = 50 N at 30°, T₂ = 40 N at 150°. Σ of the two:
`(50cos30 − 40cos30, 50sin30 + 40sin30) = (8.6603, 45.0) N`. So T₃ = 45.8257 N at
180° + 79.1066° = 259.1066°. Residual asserted `< 1e-14 N`.

**C — spring chain.** Hung vertically, springs `s1` (top) … `s3`, masses `m1`, `m2` between
them; spring `i` carries the weight below it. Extensions `x_i = W_below,i / k_i`. Asserted
against the closed form after the definition edit, with the middle override intact.

**D — flux.** `Φ = Q/ε₀ = 1e-9 / 8.8541878128e-12 = 112.9409 V·m`. Asserted to `1e-6`
relative for the charge anywhere inside (the surface integral is quadrature, so the tolerance
is the quadrature's, and the quadrature order needed to hit it is asserted too). `Φ = 0` to
`1e-9` when outside.

**E — frame round-trip.** Per-component difference `< 1e-12`; in practice `< 1e-15` with
quaternion composition.

**F — unit round-trip.** Model hash identical before and after the unit change; the two
exported SVGs identical except for label text.

---

## 10. Risks

Ordered by how much of the design they would invalidate.

1. **Hidden-line removal in vector 3D export.** Genuinely hard; the literature is old and the
   robust algorithms are fiddly. If the painter's-with-splitting approach proves inadequate
   for realistic scenes, publication output for 3D views degrades to "correct for
   near-2D views only". **Spike before Phase 4 commits**: implement the splitter, run it on
   example A rotated 30° off-axis and on a scene with an occluding ramp, inspect the SVG.
2. **Definition-edit propagation with overrides.** The diff, the merge, and the failure modes
   are the most intricate state in the system and acceptance C tests exactly this. **Spike in
   Phase 3, first**: build the override provenance model and the diff view before any other
   Phase 3 work.
3. **Solver behaviour under drag.** Branch flipping (a mechanism snapping to its mirror
   configuration) is the classic failure and LM does not prevent it. Mitigation is
   continuation from the previous solution plus a configuration-change detector that warns
   rather than silently flipping. **Spike in Phase 3**: example B with a rope dragged through
   the singular configuration.
4. **KDL comment-preservation fidelity.** The format contract (§3.2) depends on `kdljs`
   attaching comments in a way we can re-emit. If it cannot, the fallback is comments
   preserved as a side-table keyed by node id, which is uglier but sufficient. **Spike in
   Phase 2, week 1** — it is cheap and it blocks the format.
5. **MathJax label throughput in the viewport.** Hundreds of labels re-typeset on every
   camera move would be fatal. Mitigation: typeset once per label content change, cache the
   SVG, re-place only. Needs measurement. **Spike in Phase 2.**
6. **Port inference on component extraction.** The inference may routinely propose something
   wrong enough to be annoying. Mitigation is already in the design (the form is editable),
   but if the inference is bad enough the feature feels broken. Measured against ten real
   constructions in Phase 3.
7. **Flux quadrature near the singularity.** A charge close to the surface makes the
   integrand nearly singular; fixed-order quadrature will fail quietly. Mitigation: adaptive
   subdivision with a reported error estimate, and a warning on the object when the estimate
   exceeds the tolerance — never a wrong number without a warning.
8. **Scope.** Four phases, and phase 4 alone (fields, tensors, LaTeX in two pipelines, five
   export formats) is larger than phases 1–2 combined. The mitigation is the status matrix
   being honest per feature rather than per phase.

**What might simply not work:** exact vector export of curved-surface scenes (field lines on
a sphere with correct occlusion). If it does not, that is stated in the export dialog and the
docs, and raster fallback is offered *labelled as raster*, never as vector.

---

## 11. Trust model

- **There is no scripting language.** User input is expressions in a total sublanguage:
  arithmetic, a whitelisted function set, references to named model objects. No loops, no
  recursion, no I/O, no host access.
- `mathjs` is used for `parse` only. Our own evaluator walks the AST against a frozen function
  table. `math.evaluate` is never called; neither is `eval`, `Function`, or `import`.
- Bounded: per-transaction node-visit cap, expression depth cap, and a wall-clock budget after
  which the transaction aborts and rolls back whole (operations make rollback trivial).
- **Opening a project or importing a library never executes anything.** Files are data.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and a preload
  exposing a narrow, typed IPC surface: open, save, export, library-list. Nothing else.
- No network. No telemetry. No account. Asserted in CI (§2.6).

---

## 12. Repository and process

```
byrne/
  core/          model, units, frames, graph, solver, DSL      (no DOM)
  figure/        projection, Figure IR, SVG/PDF/TikZ writers   (no DOM)
  view/          three.js sync, handles, picking
  ui/            React surfaces
  shell/         Electron main + preload
  cli/           byrne render | fmt | check
  library/std/   the shipped component library, in the DSL
  docs/          DESIGN.md, PRIMITIVES.md, DSL.md, DEPENDENCIES.md
  test/          unit, property, acceptance, determinism, import-graph
  scripts/session.py   the session gate
```

**The session gate is built before the second commit.** `scripts/session.py` runs the suite
and the acceptance measurements, appends one ticket to `public/data/feed.json` carrying the
acceptance-example residuals and the test count, then commits and pushes. Red suite, or a
residual that moved without a ticket, and it exits non-zero having written nothing. There is
no other sanctioned `git commit` or `git push` in this repository. A number that moved
without a ticket explaining it is a regression.

---

## 13. Status matrix

Phase 1 is a design. Nothing is implemented.

| Feature | Status |
|---|---|
| Architecture, stack, licences | designed |
| DSL grammar + vocabulary | designed |
| Component definition schema | designed |
| Solver choice + rank analysis | designed |
| Units / dimensions type system | designed |
| Frame hierarchy + tensors | designed |
| Interface layout + interaction scripts | designed |
| Acceptance expected values | computed (§9) |
| — everything below is code — | |
| DSL parse / canonical write | planned |
| Dimensional inference | planned |
| Frame transforms | planned |
| Dependency graph + transactions | planned |
| 3D viewport + construction plane | planned |
| Numeric widget | planned |
| Palette drag-and-drop | planned |
| Outliner | planned |
| Component extraction | planned |
| Constraint solver | planned |
| Field evaluators + flux | planned |
| Tensor display | planned |
| MathJax labels | planned |
| SVG / PDF / TikZ / glTF / USD export | planned |
| Acceptance A–F | planned |

No feature moves to `implemented` without a passing correctness test, or — where a test is
impossible — a written manual acceptance procedure in `docs/MANUAL-ACCEPTANCE.md` and a
recorded result.

---

## 14. Phase 2 scope, for the record

End-to-end but thin, real on every axis: DSL parse + canonical write with the two round-trip
properties tested; dimensional inference rejecting `5` on a length field with a named
mismatch; frame tree with correct transforms; three.js viewport with a visible active
construction plane; the numeric widget; palette→viewport drag instantiating a component;
outliner reflecting and driving selection; save/reopen lossless; acceptance A working end to
end; acceptance E and F passing as automated tests. Plus the four Phase-2 spikes from §10.

Phase 2 begins on request.
