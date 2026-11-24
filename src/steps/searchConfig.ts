import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CollectionSchema } from './collection.js'

/** The one file a generated project's UI and seed script read. Every template's UI is driven by it. */
export const SEARCH_CONFIG_FILE = 'typesense.config.json'

/** What the UI searches, facets and shows in a hit, for one collection. */
export interface SearchConfig {
  queryBy: string[]
  facets: string[]
  title: string
  /** `null` rather than absent, so a JSON import keeps the same type for every collection. */
  image: string | null
  display: string[]
}

export interface SearchConfigFile {
  collections: { name: string; schema: CollectionSchema; search: SearchConfig }[]
}

const TEXT_TYPES = new Set(['string', 'string[]'])
const IMAGE_NAME = /image|thumbnail|photo/i
const TITLE_NAME = /title|name/i

export type SearchField = CollectionSchema['fields'][number]

function typeOf(value: unknown): string | undefined {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int64' : 'float'
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
    return 'string[]'
  }
  return undefined
}

/** Field types read off sample documents. Nested objects and mixed arrays are skipped. */
export function fieldsFromDocuments(documents: Record<string, unknown>[]): SearchField[] {
  const fields = new Map<string, SearchField>()
  for (const document of documents) {
    for (const [name, value] of Object.entries(document)) {
      const type = typeOf(value)
      if (name !== 'id' && !fields.has(name) && type !== undefined) fields.set(name, { name, type })
    }
  }
  return [...fields.values()]
}

/**
 * The schema's fields, plus sampled ones it does not name; the schema wins.
 *
 * A sampled field is searchable only if a `.*` field indexes it. Otherwise it is
 * merely stored, which is still enough to show it or use it as the image.
 * Typesense refuses `facet` on `.*`, so no sampled field is a facet.
 */
export function mergeFields(schema: SearchField[], sampled: SearchField[]): SearchField[] {
  const named = new Set(schema.map((field) => field.name))
  const indexed = schema.some((field) => field.name === '.*' && field.index !== false)
  return [
    ...schema,
    ...sampled
      .filter((field) => !named.has(field.name))
      .map((field) => ({ ...field, facet: false, ...(indexed ? {} : { index: false }) })),
  ]
}

/**
 * Derives the search config from a schema's fields; the caller may have merged
 * sampled ones in first.
 *
 * Only text fields become facets: a numeric facet needs a range widget, and as a
 * plain list `ratings_count` would offer thousands of one-document values.
 */
export function inferSearchConfig(schema: CollectionSchema): SearchConfig {
  const fields = schema.fields.filter((field) => field.name !== '.*')
  const image = fields.find((field) => field.type === 'string' && IMAGE_NAME.test(field.name))
  const text = fields.filter(
    (field) => TEXT_TYPES.has(field.type) && field.index !== false && field !== image,
  )

  const title = text.find((field) => TITLE_NAME.test(field.name)) ?? text[0]
  if (title === undefined) {
    throw new Error(`Collection "${schema.name}" has no text field to search.`)
  }

  return {
    queryBy: text.map((field) => field.name),
    facets: text.filter((field) => field.facet === true).map((field) => field.name),
    title: title.name,
    image: image?.name ?? null,
    display: fields
      .filter((field) => field !== title && field !== image)
      .map((field) => field.name),
  }
}

/**
 * Writes the file only if the project does not have one yet, then reads it back.
 *
 * Reading back is what makes the project's copy the source of truth: a developer's
 * edits survive a re-run, and the CLI indexes exactly what the seed script would.
 */
export async function ensureSearchConfigFile(
  targetDir: string,
  initial: SearchConfigFile,
): Promise<SearchConfigFile> {
  const file = path.join(targetDir, SEARCH_CONFIG_FILE)
  await writeFile(file, `${JSON.stringify(initial, null, 2)}\n`, { flag: 'wx' }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    },
  )
  return JSON.parse(await readFile(file, 'utf8')) as SearchConfigFile
}
