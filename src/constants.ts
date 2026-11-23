/**
 * Values shared across steps. They live here rather than being repeated inline
 * so that the summary the CLI prints and the env file it later writes cannot
 * drift apart.
 */

export const DEFAULT_PROJECT_NAME = 'my-search-app'

/** Pinned deliberately: a new major can change the API, as v30 did for synonyms and curation. */
export const TYPESENSE_IMAGE = 'typesense/typesense:30.2'

export const DEFAULT_PORT = 8108

/** The collection a local server creates for the books sample. */
export const COLLECTION_NAME = 'books'

/**
 * Approximate size of the fetched dataset, for prompt and summary copy only. The
 * exact count is not known until it is downloaded, so this stays deliberately
 * vague rather than pretending to a precision it does not have.
 */
export const DATASET_APPROX_COUNT = '~10k'

// --- The demo search ---------------------------------------------------------

/**
 * Fields the demo searches, and the reason it is two fields rather than one.
 *
 * Searching authors too means a misspelled author name ("tolkein", "dostoyevski")
 * finds their books, which a title-only search misses entirely.
 *
 * Ranking is handled by the schema's `default_sorting_field: ratings_count`: it
 * breaks text-match ties toward the better-known book, which is why "hary potr"
 * surfaces Philosopher's Stone rather than an arbitrary volume of the series.
 *
 * The template's search UI must use the same value, or the aha moment breaks in
 * the browser while every CLI check still passes.
 */
export const DEMO_QUERY_BY = 'title,authors'

/**
 * The one facet the books demo shows.
 *
 * `authors` rather than genres: the official dataset carries no genre field, and
 * inventing one would mean fabricating metadata for real books.
 */
export const DEMO_FACET_BY = 'authors'

/** The misspelling the whole project is built to answer. */
export const TYPO_DEMO_QUERY = 'hary potr'

/** Written to the project dir to make re-runs resumable. */
export const STATE_FILE = '.create-typesense-app.json'

// --- Env variable names -----------------------------------------------------
//
// THE HARD RULE: the admin key is the only secret here, and it must never be
// written with a template's public prefix. Encoding that as two disjoint lists
// (rather than as a convention in prose) is what makes it testable.

export const HOST_VAR = 'TYPESENSE_HOST'
export const PORT_VAR = 'TYPESENSE_PORT'
export const PROTOCOL_VAR = 'TYPESENSE_PROTOCOL'
export const COLLECTION_VAR = 'TYPESENSE_COLLECTION'
export const SEARCH_KEY_VAR = 'TYPESENSE_SEARCH_ONLY_API_KEY'

/**
 * Named exactly what the Typesense server reads from its own environment.
 *
 * That is not cosmetic: it lets docker-compose.yml pull the key in with
 * `env_file:` instead of `${...}` substitution. Compose only interpolates from
 * `.env`, so with a template whose env file is `.env.local` a substituting
 * compose file made plain `docker compose down` fail.
 */
export const ADMIN_KEY_VAR = 'TYPESENSE_API_KEY'

/** Receive the template's public prefix. The browser sees these. */
export const PUBLIC_ENV_VARS = [
  HOST_VAR,
  PORT_VAR,
  PROTOCOL_VAR,
  COLLECTION_VAR,
  SEARCH_KEY_VAR,
] as const

/** Never prefixed. Read only by `scripts/seed.ts` and by this CLI. */
export const PRIVATE_ENV_VARS = [ADMIN_KEY_VAR] as const
