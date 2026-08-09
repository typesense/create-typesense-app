/**
 * The collection schema — the first file worth editing.
 *
 * Typesense needs a schema before it can index anything. That requirement is the
 * reason this file exists rather than being hidden: change a field here, run
 * `npm run seed`, and the collection is rebuilt to match.
 *
 * Full field reference: https://typesense.org/docs/latest/api/collections.html
 */

/** Must match VITE_TYPESENSE_COLLECTION in .env. */
export const collectionName = process.env.VITE_TYPESENSE_COLLECTION ?? 'books'

export const booksSchema = {
  name: collectionName,
  fields: [
    // Searched, but not faceted: nobody filters by exact title.
    { name: 'title', type: 'string', facet: false },

    // `string[]` because a book can have several authors. Faceting is what lets
    // the sidebar in src/App.jsx offer them as filters.
    { name: 'authors', type: 'string[]', facet: true },

    { name: 'publication_year', type: 'int32', facet: true },
    { name: 'average_rating', type: 'float', facet: true },

    // Stored so hits can show a cover. Not searched.
    { name: 'image_url', type: 'string', facet: false },

    { name: 'ratings_count', type: 'int32', facet: true },
  ],

  /**
   * The tie-breaker, and the reason a misspelling finds the *right* book.
   *
   * Typesense ranks by text-match score first. When several documents match a
   * query equally well — as all seventeen Harry Potter records do for
   * "hary potr" — this field decides the order. Sorting by ratings_count puts
   * the best-known edition on top. Remove it and the order becomes arbitrary.
   */
  default_sorting_field: 'ratings_count',
}
