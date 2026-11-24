import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter'
import config from '../typesense.config.json'

/**
 * Connects the browser to Typesense.
 *
 * Everything here is read from a VITE_ variable, which means it ships to the
 * browser. That is deliberate: the only key in this file is the search-only key,
 * which can search the collections in typesense.config.json and nothing else. It
 * cannot add documents, drop a collection, or create further keys.
 *
 * The admin key sits in the same .env file WITHOUT the VITE_ prefix, and Vite
 * refuses to expose unprefixed variables to client code. Only scripts/seed.js
 * reads it.
 */
function required(name) {
  const value = import.meta.env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}. It should be in .env — re-run create-typesense-app if the file is gone.`,
    )
  }
  return value
}

/**
 * What the UI searches, facets and shows, per collection (or alias). Written by
 * create-typesense-app; edit freely.
 */
export const collections = config.collections.map(({ name, search }) => ({ name, search }))
const [first] = collections
if (first === undefined) {
  throw new Error('typesense.config.json lists no collections. Re-run create-typesense-app.')
}

const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: required('VITE_TYPESENSE_SEARCH_ONLY_API_KEY'),
    nodes: [
      {
        host: required('VITE_TYPESENSE_HOST'),
        port: Number(required('VITE_TYPESENSE_PORT')),
        protocol: required('VITE_TYPESENSE_PROTOCOL'),
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
