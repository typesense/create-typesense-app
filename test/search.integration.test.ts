/**
 * THE M2 acceptance criterion, automated.
 *
 * A search issued with ONLY the search-only key returns Harry Potter for
 * "hary potr" — and that same key can do nothing else. Everything upstream exists
 * to make this one assertion true.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ADMIN_KEY_VAR,
  COLLECTION_NAME,
  DEMO_FACET_BY,
  DEMO_QUERY_BY,
  SEARCH_KEY_VAR,
  TYPO_DEMO_QUERY,
} from '../src/constants.js'
import type { ProjectConfig } from '../src/config.js'
import { readEnvFile } from '../src/steps/env.js'
import { provisionServer, type ProvisionedServer } from '../src/steps/provision.js'
import { setUpSearch, type SearchSetupResult } from '../src/steps/searchSetup.js'
import { composeDown } from '../src/steps/server.js'
import { loadTemplate } from '../src/templates.js'
import { checkDocker } from '../src/util/docker.js'
import { createTypesenseClient, TypesenseError } from '../src/util/typesense.js'

const docker = await checkDocker()

const PORT = 8392
const PROJECT = 'cta-m2'
const projectDir = path.join(mkdtempSync(path.join(tmpdir(), 'cta-m2-')), PROJECT)
const envFile = path.join(projectDir, '.env.local')

let server: ProvisionedServer
let setup: SearchSetupResult

async function config(): Promise<ProjectConfig> {
  return {
    projectName: PROJECT,
    targetDir: projectDir,
    template: await loadTemplate('nextjs'),
    server: { kind: 'docker', port: PORT },
    dataset: 'books',
  }
}

beforeAll(async () => {
  if (!docker.available) return
  const projectConfig = await config()
  server = await provisionServer(projectConfig)
  setup = await setUpSearch(projectConfig, server)
}, 300_000)

afterAll(async () => {
  if (docker.available) {
    await composeDown(projectDir).catch(() => undefined)
  }
}, 120_000)

describe.skipIf(!docker.available)('search with only the search-only key', () => {
  /** A client holding the browser-visible key and nothing else. */
  function browserClient() {
    return createTypesenseClient(server.baseUrl, setup.searchOnlyKey)
  }

  it('returns Harry Potter for "hary potr" — two typos, no exact term', async () => {
    const result = await browserClient().search(COLLECTION_NAME, {
      q: TYPO_DEMO_QUERY,
      query_by: DEMO_QUERY_BY,
    })

    expect(result.found).toBeGreaterThan(0)
    expect(String(result.hits[0]?.document['title'])).toContain('Harry Potter')
  })

  it('finds only Harry Potter books, not incidental typo collisions', async () => {
    const result = await browserClient().search(COLLECTION_NAME, {
      q: TYPO_DEMO_QUERY,
      query_by: DEMO_QUERY_BY,
    })
    for (const hit of result.hits) {
      expect(String(hit.document['title'])).toContain('Harry Potter')
    }
  })

  it('is the key from the env file, not one held only in memory', async () => {
    const values = await readEnvFile(envFile)
    const fromEnv = values[`NEXT_PUBLIC_${SEARCH_KEY_VAR}`]
    expect(fromEnv).toBe(setup.searchOnlyKey)

    const result = await createTypesenseClient(server.baseUrl, fromEnv!).search(COLLECTION_NAME, {
      q: TYPO_DEMO_QUERY,
      query_by: DEMO_QUERY_BY,
    })
    expect(String(result.hits[0]?.document['title'])).toContain('Harry Potter')
  })

  it('indexed the whole dataset', () => {
    expect(setup.documentsImported).toBeGreaterThan(200)
  })

  /** The CLI proves the aha moment itself before reporting success. */
  it('was verified during setup, with the search key rather than the admin key', () => {
    expect(setup.verification.query).toBe(TYPO_DEMO_QUERY)
    expect(setup.verification.found).toBeGreaterThan(0)
    expect(setup.verification.topHit).toContain('Harry Potter')
  })

  it.each([
    ['tolkein', 'author misspelled'],
    ['grate gatsby', 'both words wrong'],
    ['sherlok holmes', 'transposed letters'],
    ['hitchikers guide', 'dropped letter'],
  ])('tolerates "%s" (%s)', async (query) => {
    const result = await browserClient().search(COLLECTION_NAME, {
      q: query,
      query_by: DEMO_QUERY_BY,
    })
    expect(result.found).toBeGreaterThan(0)
  })

  it('facets, so the UI can show one', async () => {
    const result = await browserClient().search(COLLECTION_NAME, {
      q: '*',
      query_by: DEMO_QUERY_BY,
      facet_by: DEMO_FACET_BY,
    })
    expect(result.found).toBeGreaterThan(200)
  })
})

