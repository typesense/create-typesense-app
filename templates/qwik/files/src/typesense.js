import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter'

/**
 * Connects the browser to Typesense.
 *
 * Everything here is read from a VITE_ variable, which means it ships to the
 * browser. That is deliberate: the only key in this file is the search-only key,
 * which can run searches against one collection and nothing else. It cannot add
 * documents, drop the collection, or create further keys.
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

export const collectionName = required('VITE_TYPESENSE_COLLECTION')

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
  additionalSearchParameters: {
    /**
     * Which fields a query is matched against. `authors` is here as well as
     * `title` so a misspelled author name ("tolkein") finds their books.
     *
     * Ranking comes from the collection's `default_sorting_field`
     * (`ratings_count`, see scripts/schema.js): it breaks ties between equally
     * good text matches in favour of the better-known book, which is why
     * "hary potr" puts Philosopher's Stone first.
     */
    query_by: 'title,authors',
  },
})

export const searchClient = adapter.searchClient
