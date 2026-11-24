import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadBooksSchema } from '../src/steps/collection.js'
import {
  ensureSearchConfigFile,
  fieldsFromDocuments,
  inferSearchConfig,
  mergeFields,
  SEARCH_CONFIG_FILE,
  type SearchConfigFile,
} from '../src/steps/searchConfig.js'

/** How the CLI decides what the page searches, filters and shows. */

describe('the inferred search config', () => {
  it('gives the books demo the search it depends on', async () => {
    expect(inferSearchConfig(await loadBooksSchema())).toEqual({
      queryBy: ['title', 'authors'],
      facets: ['authors'],
      title: 'title',
      image: 'image_url',
      display: ['authors', 'publication_year', 'average_rating', 'ratings_count'],
    })
  })

  it('works for any collection: a name field is the title, and only text facets become filters', () => {
    expect(
      inferSearchConfig({
        name: 'movies',
        fields: [
          { name: 'year', type: 'int32', facet: true },
          { name: 'director', type: 'string', facet: true },
          { name: 'name', type: 'string' },
          { name: 'poster_thumbnail', type: 'string' },
          { name: 'plot', type: 'string', index: false },
        ],
      }),
    ).toEqual({
      queryBy: ['director', 'name'],
      facets: ['director'],
      title: 'name',
      image: 'poster_thumbnail',
      display: ['year', 'director', 'plot'],
    })
  })

  it('refuses a collection with no text field to search', () => {
    expect(() =>
      inferSearchConfig({ name: 'numbers', fields: [{ name: 'n', type: 'int32' }] }),
    ).toThrow(/no text field/)
  })

  it('reads fields off sample documents: searchable under a `.*` field, shown but not searched without one', () => {
    const sampled = fieldsFromDocuments([
      { id: '1', title: 'Alien', tags: ['sci-fi'], meta: { a: 1 } },
      { id: '2', title: 'Heat', year: 1995 },
    ])
    expect(sampled).toEqual([
      { name: 'title', type: 'string' },
      { name: 'tags', type: 'string[]' },
      { name: 'year', type: 'int64' },
    ])

    const auto = mergeFields([{ name: '.*', type: 'auto' }], sampled)
    expect(inferSearchConfig({ name: 'auto', fields: auto }).queryBy).toEqual(['title', 'tags'])

    const stored = mergeFields([{ name: 'title', type: 'string' }], sampled)
    const config = inferSearchConfig({ name: 'stored', fields: stored })
    expect(config.queryBy).toEqual(['title'])
    expect(config.display).toEqual(['tags', 'year'])
  })
})

describe('typesense.config.json', () => {
  it("is written once, so the developer's edits survive a second run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cta-config-'))
    const books = await loadBooksSchema()
    const initial: SearchConfigFile = {
      collections: [{ name: 'books', schema: books, search: inferSearchConfig(books) }],
    }

    expect(await ensureSearchConfigFile(dir, initial)).toEqual(initial)

    const file = path.join(dir, SEARCH_CONFIG_FILE)
    const edited = JSON.parse(await readFile(file, 'utf8')) as SearchConfigFile
    edited.collections[0]!.search.facets = []
    await writeFile(file, JSON.stringify(edited))

    expect(await ensureSearchConfigFile(dir, initial)).toEqual(edited)
  })
})
