import { collections } from './typesense'
import { CollectionPage, FederatedPage } from './search'

/**
 * One selected collection gets its full page here; several get one section each.
 * "Show all in <collection>" links back to this page with ?collection=<name>&q=<query>,
 * so the app needs no router.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search)
  const name = params.get('collection')
  const query = params.get('q') ?? undefined
  const [only] = collections
  // The "Show all" page and a single-collection home page name their collection.
  const titled = name ?? (collections.length === 1 ? only?.name : undefined)
  document.title = titled === undefined ? 'Search | Typesense' : `Search ${titled} | Typesense`

  if (name !== null) {
    const collection = collections.find((entry) => entry.name === name)
    if (collection === undefined) {
      return (
        <main>
          <p>
            No collection named {name} in typesense.config.json. <a href="/">All collections</a>
          </p>
        </main>
      )
    }
    return (
      <CollectionPage
        collection={collection}
        initialQuery={query}
        showBack={collections.length > 1}
      />
    )
  }
  return collections.length === 1 && only !== undefined ? (
    <CollectionPage collection={only} initialQuery={query} />
  ) : (
    <FederatedPage />
  )
}
