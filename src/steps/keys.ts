import type { KeySpec, TypesenseClient } from '../util/typesense.js'

/** Marks the keys this CLI owns, so re-runs replace rather than accumulate. */
export const SEARCH_KEY_DESCRIPTION = 'create-typesense-app search-only key'

/**
 * The whole point of the project, in one object.
 *
 * `documents:search` on exactly one collection. This key can read search results
 * and nothing else: it cannot write documents, drop the collection, or mint
 * further keys. It is the only key that ever reaches the browser.
 */
export function searchOnlyKeySpec(collection: string): KeySpec {
  return {
    description: SEARCH_KEY_DESCRIPTION,
    actions: ['documents:search'],
    collections: [collection],
  }
}

/**
 * Creates the browser-safe key, replacing any this CLI made earlier.
 *
 * Typesense returns a key's value only at creation time, so a previous key cannot
 * be recovered and reused — it has to be replaced. Deleting our own tagged keys
 * first keeps a re-run from piling up a new key every time.
 */
export async function createSearchOnlyKey(
  client: TypesenseClient,
  collection: string,
): Promise<string> {
  const existing = await client.listKeys()
  for (const key of existing) {
    if (key.description === SEARCH_KEY_DESCRIPTION) {
      await client.deleteKey(key.id)
    }
  }

  const created = await client.createKey(searchOnlyKeySpec(collection))
  if (typeof created.value !== 'string' || created.value === '') {
    throw new Error('Typesense created a key but returned no value for it.')
  }
  return created.value
}
