# The primitive set

This file is the frozen instruction set. It is not documentation of the code; it is
**checked against** the code. `test/model.test.ts` walks every shipped component and
fails the build if any of them uses an operation, a constraint, or a parameter type that
is not listed here.

That is the mechanism behind "no privileged built-ins". A component the engine ships and
a component a user writes are the same kind of object, and the only way to keep them that
way is to make a privileged built-in a red build rather than a broken promise. If a
shipped component needs something new, the something new gets added to this list — which
means it gets added to what a user can reach — or the component does without.

---

## Value kinds

- `scalar` — a number with a dimension.
- `integer` — a dimensionless whole number.
- `boolean`
- `vector` — three components with a dimension and a report frame.
- `direction` — a unit vector. Dimensionless by construction.
- `point` — a position. A length, and bound to a frame's origin.
- `tensor2` — a rank-2 tensor.
- `frame`
- `ref` — a name. What a component parameter holds when it points at another object.

## Parameter types

Each is written `type="<name>"` on a `param`. The dimensional ones are checked against
the parameter's expression at build time.

- `type:scalar`
- `type:integer`
- `type:angle`
- `type:length`
- `type:area`
- `type:volume`
- `type:mass`
- `type:time`
- `type:velocity`
- `type:acceleration`
- `type:force`
- `type:torque`
- `type:energy`
- `type:power`
- `type:stiffness`
- `type:damping`
- `type:inertia`
- `type:charge`
- `type:efield`
- `type:eflux`
- `type:permittivity`
- `type:frequency`
- `type:ref`
- `type:point`
- `type:direction`
- `type:vector`
- `type:frame`
- `type:tensor2`
- `type:body`

## Expression operations

Available in any expression, anywhere. Nothing else is callable: there is no scripting
language, and an unknown name is an error rather than a host lookup.

- `+` `-` `*` `/` `^` and unary minus
- `==` `!=` `<` `>` `<=` `>=` `and` `or`
- `sin` `cos` `tan` `asin` `acos` `atan` `atan2`
- `sqrt` `abs` `exp` `log` `min` `max`
- `vec` — three components to a vector
- `norm` `normalize`
- `dot` `cross`
- `component` — signed magnitude along a direction
- `project` — vector onto a direction
- `in` — re-express in another frame; creates a new value, mutates nothing

## Geometry

Declared inside a component's `geometry` block. Each is parametric: it re-evaluates when
its inputs change, and it is never a mesh.

- `segment`
- `polygon`
- `polyline`
- `sphere`
- `circle`
- `arc`
- `helix`
- `arrow`
- `marker`
- `anchor`

## Constraints

- `residual` — the only constraint primitive. One scalar expression that the solver
  drives to zero, with a tolerance in its own unit.

Everything else a constraint could be — a fixed distance, a contact, a balance — is that
one primitive with a different expression in it. `std/mechanics/normal-force` is a
contact constraint written in six lines of DSL, and there is no faster path available to
the engine than the one it uses.

Document-level `constraint` nodes add three spellings over the same mechanism, for
convenience at the top level:

- `distance` — two points and a value
- `equal` — two quantities of the same dimension
- `residual` — a raw expression

## Aggregates the engine provides

Two names resolve without being declared, because they are sums over the whole scene and
cannot be written from inside one component:

- `world` — the root frame, with `.x`, `.y`, `.z`, `.origin`
- `t` — the global scrub parameter. A parameter, not an integration variable.
- `<body>.netforce` — the sum of every force attached to that body. Attaching a force to
  a body is what puts it in this sum (Modelica's through-quantity rule), which is why no
  component writes "sum of forces" by hand.

## Measures

Declared at the top level. Each creates a named object in the outliner; none is a menu
command that produces a fact and forgets where it came from.

- `resultant` `difference` `magnitude` `component` `expression` `moment`
- `flux` `field` — deferred: computed from the solved configuration, not part of it
