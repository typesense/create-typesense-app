import path from 'node:path'
import type { ProjectConfig, ServerConfig } from '../config.js'
import { mapWithLimit } from '../util/limit.js'
import {
  createTypesenseClient,
  TypesenseError,
  type StoredAlias,
  type StoredCollection,
  type TypesenseClient,
} from '../util/typesense.js'
import { composeProjectName } from './compose.js'
import { connectionEnvValues, writeEnvFile } from './env.js'
import { createSearchOnlyKey, SEARCH_KEY_DESCRIPTION } from './keys.js'
import {
  ensureSearchConfigFile,
  fieldsFromDocuments,
  inferSearchConfig,
  mergeFields,
  type SearchConfig,
  type SearchField,
} from './searchConfig.js'
import { waitForHealth } from './server.js'

type ExistingServer = Extract<ServerConfig, { kind: 'byo' }>

/** Requests the CLI sends to an existing server at the same time, at most. */
const PARALLEL_REQUESTS = 8

/** With --yes and no --collections, the most collections the CLI takes on its own. */
const MAX_COLLECTIONS_WITHOUT_NAMES = 20

/** What the CLI does on a server it does not own. Shown before and after the run. */
export function existingServerNotice(url: string): string {
  return (
    `The CLI reads schemas and documents from ${url}, and creates one search-only API key ` +
    'there for the browser. It changes nothing else. It uses the admin key for this run ' +
    'only and does not save it.'
  )
}

/** Shown before the key prompt. */
export function adminKeyNeeds(): string {
  return (
    "Paste the server's admin key. The CLI uses it for this run only: to read the schemas,\n" +
    'and to create a search-only key for the browser, scoped to the collections you choose.\n' +
    'The admin key is not saved anywhere.'
  )
}

/**
 * A key the CLI cannot use, as opposed to a server that does not answer. The
 * prompt shows the message and asks for the key again.
 */
export class KeyRefusedError extends Error {}

const NOT_ADMIN =
  'Typesense refused this key, or it cannot manage API keys. Paste the admin key: the CLI ' +
  'needs it to create the search-only key for the browser.'

function refused(error: unknown): boolean {
  return error instanceof TypesenseError && (error.status === 401 || error.status === 403)
}

/** Listing keys needs `keys:*`, which is what creating the browser's key needs too. */
async function canManageKeys(client: TypesenseClient): Promise<boolean> {
  try {
    await client.listKeys()
    return true
  } catch (error) {
    if (refused(error)) return false
    throw error
  }
}

/** Throws KeyRefusedError unless the key can create the browser's key. */
export async function checkAdminKey(url: string, adminKey: string): Promise<void> {
  await waitForHealth(url, { timeoutMs: 10_000 })
  if (!(await canManageKeys(createTypesenseClient(url, adminKey)))) {
    throw new KeyRefusedError(NOT_ADMIN)
  }
}

export interface Listing {
  collections: StoredCollection[]
  aliases: StoredAlias[]
}

/** Every collection and alias on the server. A refused list means the key is not an admin key. */
export async function listCollections(client: TypesenseClient): Promise<Listing> {
  try {
    const [collections, aliases] = await Promise.all([
      client.listCollections(),
      client.listAliases(),
    ])
    return { collections, aliases }
  } catch (error) {
    if (refused(error)) throw new KeyRefusedError(NOT_ADMIN, { cause: error })
    throw error
  }
}

export interface ExistingServerResult {
  collection: string
  /** Documents the empty query finds, with the key the browser will hold. */
  found: number
}

export interface InspectedCollection {
  /** The collection or alias name the UI searches. */
  name: string
  documents: number
  /** The collection's schema. For an alias, its `name` is the collection the alias points to. */
  schema: StoredCollection
  /** The schema's fields plus those read off sample documents. */
  fields: SearchField[]
  search: SearchConfig
}

/**
 * Everything that can refuse the run, before the scaffold writes a file. Every
 * request here is a GET. No collections selected means every collection and
 * alias on the server.
 */
