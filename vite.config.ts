import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The application is a single bundle with the component library and the examples baked
// in, so it runs with no network at all. In Electron it is loaded from a file: URL; the
// browser build is the same bundle and exists so the tool can be tried without an
// install, not because the browser is the product (see docs/DESIGN.md §2.2).
export default defineConfig({
  base: './',
  // MathJax's version module falls back to `eval('require')` when PACKAGE_VERSION is not
  // defined, which throws in a browser bundle and would take the whole label pipeline
  // with it. Defining it is MathJax's own supported mechanism, and it also removes the
  // only `eval` in the tree -- which matters, because "there is no eval anywhere" is part
  // of the trust model (docs/DESIGN.md §11), not a slogan.
  define: { PACKAGE_VERSION: JSON.stringify('3.2.1') },
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // MathJax (~1.5 MB) and three are the two heavyweights; split them off so a
        // change to the model does not invalidate them in the browser cache.
        manualChunks(id: string) {
          if (id.includes('mathjax-full')) return 'mathjax'
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/mathjs')) return 'mathjs'
          return undefined
        },
      },
    },
  },
  // `?raw` globs in src/ui/store.ts reach these directories.
  publicDir: false,
  server: { port: 5173 },
})
