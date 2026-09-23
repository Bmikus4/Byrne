// Reverse-mode automatic differentiation over a flat tape.
//
// The solver needs an exact Jacobian. Finite differences would put a 1e-8 floor under
// every residual, which makes "residual at machine precision" — the thing acceptance
// example B asserts — unreachable. Symbolic differentiation of the residual DAG costs
// about a hundred lines and removes the floor entirely.
//
// The tape is append-only and nodes reference earlier indices only, so array order IS
// topological order. Forward evaluation is one pass up; the adjoint is one pass down.
// No allocation in either, which is why a drag can afford to do this per frame.

export type Tag = number & { readonly __tape: unique symbol }

// A plain enum, not `const enum`: isolatedModules forbids the latter.
enum Op {
  Const, Var, Add, Sub, Mul, Div, Neg, Sin, Cos, Sqrt, Pow, Atan2, Abs,
}

export class Tape {
  private op: Op[] = []
  private a: number[] = []
  private b: number[] = []
  private k: number[] = []
  private nvars = 0

  /** Number of tape slots. */
  get size(): number { return this.op.length }
  /** Number of declared unknowns. */
  get vars(): number { return this.nvars }

  private push(op: Op, a = -1, b = -1, k = 0): Tag {
    this.op.push(op); this.a.push(a); this.b.push(b); this.k.push(k)
    return (this.op.length - 1) as Tag
  }

  const(x: number): Tag { return this.push(Op.Const, -1, -1, x) }

  /** Declare the next unknown. Index order is the column order of the Jacobian. */
  variable(): Tag { return this.push(Op.Var, this.nvars++) }

  add(x: Tag, y: Tag): Tag { return this.push(Op.Add, x, y) }
  sub(x: Tag, y: Tag): Tag { return this.push(Op.Sub, x, y) }
  mul(x: Tag, y: Tag): Tag { return this.push(Op.Mul, x, y) }
  div(x: Tag, y: Tag): Tag { return this.push(Op.Div, x, y) }
  neg(x: Tag): Tag { return this.push(Op.Neg, x) }
  sin(x: Tag): Tag { return this.push(Op.Sin, x) }
  cos(x: Tag): Tag { return this.push(Op.Cos, x) }
  sqrt(x: Tag): Tag { return this.push(Op.Sqrt, x) }
  abs(x: Tag): Tag { return this.push(Op.Abs, x) }
  /** Constant exponent only; a variable exponent is not something a residual needs. */
  pow(x: Tag, p: number): Tag { return this.push(Op.Pow, x, -1, p) }
  atan2(y: Tag, x: Tag): Tag { return this.push(Op.Atan2, y, x) }

  scale(x: Tag, s: number): Tag { return this.mul(x, this.const(s)) }
  sum(xs: Tag[]): Tag {
    if (xs.length === 0) return this.const(0)
    let acc = xs[0]!
    for (let i = 1; i < xs.length; i++) acc = this.add(acc, xs[i]!)
    return acc
  }
  /** Euclidean norm of a 3-tuple. Guarded: the derivative at zero is undefined. */
  norm3(v: [Tag, Tag, Tag]): Tag {
    return this.sqrt(this.sum([this.mul(v[0], v[0]), this.mul(v[1], v[1]), this.mul(v[2], v[2])]))
  }
  dot3(u: [Tag, Tag, Tag], v: [Tag, Tag, Tag]): Tag {
    return this.sum([this.mul(u[0], v[0]), this.mul(u[1], v[1]), this.mul(u[2], v[2])])
  }

  /** Forward pass. Returns the value of every slot. */
  forward(x: readonly number[], out?: Float64Array): Float64Array {
    const n = this.op.length
    const v = out && out.length === n ? out : new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = this.a[i]!, b = this.b[i]!, k = this.k[i]!
      switch (this.op[i]!) {
        case Op.Const: v[i] = k; break
        case Op.Var: v[i] = x[a]!; break
        case Op.Add: v[i] = v[a]! + v[b]!; break
        case Op.Sub: v[i] = v[a]! - v[b]!; break
        case Op.Mul: v[i] = v[a]! * v[b]!; break
        case Op.Div: v[i] = v[a]! / v[b]!; break
        case Op.Neg: v[i] = -v[a]!; break
        case Op.Sin: v[i] = Math.sin(v[a]!); break
        case Op.Cos: v[i] = Math.cos(v[a]!); break
        case Op.Sqrt: v[i] = Math.sqrt(v[a]!); break
        case Op.Abs: v[i] = Math.abs(v[a]!); break
        case Op.Pow: v[i] = Math.pow(v[a]!, k); break
        case Op.Atan2: v[i] = Math.atan2(v[a]!, v[b]!); break
      }
    }
    return v
  }

  /**
   * Adjoint pass for one output slot. `values` must come from `forward` at the same x.
   * Returns d(output)/d(var_j) for every declared variable.
   */
  gradient(output: Tag, values: Float64Array, adj?: Float64Array, out?: Float64Array): Float64Array {
    const n = this.op.length
    const g = adj && adj.length === n ? adj.fill(0) : new Float64Array(n)
    const grad = out && out.length === this.nvars ? out.fill(0) : new Float64Array(this.nvars)
    g[output] = 1
    for (let i = n - 1; i >= 0; i--) {
      const gi = g[i]!
      if (gi === 0) continue
      const a = this.a[i]!, b = this.b[i]!, k = this.k[i]!
      switch (this.op[i]!) {
        case Op.Const: break
        case Op.Var: grad[a] = grad[a]! + gi; break
        case Op.Add: g[a] = g[a]! + gi; g[b] = g[b]! + gi; break
        case Op.Sub: g[a] = g[a]! + gi; g[b] = g[b]! - gi; break
        case Op.Mul: g[a] = g[a]! + gi * values[b]!; g[b] = g[b]! + gi * values[a]!; break
        case Op.Div: {
          const vb = values[b]!
          g[a] = g[a]! + gi / vb
          g[b] = g[b]! - (gi * values[a]!) / (vb * vb)
          break
        }
        case Op.Neg: g[a] = g[a]! - gi; break
        case Op.Sin: g[a] = g[a]! + gi * Math.cos(values[a]!); break
        case Op.Cos: g[a] = g[a]! - gi * Math.sin(values[a]!); break
        case Op.Sqrt: g[a] = g[a]! + gi / (2 * values[i]!); break
        case Op.Abs: g[a] = g[a]! + gi * Math.sign(values[a]!); break
        case Op.Pow: g[a] = g[a]! + gi * k * Math.pow(values[a]!, k - 1); break
        case Op.Atan2: {
          const y = values[a]!, xx = values[b]!
          const d = y * y + xx * xx
          g[a] = g[a]! + (gi * xx) / d
          g[b] = g[b]! - (gi * y) / d
          break
        }
      }
    }
    return grad
  }

  /** Values of several outputs and the full Jacobian, in one forward and m adjoint passes. */
  evaluate(outputs: readonly Tag[], x: readonly number[]): { f: Float64Array; J: Float64Array[] } {
    const values = this.forward(x)
    const f = new Float64Array(outputs.length)
    const J: Float64Array[] = []
    const adj = new Float64Array(this.op.length)
    for (let i = 0; i < outputs.length; i++) {
      f[i] = values[outputs[i]!]!
      J.push(this.gradient(outputs[i]!, values, adj))
    }
    return { f, J }
  }
}
