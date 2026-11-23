/**
 * Qwik + instantsearch.js, bundled by Vite.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'qwik',
  name: 'Qwik + instantsearch.js',

  // create-vite does not install dependencies, so there is no flag to skip:
  // the dependency step is the only install.
  scaffold: 'npm create vite@latest {{dir}} -- --template qwik',

  deps: ['typesense', 'typesense-instantsearch-adapter', 'instantsearch.js'],

  /**
   * Corrects the starter's own pin, and the project will not install without it.
   *
   * create-vite's qwik template asks for vite@^8, but @builder.io/qwik declares
   * `peer vite@">=5 <8"`, so a plain `npm install` on the untouched scaffold
   * fails with ERESOLVE. No 1.x release of Qwik supports Vite 8; only the 2.0
   * beta does. Pinning Vite 7 keeps both stable. Revisit when Qwik 2 ships.
   *
   * devDeps are installed before deps so this lands first.
   */
  devDeps: ['vite@^7'],

  env: {
    file: '.env',
    /**
     * The starter runs Qwik through Vite with no envPrefix override, so Vite's
     * own rule applies: nothing without this prefix reaches client code, and the
     * admin key cannot leak into the bundle.
     *
     * Note this is not Qwik City's PUBLIC_ convention, which belongs to the
     * full-stack framework rather than this CSR setup.
     */
    publicPrefix: 'VITE_',
  },

  seedCommand: 'node scripts/seed.js',

  files: 'files/',
  // The Qwik starter is a landing page. Our app replaces it, which would
  // otherwise leave its artwork behind as unreferenced files. The overlay's
  // public/favicon.png is the Typesense favicon, so the starter's goes too.
  remove: ['src/assets', 'public/icons.svg', 'public/favicon.svg'],

  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}
