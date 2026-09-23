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

## The deployed page

`npm run build` renders `docs/DESIGN.md` to `dist/index.html`. That is all the web
deployment is — a reading surface for the design document, not the application. The
application is an Electron desktop app (see §2.2 for why not a browser).

## Licence

Apache-2.0.
