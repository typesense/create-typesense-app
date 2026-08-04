/**
 * The dataset and schema are the two shipped assets the whole demo rests on. If
 * they drift apart, or the aha-moment book goes missing, everything downstream
 * fails in a confusing way — so they are checked here rather than at runtime.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLLECTION_NAME, DATASET_DOCUMENT_COUNT } from '../src/constants.js'
import { dataDir } from '../src/paths.js'

interface Book {
  id: string
  title: string
  authors: string[]
  genres: string[]
  publication_year: number
}

interface SchemaField {
  name: string
  type: string
  facet?: boolean
  optional?: boolean
  sort?: boolean
}

const rawJsonl = readFileSync(path.join(dataDir, 'books.jsonl'), 'utf8')
const schema = JSON.parse(readFileSync(path.join(dataDir, 'books.schema.json'), 'utf8')) as {
  name: string
  fields: SchemaField[]
  default_sorting_field?: string
}

const lines = rawJsonl.split('\n').filter((line) => line.trim() !== '')
const books = lines.map((line) => JSON.parse(line) as Book)

describe('books.schema.json', () => {
  it('names the collection the CLI expects', () => {
    expect(schema.name).toBe(COLLECTION_NAME)
  })

  it('makes title searchable', () => {
    expect(schema.fields.find((field) => field.name === 'title')?.type).toBe('string')
  })

  it('gives the UI something to facet on', () => {
    expect(schema.fields.filter((field) => field.facet === true).length).toBeGreaterThan(0)
  })

  it('only uses an existing field for default sorting', () => {
    if (schema.default_sorting_field === undefined) return
    const names = schema.fields.map((field) => field.name)
    expect(names).toContain(schema.default_sorting_field)
  })

  it('declares a sortable numeric type for the default sorting field', () => {
    if (schema.default_sorting_field === undefined) return
    const field = schema.fields.find((f) => f.name === schema.default_sorting_field)
    expect(['int32', 'int64', 'float']).toContain(field?.type)
  })
})

describe('books.jsonl', () => {
  it('is valid JSONL — every line parses on its own', () => {
    // Parsing happened at import; assert we actually got documents out of it.
    expect(books.length).toBeGreaterThan(100)
  })

  /** Keeps the count shown in the prompt and the summary honest. */
  it('holds exactly the number of documents the CLI advertises', () => {
    expect(books.length).toBe(DATASET_DOCUMENT_COUNT)
  })

  it('has no trailing-comma or pretty-printed lines', () => {
    for (const line of lines) {
      expect(line.startsWith('{')).toBe(true)
      expect(line.endsWith('}')).toBe(true)
    }
  })

  it('uses unique ids', () => {
    expect(new Set(books.map((book) => book.id)).size).toBe(books.length)
  })

  it('populates every field the schema declares as required', () => {
    const required = schema.fields.filter((field) => field.optional !== true)
    for (const book of books) {
      for (const field of required) {
        expect(book[field.name as keyof Book], `${book.title} is missing ${field.name}`).toBeDefined()
      }
    }
  })

  it('matches the declared types', () => {
    for (const book of books) {
      expect(typeof book.id).toBe('string')
      expect(typeof book.title).toBe('string')
      expect(Array.isArray(book.authors)).toBe(true)
      expect(Array.isArray(book.genres)).toBe(true)
      expect(Number.isInteger(book.publication_year)).toBe(true)
    }
  })

  it('carries no field the schema does not declare', () => {
    const declared = new Set([...schema.fields.map((field) => field.name), 'id'])
    for (const book of books) {
      for (const key of Object.keys(book)) {
        expect(declared, `${book.title} has undeclared field "${key}"`).toContain(key)
      }
    }
  })

  it('has plausible publication years', () => {
    for (const book of books) {
      expect(book.publication_year).toBeGreaterThan(1400)
      expect(book.publication_year).toBeLessThanOrEqual(2026)
    }
  })

  it('never has an empty author or genre list', () => {
    for (const book of books) {
      expect(book.authors.length, `${book.title} has no author`).toBeGreaterThan(0)
      expect(book.genres.length, `${book.title} has no genre`).toBeGreaterThan(0)
    }
  })

  /** The aha moment is typo tolerance on this exact title. */
  it('contains Harry Potter, which the whole demo depends on', () => {
    const harryPotter = books.filter((book) => book.title.includes('Harry Potter'))
    expect(harryPotter.length).toBeGreaterThan(0)
    expect(harryPotter[0]?.authors).toContain('J.K. Rowling')
  })

  it('has enough genre variety for a facet to be interesting', () => {
    const genres = new Set(books.flatMap((book) => book.genres))
    expect(genres.size).toBeGreaterThan(10)
  })

  it('spans enough decades to be recognisably a real library', () => {
    const decades = new Set(books.map((book) => Math.floor(book.publication_year / 10)))
    expect(decades.size).toBeGreaterThan(10)
  })

  it('has no duplicate titles by the same author', () => {
    const seen = new Set<string>()
    for (const book of books) {
      const key = `${book.title}::${book.authors.join(',')}`
      expect(seen, `duplicate: ${key}`).not.toContain(key)
      seen.add(key)
    }
  })
})
