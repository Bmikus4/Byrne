// The constraint solver.
//
// One residual system for geometry AND statics. They cannot be two subsystems: the
// friction force depends on the normal force, which depends on the contact geometry,
// which the contact constraint determines. Splitting them poses an ordering question
// with no right answer.
//
// Damped Newton (Levenberg-Marquardt) on an exact Jacobian from `ad.ts`, with rank
// analysis by SVD before the first step. LM rather than plain Newton because a drag
// routinely passes through near-singular configurations (a linkage going straight) and
// plain Newton throws the model across the screen there.
//
// The solver never drops a constraint. There is no code path that removes a residual
// row. Redundancy is absorbed by the least-squares formulation and REPORTED.

import { Matrix, SingularValueDecomposition } from 'ml-matrix'
import { Tag, Tape } from './ad.js'
import { Dim } from './dimension.js'

export interface Unknown {
  /** Stable id. Column order is the sorted order of these, so solving is deterministic. */
  readonly id: string
  readonly init: number
  readonly dim: Dim
  /** Locked unknowns are not unknowns; they are held and reported in the DOF count. */
  readonly locked?: boolean
}

export interface ResidualSpec {
  /** Stable id of the constraint that emitted this row. */
  readonly owner: string
  readonly label: string
  /** Convergence tolerance in the residual's own SI unit. */
  readonly tol: number
  readonly tag: Tag
}

export type Verdict = 'well-constrained' | 'under-constrained' | 'over-constrained' | 'empty'

export interface Conflict {
  /** Constraint ids whose rows are linearly dependent. */
  readonly constraints: string[]
  /** True when the dependency is inconsistent, i.e. the constraints disagree. */
  readonly conflicting: boolean
  /** Magnitude of the inconsistency in the dependent combination. */
  readonly residual: number
}

export interface SolveReport {
  readonly verdict: Verdict
  readonly unknowns: number
  readonly residuals: number
  readonly rank: number
  readonly dof: number
  readonly converged: boolean
  readonly iterations: number
  /** Infinity-norm of the residual vector, scaled by each row's own tolerance. */
  readonly worst: number
  readonly worstRow?: string
  /** Per-row residual in SI, keyed by constraint id. Exposed on demand in the inspector. */
  readonly rowResiduals: ReadonlyMap<string, number>
  readonly conflicts: readonly Conflict[]
  /** Free directions when under-constrained, as unit vectors over the unknown columns. */
  readonly freeDirections: readonly Float64Array[]
  readonly x: Float64Array
}

export interface SolveOptions {
  readonly maxIterations?: number
  readonly lambda0?: number
  /** Guess to start from. Continuation from the previous solution is what stops flipping. */
  readonly x0?: readonly number[]
}

const RANK_TOL_FACTOR = 1e-10

