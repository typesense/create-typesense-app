/**
 * Astro + vanilla instantsearch.js.
 *
 * Deliberately no island framework: search-as-you-type needs JS, but reaching for
 * @astrojs/react would re-explode the framework matrix (PLAN.md §5). A <script>
 * tag in an .astro file is enough.
 */
export default {
  id: 'astro',
  name: 'Astro + instantsearch.js',
  scaffold:
    'npm create astro@latest {{dir}} -- --template minimal --install --no-git --skip-houston',
  deps: ['typesense', 'typesense-instantsearch-adapter', 'instantsearch.js'],
  env: {
    file: '.env',
    publicPrefix: 'PUBLIC_',
    accessor: 'import.meta.env',
  },
  files: 'files/',
  devCommand: 'npm run dev',
  devUrl: 'http://localhost:4321',
}
