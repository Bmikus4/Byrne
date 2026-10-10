# Byrne

A locally runnable, open-source physics-diagram authoring environment: direct-manipulation
3D construction, a live typed computation graph where every object carries units and a
frame, a component system in which the shipped library is itself authored, and
publication-quality vector output with LaTeX-typeset labels — all from one model, in one
human-readable file format.

The name is Oliver Byrne's 1847 edition of Euclid's *Elements*, where the diagram is the
argument and colour carries meaning rather than decoration.

## Status

Phase 1 — design only. No implementation exists.

**[docs/DESIGN.md](docs/DESIGN.md)** is the document: prior-art analysis, architecture, the
DSL, the component schema, the solver choice, the units and frame type system, the interface
with an interaction script per acceptance example, dependency licences, and the risks.

The status matrix at §13 reads `planned` for every line of code.

## The chart editor

`/app/chart.html` is a 2D editor for diagram-charts of the kind in the Fundamental Unit of
Experience work: discs, crowding rings, poles, wavy geodesics, labels with LaTeX, boxed
notes, tick strings, formula curves (y = f(x), parametric, polar) and exact two-body Kepler
orbits you reshape by dragging the satellite or its velocity. Everything snaps to a square
or circular grid. It draws through the same figure pipeline as the 3D editor, so PNG, SVG,
PDF and TikZ exports are the picture on screen. Charts I, II and III open as templates.

Pictures come in by button, drop or paste and are stored in the chart file. The radial
heatmap is Figure 8 of *The Need for Quantum Relativity*: a self-similar field of crests and
spiral pockets, with its slice read out as a spectrum and a binary string; it opens as the
"Experience map" template. Export, Animated SVG writes a file that plays in any browser:
satellites run at Kepler speed and fields flow one crest per period, seamlessly. A field
can record its state at each of the loop's 120 frames: 120 rows of 32 bits, drawn under
the strip and downloadable as text with the parameters that regenerate it.

## The deployed page

`npm run build` renders `docs/DESIGN.md` to `dist/index.html`. That is all the web
deployment is — a reading surface for the design document, not the application. The
application is an Electron desktop app (see §2.2 for why not a browser).

## Licence

Apache-2.0.
