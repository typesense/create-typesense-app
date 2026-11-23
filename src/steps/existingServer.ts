import path from 'node:path'
import type { ProjectConfig, ServerConfig } from '../config.js'
import { CommandError } from '../util/clipboard.js'
import {
  createTypesenseClient,
  TypesenseError,
  type StoredAlias,
  type StoredCollection,
  type TypesenseClient,
} from '../util/typesense.js'
import { connectionEnvValues, writeEnvFile } from './env.js'
import {
  ensureSearchConfigFile,
  fieldsFromDocuments,
  inferSearchConfig,
  mergeFields,
  type SearchConfig,
  type SearchField,
} from './searchConfig.js'
import { mapWithLimit } from '../util/limit.js'
import { waitForHealth } from './server.js'

type ExistingServer = Extract<ServerConfig, { kind: 'byo' }>

/** Requests the CLI sends to an existing server at the same time, at most. */
const PARALLEL_REQUESTS = 8

/** With --yes and no --collections, the most collections the CLI takes on its own. */
const MAX_COLLECTIONS_WITHOUT_NAMES = 20

export function readOnlyNotice(url: string): string {
  return `Read-only: this CLI reads schemas and documents from ${url} and does not create, change or delete anything on it.`
}

/**
 * One shell word in single quotes. A `'` inside closes the quotes, adds an
 * escaped quote, and opens them again, so nothing in the value runs as shell.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * The command a developer runs, with their own admin key, to make a key this CLI
 * accepts. It reads `$TYPESENSE_ADMIN_API_KEY`, so no key value is ever printed.
 *
 * Collection names can come from the server's own list, and Typesense accepts a
 * `'` in a name, so every value is quoted for the shell.
 */
export function searchKeyCommand(url: string, collections: string[]): string {
  const spec = {
    description: 'create-typesense-app search key',
    actions: ['documents:search', 'collections:get', 'collections:list', 'aliases:list'],
    collections,
  }
  return [
    `curl -X POST ${shellQuote(`${url}/keys`)} \\`,
    `  -H "X-TYPESENSE-API-KEY: $TYPESENSE_ADMIN_API_KEY" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellQuote(JSON.stringify(spec))}`,
  ].join('\n')
}

function refused(error: unknown): boolean {
  return error instanceof TypesenseError && (error.status === 401 || error.status === 403)
}

export interface Listing {
  collections: StoredCollection[]
  aliases: StoredAlias[]
  /** True when the key may not run `collections:list`, so the list is not the whole server. */
  listRefused: boolean
}

/**
 * The collections and aliases the key can see. A refused list is reported, not
 * hidden: a search-only key from the Typesense Cloud dashboard has only
 * `documents:search`. Any other failure, such as a wrong URL, is thrown.
 */
export async function listSearchable(client: TypesenseClient): Promise<Listing> {
  let listRefused = false
  const collections = await client.listCollections().catch((error: unknown) => {
    if (!refused(error)) throw error
    listRefused = true
    return []
  })
  // `aliases:list` is optional: without it, the picker shows collections only.
  const aliases = await client.listAliases().catch((error: unknown) => {
    if (!refused(error)) throw error
    return []
  })
  return { collections, aliases, listRefused }
}

/**
 * Shown before the key prompt. The dashboard's "search-only" key looks right but
 * has only `documents:search`, so say up front what the key needs.
 */
export function keyNeeds(): string {
  return (
    'Paste a search key for this server. The browser gets this key, so it may only search\n' +
    'and read schemas: an admin key is refused. The search-only key in the Typesense Cloud\n' +
    'dashboard does not work either, because it cannot read schemas. To make the right key,\n' +
    'set TYPESENSE_ADMIN_API_KEY to your admin key, run this command, and paste the "value"\n' +
    'from its reply:'
  )
}

/** What to do after a refused key, when the CLI can ask again. */
export const MAKE_KEY_AND_PASTE =
  'Make a search key with this command, then paste the "value" from its reply:'

