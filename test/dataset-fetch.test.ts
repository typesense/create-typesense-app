/**
 * The dataset is fetched at scaffold time rather than bundled, which means the
 * CLI depends on a file it does not control. These tests cover the download,
 * the caching that keeps a re-run offline-safe, and — most importantly — the
 * shape check that turns upstream drift into one clear error instead of ten
 * thousand import failures.
 *
 * A local server stands in for dl.typesense.org so the suite needs no network.
 */
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertDatasetShape,
  countJsonlDocuments,
  ensureDataset,
} from '../src/steps/dataset.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

/** One record with the same fields the real dataset carries. */
function record(id: number, title: string): string {
  return JSON.stringify({
    id: String(id),
    title,
    authors: ['A. Writer'],
    publication_year: 1997,
    average_rating: 4.4,
    image_url: 'https://example.com/cover.jpg',
    ratings_count: 1000 + id,
  })
}

const SAMPLE = [
  record(1, "Harry Potter and the Philosopher's Stone"),
  record(2, 'The Hobbit'),
  record(3, 'Dune'),
].join('\n')

const REQUIRED = [
  'title',
  'authors',
  'publication_year',
  'average_rating',
  'image_url',
  'ratings_count',
]

/** Serves a body, gzipped or not, so both the happy and broken paths are real. */
async function serve(
  body: Buffer | string,
  { status = 200 }: { status?: number } = {},
): Promise<string> {
  const payload = typeof body === 'string' ? Buffer.from(body) : body
  const server = createServer((_request, response) => {
    response.writeHead(status, {
      'content-type': 'application/x-gzip',
      'content-length': String(payload.byteLength),
    })
    response.end(payload)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}/books.jsonl.gz`
}

function scratch(): string {
  return path.join(tmpdir(), `cta-ds-${Math.random().toString(36).slice(2)}`, 'my-app')
}

describe('countJsonlDocuments', () => {
  it('counts one document per line', () => {
    expect(countJsonlDocuments(SAMPLE)).toBe(3)
  })

  it('ignores blank lines and a trailing newline', () => {
    expect(countJsonlDocuments(`${SAMPLE}\n\n`)).toBe(3)
  })

  it('counts nothing in empty text', () => {
    expect(countJsonlDocuments('')).toBe(0)
  })
})

describe('assertDatasetShape', () => {
  it('accepts a record carrying every required field', () => {
    expect(() => assertDatasetShape(SAMPLE, REQUIRED)).not.toThrow()
  })

  /** The point of the check: upstream drops or renames a field. */
  it('names the missing field when the upstream data changes', () => {
    const withoutRatings = JSON.stringify({ id: '1', title: 'X', authors: ['Y'] })
    expect(() => assertDatasetShape(withoutRatings, REQUIRED)).toThrow(/ratings_count/)
  })

  it('rejects HTML served in place of the dataset', () => {
    expect(() => assertDatasetShape('<!doctype html><html>404', REQUIRED)).toThrow(
      /could not be read|not valid/i,
    )
  })

  it('rejects an empty payload', () => {
    expect(() => assertDatasetShape('', REQUIRED)).toThrow(/empty/i)
  })
})

describe('ensureDataset', () => {
  it('downloads, decompresses and writes the JSONL into the project', async () => {
    const dir = scratch()
    const url = await serve(gzipSync(Buffer.from(SAMPLE)))

    const result = await ensureDataset(dir, { url })

    expect(result.downloaded).toBe(true)
    expect(result.documents).toBe(3)
    expect(result.path).toBe(path.join(dir, 'data', 'books.jsonl'))
    expect(readFileSync(result.path, 'utf8')).toContain('Harry Potter')
  })

  it('reports the compressed size actually transferred', async () => {
    const compressed = gzipSync(Buffer.from(SAMPLE))
    const result = await ensureDataset(scratch(), { url: await serve(compressed) })
    expect(result.bytes).toBe(compressed.byteLength)
  })

  /** So a re-run works offline and does not re-download 476 KB every time. */
  it('reuses an existing copy without touching the network', async () => {
    const dir = scratch()
    mkdirSync(path.join(dir, 'data'), { recursive: true })
    writeFileSync(path.join(dir, 'data', 'books.jsonl'), SAMPLE)

    // An unreachable URL proves no request is made.
    const result = await ensureDataset(dir, { url: 'http://127.0.0.1:1/nope.gz' })

    expect(result.downloaded).toBe(false)
    expect(result.bytes).toBe(0)
    expect(result.documents).toBe(3)
  })

  it('re-downloads when the cached copy is empty rather than trusting it', async () => {
    const dir = scratch()
    mkdirSync(path.join(dir, 'data'), { recursive: true })
    writeFileSync(path.join(dir, 'data', 'books.jsonl'), '')

    const result = await ensureDataset(dir, { url: await serve(gzipSync(Buffer.from(SAMPLE))) })
    expect(result.downloaded).toBe(true)
    expect(result.documents).toBe(3)
  })

  it('reports progress so a slow connection does not look like a hang', async () => {
    const messages: string[] = []
    await ensureDataset(scratch(), {
      url: await serve(gzipSync(Buffer.from(SAMPLE))),
      onProgress: (message) => messages.push(message),
    })
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.join(' ')).toMatch(/download/i)
  })

  it('gives an actionable error when the download fails', async () => {
    await expect(
      ensureDataset(scratch(), { url: 'http://127.0.0.1:1/unreachable.gz' }),
    ).rejects.toThrow(/could not download|--dataset empty|dl\.typesense\.org|manually/i)
  })

  it('gives an actionable error on a non-200 response', async () => {
    const url = await serve(gzipSync(Buffer.from(SAMPLE)), { status: 404 })
    await expect(ensureDataset(scratch(), { url })).rejects.toThrow(/404/)
  })

  it('reports a clear error when the payload is not gzip', async () => {
    const url = await serve('this is not gzipped at all')
    await expect(ensureDataset(scratch(), { url })).rejects.toThrow(/decompress|gzip/i)
  })

  it('refuses to write a dataset missing the fields the schema needs', async () => {
    const wrong = JSON.stringify({ id: '1', title: 'Only a title' })
    const dir = scratch()
    await expect(
      ensureDataset(dir, { url: await serve(gzipSync(Buffer.from(wrong))) }),
    ).rejects.toThrow(/ratings_count|authors/)
    // Nothing half-written left behind.
    expect(existsSync(path.join(dir, 'data', 'books.jsonl'))).toBe(false)
  })
})
