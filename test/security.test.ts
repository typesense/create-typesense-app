import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ADMIN_KEY_VAR, SEARCH_KEY_VAR } from '../src/constants.js'
import {
  connectionEnvValues,
  parseEnvContents,
  upsertEnvContents,
  writeEnvFile,
} from '../src/steps/env.js'
import { inspectExistingServer, searchKeyCommand } from '../src/steps/existingServer.js'
import { createSearchOnlyKey, SEARCH_KEY_DESCRIPTION } from '../src/steps/keys.js'
import { CommandError } from '../src/util/clipboard.js'
import type { TypesenseClient } from '../src/util/typesense.js'

/**
 * The admin key must never reach the browser, and the CLI must never change a
 * server that it does not own.
 */

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cta-security-'))
}

describe('the env file', () => {
  it('writes the admin key without the public prefix, and every other value with it', () => {
    const contents = upsertEnvContents(
      '',
      {
        [ADMIN_KEY_VAR]: 'admin-secret',
        ...connectionEnvValues('http://127.0.0.1:8108', 'books', 'search-key'),
      },
      'VITE_',
    )
    const env = parseEnvContents(contents)

    expect(env[ADMIN_KEY_VAR]).toBe('admin-secret')
    expect(env[`VITE_${ADMIN_KEY_VAR}`]).toBeUndefined()
    expect(env[`VITE_${SEARCH_KEY_VAR}`]).toBe('search-key')
    const browserValues = Object.entries(env)
      .filter(([name]) => name.startsWith('VITE_'))
      .map(([, value]) => value)
    expect(browserValues).not.toContain('admin-secret')
  })

  it('refuses a value with a newline, which would add a second variable', () => {
    expect(() =>
      upsertEnvContents('', { [SEARCH_KEY_VAR]: `key\nVITE_${ADMIN_KEY_VAR}=leak` }, 'VITE_'),
    ).toThrow(/newline/)
  })

  it('refuses a variable that is on neither the public nor the private list', () => {
    expect(() => upsertEnvContents('', { SOMETHING_NEW: 'x' }, 'VITE_')).toThrow(
      /Unknown env variable/,
    )
  })

  it('replaces its own lines and keeps every other line', () => {
    const first = upsertEnvContents('OTHER=1\n', { [SEARCH_KEY_VAR]: 'old' }, 'VITE_')
    const second = upsertEnvContents(first, { [SEARCH_KEY_VAR]: 'new' }, 'VITE_')
    expect(second).toBe(`OTHER=1\nVITE_${SEARCH_KEY_VAR}=new\n`)
  })

  it('adds the env file to .gitignore once, unless .gitignore already covers it', async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, '.gitignore'), 'node_modules\n')
    await writeEnvFile(path.join(dir, '.env'), { [ADMIN_KEY_VAR]: 'k' }, 'VITE_')
    await writeEnvFile(path.join(dir, '.env'), { [ADMIN_KEY_VAR]: 'k' }, 'VITE_')
    const gitignore = await readFile(path.join(dir, '.gitignore'), 'utf8')
    expect(gitignore.startsWith('node_modules\n')).toBe(true)
    expect(gitignore.match(/^\/\.env$/gm)).toHaveLength(1)

    const covered = await tempDir()
    await writeFile(path.join(covered, '.gitignore'), '.env*\n')
    await writeEnvFile(path.join(covered, '.env'), { [ADMIN_KEY_VAR]: 'k' }, 'VITE_')
    expect(await readFile(path.join(covered, '.gitignore'), 'utf8')).toBe('.env*\n')
  })
})

