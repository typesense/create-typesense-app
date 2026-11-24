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
  },
  seedCommand: 'tsx scripts/seed.ts',
  files: 'files/',
  // The starter's demo page styles and artwork. app/favicon.ico goes because the
  // overlay's app/icon.png is the Typesense favicon, and Next.js would serve both.
  remove: [
    'app/favicon.ico',
    'app/page.module.css',
    'public/file.svg',
    'public/globe.svg',
    'public/next.svg',
    'public/vercel.svg',
    'public/window.svg',
  ],
  devCommand: 'npm run dev',
  devUrl: 'http://localhost:3000',
}
