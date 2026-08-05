/**
 * Rebuilds the collection from data/books.jsonl.
 *
 * Idempotent: it drops the collection, recreates it from scripts/schema.ts, and
 * re-imports every document. Run it after editing the schema or the data.
 *
 *   npm run seed
 *
 * This is the only file that uses the admin key. Note the variable it reads —
 * TYPESENSE_API_KEY, with no NEXT_PUBLIC_ prefix — so Next.js never bundles it
 * into anything the browser downloads.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { booksSchema, collectionName } from './schema'

/**
 * Reads .env.local into process.env.
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
  await loadEnv('.env.local')

  // Coalesced rather than checked for undefined so the type stays `string` inside
  // the request helper below.
  const adminApiKey = process.env.TYPESENSE_API_KEY ?? ''
  if (adminApiKey === '') {
    throw new Error(
      'TYPESENSE_API_KEY is missing from .env.local. It is the admin key, and only this script uses it.',
    )
  }

  const host = process.env.NEXT_PUBLIC_TYPESENSE_HOST ?? 'localhost'
  const port = process.env.NEXT_PUBLIC_TYPESENSE_PORT ?? '8108'
  const protocol = process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL ?? 'http'
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
  await typesense('POST', '/collections', JSON.stringify(booksSchema))
  console.log('  created the collection from scripts/schema.ts')

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
  console.log('\nDone. Try searching for "hary potr".')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
