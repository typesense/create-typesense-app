/**
 * Next.js + react-instantsearch.
 * Every field is documented in ../README.md — the template contract.
 */
export default {
  id: 'nextjs',
  name: 'Next.js + react-instantsearch',
  scaffold:
    'npx --yes create-next-app@latest {{dir}} --ts --app --eslint --no-tailwind --no-src-dir --no-import-alias --yes --skip-install',
  deps: ['typesense', 'typesense-instantsearch-adapter', 'react-instantsearch'],
  // Runs scripts/seed.ts. Node's own TypeScript support is too new to rely on
  // across the Node versions this package supports.
  devDeps: ['tsx'],
  env: {
    file: '.env.local',
    publicPrefix: 'NEXT_PUBLIC_',
    accessor: 'process.env',
  },
  files: 'files/',
  devCommand: 'npm run dev',
  devUrl: 'http://localhost:3000',
}
