import { mkdir, copyFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { COLLECTION_NAME } from '../constants.js'
import { dataDir } from '../paths.js'
import type { TypesenseClient } from '../util/typesense.js'

export const SCHEMA_FILE = 'books.schema.json'
export const DATASET_FILE = 'books.jsonl'

export interface CollectionSchema {
  name: string
  fields: { name: string; type: string; facet?: boolean; optional?: boolean }[]
  default_sorting_field?: string
}

/**
 * Reads the bundled schema, forcing the collection name to the CLI's constant so
 * the file and the code cannot drift apart.
 *
 * The schema stays bundled even though the data is fetched: it is ours, it is
 * tiny, and PLAN.md §6 wants it sitting in the project inviting edits.
 */
export async function loadBooksSchema(): Promise<CollectionSchema> {
  const raw = await readFile(path.join(dataDir, SCHEMA_FILE), 'utf8')
  const parsed = JSON.parse(raw) as CollectionSchema

  if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    throw new Error(`${SCHEMA_FILE} declares no fields.`)
  }

  return { ...parsed, name: COLLECTION_NAME }
}

/** Puts the schema in the user's project — the file PLAN.md §6 wants them to edit first. */
export async function copySchemaInto(targetDir: string): Promise<string> {
  const destinationDir = path.join(targetDir, 'data')
  await mkdir(destinationDir, { recursive: true })
  const destination = path.join(destinationDir, SCHEMA_FILE)
  await copyFile(path.join(dataDir, SCHEMA_FILE), destination)
  return destination
}

export interface RecreateOutcome {
  /** True when a collection was already there and had to be dropped first. */
  replaced: boolean
}

/**
 * Drop-and-recreate rather than create-if-absent.
 *
 * A collection that already exists may have been made from an older schema, and
 * Typesense will not retrofit one. Recreating keeps a re-run honest: what is in
 * the collection always matches the schema on disk.
 */
export async function recreateCollection(
  client: TypesenseClient,
  schema: CollectionSchema,
): Promise<RecreateOutcome> {
  const replaced = await client.collectionExists(schema.name)
  if (replaced) {
    await client.deleteCollection(schema.name)
  }
  await client.createCollection(schema)
  return { replaced }
}