export function solve(
  tape: Tape,
  unknowns: readonly Unknown[],
  residuals: readonly ResidualSpec[],
  opts: SolveOptions = {},
): SolveReport {
  const n = unknowns.length
  const m = residuals.length
  const x = Float64Array.from(opts.x0 && opts.x0.length === n ? opts.x0 : unknowns.map((u) => u.init))

  if (m === 0 || n === 0) {
    return {
      verdict: m === 0 && n === 0 ? 'empty' : m === 0 ? 'under-constrained' : 'over-constrained',
      unknowns: n, residuals: m, rank: 0, dof: n, converged: true, iterations: 0,
      worst: 0, rowResiduals: new Map(), conflicts: [], freeDirections: [], x,
    }
  }

  const tags = residuals.map((r) => r.tag)
  const tol = residuals.map((r) => r.tol)
  const maxIter = opts.maxIterations ?? 200

  let lambda = opts.lambda0 ?? 1e-6
  let iterations = 0
  let { f, J } = tape.evaluate(tags, x)
  let cost = sumSq(f, tol)

  for (; iterations < maxIter; iterations++) {
    if (scaledInfNorm(f, tol) <= 1) break

    // Normal equations with Marquardt scaling: (J'J + lambda diag(J'J)) d = -J'f
    const JtJ = new Matrix(n, n)
    const Jtf = new Float64Array(n)
    for (let i = 0; i < m; i++) {
      const Ji = J[i]!
      const w = 1 / tol[i]!   // weight rows by their own unit so mixed systems are comparable
      const fi = f[i]! * w * w
      for (let a = 0; a < n; a++) {
        const ja = Ji[a]!
        if (ja === 0) continue
        Jtf[a] = Jtf[a]! + ja * fi
        for (let b = a; b < n; b++) {
          const v = JtJ.get(a, b) + ja * Ji[b]! * w * w
          JtJ.set(a, b, v)
          if (a !== b) JtJ.set(b, a, v)
        }
      }
    }

    let accepted = false
    for (let attempt = 0; attempt < 24 && !accepted; attempt++) {
      const A = JtJ.clone()
      for (let a = 0; a < n; a++) {
        const d = JtJ.get(a, a)
        A.set(a, a, d + lambda * (d > 0 ? d : 1))
      }
      let step: Float64Array
      try {
        const svd = new SingularValueDecomposition(A, { autoTranspose: false })
        const b = Matrix.columnVector(Array.from(Jtf, (v) => -v))
        step = Float64Array.from(svd.solve(b).to1DArray())
      } catch {
        lambda *= 10
        continue
      }
      const xn = Float64Array.from(x, (v, i) => v + step[i]!)
      const ev = tape.evaluate(tags, xn)
      const cn = sumSq(ev.f, tol)
      if (Number.isFinite(cn) && cn < cost) {
        x.set(xn); f = ev.f; J = ev.J; cost = cn
        lambda = Math.max(lambda * 0.1, 1e-14)
        accepted = true
      } else {
        lambda *= 10
        if (lambda > 1e12) break
      }
    }
    if (!accepted) break
  }

  // Polish. The damping that keeps a drag stable also stops the last step short, so the
  // answer sits at the declared tolerance rather than at machine precision. Once the
  // iteration has converged the configuration is no longer in doubt, so a few undamped
  // Gauss-Newton steps are safe and take the residual the rest of the way down. Each is
  // accepted only if it reduces the cost, so this cannot make the answer worse.
  for (let polish = 0; polish < 4; polish++) {
    const JtJ = new Matrix(n, n)
    const Jtf = new Float64Array(n)
    for (let i = 0; i < m; i++) {
      const Ji = J[i]!
      const w2 = 1 / (tol[i]! * tol[i]!)
      for (let a = 0; a < n; a++) {
        const ja = Ji[a]!
        if (ja === 0) continue
        Jtf[a] = Jtf[a]! + ja * f[i]! * w2
        for (let b = a; b < n; b++) {
          const v = JtJ.get(a, b) + ja * Ji[b]! * w2
          JtJ.set(a, b, v)
          if (a !== b) JtJ.set(b, a, v)
        }
      }
    }
    let step: Float64Array
    try {
      const svd = new SingularValueDecomposition(JtJ, { autoTranspose: false })
      step = Float64Array.from(svd.solve(Matrix.columnVector(Array.from(Jtf, (v) => -v))).to1DArray())
    } catch { break }
    if (!step.every(Number.isFinite)) break
    const xn = Float64Array.from(x, (v, i) => v + step[i]!)
    const ev = tape.evaluate(tags, xn)
    const cn = sumSq(ev.f, tol)
    if (!(Number.isFinite(cn) && cn < cost)) break
    x.set(xn); f = ev.f; J = ev.J; cost = cn
  }

  const converged = scaledInfNorm(f, tol) <= 1

  // Rank analysis at the solution. Rows are scaled by their own tolerance so that a
  // metre row and a newton row are comparable; a rank tolerance on an unscaled mixed
  // system is meaningless.
  //
  // Both null spaces come from RIGHT singular vectors, because ml-matrix returns V at
  // full size (columns x columns) and U only in economy form. The left null space of J
  // is therefore taken as the null space of J-transpose. Each matrix is zero-padded to
  // rows >= columns so no auto-transposition happens behind our back.
  const rowScaled = (i: number, a: number) => J[i]![a]! / tol[i]!

  const svd = new SingularValueDecomposition(padRows(m, n, rowScaled), { autoTranspose: false })
  const sv = svd.diagonal
  const smax = sv.length ? Math.max(...sv) : 0
  const rankTol = smax * RANK_TOL_FACTOR * Math.max(m, n)
  let rank = 0
  for (const s of sv) if (s > rankTol) rank++

  const dof = n - rank
  const redundancy = m - rank

  const conflicts: Conflict[] = []
  if (redundancy > 0) {
    const svdT = new SingularValueDecomposition(
      padRows(n, m, (a, i) => rowScaled(i, a)), { autoTranspose: false },
    )
    const U = svdT.rightSingularVectors   // m x m, full
    for (let c = rank; c < Math.min(U.columns, m); c++) {
      const u = new Float64Array(m)
      let mx = 0
      for (let i = 0; i < m; i++) { u[i] = U.get(i, c); mx = Math.max(mx, Math.abs(u[i]!)) }
      if (mx === 0) continue
      const support: string[] = []
      let inconsistency = 0
      for (let i = 0; i < m; i++) {
        if (Math.abs(u[i]!) > 0.1 * mx) {
          if (!support.includes(residuals[i]!.owner)) support.push(residuals[i]!.owner)
        }
        inconsistency += (u[i]! / mx) * (f[i]! / tol[i]!)
      }
      conflicts.push({
        constraints: support,
        conflicting: Math.abs(inconsistency) > 1,
        residual: Math.abs(inconsistency),
      })
    }
  }

  const freeDirections: Float64Array[] = []
  if (dof > 0) {
    const V = svd.rightSingularVectors
    for (let c = rank; c < Math.min(V.columns, n); c++) {
      const v = new Float64Array(n)
      for (let a = 0; a < n; a++) v[a] = V.get(a, c)
      freeDirections.push(v)
    }
  }

  const rowResiduals = new Map<string, number>()
  let worst = 0
  let worstRow: string | undefined
  for (let i = 0; i < m; i++) {
    const r = residuals[i]!
    const prev = rowResiduals.get(r.owner) ?? 0
    rowResiduals.set(r.owner, Math.max(prev, Math.abs(f[i]!)))
    const scaled = Math.abs(f[i]!) / tol[i]!
    if (scaled > worst) { worst = scaled; worstRow = r.label }
  }

  const verdict: Verdict =
    redundancy > 0 ? 'over-constrained' : dof > 0 ? 'under-constrained' : 'well-constrained'

  return {
    verdict, unknowns: n, residuals: m, rank, dof, converged, iterations,
    worst, worstRow, rowResiduals, conflicts, freeDirections, x,
  }
}

/**
 * Build an (max(rows, cols) x cols) matrix from `get`, padding with zero rows.
 * Padding changes neither the rank nor either null space, and it keeps ml-matrix's
 * SVD out of its auto-transpose path, where U and V are swapped.
 */
function padRows(rows: number, cols: number, get: (r: number, c: number) => number): Matrix {
  const M = new Matrix(Math.max(rows, cols), cols)
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) M.set(i, j, get(i, j))
  return M
}

function sumSq(f: Float64Array, tol: readonly number[]): number {
  let s = 0
  for (let i = 0; i < f.length; i++) { const v = f[i]! / tol[i]!; s += v * v }
  return s
}

function scaledInfNorm(f: Float64Array, tol: readonly number[]): number {
  let s = 0
  for (let i = 0; i < f.length; i++) s = Math.max(s, Math.abs(f[i]!) / tol[i]!)
  return s
}
