/**
 * SolidJS + instantsearch.js connectors, bundled by Vite.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'solid',
  name: 'SolidJS + instantsearch.js',

  // create-vite does not install dependencies, so there is no flag to skip:
  // the dependency step is the only install.
  scaffold: 'npm create vite@latest {{dir}} -- --template solid',

  deps: ['typesense', 'typesense-instantsearch-adapter', 'instantsearch.js'],
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
  // The Solid starter is a landing page. Our App replaces it, which would
  // otherwise leave its artwork behind as unreferenced files. favicon.svg goes
  // because index.html points at the overlay's Typesense favicon.png.
  remove: ['src/assets', 'public/icons.svg', 'public/favicon.svg'],

  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}
