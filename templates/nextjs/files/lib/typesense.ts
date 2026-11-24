import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter'
import config from '../typesense.config.json'

/**
 * Connects the browser to Typesense.
 *
 * Every value here is read from a NEXT_PUBLIC_ variable, which means it ships to
 * the browser. That is fine — and deliberate — because the only key in this file
 * is the search-only key: it can search the collections in typesense.config.json
 * and nothing else. It cannot add documents, drop a collection, or create keys.
 *
 * The admin key lives in the same .env.local file WITHOUT the NEXT_PUBLIC_
 * prefix, so Next.js never exposes it. Only scripts/seed.ts reads it.
 */
function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}. It should be in .env.local — re-run create-typesense-app if the file is gone.`,
    )
  }
  return value
}

/** What the UI searches, facets and shows. Written by create-typesense-app; edit freely. */
export interface SearchConfig {
  queryBy: string[]
  facets: string[]
  title: string
  image: string | null
  display: string[]
}

export interface Collection {
  /** The collection or alias to search. */
  name: string
  search: SearchConfig
}

export const collections: Collection[] = config.collections.map(({ name, search }) => ({
  name,
  search,
}))
const [first] = collections
if (first === undefined) {
  throw new Error('typesense.config.json lists no collections. Re-run create-typesense-app.')
}

const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: required(
      'NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY',
      process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY,
    ),
    nodes: [
      {
        host: required('NEXT_PUBLIC_TYPESENSE_HOST', process.env.NEXT_PUBLIC_TYPESENSE_HOST),
        port: Number(
          required('NEXT_PUBLIC_TYPESENSE_PORT', process.env.NEXT_PUBLIC_TYPESENSE_PORT),
        ),
        protocol: required(
          'NEXT_PUBLIC_TYPESENSE_PROTOCOL',
          process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL,
        ),
      },
    ],
    // Results are cached briefly so typing does not re-fetch the same query.
    cacheSearchResultsForSeconds: 2 * 60,
  },
  /**
   * Which fields a query is matched against, per collection, from
   * typesense.config.json. Ranking ties are broken by each schema's
   * `default_sorting_field`, which is why "hary potr" puts the best-known Harry
   * Potter book first.
   */
  additionalSearchParameters: { query_by: first.search.queryBy.join(',') },
  collectionSpecificSearchParameters: Object.fromEntries(
    collections.map(({ name, search }) => [name, { query_by: search.queryBy.join(',') }]),
  ),
})

export const searchClient = adapter.searchClient
