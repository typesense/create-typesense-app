/**
 * The scoping of the browser-visible key is the differentiator this whole project
 * exists for, so the spec it sends to Typesense is asserted directly.
 */
import { describe, expect, it } from 'vitest'
import { COLLECTION_NAME } from '../src/constants.js'
import { SEARCH_KEY_DESCRIPTION, searchOnlyKeySpec } from '../src/steps/keys.js'

describe('searchOnlyKeySpec', () => {
  const spec = searchOnlyKeySpec(COLLECTION_NAME)

  it('grants document search and nothing else', () => {
    expect(spec.actions).toEqual(['documents:search'])
  })

  it('is scoped to the one collection, not to *', () => {
    expect(spec.collections).toEqual([COLLECTION_NAME])
    expect(spec.collections).not.toContain('*')
  })

  it('grants no write, no key management, no collection administration', () => {
    const forbidden = [
      'documents:create',
      'documents:upsert',
      'documents:update',
      'documents:delete',
      'documents:import',
      'documents:*',
      'collections:create',
      'collections:delete',
      'collections:*',
      'keys:create',
      'keys:*',
      '*',
    ]
    for (const action of forbidden) {
      expect(spec.actions).not.toContain(action)
    }
  })

  it('is tagged so re-runs can find and replace it', () => {
    expect(spec.description).toBe(SEARCH_KEY_DESCRIPTION)
  })

  it('scopes to whatever collection it is given', () => {
    expect(searchOnlyKeySpec('movies').collections).toEqual(['movies'])
  })
})
