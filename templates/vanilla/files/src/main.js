import './style.css'
import instantsearch from 'instantsearch.js'
import { hits, refinementList, searchBox, stats } from 'instantsearch.js/es/widgets'
import { collectionName, searchClient } from './typesense.js'

document.querySelector('#app').innerHTML = `
  <main class="page">
    <header class="header">
      <h1 class="heading">Search ${collectionName}</h1>
      <p class="subheading">Misspell it on purpose. Typesense corrects typos as you type.</p>
    </header>

    <div id="searchbox"></div>

    <div class="layout">
      <aside class="sidebar">
        <h2 class="facet-heading">Author</h2>
        <div id="authors"></div>
      </aside>
      <section>
        <div id="stats"></div>
        <div id="hits"></div>
      </section>
    </div>
  </main>
`

const search = instantsearch({
  indexName: collectionName,
  searchClient,
  future: { preserveSharedStateOnUnmount: true },
})

search.addWidgets([
  searchBox({
    container: '#searchbox',
    placeholder: 'Try "hary potr"',
    // The demo needs neither: results update as you type.
    showSubmit: false,
    showReset: false,
    cssClasses: { input: 'search-input' },
  }),

  stats({
    container: '#stats',
    cssClasses: { root: 'stats' },
  }),

  // One facet, on a field scripts/schema.js marks as facetable.
  refinementList({
    container: '#authors',
    attribute: 'authors',
    limit: 8,
    searchable: true,
    searchablePlaceholder: 'Filter authors',
    cssClasses: {
      list: 'facet-list',
      label: 'facet-label',
      count: 'facet-count',
      searchBox: 'facet-search',
    },
  }),

  hits({
    container: '#hits',
    cssClasses: { list: 'hit-list', item: 'hit' },
    templates: {
      item: (hit, { html }) => html`
        <img class="cover" src="${hit.image_url}" alt="" loading="lazy" />
        <div class="hit-body">
          <h2 class="title">${hit.title}</h2>
          <p class="meta">${hit.authors.join(', ')} · ${hit.publication_year}</p>
          <p class="rating">
            ★ ${hit.average_rating} · ${hit.ratings_count.toLocaleString()} ratings
          </p>
        </div>
      `,
    },
  }),
])

search.start()
