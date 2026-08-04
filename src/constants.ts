/**
 * Values shared across steps. They live here rather than being repeated inline
 * so that the summary the CLI prints and the env file it later writes cannot
 * drift apart.
 */

export const DEFAULT_PROJECT_NAME = 'my-search-app'

/** Pinned deliberately — see PLAN.md §9. v30 reshaped synonyms and curation. */
export const TYPESENSE_IMAGE = 'typesense/typesense:30.2'

export const DEFAULT_PORT = 8108

/** v1 is single-collection by design (PLAN.md §2). */
export const COLLECTION_NAME = 'books'

/** Written to the project dir to make re-runs resumable (PLAN.md §7). */
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
