import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter'

/**
 * Connects the browser to Typesense.
 *
 * Every value here is read from a NEXT_PUBLIC_ variable, which means it ships to
 * the browser. That is fine — and deliberate — because the only key in this file
 * is the search-only key: it can run searches against one collection and nothing
 * else. It cannot add documents, drop the collection, or create further keys.
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

export const collectionName = required(
  'NEXT_PUBLIC_TYPESENSE_COLLECTION',
  process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION,
)

const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: required(
      'NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY',
      process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY,
    ),
    nodes: [
      {
        host: required('NEXT_PUBLIC_TYPESENSE_HOST', process.env.NEXT_PUBLIC_TYPESENSE_HOST),
        port: Number(required('NEXT_PUBLIC_TYPESENSE_PORT', process.env.NEXT_PUBLIC_TYPESENSE_PORT)),
        protocol: required(
          'NEXT_PUBLIC_TYPESENSE_PROTOCOL',
          process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL,
        ),
      },
    ],
    // Results are cached briefly so typing does not re-fetch the same query.
    cacheSearchResultsForSeconds: 2 * 60,
  },
  additionalSearchParameters: {
    /**
     * Which fields a query is matched against. `authors` is here as well as
     * `title` so that a misspelled author name ("tolkein") finds their books.
     *
     * Ranking is handled by the collection's `default_sorting_field`
     * (`ratings_count`, see scripts/schema.ts): it breaks ties between equally
     * good text matches in favour of the better-known book, which is why
     * "hary potr" puts Philosopher's Stone first.
     */
    query_by: 'title,authors',
  },
})

export const searchClient = adapter.searchClient
