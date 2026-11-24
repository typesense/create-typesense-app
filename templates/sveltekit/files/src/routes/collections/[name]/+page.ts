import { error } from '@sveltejs/kit'
import { collections } from '../../../lib/typesense'
import type { PageLoad } from './$types'

/** "Show all in <collection>": one collection with its facets, keeping the query. */
export const load: PageLoad = ({ params, url }) => {
  const collection = collections.find((entry) => entry.name === params.name)
  if (collection === undefined) {
    error(404, `No collection named "${params.name}" in typesense.config.json.`)
  }
  return { collection, query: url.searchParams.get('q') ?? '' }
}
