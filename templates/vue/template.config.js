/**
 * Vue 3 + vue-instantsearch, bundled by Vite.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'vue',
  name: 'Vue + vue-instantsearch',

  // create-vite does not install dependencies, so there is no flag to skip:
  // the dependency step is the only install.
  scaffold: 'npm create vite@latest {{dir}} -- --template vue-ts',

  // vue-instantsearch brings instantsearch.js itself; it is listed because
  // src/App.vue imports its types, which should not rely on hoisting.
  deps: ['typesense', 'typesense-instantsearch-adapter', 'vue-instantsearch', 'instantsearch.js'],
  // Nothing extra: the seed script is plain JS, so Node runs it directly.
  devDeps: [],

  env: {
    file: '.env',
    /**
     * Vite refuses to expose any variable without this prefix to client code, so
     * the admin key cannot reach the browser even by mistake.
     */
    publicPrefix: 'VITE_',
  },

  seedCommand: 'node scripts/seed.js',

  files: 'files/',
  // The Vue starter is a landing page. Our App replaces it, which would otherwise
  // leave its demo component and artwork behind as unreferenced files.
  // public/favicon.svg goes because the overlay's public/favicon.png is the Typesense favicon.
  remove: ['src/components/HelloWorld.vue', 'src/assets', 'public/icons.svg', 'public/favicon.svg'],

  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}
