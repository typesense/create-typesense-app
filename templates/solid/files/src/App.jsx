import { For, createSignal, onCleanup, onMount } from 'solid-js'
import instantsearch from 'instantsearch.js'
import {
  connectHits,
  connectRefinementList,
  connectSearchBox,
  connectStats,
} from 'instantsearch.js/es/connectors'
import { collectionName, searchClient } from './typesense.js'
import './App.css'

function App() {
  const search = instantsearch({
    indexName: collectionName,
    searchClient,
    future: { preserveSharedStateOnUnmount: true },
  })

  /**
   * Bridges an InstantSearch connector to a Solid signal.
   *
   * Connectors are the headless half of InstantSearch: instead of rendering a
   * widget, they hand you state and the functions that change it. That maps
   * straight onto a signal, so the markup below is ordinary Solid rather than
   * vanilla widgets mounted into empty divs.
   */
  function connect(connector, params = {}) {
    const [state, setState] = createSignal()
    search.addWidgets([connector((options) => setState(options))(params)])
    return state
  }

  const searchBox = connect(connectSearchBox)
  const stats = connect(connectStats)
  const authors = connect(connectRefinementList, {
    attribute: 'authors',
    limit: 8,
    searchable: true,
  })
  const hits = connect(connectHits)

  // Widgets must be registered before the search starts.
  onMount(() => search.start())
  onCleanup(() => search.dispose())

  return (
    <main class="page">
      <header class="header">
        <h1 class="heading">Search {collectionName}</h1>
        <p class="subheading">Misspell it on purpose. Typesense corrects typos as you type.</p>
      </header>

      <input
        class="search-input"
        type="search"
        placeholder='Try "hary potr"'
        value={searchBox()?.query ?? ''}
        onInput={(event) => searchBox()?.refine(event.currentTarget.value)}
      />

      <div class="layout">
        <aside class="sidebar">
          <h2 class="facet-heading">Author</h2>
          <input
            class="facet-search"
            type="search"
            placeholder="Filter authors"
            onInput={(event) => authors()?.searchForItems(event.currentTarget.value)}
          />
          <ul class="facet-list">
            <For each={authors()?.items ?? []}>
              {(item) => (
                <li>
                  <label class="facet-label">
                    <input
                      type="checkbox"
                      checked={item.isRefined}
                      onChange={() => authors()?.refine(item.value)}
                    />
                    <span>{item.label}</span>
                    <span class="facet-count">{item.count}</span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </aside>

        <section>
          <p class="stats">
            {(stats()?.nbHits ?? 0).toLocaleString()} results found in{' '}
            {stats()?.processingTimeMS ?? 0}ms
          </p>

          <ul class="hit-list">
            <For each={hits()?.hits ?? []}>
              {(hit) => (
                <li class="hit">
                  <img class="cover" src={hit.image_url} alt="" loading="lazy" />
                  <div class="hit-body">
                    <h2 class="title">{hit.title}</h2>
                    <p class="meta">
                      {hit.authors.join(', ')} · {hit.publication_year}
                    </p>
                    <p class="rating">
                      ★ {hit.average_rating} · {hit.ratings_count.toLocaleString()} ratings
                    </p>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </main>
  )
}

export default App
