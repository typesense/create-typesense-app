/**
 * Angular + instantsearch.js connectors, bundled by the Angular CLI.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'angular',
  name: 'Angular + instantsearch.js',

  // No SSR: the search runs in the browser, and a server render would only show
  // an empty page before it. --routing false: one page reads ?collection= instead.
  scaffold:
    'npx --yes @angular/cli@latest new {{dir}} --defaults --skip-install --skip-git --no-ssr --style css --routing false --ai-config none --interactive false',

  // angular-instantsearch is deprecated; the plain library's connectors feed signals.
  deps: ['typesense', 'typesense-instantsearch-adapter', 'instantsearch.js'],
  // Nothing extra: the seed script is plain JS, so Node runs it directly. It is
  // .mjs because the Angular starter's package.json is not "type": "module".
  devDeps: [],

  env: {
    file: '.env',
    /**
     * Angular reads no env file by itself. The overlay's builders/ wraps the
     * Angular builders and inlines only NG_APP_ variables from .env into the
     * bundle, so the unprefixed admin key is never read into it.
     */
    publicPrefix: 'NG_APP_',
  },

  seedCommand: 'node scripts/seed.mjs',

  files: 'files/',
  // The starter is a landing page. Our App replaces it, and its spec tests that
  // page; the styles move to src/styles.css. public/favicon.ico goes because the
  // overlay's public/favicon.png is the Typesense favicon.
  remove: ['public/favicon.ico', 'src/app/app.css', 'src/app/app.spec.ts'],

  devCommand: 'npm start',
  devUrl: 'http://localhost:4200',
}
