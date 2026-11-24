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
import {
  inspectExistingServer,
  KeyRefusedError,
  setUpExistingServer,
} from '../src/steps/existingServer.js'
import { createSearchOnlyKey, SEARCH_KEY_DESCRIPTION } from '../src/steps/keys.js'
import { loadTemplate } from '../src/templates.js'
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
  it('can only search the given collections, and a re-run replaces only keys with its description', async () => {
    const keys = [
      { id: 1, description: SEARCH_KEY_DESCRIPTION },
      { id: 2, description: 'a key someone else made' },
      { id: 3, description: `${SEARCH_KEY_DESCRIPTION} for another-project-123abc` },
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
        return { id: 4, value: 'new-search-key' }
      },
    } as unknown as TypesenseClient

    expect(await createSearchOnlyKey(client, ['movies', 'films'])).toBe('new-search-key')
    expect(created).toEqual([
      {
        description: SEARCH_KEY_DESCRIPTION,
        actions: ['documents:search'],
        collections: ['movies', 'films'],
      },
    ])
    expect(keys.map((key) => key.id)).toEqual([2, 3])
  })
})

describe('an existing server', () => {
  const ADMIN = 'admin-key'
  const SEARCH = 'a-key-that-only-searches'
  const BROWSER = 'key-the-cli-created'
  const requests: string[] = []
  const createdKeys: { description: string; actions: string[]; collections: string[] }[] = []

  // Answers like a Typesense that holds `movies` and an alias `films` for it.
  // Only the admin key may manage keys; a created key may only search.
  const server = createServer((request, response) => {
    const key = request.headers['x-typesense-api-key']
    const url = request.url ?? ''
    const reply = (status: number, body: unknown) =>
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    const movies = { name: 'movies', num_documents: 1, fields: [{ name: 'title', type: 'string' }] }
    requests.push(request.method ?? '')

    if (url === '/health') return reply(200, { ok: true })
    if (url.includes('/documents/search') && (key === ADMIN || key === SEARCH || key === BROWSER))
      return reply(200, { found: 1, hits: [{ document: { title: 'Alien' } }] })
    if (key !== ADMIN) return reply(401, { message: 'Forbidden' })
    if (url === '/keys' && request.method === 'GET') return reply(200, { keys: [] })
    if (url === '/keys' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        createdKeys.push(JSON.parse(body))
        reply(201, { id: 1, value: BROWSER })
      })
      return
    }
    if (url === '/collections') return reply(200, [movies])
    if (url === '/aliases')
      return reply(200, { aliases: [{ name: 'films', collection_name: 'movies' }] })
    if (url === '/collections/movies' || url === '/collections/films') return reply(200, movies)
    return reply(404, { message: 'Not Found' })
  })
  const url = new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  )
  afterAll(() => new Promise((resolve) => server.close(resolve)))

  const existing = async (adminKey: string, collections: string[] = []) => ({
    kind: 'byo' as const,
    flavour: 'existing' as const,
    url: await url,
    adminKey,
    collections,
  })

  it('refuses a key that cannot manage API keys', async () => {
    await expect(inspectExistingServer(await existing(SEARCH))).rejects.toThrow(KeyRefusedError)
  })

  it('reads with GET only, then gives the browser a new key that can only search the chosen collections', async () => {
    requests.length = 0
    const inspected = await inspectExistingServer(await existing(ADMIN))
    expect(inspected.map((collection) => collection.name)).toEqual(['movies', 'films'])
    expect(new Set(requests)).toEqual(new Set(['GET']))

    const targetDir = await tempDir()
    const template = await loadTemplate('vanilla')
    const results = await setUpExistingServer(
      { projectName: 'app', targetDir, template, server: await existing(ADMIN) },
      inspected,
    )

    // One key: search only, on each chosen name and the collection behind the alias.
    expect(createdKeys).toHaveLength(1)
    expect(createdKeys[0]).toMatchObject({
      actions: ['documents:search'],
      collections: ['movies', 'films'],
    })
    expect(createdKeys[0]?.description).toMatch(/^create-typesense-app search-only key for app-/)
    expect(results).toEqual([
      { collection: 'movies', found: 1 },
      { collection: 'films', found: 1 },
    ])

    // The browser gets the new key; the admin key reaches no file.
    const env = parseEnvContents(await readFile(path.join(targetDir, '.env'), 'utf8'))
    expect(env[`VITE_${SEARCH_KEY_VAR}`]).toBe(BROWSER)
    expect(Object.values(env)).not.toContain(ADMIN)
    expect(await readFile(path.join(targetDir, 'typesense.config.json'), 'utf8')).not.toContain(
      ADMIN,
    )
  })
})
