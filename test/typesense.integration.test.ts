import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEARCH_KEY_VAR } from '../src/constants.js'
import type { LocalProjectConfig } from '../src/config.js'
import { readEnvFile } from '../src/steps/env.js'
import { type ProvisionedServer, provisionServer } from '../src/steps/provision.js'
import { setUpSearch } from '../src/steps/searchSetup.js'
import { composeDown } from '../src/steps/server.js'
import { loadTemplate } from '../src/templates.js'
import { checkDocker } from '../src/util/docker.js'
import { nextFreePort } from '../src/util/port.js'
import { createTypesenseClient, TypesenseError } from '../src/util/typesense.js'

/**
 * Against a real Typesense in Docker: the key that the CLI gives the browser can
 * search, and can do nothing else. Only a real server can prove the second part.
 *
 * Skipped when Docker is not running. The project gets a small copy of the books
 * data, so the test downloads nothing.
 */
const docker = await checkDocker()

const BOOKS = [
  {
    title: "Harry Potter and the Philosopher's Stone",
    authors: ['J.K. Rowling'],
    ratings_count: 4602479,
  },
  { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], ratings_count: 2071616 },
  { title: 'The Hunger Games', authors: ['Suzanne Collins'], ratings_count: 4780653 },
].map((book) => ({
  ...book,
  publication_year: 2000,
  average_rating: 4.3,
  image_url: 'https://example.com/cover.jpg',
}))

let config: LocalProjectConfig
let server: ProvisionedServer

beforeAll(async () => {
  if (!docker.available) return
  const targetDir = path.join(await mkdtemp(path.join(tmpdir(), 'cta-typesense-')), 'app')
  await mkdir(path.join(targetDir, 'data'), { recursive: true })
  await writeFile(
    path.join(targetDir, 'data', 'books.jsonl'),
    BOOKS.map((book) => JSON.stringify(book)).join('\n'),
  )
  config = {
    projectName: 'app',
    targetDir,
    template: await loadTemplate('nextjs'),
    server: { kind: 'docker', port: await nextFreePort(8390) },
  }
  server = await provisionServer(config)
  await setUpSearch(config, server)
}, 300_000)

afterAll(async () => {
  if (docker.available && config !== undefined) {
    await composeDown(config.targetDir).catch(() => undefined)
  }
}, 120_000)

describe.skipIf(!docker.available)('the search key in the env file, on a real Typesense', () => {
  async function browserClient() {
    const env = await readEnvFile(path.join(config.targetDir, config.template.env.file))
    const key = env[`${config.template.env.publicPrefix}${SEARCH_KEY_VAR}`] ?? ''
    expect(key).not.toBe('')
    return createTypesenseClient(server.baseUrl, key)
  }

  it('finds Harry Potter for the misspelled "hary potr"', async () => {
    const result = await (await browserClient()).search('books', {
      q: 'hary potr',
      query_by: 'title,authors',
    })
    expect(String(result.hits[0]?.document['title'])).toBe(
      "Harry Potter and the Philosopher's Stone",
    )
  })

  it('cannot write documents, delete the collection, use the key API, or search another collection', async () => {
    const browser = await browserClient()
    const admin = createTypesenseClient(server.baseUrl, server.adminKey)
    await admin.createCollection({ name: 'private', fields: [{ name: 'body', type: 'string' }] })

    await expect(browser.importDocuments('books', '{"title":"Injected"}')).rejects.toThrow(
      TypesenseError,
    )
    await expect(browser.deleteCollection('books')).rejects.toThrow(TypesenseError)
    await expect(browser.listKeys()).rejects.toThrow(TypesenseError)
    await expect(
      browser.createKey({ description: 'escalated', actions: ['*'], collections: ['*'] }),
    ).rejects.toThrow(TypesenseError)
    await expect(browser.search('private', { q: '*', query_by: 'body' })).rejects.toThrow(
      TypesenseError,
    )

    // Nothing changed: the admin key still sees all the books.
    expect((await admin.getCollection('books')).num_documents).toBe(BOOKS.length)
  })
})
