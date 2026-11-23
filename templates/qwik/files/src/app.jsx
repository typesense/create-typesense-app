import { component$, useSignal, useVisibleTask$ } from '@builder.io/qwik'
import instantsearch from 'instantsearch.js'
import {
  configure,
  hits,
  index,
  refinementList,
  searchBox,
  stats,
} from 'instantsearch.js/es/widgets'
import { collections, searchClient } from './typesense.js'
import './app.css'

/**
 * Every field name below comes from typesense.config.json, so this page works for
 * any collection. Change what it shows there, not here.
 *
 * There is no router: `?collection=<name>&q=<query>` is "Show all in <name>".
 * One collection in the file gets that full page as the home page.
 */
const params = new URLSearchParams(window.location.search)
const only =
  collections.length === 1
    ? collections[0]
    : collections.find((entry) => entry.name === params.get('collection'))
const initialQuery = params.get('q') ?? ''
document.title = only === undefined ? 'Search | Typesense' : `Search ${only.name} | Typesense`

function label(field) {
  const words = field.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function format(value) {
  if (Array.isArray(value)) return value.join(', ')
  // Not toLocaleString: it would print a year as "2,008".
  return value === null || value === undefined ? '' : String(value)
}

function hitsWidget(container, { name, search }) {
  return hits({
    container,
    cssClasses: { list: 'hit-list', item: 'hit', emptyRoot: 'empty' },
    templates: {
      empty: `No results in ${name}.`,
      item: (hit, { html, components }) => {
        const image = search.image === null ? '' : format(hit[search.image])
        const details = search.display
          .map((field) => [field, format(hit[field])])
          .filter(([, value]) => value !== '')
        return html`
          ${
            image !== '' &&
            // Real data has dead image URLs; a broken-image icon helps nobody.
            html`<img
              class="cover"
              src=${image}
              alt=""
              loading="lazy"
              onError=${(event) => (event.currentTarget.style.display = 'none')}
            />`
          }
          <div class="hit-body">
            <h2 class="title">${components.Highlight({ hit, attribute: search.title })}</h2>
            <dl class="fields">
              ${details.map(
                ([field, value]) =>
                  html`<div class="field"><dt>${label(field)}</dt><dd>${value}</dd></div>`,
              )}
            </dl>
          </div>
        `
      },
    },
  })
}

export const App = component$(() => {
  const rootEl = useSignal()

  /**
   * InstantSearch runs entirely on the client, inside a visible task.
   *
   * This is the one place Qwik differs from the other templates. Qwik serialises
   * component state so it can resume without replaying the app, and InstantSearch's
   * state cannot survive that: it holds refine() callbacks and SearchResults
   * instances. Putting it in a signal would break serialisation.
   *
   * So the library keeps its own state in this closure and owns the DOM inside the
   * containers below, found by their data- attributes. Nothing crosses Qwik's
   * boundary, which is also why this file needs no $ event handlers.
   */
  useVisibleTask$(({ cleanup }) => {
    const root = rootEl.value
    const find = (selector) => root.querySelector(selector)
    // The root index carries the query; on the federated page every section is an index().
    const rootIndex = only?.name ?? collections[0].name

    const search = instantsearch({
      indexName: rootIndex,
      searchClient,
      initialUiState: initialQuery === '' ? undefined : { [rootIndex]: { query: initialQuery } },
      future: { preserveSharedStateOnUnmount: true },
    })

    search.addWidgets([
      searchBox({
        container: find('[data-searchbox]'),
        placeholder: only === undefined ? 'Search' : `Search ${only.name}`,
        autofocus: true,
        // The demo needs neither: results update as you type.
        showSubmit: false,
        showReset: false,
        cssClasses: { root: 'search-root', input: 'search-input' },
      }),
    ])

    if (only !== undefined) {
      search.addWidgets([
        stats({ container: find('[data-stats]'), cssClasses: { root: 'stats' } }),
        ...only.search.facets.map((field) =>
          refinementList({
            container: find(`[data-facet="${CSS.escape(field)}"]`),
            attribute: field,
            limit: 8,
            searchable: true,
            searchablePlaceholder: `Filter ${label(field).toLowerCase()}`,
            cssClasses: {
              list: 'facet-list',
              label: 'facet-label',
              checkbox: 'facet-checkbox',
              count: 'facet-count',
              searchBox: 'facet-search',
            },
          }),
        ),
        hitsWidget(find('[data-hits]'), only),
      ])
    } else {
      search.addWidgets(
        collections.map((collection) =>
          index({ indexName: collection.name, indexId: `section-${collection.name}` }).addWidgets([
            configure({ hitsPerPage: 5 }),
            hitsWidget(find(`[data-section="${CSS.escape(collection.name)}"]`), collection),
          ]),
        ),
      )
    }

    // InstantSearch turns a failed request into zero hits; say what went wrong instead.
    const alert = find('[role=alert]')
    search.on('error', ({ error }) => {
      alert.textContent = `Search failed: ${error.message} Check the field names in typesense.config.json.`
      alert.hidden = false
    })
    search.on('render', () => {
      if (search.status !== 'error') {
        alert.hidden = true
        alert.textContent = ''
      }
      // "Show all" keeps whatever is in the search box.
      const query = search.getUiState()[rootIndex]?.query ?? ''
      for (const link of root.querySelectorAll('[data-show-all]')) {
        const target = new URLSearchParams({ collection: link.dataset.showAll })
        if (query !== '') target.set('q', query)
        link.href = `?${target}`
      }
    })

    search.start()
    cleanup(() => search.dispose())
  })

  const facets = only !== undefined && only.search.facets.length > 0

  return (
    <div class="page" ref={rootEl}>
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
          <h1 class="heading">{only === undefined ? 'Search' : `Search ${only.name}`}</h1>
          <p class="subheading">Misspell it on purpose. Typesense corrects typos as you type.</p>
        </div>

        <div data-searchbox />
        <p role="alert" class="error" hidden />

        {only === undefined ? (
          collections.map(({ name }) => (
            <section key={name} class="section">
              <div class="section-header">
                <h2 class="section-title">{name}</h2>
                <a
                  class="link"
                  data-show-all={name}
                  href={`?collection=${encodeURIComponent(name)}`}
                >
                  Show all in {name}
                </a>
              </div>
              <div data-section={name} />
            </section>
          ))
        ) : (
          <>
            {collections.length > 1 && (
              <a class="link back" href="/">
                ← All collections
              </a>
            )}
            <div class={facets ? 'layout' : undefined}>
              {facets && (
                <aside class="sidebar">
                  {only.search.facets.map((field) => (
                    <section key={field}>
                      <h2 class="facet-heading">{label(field)}</h2>
                      <div data-facet={field} />
                    </section>
                  ))}
                </aside>
              )}
              <section>
                <div data-stats />
                <div data-hits />
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
})
