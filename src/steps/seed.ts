import type { TypesenseClient } from '../util/typesense.js'

export interface ImportOutcome {
  imported: number
  failed: number
  /** First few failure messages, for an actionable error. */
  errors: string[]
}

const MAX_REPORTED_ERRORS = 5

/**
 * Typesense's bulk import answers with one JSON object per line, not a single
 * status: a 200 response can still mean every document failed. Reading only the
 * status code would report a successful index over an empty collection.
 */
export function parseImportResponse(body: string): ImportOutcome {
  let imported = 0
  let failed = 0
  const errors: string[] = []

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let parsed: { success?: boolean; error?: string }
    try {
      parsed = JSON.parse(trimmed) as { success?: boolean; error?: string }
    } catch {
      failed += 1
      if (errors.length < MAX_REPORTED_ERRORS) {
        errors.push(`A response line could not be parsed: ${trimmed.slice(0, 120)}`)
      }
      continue
    }

    if (parsed.success === true) {
      imported += 1
    } else {
      failed += 1
      if (errors.length < MAX_REPORTED_ERRORS) {
        errors.push(parsed.error ?? 'unknown import error')
      }
    }
  }

  return { imported, failed, errors }
}

/** Imports the documents and refuses to report success on a partial index. */
export async function seedCollection(
  client: TypesenseClient,
  collection: string,
  jsonl: string,
): Promise<ImportOutcome> {
  const outcome = parseImportResponse(await client.importDocuments(collection, jsonl))

  if (outcome.failed > 0) {
    throw new Error(
      `${outcome.failed} of ${outcome.failed + outcome.imported} documents failed to index:\n` +
        outcome.errors.map((error) => `  - ${error}`).join('\n'),
    )
  }

  return outcome
}