describe.skipIf(!docker.available)('the search-only key is genuinely restricted', () => {
  function browserClient() {
    return createTypesenseClient(server.baseUrl, setup.searchOnlyKey)
  }

  it('cannot import documents', async () => {
    await expect(
      browserClient().importDocuments(COLLECTION_NAME, '{"id":"x","title":"Injected"}'),
    ).rejects.toThrow(TypesenseError)
  })

  it('cannot delete the collection', async () => {
    await expect(browserClient().deleteCollection(COLLECTION_NAME)).rejects.toThrow(TypesenseError)
    // Still there, checked with the admin key.
    const admin = createTypesenseClient(server.baseUrl, server.adminKey)
    expect(await admin.collectionExists(COLLECTION_NAME)).toBe(true)
  })

  it('cannot list or mint keys — no privilege escalation', async () => {
    await expect(browserClient().listKeys()).rejects.toThrow(TypesenseError)
    await expect(
      browserClient().createKey({
        description: 'escalated',
        actions: ['*'],
        collections: ['*'],
      }),
    ).rejects.toThrow(TypesenseError)
  })

  it('cannot search a collection it was not scoped to', async () => {
    const admin = createTypesenseClient(server.baseUrl, server.adminKey)
    await admin.createCollection({
      name: 'secrets',
      fields: [{ name: 'body', type: 'string' }],
    })
    await expect(
      browserClient().search('secrets', { q: 'anything', query_by: 'body' }),
    ).rejects.toThrow(TypesenseError)
  })
})

describe.skipIf(!docker.available)('the env file', () => {
  it('keeps the admin key unprefixed and the search key prefixed', async () => {
    const values = await readEnvFile(envFile)
    expect(values[ADMIN_KEY_VAR]).toBe(server.adminKey)
    expect(values[`NEXT_PUBLIC_${ADMIN_KEY_VAR}`]).toBeUndefined()
    expect(values[`NEXT_PUBLIC_${SEARCH_KEY_VAR}`]).toBe(setup.searchOnlyKey)
  })

  it('never writes the admin key under any public name', async () => {
    const values = await readEnvFile(envFile)
    for (const [name, value] of Object.entries(values)) {
      if (name.startsWith('NEXT_PUBLIC_')) {
        expect(value).not.toBe(server.adminKey)
      }
    }
  })

  it('records where the collection is, so the template needs no hardcoding', async () => {
    const values = await readEnvFile(envFile)
    expect(values['NEXT_PUBLIC_TYPESENSE_HOST']).toBe('127.0.0.1')
    expect(values['NEXT_PUBLIC_TYPESENSE_PORT']).toBe(String(PORT))
    expect(values['NEXT_PUBLIC_TYPESENSE_PROTOCOL']).toBe('http')
    expect(values['NEXT_PUBLIC_TYPESENSE_COLLECTION']).toBe(COLLECTION_NAME)
  })
})

describe.skipIf(!docker.available)('re-running', () => {
  it('recreates the collection and still ends up searchable', async () => {
    const projectConfig = await config()
    const second = await setUpSearch(projectConfig, server)

    expect(second.replacedCollection).toBe(true)
    expect(second.documentsImported).toBe(setup.documentsImported)

    const result = await createTypesenseClient(server.baseUrl, second.searchOnlyKey).search(
      COLLECTION_NAME,
      { q: TYPO_DEMO_QUERY, query_by: DEMO_QUERY_BY },
    )
    expect(String(result.hits[0]?.document['title'])).toContain('Harry Potter')
  }, 120_000)

  it('does not accumulate a new search key on every run', async () => {
    const admin = createTypesenseClient(server.baseUrl, server.adminKey)
    const ours = (await admin.listKeys()).filter(
      (key) => key.description === 'create-typesense-app search-only key',
    )
    expect(ours).toHaveLength(1)
  })
})
