import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DATASET_FILE } from './collection.js'

/**
 * Typesense's own sample dataset — the one their docs use.
 *
 * Fetched at scaffold time rather than bundled, so nothing is redistributed and
 * the package stays small. The cost is a dependency on a file we do not control,
 * which is why assertDatasetShape exists.
 */
export const BOOKS_DATASET_URL = 'https://dl.typesense.org/datasets/books.jsonl.gz'

const DOWNLOAD_TIMEOUT_MS = 120_000

export interface DatasetResult {
  /** Absolute path to the JSONL inside the user's project. */
  path: string
  documents: number
  /** False when a previous run's copy was reused. */
  downloaded: boolean
  /** Compressed bytes transferred; 0 when cached. */
  bytes: number
}

export interface DatasetOptions {
  url?: string
  onProgress?: (message: string) => void
}

export function countJsonlDocuments(text: string): number {
  let count = 0
  for (const line of text.split('\n')) {
    if (line.trim() !== '') count += 1
  }
  return count
}

/**
 * Checks the first record against the fields the schema indexes.
 *
 * Without this, an upstream rename would surface as ten thousand identical
 * import failures rather than one sentence naming the field that vanished.
 */
export function assertDatasetShape(text: string, requiredFields: string[]): void {
  const firstLine = text.split('\n').find((line) => line.trim() !== '')
  if (firstLine === undefined) {
    throw new Error('The downloaded dataset is empty.')
  }

  let record: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(firstLine)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    record = parsed as Record<string, unknown>
  } catch {
    throw new Error(
      `The downloaded dataset could not be read as JSONL. Its first line was: ${firstLine.slice(0, 80)}`,
    )
  }

  const missing = requiredFields.filter((field) => record[field] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `The dataset at ${BOOKS_DATASET_URL} no longer carries ${missing.join(', ')}, ` +
        'which data/books.schema.json indexes. The upstream file has changed shape.',
    )
  }
}

function humanKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Puts books.jsonl in the project's data/ directory, downloading it only if it is
 * not already there — so a re-run neither needs the network nor re-fetches.
 */
export async function ensureDataset(
  targetDir: string,
  { url = BOOKS_DATASET_URL, onProgress = () => {} }: DatasetOptions = {},
): Promise<DatasetResult> {
  const dataDirectory = path.join(targetDir, 'data')
  const destination = path.join(dataDirectory, DATASET_FILE)

  const cached = await readFile(destination, 'utf8').catch(() => '')
  if (cached.trim() !== '') {
    const documents = countJsonlDocuments(cached)
    onProgress(`Reusing the ${documents} documents already in data/${DATASET_FILE}`)
    return { path: destination, documents, downloaded: false, bytes: 0 }
  }

  onProgress(`Downloading ${DATASET_FILE}.gz from dl.typesense.org`)

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (error) {
    throw new Error(
      `Could not download the sample dataset from ${url}\n` +
        `  ${error instanceof Error ? error.message : String(error)}\n` +
        'Check the network and re-run, or download it manually into ' +
        `data/${DATASET_FILE}.`,
    )
  }

  if (!response.ok) {
    throw new Error(
      `Could not download the sample dataset: ${url} replied ${response.status}.\n` +
        'Check the network and re-run.',
    )
  }

  const compressed = Buffer.from(await response.arrayBuffer())
  onProgress(`Downloaded ${humanKb(compressed.byteLength)}, decompressing`)

  let jsonl: string
  try {
    jsonl = gunzipSync(compressed).toString('utf8')
  } catch (error) {
    throw new Error(
      `Could not decompress the dataset from ${url} — it does not look like gzip.\n` +
        `  ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  // Validate before writing, so a bad payload leaves nothing behind.
  assertDatasetShape(jsonl, REQUIRED_DATASET_FIELDS)

  await mkdir(dataDirectory, { recursive: true })
  await writeFile(destination, jsonl, 'utf8')

  const documents = countJsonlDocuments(jsonl)
  return { path: destination, documents, downloaded: true, bytes: compressed.byteLength }
}

/**
 * Fields the bundled schema indexes, and therefore the ones the remote file must
 * still provide. `id` is excluded: Typesense supplies one if absent.
 */
export const REQUIRED_DATASET_FIELDS = [
  'title',
  'authors',
  'publication_year',
  'average_rating',
  'image_url',
  'ratings_count',
]
