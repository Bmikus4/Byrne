# The Byrne DSL

The file a Byrne project lives in is a [KDL](https://kdl.dev) document with a vocabulary
of twelve node kinds. It is the primary format: the application reads and writes it
directly, and every export is derived from it.

No grammar was invented. KDL supplies the syntax; mathjs supplies the expression syntax
inside string values; this document supplies the vocabulary.

---

## Reading a file

```kdl
project "byrne" version=1 {
  units length="m" mass="kg" angle="deg" force="N" time="s"
  precision sig=6
}

param "theta" "30 deg" type="angle" range="0 deg .. 80 deg"
param "m" "2 kg" type="mass"

instance "ramp" "std/mechanics/inclined-plane" {
  param "angle" "theta"
}

instance "block" "std/mechanics/point-mass" {
  param "mass" "m"
  param "at" "ramp.base + ramp.updir * 1.2 m"
}

measure "net" "resultant" {
  of "W.force" "N.force" "f.force"
  express-in "ramp.frame"
}
```

A node is `name arg1 arg2 prop=value { children }`. The vocabulary:

| Node | Shape |
|---|---|
| `project` | `"byrne" version=N { units ... ; precision sig=N ; library "path" }` |
| `param` | `"name" "expression" [type=] [init=] [range=] [locked=#true]` |
| `frame` | `"name" [parent=] [origin=] [axis= angle=] [x= up=]` |
| `instance` | `"name" "component/path" { param ... ; attach ... }` |
| `measure` | `"name" "op" { of ... ; express-in ; along ; about }` |
| `check` | `"name" "op" { body ; tolerance ; directions }` |
| `constraint` | `"name" "op" "operand"... [value=]` |
| `label` | `"target" latex="..." [anchor=] [offset=]` |
| `style` | `"selector" { stroke ... ; weight ... }` |
| `view` | `"name" { camera ... ; plane ; visible ... }` |
| `component` | `"path" version=N { meta ; param ; port ; frame ; geometry ; expose ; constraints ; instance ; style ; label }` |

---

## Expressions

Everything in quotes that is not a name is an expression. The operators and functions are
frozen and listed in [PRIMITIVES.md](PRIMITIVES.md). There is **no scripting language**:
no loops, no recursion, no I/O, no host access. Opening a file or importing a library
never executes anything, because there is nothing to execute.

### The juxtaposition rule

**After a number, an adjacent identifier is a unit. Multiplying by a name requires `*`.**

```
9.81 m/s^2        the metre, even in a document with a parameter named `m`
m * g             the parameter `m`
2 * s             the parameter `s`
2 s               two seconds
```

This exists because a mass called `m` and the metre are the same three characters, and
guessing between them at evaluation time is exactly the kind of quiet wrongness this tool
is built to avoid. Unit-bearing literals are lifted out of the source before the
expression parser sees it, so there is no ambiguity left.

### Units are never optional

A field of a dimensional type rejects a bare number:

```
param "L" "5"          ->  L: declared `length` (m) but the expression is dimensionless
param "L" "5 m"        ->  fine
param "x" "L + 2 s"    ->  dimension mismatch: cannot add m and s
```

Dimensionless quantities are declared dimensionless (`type="scalar"`), so the rejection is
unambiguous rather than a guess about intent.

### Frames

A vector is a frame-invariant object; its frame says which basis it is **reported** in.

```
measure "vB" "expression" { of "vA" ; express-in "B" }
```

creates a **new named object**. Nothing mutates. Adding two quantities reported in
different frames is an error, because it usually means the author is confusing two
different things; `dot`, `cross`, `component` and `project` do not require agreement,
because they are invariant and their result is a scalar or takes the first operand's
frame.

---

## Solver unknowns

`"?"` marks a value the solver finds rather than one the user types:

```
param "T3" "?" type="force" init="10 N"
constraint "balance_x" "residual" "dot(ring.netforce, world.x)" value="1e-12 N"
```

`value=` on a residual is its convergence tolerance, **in its own unit**. A single scalar
tolerance across a system mixing metres and newtons is meaningless, which is why the
tolerance is dimensional.

A component parameter can declare itself unknown, so that dropping the component in is
what creates the unknown:

```kdl
param "N" type="force" unknown=#true default="10 N"
```

---

## Components

A component is a typed, parameterised, versioned construction. The shipped library is
written in this same form; `test/model.test.ts` fails the build if any shipped component
uses a mechanism not listed in [PRIMITIVES.md](PRIMITIVES.md).

```kdl
component "std/mechanics/spring" version=1 {
  meta { title "Spring" ; category "Mechanics" ; description "..." }
  param "a" type="ref"
  param "k" type="stiffness" default="100 N/m" min="0 N/m"
  port "a" type="point" role="in" accept="is-point(x)"
  frame "local" origin="a.position" x="dir" up="world.z"
  geometry { helix "coil" from="a.position" to="b.position" turns="coils" radius="radius" }
  expose { quantity "extension" "norm(delta) - L0" }
  constraints { residual name="contact" expr="dot(body.netforce, surface.normal)" tol="1e-12 N" }
  instance "inner" "std/mechanics/point-mass" { param "mass" "mass" }
  style { stroke "structure" }
  label latex="k" anchor="mid" offset="6 mm"
}
```

Scoping, which is the part worth knowing:

* A value written at a **call site** sees the caller's names.
* A **definition default** sees the component's own parameters, ports, frame and nested
  instances.

Without that split, `param "g" "g"` on a component that also has a parameter `g` would
resolve to itself.

A `type="ref"` parameter holds a **name**, so `weight.body.mass` resolves through it to
`block.mass`. That is what connects a force to a body, and connecting a force to a body is
what puts it into `<body>.netforce` — Modelica's through-quantity rule, which is why no
component ever writes "sum of forces" by hand.

---

## Round-trip

Two properties, each a test in `test/model.test.ts`:

1. **Semantic round-trip.** `read(write(d))` equals `d` for every document.
2. **Textual fixpoint.** `write(read(t))` is byte-identical to `t` for every `t` the
   writer produced.

A hand-edited file is not required to be a fixpoint: saving it reformats it, as `gofmt`
does. `byrne fmt --write` normalises before committing.

---

## Two deviations from the design document

Both are forced by `kdljs` 0.3.0, which implements KDL v1.

**No raw strings.** LaTeX is written with doubled backslashes:

```kdl
label "theta" latex="\\theta"
```

rather than the `r"\theta"` the design document uses. When the parser gains KDL v2 raw
strings this reverts.

**Comments survive only at the top level.** `kdljs` discards comments, so Byrne recovers
them with a brace-depth scan of the source and reattaches the ones that precede a
top-level node. A comment inside a node's children is lost on reformat. This is stated
rather than hidden, and the fallback is the one the design document named in advance.
