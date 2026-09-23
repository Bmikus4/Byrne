# Manual acceptance

Six features need a person and a window. Each has a procedure and a place to record the
result.

> **Status: the procedures below have NOT been run.** They were written by the same
> session that wrote the code, which had no browser. Every "Result" line says so. Do not
> read the status matrix's `implemented, manual` as `verified` — it means "the code is
> there and the automated layer beneath it passes; the interface itself is unobserved".
>
> What IS verified automatically for these features is named under each procedure.
> `test/ui-render.test.ts` mounts the whole component tree in a DOM (happy-dom, with the
> 3D viewport stubbed) and drives real events, so the panels, the numeric field, the
> command palette and the status strip are covered as FUNCTION. What no test here covers
> is how any of it LOOKS, and the viewport's three.js rendering is not covered at all.

Everything else in the status matrix (docs/DESIGN.md §13) has an automated test.

---

## Setup

```
npm install
npm run dev            # http://localhost:5173
```

Or the deployed build, which is the same bundle.

---

## M1 — The cold-open test

**The claim (design §7.7):** a user opens the app cold, drags a mass onto the canvas, and
gets a mass on the canvas without reading anything. If any of the first five interactions
needs documentation, the interface has failed.

**Procedure**

1. Open the app. It loads acceptance example A.
2. Drag `Point mass` from the left palette onto the viewport.
3. Observe: a mass appears where the cursor was, snapped to the grid, and a new
   `instance` row appears in the outliner.
4. Click the new row. The inspector opens on it with its parameters.
5. Type `3 kg` in `mass` and press Enter.

**Result:** NOT RUN — no browser in the session that built it.

**Verified automatically:** `test/ui-model.test.ts` runs the same drop as an operation
(`instantiate` with an `at` point) and asserts the document gains one instance and the
scene still builds; `test/ui-render.test.ts` asserts the palette lists the components and
the outliner follows the model. Unobserved: the drag itself, the ghost preview, the
raycast onto the construction plane, and the snap.

**Known limitation:** the drop currently always places on the active plane. Dropping onto
a *surface under the cursor* (design §7.4, semantics 1) orients to the plane, not to the
surface. Object-to-object drops (semantics 2 and 3) exist as operations and are reachable
from the inspector and the command palette, but not yet from a viewport drag.

---

## M2 — The numeric widget is one control, twice

**The claim (design §7.2, §7.3):** the handle and the field are the same control; dragging
the handle types in the field.

**Procedure**

1. Select `theta` in the outliner.
2. Drag left and right on the **label** `theta` (the dotted underline is the affordance).
3. Observe: the field text changes as you drag, the ramp rotates, and the normal force
   glyph shortens and lengthens.
4. Hold Shift while dragging: the increment is ten times larger. Shift+Ctrl: one tenth.
5. Release, then type `52 deg` in the field. The ramp moves to match.
6. Ctrl-Z. The angle returns to what it was before the drag, in one step.

**Result:** the TYPING half is verified; the DRAG half is NOT RUN.

**Verified automatically:** `test/ui-render.test.ts` types `5 kg` into the real field and
asserts the solved model follows; `test/ui-model.test.ts` asserts undo and redo return
exactly. That the label is draggable and that the drag emits the same operation is true by
construction in `NumericField.tsx` — `props.onCommit` is the one path both take — but the
pointer drag itself is unobserved.

---

## M3 — Units are never optional, and the error is specific

**Procedure**

1. Select `L` in the outliner. Clear the field and type `5`. Press Enter.
2. Observe: the field shows `needs a unit: this is a m quantity`, and the bottom strip
   shows `L: declared length (m) but the expression is dimensionless`.
3. Type `5 ft`. The ramp shortens to 1.524 m and every downstream number updates.
4. Change the bottom strip's `units` control from `m` to `cm`. Every display changes; the
   geometry does not move.

**Result:** VERIFIED, except the appearance.

**Verified automatically:** `test/ui-render.test.ts` types `5` into the real `L` field and
asserts `needs a unit` appears on the field and `declared \`length\`` appears in the strip;
`test/units.test.ts` asserts the rejection and its message; `test/model.test.ts` asserts
the tape is bit-identical across a project unit change and the exported SVG is unchanged.

---

## M4 — The command palette is the operation registry

**The claim (design §7.5):** the palette lists every action by name, and cannot drift from
what the application can do, because it is generated from the registry.

**Procedure**

1. Press Ctrl-K.
2. Observe every operation in `src/ui/model.ts` listed by title, plus every bundled
   example, plus the export and save commands.
3. Type `equil`. Select `Equilibrium check on body` with a body selected.
4. Observe: the outliner gains `constraint` rows AND a `check` row. The bottom strip's DOF
   count falls.

**Result:** VERIFIED.

**Verified automatically:** `test/ui-render.test.ts` dispatches Ctrl-K at the window and
asserts the palette opens listing `Set parameter`, `Place component` and `Extract component
from selection`; `test/ui-model.test.ts` asserts `add-equilibrium` takes example B from
`under-constrained, 2 DOF` to `well-constrained, 0 DOF` with the right tension. The
palette's list IS `operations()`, so it cannot drift from what the app can do.

---

## M5 — The four modes are always visible

**The claim (design §7.1):** units, frame, construction plane and snap are visible and
changeable without menu diving, along with the DOF readout.

**Procedure**

1. Look at the bottom strip. All four controls and the DOF readout are present.
2. Change `plane` from `zx` to `xy`. The highlighted plane and the grid rotate.
3. Change `snap` to `off`. Drag a component in from the palette: it lands unsnapped, and
   the cursor readout shows unrounded coordinates.
4. Open example B (Ctrl-K, `Open B`). The DOF readout reads `0 DOF, well-constrained`.
   Delete the `balance_y` constraint. It reads `1 DOF, under-constrained` immediately.

**Result:** the STRIP is verified; steps 2 and 3, which change the 3D view, are NOT RUN.

**Verified automatically:** `test/ui-render.test.ts` asserts all four mode controls and the
DOF readout are in the rendered tree, and that a conflicting pair of constraints shows
`over-constrained` there; `test/solver.test.ts` asserts the rank analysis behind it,
including that a merely redundant constraint is distinguished from a conflicting one.

---

## M6 — Labels are typeset, in the viewport and in the file

**Procedure**

1. Observe `\theta`, `\vec{N}`, `\vec{f}` and `m\vec{g}` in the viewport, set in TeX.
2. Ctrl-Shift-S to export SVG. Open it in a browser and in Inkscape.
3. Observe the labels are `<path>` outlines, not text, and are identical to the viewport.
4. `npx tsx src/cli/byrne.ts render examples/A-inclined-plane.byrne -o fig.pdf` and open
   the PDF. The labels are vector paths there too.

**Result:** steps 3 and 4 VERIFIED — the exported SVG and PDF in `figures/` were produced
by the CLI in this session and `test/export.test.ts` asserts both carry glyph path data,
no `<image>`, and no `/Subtype /Image`. Step 1, the viewport, is NOT RUN.
