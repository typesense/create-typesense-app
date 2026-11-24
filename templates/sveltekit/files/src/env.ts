import { defineEnvVars } from '@sveltejs/kit/env'

/**
 * The variables the browser may see, read from .env at build time.
 *
 * SvelteKit exposes only what is listed here with `public: true`, through
 * $app/env/public. The admin key, TYPESENSE_API_KEY, is deliberately absent, so
 * no client code can import it. Only scripts/seed.ts reads it.
 */
function required(value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error('It should be in .env — re-run create-typesense-app if the file is gone.')
  }
  return value
}

const browser = { public: true, static: true, schema: required }

export const variables = defineEnvVars({
  PUBLIC_TYPESENSE_HOST: browser,
  PUBLIC_TYPESENSE_PORT: browser,
  PUBLIC_TYPESENSE_PROTOCOL: browser,
  // Search-only: it can search the collections in typesense.config.json and nothing else.
  PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY: browser,
})
