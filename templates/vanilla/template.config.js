/**
 * Vanilla JS + instantsearch.js, bundled by Vite.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'vanilla',
  name: 'Vanilla JS + instantsearch.js',

  // create-vite does not install dependencies, so unlike create-next-app there is
  // no flag to skip: the dependency step below is the only install.
  scaffold: 'npm create vite@latest {{dir}} -- --template vanilla',

  deps: ['typesense', 'typesense-instantsearch-adapter', 'instantsearch.js'],
  // Nothing extra: the seed script is plain JS, so Node runs it directly.
  devDeps: [],

  env: {
    file: '.env',
    /**
     * Vite refuses to expose any variable without this prefix to client code, so
     * the admin key cannot reach the browser even by mistake. Elsewhere the prefix
     * is a convention we honour; here the bundler enforces it.
     */
    publicPrefix: 'VITE_',
  },

  seedCommand: 'node scripts/seed.js',

  files: 'files/',
  // The Vite starter is a landing page. Our entry point replaces it, which would
  // otherwise leave its counter and artwork behind as unreferenced files.
  // public/favicon.svg goes because index.html now points at the overlay's favicon.png.
  remove: ['src/counter.js', 'src/assets', 'public/icons.svg', 'public/favicon.svg'],

  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}