/**
 * Why the CLI cannot list the collections. Typesense answers a wrong key and a
 * key without `collections:list` with the same 401, so name both.
 */
export function listRefusedMessage(): string {
  return 'Typesense refused this key. Either it is not a valid key, or it lacks the `collections:list` action.'
}

/** Listing keys needs `keys:*`, which a key for the browser must never have. */
async function canManageKeys(client: TypesenseClient): Promise<boolean> {
  try {
    await client.listKeys()
    return true
  } catch (error) {
    if (error instanceof TypesenseError && (error.status === 401 || error.status === 403)) {
      return false
    }
    throw error
  }
}

/**
 * Requests that Typesense refuses with 401 when the key lacks the action, and
 * that change nothing when the key has it: an id that no document has, an empty
 * import, and bodies that Typesense rejects as invalid. Measured on Typesense 30.
 */
function writeProbes(collection: string): [string, string, string | undefined, string][] {
  const name = encodeURIComponent(collection)
  const id = `create-typesense-app-probe-${Math.random().toString(36).slice(2)}`
  return [
    ['DELETE', `/collections/${name}/documents/${id}`, undefined, 'delete documents'],
    ['POST', `/collections/${name}/documents/import`, '', 'import documents'],
    ['POST', `/collections/${name}/documents`, 'probe', 'create documents'],
    ['PATCH', `/collections/${name}/documents/${id}`, 'probe', 'update documents'],
    ['PATCH', `/collections/${name}`, '{"fields":"probe"}', 'change the collection'],
  ]
}

/**
 * What the key can write, so a key that can is refused before the browser gets
 * it. Not covered: `collections:delete` on a named collection, because the only
 * request that shows it deletes the collection.
 */
export async function writeAccess(
  client: TypesenseClient,
  collections: string[],
): Promise<string[]> {
  const probes: [string, string, string | undefined, string][] = [
    ['POST', '/collections', 'probe', 'create collections'],
    ...collections.flatMap(writeProbes),
  ]
  const allowed = await mapWithLimit(
    probes,
    PARALLEL_REQUESTS,
    async ([method, path, body, action]) => {
      const status = await client.status(method, path, body)
      return status === 401 || status === 403 ? undefined : action
    },
  )
  return [...new Set(allowed.filter((action) => action !== undefined))]
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
  schema: StoredCollection
  /** The schema's fields plus those read off sample documents. */
  fields: SearchField[]
  search: SearchConfig
}

/**
 * Everything that can refuse the run, before the scaffold writes a file.
 *
 * The CLI never changes an existing server: every request is a GET, except the
 * write probes, which change nothing. The key the developer gave is the one the
 * browser gets, so a key that can manage keys or write is refused. No
 * collections selected means every collection and alias the key can see.
 */
export async function inspectExistingServer(
  server: ExistingServer,
): Promise<InspectedCollection[]> {
  await waitForHealth(server.url, { timeoutMs: 10_000 })
  const client = createTypesenseClient(server.url, server.apiKey)

  const listing = await listSearchable(client)
  const { aliases } = listing
  const names =
    server.collections.length > 0
      ? server.collections
      : [
          ...listing.collections.map((collection) => collection.name),
          ...aliases.map((alias) => alias.name),
        ]
  // A key for an alias must also cover the collection it points to.
  const target = new Map(aliases.map((alias) => [alias.name, alias.collection_name]))
  const scope = [...new Set(names.flatMap((name) => [name, target.get(name) ?? name]))]

  if (await canManageKeys(client)) {
    throw new CommandError(
      'That key can manage API keys, so it is an admin key or close to one. The browser gets ' +
        'this key, so it must not be one.',
      searchKeyCommand(server.url, scope.length > 0 ? scope : ['*']),
    )
  }
  if (names.length === 0) {
    if (listing.listRefused) {
      throw new CommandError(
        `${listRefusedMessage()} Name the collections with --collections, or use a key that can list them.`,
        searchKeyCommand(server.url, ['*']),
      )
    }
    throw new Error(
      `${server.url} has no collections that the key can see. Create a collection with ` +
        'documents, then run the CLI again.',
    )
  }
  // Without --collections, --yes takes every collection, and each one gets a
  // section on the page. Past a handful, that is a page nobody can use.
  if (server.collections.length === 0 && names.length > MAX_COLLECTIONS_WITHOUT_NAMES) {
    throw new Error(
      `The key can see ${names.length} collections and aliases on ${server.url}. Name the ones ` +
        `to search with --collections, for example --collections ${names.slice(0, 2).join(',')}.`,
    )
  }

  const writes = await writeAccess(client, scope)
  if (writes.length > 0) {
    throw new CommandError(
      `That key can ${writes.join(', ')}. The browser gets this key, so it must not write.`,
      searchKeyCommand(server.url, scope),
    )
  }

  return mapWithLimit(names, PARALLEL_REQUESTS, (name) =>
    inspectCollection(client, server.url, name, scope),
  )
}

