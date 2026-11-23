import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { DEMO_QUERY_BY, TYPO_DEMO_QUERY } from '../constants.js'
import type { ProjectConfig } from '../config.js'
import { createTypesenseClient } from '../util/typesense.js'
import { loadBooksSchema, recreateCollection } from './collection.js'
import { ensureSearchConfigFile, inferSearchConfig, SEARCH_CONFIG_FILE } from './searchConfig.js'
import { ensureDataset } from './dataset.js'
import { connectionEnvValues, writeEnvFile } from './env.js'
import { createSearchOnlyKey } from './keys.js'
import type { ProvisionedServer } from './provision.js'
import { seedCollection } from './seed.js'

export interface TypoVerification {
  query: string
  found: number
  topHit: string
}

export interface SearchSetupResult {
  collection: string
  documentsImported: number
  /** The browser-safe key. The admin key stays in ProvisionedServer. */
  searchOnlyKey: string
  replacedCollection: boolean
  /** Proof the aha moment works, obtained with the search-only key. */
  verification: TypoVerification
}

export interface SearchSetupOptions {
  onStep?: (message: string) => void
}

/**
 * Everything between "a server is running" and "the browser can search it":
 * collection, documents, scoped key, env file.
 *
 * Framework-agnostic on purpose. The only things it takes from the template are
 * the env file's name and its public prefix, both from the manifest.
 */
export async function setUpSearch(
  config: ProjectConfig,
  server: ProvisionedServer,
  { onStep = () => {} }: SearchSetupOptions = {},
): Promise<SearchSetupResult> {
  const { template, targetDir } = config

  // Only the CLI ever holds the admin key.
  const admin = createTypesenseClient(server.baseUrl, server.adminKey)

  const books = await loadBooksSchema()
  const searchFile = await ensureSearchConfigFile(targetDir, {
    collections: [{ name: books.name, schema: books, search: inferSearchConfig(books) }],
  })
  const schema = searchFile.collections[0]?.schema
  if (schema === undefined) {
    throw new Error(`${SEARCH_CONFIG_FILE} lists no collections.`)
  }

  const { replaced } = await recreateCollection(admin, schema)
  onStep(`${replaced ? 'Recreated' : 'Created'} collection "${schema.name}"`)

  // Fetched, not bundled. Lands directly in the project so the user's own seed
  // script can re-run it offline.
  const dataset = await ensureDataset(targetDir, { onProgress: onStep })

  const { imported: documentsImported } = await seedCollection(
    admin,
    schema.name,
    await readFile(dataset.path, 'utf8'),
  )
  onStep(`Indexed ${documentsImported} documents`)

  const searchOnlyKey = await createSearchOnlyKey(admin, schema.name)
  onStep('Generated a search-only API key')

  // The only place the browser-visible values are written. connectionEnvValues
  // returns public names only, so every one of them gets the prefix; the admin key
  // was written unprefixed during provisioning and is untouched here.
  await writeEnvFile(
    path.join(targetDir, template.env.file),
    connectionEnvValues(server.baseUrl, schema.name, searchOnlyKey),
    template.env.publicPrefix,
  )
  onStep(`Wrote ${template.env.file}`)

  const verification = await verifyTypoSearch(server.baseUrl, searchOnlyKey, schema.name)
  onStep(`Verified: "${verification.query}" finds ${verification.topHit}`)

  return {
    collection: schema.name,
    documentsImported,
    searchOnlyKey,
    replacedCollection: replaced,
    verification,
  }
}

/**
 * Runs the demo query with the *search-only* key, so the CLI proves the thing it
 * is about to claim rather than assuming it.
 *
 * Using the browser's key here is the point: it exercises the same path the app
 * will, and would catch a key that was scoped wrongly.
 */
export async function verifyTypoSearch(
  baseUrl: string,
  searchOnlyKey: string,
  collection: string,
): Promise<TypoVerification> {
  const browser = createTypesenseClient(baseUrl, searchOnlyKey)
  const result = await browser.search(collection, {
    q: TYPO_DEMO_QUERY,
    query_by: DEMO_QUERY_BY,
  })

  const topHit = String(result.hits[0]?.document['title'] ?? '')

  if (result.found === 0) {
    throw new Error(
      `The collection was indexed but searching "${TYPO_DEMO_QUERY}" returned nothing. ` +
        `Expected typo-tolerant matches over ${DEMO_QUERY_BY}.`,
    )
  }

  return { query: TYPO_DEMO_QUERY, found: result.found, topHit }
}
