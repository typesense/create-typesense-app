/**
 * The schema is the one shipped asset the demo rests on; the data is fetched from
 * dl.typesense.org at scaffold time. So this file checks the schema locally, and
 * checks the live dataset still fits it in a test that skips without a network.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLLECTION_NAME, DEMO_FACET_BY, DEMO_QUERY_BY } from '../src/constants.js'
import { dataDir } from '../src/paths.js'
import {
  BOOKS_DATASET_URL,
  REQUIRED_DATASET_FIELDS,
  assertDatasetShape,
  countJsonlDocuments,
} from '../src/steps/dataset.js'

interface SchemaField {
  name: string
  type: string
  facet?: boolean
  optional?: boolean
}

const schema = JSON.parse(readFileSync(path.join(dataDir, 'books.schema.json'), 'utf8')) as {
  name: string
  fields: SchemaField[]
  default_sorting_field?: string
}

const fieldNames = schema.fields.map((field) => field.name)

describe('books.schema.json', () => {
  it('names the collection the CLI expects', () => {
    expect(schema.name).toBe(COLLECTION_NAME)
  })

  it('makes title searchable as a string', () => {
    expect(schema.fields.find((field) => field.name === 'title')?.type).toBe('string')
  })

  it('declares every field the demo query searches', () => {
    for (const field of DEMO_QUERY_BY.split(',')) {
      expect(fieldNames).toContain(field)
    }
  })

  it('makes the demo facet field facetable', () => {
    expect(schema.fields.find((field) => field.name === DEMO_FACET_BY)?.facet).toBe(true)
  })

  /** This is what breaks the "hary potr" tie toward the best-known book. */
  it('sorts by popularity, so typo matches rank sensibly', () => {
    expect(schema.default_sorting_field).toBe('ratings_count')
    const field = schema.fields.find((f) => f.name === schema.default_sorting_field)
    expect(['int32', 'int64', 'float']).toContain(field?.type)
  })

  it('requires exactly the fields the downloader validates', () => {
    const required = schema.fields
      .filter((field) => field.optional !== true)
      .map((field) => field.name)
    expect([...required].sort()).toEqual([...REQUIRED_DATASET_FIELDS].sort())
  })
})

/**
 * Guards against upstream drift in a file we do not control. Skipped rather than
 * failed when offline, so the suite stays runnable on a plane.
 */
const online = await fetch(BOOKS_DATASET_URL, { method: 'HEAD' })
  .then((response) => response.ok)
  .catch(() => false)

describe.skipIf(!online)('the live dataset at dl.typesense.org', () => {
  it(
    'still carries every field the schema indexes',
    async () => {
      const { gunzipSync } = await import('node:zlib')
      const response = await fetch(BOOKS_DATASET_URL)
      const jsonl = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')

      expect(() => assertDatasetShape(jsonl, REQUIRED_DATASET_FIELDS)).not.toThrow()
      expect(countJsonlDocuments(jsonl)).toBeGreaterThan(5_000)
      expect(jsonl).toContain('Harry Potter')
    },
    120_000,
  )
})