async function inspectCollection(
  client: TypesenseClient,
  url: string,
  name: string,
  scope: string[],
): Promise<InspectedCollection> {
  const schema = await client.getCollection(name).catch(async (error: unknown) => {
    if (error instanceof TypesenseError && error.status === 404) {
      throw new Error(`${url} has no collection or alias named "${name}".`, { cause: error })
    }
    if (refused(error)) {
      // A wrong key and a missing `collections:get` both get 401. A search tells
      // them apart: a valid key that may search the collection gets results.
      const searches = await client.search(name, { q: '*', per_page: '1' }).then(
        () => true,
        () => false,
      )
      throw new CommandError(
        searches
          ? `The key may not read the schema of "${name}": it lacks the \`collections:get\` action.`
          : `Typesense refused this key for "${name}". Either it is not a valid key, or it has no access to "${name}".`,
        searchKeyCommand(url, scope),
        { cause: error },
      )
    }
    throw error
  })
  // Inferred here, so a collection with nothing to search is refused before the scaffold.
  const { hits } = await client.search(name, { q: '*', per_page: '10' }).catch((error: unknown) => {
    if (!refused(error)) throw error
    throw new CommandError(
      `The key may not search "${name}": it lacks the \`documents:search\` action.`,
      searchKeyCommand(url, scope),
      { cause: error },
    )
  })
  const fields = mergeFields(schema.fields, fieldsFromDocuments(hits.map((hit) => hit.document)))
  return {
    name,
    documents: schema.num_documents,
    schema,
    fields,
    search: inferSearchConfig({ name, fields }),
  }
}

/** Wires the generated project to the inspected collections. Still only GETs. */
export async function setUpExistingServer(
  config: ProjectConfig & { server: ExistingServer },
  inspected: InspectedCollection[],
  { onStep = () => {} }: { onStep?: (message: string) => void } = {},
): Promise<ExistingServerResult[]> {
  const { server, template, targetDir } = config

  await ensureSearchConfigFile(targetDir, {
    collections: inspected.map(({ name, schema, search }) => ({
      name,
      schema: { name, fields: schema.fields, default_sorting_field: schema.default_sorting_field },
      search,
    })),
  })
  onStep('Wrote typesense.config.json')

  // The collection variable names the first one; the UI reads them all from the config.
  await writeEnvFile(
    path.join(targetDir, template.env.file),
    connectionEnvValues(server.url, inspected[0]?.name ?? '', server.apiKey),
    template.env.publicPrefix,
  )
  onStep(`Wrote ${template.env.file}`)

  const client = createTypesenseClient(server.url, server.apiKey)
  return mapWithLimit(inspected, PARALLEL_REQUESTS, async ({ name, search }) => {
    const { found } = await client.search(name, { q: '*', query_by: search.queryBy.join(',') })
    return { collection: name, found }
  })
}
