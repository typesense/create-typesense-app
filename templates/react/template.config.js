/**
 * React + react-instantsearch, bundled by Vite.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'react',
  name: 'React + react-instantsearch, bundled by Vite',

  // create-vite does not install dependencies, so there is no flag to skip:
  // the dependency step is the only install.
  scaffold: 'npm create vite@latest {{dir}} -- --template react-ts',

  deps: ['typesense', 'typesense-instantsearch-adapter', 'react-instantsearch'],
  // Runs scripts/seed.ts. Node's own TypeScript support is too new to rely on
  // across the Node versions this package supports.
  devDeps: ['tsx'],

  env: {
    file: '.env',
    /**
     * Vite refuses to expose any variable without this prefix to client code, so
     * the admin key cannot reach the browser even by mistake.
     */
    publicPrefix: 'VITE_',
  },

  seedCommand: 'tsx scripts/seed.ts',

  files: 'files/',
  // The React starter is a landing page. Our App replaces it, which would
  // otherwise leave its stylesheets and artwork behind as unreferenced files.
  // public/favicon.svg goes because index.html points at the overlay's favicon.png.
  remove: ['src/App.css', 'src/index.css', 'src/assets', 'public/icons.svg', 'public/favicon.svg'],

  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}
