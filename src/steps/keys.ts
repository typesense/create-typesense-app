import type { KeySpec, TypesenseClient } from '../util/typesense.js'

/** Marks the keys this CLI owns, so re-runs replace rather than accumulate. */
export const SEARCH_KEY_DESCRIPTION = 'create-typesense-app search-only key'

/**
 * The whole point of the project, in one object.
 *
 * `documents:search` on exactly the given collections. This key can read search
 * results and nothing else: it cannot write documents, drop a collection, or
 * mint further keys. It is the only key that ever reaches the browser.
 */
export function searchOnlyKeySpec(
  collections: string[],
  description = SEARCH_KEY_DESCRIPTION,
): KeySpec {
  return { description, actions: ['documents:search'], collections }
}

/**
 * Creates the browser-safe key, replacing any this CLI made earlier with the
 * same description.
 *
 * Typesense returns a key's value only at creation time, so a previous key cannot
 * be recovered and reused — it has to be replaced. Deleting our own tagged keys
 * first keeps a re-run from piling up a new key every time. On a server that
 * several projects share, each project passes its own description, so a re-run
 * never deletes another project's key.
 */
export async function createSearchOnlyKey(
  client: TypesenseClient,
  collections: string[],
  description = SEARCH_KEY_DESCRIPTION,
): Promise<string> {
  const existing = await client.listKeys()
  for (const key of existing) {
    if (key.description === description) {
      await client.deleteKey(key.id)
    }
  }

  const created = await client.createKey(searchOnlyKeySpec(collections, description))
  if (typeof created.value !== 'string' || created.value === '') {
    throw new Error('Typesense created a key but returned no value for it.')
  }
  return created.value
}
