# Byrne — working notes

## The session gate

`scripts/session.py` is the only sanctioned `git commit` and `git push` in this repository.

```
python scripts/session.py -m "Subject, a fact about the software, <= 80 chars"
python scripts/session.py -m "..." --dry-run      # confirm and measure, write nothing
```

It confirms, then tickets, then commits — stopping at the first failure:

1. **Confirm.** `vitest run`, re-render every figure from its example, take the
   measurement in `scripts/measure.mjs`, run the **inverted control** (the closed forms
   are perturbed by 1e-3; if the comparison still agrees, it is not comparing anything and
   the gate fails), and build. Any failure exits non-zero having written nothing.
2. **Ticket.** One entry appended to `public/data/feed.json` carrying the acceptance
   numbers as they stood, a headline, and the test count. One feed, append-only. Old
   entries may be thinned to their headlines; they are never rewritten or deleted.
3. **Commit and push.** The body carries the headline and the ticket id. The ticket has no
   sha — it is committed inside the commit it would name — so the id is the join key:
   `git log --grep "Ticket T0001"`.

**A number that moved without a ticket explaining it is a regression.**

## What is verified and what is not

`docs/DESIGN.md` §13 is the status matrix. Rows marked **unobserved** mean the code is
written and the layer under it is tested, but *nobody has looked at it* — the 3D viewport,
the pointer drags, the CLI's output on a terminal. `docs/MANUAL-ACCEPTANCE.md` holds the
procedure for each and says, per step, what a test covers and what it does not. Do not
promote a row to `tested` without a test that fails when the behaviour goes away.

## The rules that are enforced, not promised

Three architectural claims are CI tests rather than principles. If one starts failing, fix
the code, not the test:

- **`core/` and `figure/` touch no DOM, no filesystem, no GPU** (`test/import-graph.test.ts`).
  This is what makes a screenshot-as-vector-export structurally impossible and every
  acceptance example runnable headless.
- **No privileged built-ins** (`test/model.test.ts`). Every shipped component resolves to
  the frozen list in `docs/PRIMITIVES.md` or to another component. Adding a mechanism a
  user cannot reach turns the build red.
- **The DSL round-trips** (`test/model.test.ts`), as two separate properties: semantic
  round-trip, and textual fixpoint for canonically-written files.

## Things it is easy to get wrong here

- **`residual` is the only constraint primitive.** Contact, balance and fixed distance are
  all one scalar expression driven to zero. Do not add a second mechanism; add a component.
- **A check measures; a constraint constrains.** An equilibrium check must never emit a
  solver row, or what is being solved for stops being visible in the document.
- **Frames are a report attribute.** Components are stored in world coordinates. `+` and
  `-` require the frames to agree; `dot`, `cross`, `component` and `project` do not,
  because they are invariant.
- **A call-site parameter value is evaluated in the CALLER's scope**; a definition default
  is evaluated in the component's own. Collapsing the two makes `param "g" "g"` resolve to
  itself.
- **The solver's polish step is load-bearing.** Removing the undamped Gauss-Newton steps
  after convergence moves the acceptance numbers from machine precision to the declared
  tolerance, which is a thousand times worse and looks like nothing changed.
- **`t` is a scrub parameter.** There is no integrator. If dynamics is ever added it gets
  its own state vector, its own design document and a different name.

## Layout

```
src/core/     the model            (no DOM, no fs, no GPU)
src/figure/   projection + export  (no DOM, no fs, no GPU, no rasteriser)
src/ui/       React + three.js
src/io/       the only filesystem access
src/cli/      byrne check | render | fmt | primitives
library/std/  the shipped components, in the DSL
examples/     the acceptance examples
figures/      re-rendered by the gate from examples/
docs/         DESIGN.md, DSL.md, PRIMITIVES.md, MANUAL-ACCEPTANCE.md
```
