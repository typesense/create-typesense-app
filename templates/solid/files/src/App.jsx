import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import instantsearch from 'instantsearch.js'
import {
  connectHits,
  connectRefinementList,
  connectSearchBox,
  connectStats,
} from 'instantsearch.js/es/connectors'
import { highlight } from 'instantsearch.js/es/helpers'
import { configure, index } from 'instantsearch.js/es/widgets'
import { collections, searchClient } from './typesense.js'
import './App.css'

/**
 * Every field name below comes from typesense.config.json, so these pages work
 * for any collection. Change what they show there, not here.
 */
function label(field) {
  const words = field.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function format(value) {
  if (Array.isArray(value)) return value.join(', ')
  // Not toLocaleString: it would print a year as "2,008".
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Starts one InstantSearch instance for the life of the page.
 *
 * Connectors are the headless half of InstantSearch: instead of rendering a
 * widget, they hand you state and the functions that change it. `connect` maps
 * that straight onto a Solid signal, so the markup below is ordinary Solid
 * rather than vanilla widgets mounted into empty divs.
 */
function createSearch(indexName, initialQuery) {
  const search = instantsearch({
    indexName,
    searchClient,
    initialUiState: initialQuery ? { [indexName]: { query: initialQuery } } : undefined,
    future: { preserveSharedStateOnUnmount: true },
  })

  // InstantSearch turns a failed request into zero hits; keep its error to show it.
  const [error, setError] = createSignal()
  search.on('error', () => setError(search.error))
  search.on('render', () => setError(search.error))

  // Widgets must be registered before the search starts, so start on mount.
  onMount(() => search.start())
  onCleanup(() => search.dispose())

  return { search, error }
}

/** `parent` is the InstantSearch instance or an `index` widget inside it. */
function connect(parent, connector, params = {}) {
  const [state, setState] = createSignal()
  parent.addWidgets([connector((options) => setState(options))(params)])
  return state
}

function Hit(props) {
  const image = () => (props.search.image === null ? '' : format(props.hit[props.search.image]))
  const details = () =>
    props.search.display
      .map((field) => [field, format(props.hit[field])])
      .filter(([, value]) => value !== '')

  return (
    <li class="hit">
      <Show when={image() !== ''}>
        <img
          class="cover"
          src={image()}
          alt=""
          loading="lazy"
          // Real data has dead image URLs; a broken-image icon helps nobody.
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </Show>
      <div class="hit-body">
        {/* The hit values are HTML-escaped by InstantSearch; only <mark> is added. */}
        <h2 class="title">
          <span innerHTML={highlight({ attribute: props.search.title, hit: props.hit })} />
        </h2>
        <dl class="fields">
          <For each={details()}>
            {([field, value]) => (
              <div class="field">
                <dt>{label(field)}</dt>
                <dd>{value}</dd>
              </div>
            )}
          </For>
        </dl>
      </div>
    </li>
  )
}

function Shell(props) {
  // One index.html serves every page, so each page sets its own window title.
  document.title = `${props.heading} | Typesense`
  return (
    <div class="page">
      <header class="topbar">
        <a href="https://typesense.org" aria-label="Typesense">
          <img class="logo" src="/typesense-logo.svg" alt="Typesense" />
        </a>
        <nav class="nav">
          <a href="https://typesense.org/docs/">docs</a>
          <a href="https://github.com/typesense/typesense">github</a>
          <a href="https://cloud.typesense.org">cloud</a>
        </nav>
      </header>
      <main class="content">
        <div class="header">
          <h1 class="heading">{props.heading}</h1>
          <p class="subheading">Misspell it on purpose. Typesense corrects typos as you type.</p>
        </div>

        <input
          class="search-input"
          type="search"
          placeholder={props.heading}
          autofocus
          value={props.searchBox()?.query ?? ''}
          onInput={(event) => props.searchBox()?.refine(event.currentTarget.value)}
        />

        <Show when={props.error()}>
          {(error) => (
            <p role="alert" class="error">
              Search failed: {error().message} Check the field names in typesense.config.json.
            </p>
          )}
        </Show>

        {props.children}
      </main>
    </div>
  )
}

/** One collection with its own facets: the home page when only one is selected. */
function CollectionPage(props) {
  const { name, search: config } = props.collection
  const { search, error } = createSearch(name, props.initialQuery)
  const searchBox = connect(search, connectSearchBox)
  const stats = connect(search, connectStats)
  const facets = config.facets.map((field) => ({
    field,
    state: connect(search, connectRefinementList, { attribute: field, limit: 8, searchable: true }),
  }))
  const hits = connect(search, connectHits)

  return (
    <Shell heading={`Search ${name}`} searchBox={searchBox} error={error}>
      <Show when={props.showBack}>
        <a class="link back" href={location.pathname}>
          ← All collections
        </a>
      </Show>
      <div class={facets.length > 0 ? 'layout' : undefined}>
        <Show when={facets.length > 0}>
          <aside class="sidebar">
            <For each={facets}>
              {({ field, state }) => (
                <section>
                  <h2 class="facet-heading">{label(field)}</h2>
                  <input
                    class="facet-search"
                    type="search"
                    placeholder={`Filter ${label(field).toLowerCase()}`}
                    onInput={(event) => state()?.searchForItems(event.currentTarget.value)}
                  />
                  <ul class="facet-list">
                    <For each={state()?.items ?? []}>
                      {(item) => (
                        <li>
                          <label class="facet-label">
                            <input
                              class="facet-checkbox"
                              type="checkbox"
                              checked={item.isRefined}
                              onChange={() => state()?.refine(item.value)}
                            />
                            <span>{item.label}</span>
                            <span class="facet-count">{item.count}</span>
                          </label>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </aside>
        </Show>

        <section>
          <p class="stats">
            {(stats()?.nbHits ?? 0).toLocaleString()} results found in{' '}
            {stats()?.processingTimeMS ?? 0}ms
          </p>
          <ul class="hit-list">
            <For each={hits()?.hits ?? []}>{(hit) => <Hit hit={hit} search={config} />}</For>
          </ul>
        </section>
      </div>
    </Shell>
  )
}

/** One query, every selected collection: each in its own `index` with its top 5 hits. */
function FederatedPage() {
  // The root index carries the query; every section, its own included, is an `index`.
  const { search, error } = createSearch(collections[0].name)
  const searchBox = connect(search, connectSearchBox)
  const sections = collections.map((collection) => {
    const section = index({ indexName: collection.name, indexId: `section-${collection.name}` })
    section.addWidgets([configure({ hitsPerPage: 5 })])
    search.addWidgets([section])
    return { collection, hits: connect(section, connectHits) }
  })

  const href = (name) => {
    const query = searchBox()?.query ?? ''
    return `?collection=${encodeURIComponent(name)}${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`
  }

  return (
    <Shell heading="Search" searchBox={searchBox} error={error}>
      <For each={sections}>
        {({ collection, hits }) => (
          <section class="section">
            <div class="section-header">
              <h2 class="section-title">{collection.name}</h2>
              <a class="link" href={href(collection.name)}>
                Show all in {collection.name}
              </a>
            </div>
            <Show when={hits()?.results}>
              {(results) => (
                <Show
                  when={results().nbHits > 0}
                  fallback={<p class="empty">No results in {collection.name}.</p>}
                >
                  <ul class="hit-list">
                    <For each={hits().hits}>
                      {(hit) => <Hit hit={hit} search={collection.search} />}
                    </For>
                  </ul>
                </Show>
              )}
            </Show>
          </section>
        )}
      </For>
    </Shell>
  )
}

/**
 * One collection: its full page. Several: the federated page, and "Show all in"
 * links back to this same page with `?collection=<name>&q=<query>`, since the
 * project has no router.
 */
function App() {
  const params = new URLSearchParams(location.search)
  const chosen =
    collections.length === 1
      ? collections[0]
      : collections.find((collection) => collection.name === params.get('collection'))

  return chosen === undefined ? (
    <FederatedPage />
  ) : (
    <CollectionPage
      collection={chosen}
      initialQuery={params.get('q') ?? ''}
      showBack={collections.length > 1}
    />
  )
}

export default App