describe('the browser key', () => {
  it('can only search one collection, and a re-run replaces only keys this CLI made', async () => {
    const keys = [
      { id: 1, description: SEARCH_KEY_DESCRIPTION },
      { id: 2, description: 'a key someone else made' },
    ]
    const created: object[] = []
    const client = {
      listKeys: async () => keys,
      deleteKey: async (id: number) => {
        keys.splice(
          keys.findIndex((key) => key.id === id),
          1,
        )
      },
      createKey: async (spec: object) => {
        created.push(spec)
        return { id: 3, value: 'new-search-key' }
      },
    } as unknown as TypesenseClient

    expect(await createSearchOnlyKey(client, 'books')).toBe('new-search-key')
    expect(created).toEqual([
      {
        description: SEARCH_KEY_DESCRIPTION,
        actions: ['documents:search'],
        collections: ['books'],
      },
    ])
    expect(keys.map((key) => key.id)).toEqual([2])
  })
})

describe('an existing server', () => {
  const ADMIN = 'admin-key'
  const SEARCH = 'search-key'
  const WRITER = 'key-that-can-write-documents'
  const requests: string[] = []

  // Answers like a Typesense that holds `movies` and an alias `films` for it.
  // Only the admin key may list API keys. A write that the key may not make gets
  // 401; one that it may make gets 404, as Typesense answers the CLI's probes.
  const server = createServer((request, response) => {
    const key = request.headers['x-typesense-api-key']
    const url = request.url ?? ''
    const reply = (status: number, body: unknown) => {
      requests.push(`${request.method} ${status}`)
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    const movies = { name: 'movies', num_documents: 1, fields: [{ name: 'title', type: 'string' }] }

    if (url === '/health') return reply(200, { ok: true })
    if (key !== ADMIN && key !== SEARCH && key !== WRITER)
      return reply(401, { message: 'Forbidden' })
    if (url === '/keys') return key === ADMIN ? reply(200, { keys: [] }) : reply(401, {})
    if (request.method !== 'GET') return key === WRITER ? reply(404, {}) : reply(401, {})
    if (url === '/collections') return reply(200, [movies])
    if (url === '/aliases')
      return reply(200, { aliases: [{ name: 'films', collection_name: 'movies' }] })
    if (url === '/collections/movies' || url === '/collections/films') return reply(200, movies)
    if (url.includes('/documents/search'))
      return reply(200, { found: 1, hits: [{ document: { title: 'Alien' } }] })
    return reply(404, { message: 'Not Found' })
  })
  const url = new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  )
  afterAll(() => new Promise((resolve) => server.close(resolve)))

  const existing = async (apiKey: string, collections: string[] = []) => ({
    kind: 'byo' as const,
    flavour: 'existing' as const,
    url: await url,
    apiKey,
    collections,
  })

  it('refuses an admin key, and prints a command that makes a search key without showing a key', async () => {
    const error = await inspectExistingServer(await existing(ADMIN, ['movies'])).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(CommandError)
    expect((error as CommandError).message).toMatch(/can manage API keys/)
    expect((error as CommandError).command).toContain('$TYPESENSE_ADMIN_API_KEY')
    expect((error as CommandError).command).not.toContain(ADMIN)
  })

  it('refuses a key that can write, and accepts a search key, whose every write is refused', async () => {
    const error = await inspectExistingServer(await existing(WRITER)).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(CommandError)
    expect((error as CommandError).message).toMatch(/can create collections, delete documents/)

    requests.length = 0
    const inspected = await inspectExistingServer(await existing(SEARCH))
    expect(inspected.map((collection) => collection.name)).toEqual(['movies', 'films'])
    const writes = requests.filter((entry) => !entry.startsWith('GET '))
    expect(writes.length).toBeGreaterThan(0)
    expect(new Set(writes)).toEqual(new Set(['DELETE 401', 'POST 401', 'PATCH 401']))
  })

  it('makes the suggested key cover the collection that an alias points to', () => {
    const command = searchKeyCommand('https://xyz.a1.typesense.net', ['films', 'movies'])
    const spec = JSON.parse(/-d '(.*)'$/m.exec(command)?.[1] ?? '{}')
    expect(spec.collections).toEqual(['films', 'movies'])
    expect(spec.actions).toEqual([
      'documents:search',
      'collections:get',
      'collections:list',
      'aliases:list',
    ])
  })
})
