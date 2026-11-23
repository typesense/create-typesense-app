/**
 * SvelteKit + instantsearch.js.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'sveltekit',
  name: 'SvelteKit + instantsearch.js',

  // The official generator. These four flags are what it needs to skip every
  // prompt; --no-install leaves the dependency step as the only install.
  scaffold:
    'npx --yes sv@latest create {{dir}} --template minimal --types ts --no-add-ons --no-install',

  // There is no official Svelte binding for InstantSearch, so the widgets run in
  // the browser and own their DOM, as in the qwik template.
  deps: ['typesense', 'typesense-instantsearch-adapter', 'instantsearch.js'],
  // Runs scripts/seed.ts. Node's own TypeScript support is too new to rely on
  // across the Node versions this package supports.
  devDeps: ['tsx'],

  env: {
    file: '.env',
    /**
     * SvelteKit 3 no longer keys on a prefix: src/env.ts declares which variables
     * the browser gets, and the admin key is not among them. PUBLIC_ is kept as
     * the naming convention SvelteKit's docs and older projects use.
     */
    publicPrefix: 'PUBLIC_',
  },

  seedCommand: 'tsx scripts/seed.ts',

  files: 'files/',
  // The starter's favicon, which the overlay's +layout.svelte replaced with
  // static/favicon.png.
  remove: ['src/lib/assets'],

  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}
