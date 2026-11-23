/**
 * Rebuilds the collection from data/books.jsonl.
 *
 * Idempotent: it drops the collection, recreates it from the schema in
 * typesense.config.json, and re-imports every document. Run it after editing the
 * schema or the data.
 *
 *   npm run seed
 *
 * This is the only file that uses the admin key. Note the variable it reads —
 * TYPESENSE_API_KEY, with no VITE_ prefix — so Vite never bundles it
 * into anything the browser downloads.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Tags the browser-safe key so this script can find its own and avoid piling up a
 * new one on every run. Must match what create-typesense-app uses.
 */
const SEARCH_KEY_DESCRIPTION = 'create-typesense-app search-only key'
const ENV_FILE = '.env'
const SEARCH_KEY_VAR = 'VITE_TYPESENSE_SEARCH_ONLY_API_KEY'

/**
 * Reads .env into process.env.
 *
 * Hand-rolled rather than using a library or Node's --env-file so this script
 * runs the same way on every Node version the project might be on.
 */
async function loadEnv(file: string): Promise<void> {
  const contents = await readFile(file, 'utf8').catch(() => '')
  for (const line of contents.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match === null) continue
    const [, name, rawValue = ''] = match
    if (name !== undefined && process.env[name] === undefined) {
      process.env[name] = rawValue.trim()
    }
  }
}

async function main(): Promise<void> {
  await loadEnv('.env')

  const config = JSON.parse(await readFile('typesense.config.json', 'utf8')) as {
    collections: { name: string; schema: { name: string } }[]
  }
  const collection = config.collections[0]
  if (collection === undefined) {
    throw new Error('typesense.config.json lists no collections. Re-run create-typesense-app.')
  }
  const collectionName = collection.name

  // Coalesced rather than checked for undefined so the type stays `string` inside
  // the request helper below.
  const adminApiKey = process.env.TYPESENSE_API_KEY ?? ''
  if (adminApiKey === '') {
    throw new Error(
      'TYPESENSE_API_KEY is missing from .env. It is the admin key, and only this script uses it.',
    )
  }

  const host = process.env.VITE_TYPESENSE_HOST ?? 'localhost'
  const port = process.env.VITE_TYPESENSE_PORT ?? '8108'
  const protocol = process.env.VITE_TYPESENSE_PROTOCOL ?? 'http'
  const baseUrl = `${protocol}://${host}:${port}`

  async function typesense(
    method: string,
    endpoint: string,
    body?: string,
    contentType = 'application/json',
  ): Promise<string> {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { 'X-TYPESENSE-API-KEY': adminApiKey, 'Content-Type': contentType },
      body,
    })
    const text = await response.text()
    // 404 is fine: dropping a collection that is not there yet.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Typesense replied ${response.status} to ${method} ${endpoint}: ${text}`)
    }
    return text
  }

  const datasetPath = path.join('data', 'books.jsonl')
  const jsonl = await readFile(datasetPath, 'utf8').catch(() => {
    throw new Error(
      `${datasetPath} is missing. Download it with:\n` +
        '  curl -L https://dl.typesense.org/datasets/books.jsonl.gz | gunzip > data/books.jsonl',
    )
  })

  console.log(`Rebuilding "${collectionName}" at ${baseUrl}`)

  // Drop first: Typesense will not retrofit an existing collection to a new schema.
  await typesense('DELETE', `/collections/${collectionName}`)
  await typesense('POST', '/collections', JSON.stringify(collection.schema))
  console.log('  created the collection from typesense.config.json')

  const result = await typesense(
    'POST',
    `/collections/${collectionName}/documents/import?action=upsert`,
    jsonl,
    'text/plain',
  )

  // The import replies with one JSON object per line: a 200 does not mean success.
  let imported = 0
  const failures: string[] = []
  for (const line of result.split('\n')) {
    if (line.trim() === '') continue
    try {
      const outcome = JSON.parse(line) as { success?: boolean; error?: string }
      if (outcome.success === true) imported += 1
      else failures.push(outcome.error ?? 'unknown error')
    } catch {
      failures.push(`unparseable response line: ${line.slice(0, 80)}`)
    }
  }

  if (failures.length > 0) {
    console.error(`  ${failures.length} documents failed to index:`)
    for (const failure of failures.slice(0, 5)) console.error(`    - ${failure}`)
    process.exit(1)
  }

  console.log(`  indexed ${imported} documents`)

  await ensureSearchOnlyKey(typesense, collectionName)

  console.log('\nDone. Try searching for "hary potr".')
}

/**
 * Makes sure the browser still has a working key, recreating it if it is gone.
 *
 * `docker compose down --volumes` deletes API keys along with the index, and
 * Typesense only ever reveals a key's value at creation time — so a wiped key
 * cannot be recovered, only replaced. Without this the app would come back with a
 * 401 that no amount of reseeding fixed.
 *
 * Note what the key is allowed to do: search documents, in one collection. That is
 * the only key the browser ever receives.
 */
async function ensureSearchOnlyKey(
  typesense: (
    method: string,
    endpoint: string,
    body?: string,
    contentType?: string,
  ) => Promise<string>,
  collectionName: string,
): Promise<void> {
  const configured = process.env[SEARCH_KEY_VAR] ?? ''

  const { keys = [] } = JSON.parse(await typesense('GET', '/keys')) as {
    keys?: { id: number; description: string; value_prefix: string }[]
  }
  const ours = keys.filter((key) => key.description === SEARCH_KEY_DESCRIPTION)

  // Typesense exposes only a prefix of an existing key, which is enough to tell
  // whether the one in the env file is still the live one.
  const stillValid =
    configured !== '' && ours.some((key) => configured.startsWith(key.value_prefix))
  if (stillValid) return

  for (const key of ours) {
    await typesense('DELETE', `/keys/${key.id}`)
  }

  const created = JSON.parse(
    await typesense(
      'POST',
      '/keys',
      JSON.stringify({
        description: SEARCH_KEY_DESCRIPTION,
        actions: ['documents:search'],
        collections: [collectionName],
      }),
    ),
  ) as { value?: string }

  if (created.value === undefined || created.value === '') {
    throw new Error('Typesense created a search-only key but returned no value for it.')
  }

  const contents = await readFile(ENV_FILE, 'utf8').catch(() => '')
  const line = `${SEARCH_KEY_VAR}=${created.value}`
  const lines = contents === '' ? [] : contents.replace(/\n+$/, '').split('\n')
  const index = lines.findIndex((existing) => existing.startsWith(`${SEARCH_KEY_VAR}=`))
  if (index === -1) lines.push(line)
  else lines[index] = line
  await writeFile(ENV_FILE, `${lines.join('\n')}\n`, 'utf8')

  console.log(`  created a new search-only key and updated ${ENV_FILE}`)
  console.log('    (restart the dev server so it picks up the new value)')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
