import {
  PUBLIC_TYPESENSE_HOST,
  PUBLIC_TYPESENSE_PORT,
  PUBLIC_TYPESENSE_PROTOCOL,
  PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY,
} from '$app/env/public'
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter'
import config from '../../typesense.config.json'

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

/**
 * Connects the browser to Typesense.
 *
 * Every value here ships to the browser. That is fine — and deliberate — because
 * the only key is the search-only key. src/env.ts lists what may be public; the
 * admin key is not on that list.
 */
const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY,
    nodes: [
      {
        host: PUBLIC_TYPESENSE_HOST,
        port: Number(PUBLIC_TYPESENSE_PORT),
        protocol: PUBLIC_TYPESENSE_PROTOCOL,
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