export async function inspectExistingServer(
  server: ExistingServer,
): Promise<InspectedCollection[]> {
  await checkAdminKey(server.url, server.adminKey)
  const client = createTypesenseClient(server.url, server.adminKey)

  const listing = await listCollections(client)
  const names =
    server.collections.length > 0
      ? server.collections
      : [
          ...listing.collections.map((collection) => collection.name),
          ...listing.aliases.map((alias) => alias.name),
        ]
  if (names.length === 0) {
    throw new Error(
      `${server.url} has no collections. Create a collection with documents, then run the CLI again.`,
    )
  }
  // Without --collections, --yes takes every collection, and each one gets a
  // section on the page. Past a handful, that is a page nobody can use.
  if (server.collections.length === 0 && names.length > MAX_COLLECTIONS_WITHOUT_NAMES) {
    throw new Error(
      `${server.url} has ${names.length} collections and aliases. Name the ones to search ` +
        `with --collections, for example --collections ${names.slice(0, 2).join(',')}.`,
    )
  }

  return mapWithLimit(names, PARALLEL_REQUESTS, (name) =>
    inspectCollection(client, server.url, name),
  )
}

async function inspectCollection(
  client: TypesenseClient,
  url: string,
  name: string,
): Promise<InspectedCollection> {
  const schema = await client.getCollection(name).catch((error: unknown) => {
    if (error instanceof TypesenseError && error.status === 404) {
      throw new Error(`${url} has no collection or alias named "${name}".`, { cause: error })
    }
    throw error
  })
  // Inferred here, so a collection with nothing to search is refused before the scaffold.
  const { hits } = await client.search(name, { q: '*', per_page: '10' })
  const fields = mergeFields(schema.fields, fieldsFromDocuments(hits.map((hit) => hit.document)))
  return {
    name,
    documents: schema.num_documents,
    schema,
    fields,
    search: inferSearchConfig({ name, fields }),
  }
}

/**
 * The description of this project's search key on an existing server. Several
 * projects can share one server, so it names the project and a hash of its path:
 * a re-run replaces this project's key and leaves every other key alone.
 */
export function searchKeyDescription(projectName: string, targetDir: string): string {
  return `${SEARCH_KEY_DESCRIPTION} for ${composeProjectName(projectName, targetDir)}`
}

/**
 * Wires the generated project to the inspected collections, and creates the
 * browser's key: `documents:search` on those collections, and on the collection
 * behind each alias. The admin key never reaches a file.
 */
export async function setUpExistingServer(
  config: ProjectConfig & { server: ExistingServer },
  inspected: InspectedCollection[],
  { onStep = () => {} }: { onStep?: (message: string) => void } = {},
): Promise<ExistingServerResult[]> {
  const { server, template, targetDir, projectName } = config

  await ensureSearchConfigFile(targetDir, {
    collections: inspected.map(({ name, schema, search }) => ({
      name,
      schema: { name, fields: schema.fields, default_sorting_field: schema.default_sorting_field },
      search,
    })),
  })
  onStep('Wrote typesense.config.json')

  const admin = createTypesenseClient(server.url, server.adminKey)
  const scope = [...new Set(inspected.flatMap(({ name, schema }) => [name, schema.name]))]
  const searchKey = await createSearchOnlyKey(
    admin,
    scope,
    searchKeyDescription(projectName, targetDir),
  )
  onStep('Created a search-only key for the browser')

  // The collection variable names the first one; the UI reads them all from the config.
  await writeEnvFile(
    path.join(targetDir, template.env.file),
    connectionEnvValues(server.url, inspected[0]?.name ?? '', searchKey),
    template.env.publicPrefix,
  )
  onStep(`Wrote ${template.env.file}`)

  // With the browser's key, so this proves the key the page will use.
  const browser = createTypesenseClient(server.url, searchKey)
  return mapWithLimit(inspected, PARALLEL_REQUESTS, async ({ name, search }) => {
    const { found } = await browser.search(name, { q: '*', query_by: search.queryBy.join(',') })
    return { collection: name, found }
  })
}
