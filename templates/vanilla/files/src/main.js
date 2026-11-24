import './style.css'
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

/**
 * Every field name below comes from typesense.config.json, so this page works for
 * any collection. Change what it shows there, not here.
 *
 * One collection: its full page. Several: one section each, and
 * `?collection=<name>&q=<query>` for "Show all in <name>" (there is no router).
 */
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function label(field) {
  const words = field.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function format(value) {
  if (Array.isArray(value)) return value.join(', ')
  // Not toLocaleString: it would print a year as "2,008".
  return value === null || value === undefined ? '' : String(value)
}

function hitTemplate(search) {
  return (hit, { html, components }) => {
    const image = search.image === null ? '' : format(hit[search.image])
    const details = search.display
      .map((field) => [field, format(hit[field])])
      .filter(([, value]) => value !== '')
    return html`
      ${
        image !== '' &&
        html`<img
          class="cover"
          src="${image}"
          alt=""
          loading="lazy"
          onError=${(event) => {
            // Real data has dead image URLs; a broken-image icon helps nobody.
            event.currentTarget.style.display = 'none'
          }}
        />`
      }
      <div class="hit-body">
        <h2 class="title">${components.Highlight({ attribute: search.title, hit })}</h2>
        <dl class="fields">
          ${details.map(
            ([field, value]) =>
              html`<div class="field"><dt>${label(field)}</dt><dd>${value}</dd></div>`,
          )}
        </dl>
      </div>
    `
  }
}

const hitClasses = { list: 'hit-list', item: 'hit' }

const params = new URLSearchParams(window.location.search)
const [first] = collections
const selected =
  collections.length === 1
    ? first
    : collections.find((collection) => collection.name === params.get('collection'))
// The root index carries the query; on the federated page every section is an index().
const rootIndex = selected?.name ?? first.name
const heading = selected === undefined ? 'Search' : `Search ${selected.name}`
const initialQuery = params.get('q') ?? ''

document.title = `${heading} | Typesense`

const topbar = element('header', 'topbar')
const home = element('a')
home.href = 'https://typesense.org'
home.setAttribute('aria-label', 'Typesense')
const logo = element('img', 'logo')
logo.src = '/typesense-logo.svg'
logo.alt = 'Typesense'
home.append(logo)
const nav = element('nav', 'nav')
for (const [text, href] of [
  ['docs', 'https://typesense.org/docs/'],
  ['github', 'https://github.com/typesense/typesense'],
  ['cloud', 'https://cloud.typesense.org'],
]) {
  const link = element('a', undefined, text)
  link.href = href
  nav.append(link)
}
topbar.append(home, nav)

const page = element('main', 'content')
const header = element('div', 'header')
header.append(
  element('h1', 'heading', heading),
  element('p', 'subheading', 'Misspell it on purpose. Typesense corrects typos as you type.'),
)
const searchboxContainer = element('div')
const alert = element('p', 'error')
alert.setAttribute('role', 'alert')
alert.hidden = true
page.append(header, searchboxContainer, alert)
const shell = element('div', 'page')
shell.append(topbar, page)
document.querySelector('#app').replaceChildren(shell)

const search = instantsearch({
  indexName: rootIndex,
  searchClient,
  initialUiState: initialQuery === '' ? undefined : { [rootIndex]: { query: initialQuery } },
  future: { preserveSharedStateOnUnmount: true },
})

search.addWidgets([
  searchBox({
    container: searchboxContainer,
    placeholder: heading,
    autofocus: true,
    // The demo needs neither: results update as you type.
    showSubmit: false,
    showReset: false,
    cssClasses: { root: 'search-root', input: 'search-input' },
  }),
])

if (selected !== undefined) {
  const { search: config } = selected
  if (collections.length > 1) {
    const back = element('a', 'link back', '← All collections')
    back.href = window.location.pathname
    page.append(back)
  }

  const facets = config.facets.length > 0
  const layout = element('div', facets ? 'layout' : undefined)
  if (facets) {
    const sidebar = element('aside', 'sidebar')
    for (const field of config.facets) {
      const section = element('section')
      const container = element('div')
      section.append(element('h2', 'facet-heading', label(field)), container)
      sidebar.append(section)
      search.addWidgets([
        refinementList({
          container,
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
      ])
    }
    layout.append(sidebar)
  }

  const results = element('section')
  const statsContainer = element('div')
  const hitsContainer = element('div')
  results.append(statsContainer, hitsContainer)
  layout.append(results)
  page.append(layout)

  search.addWidgets([
    stats({ container: statsContainer, cssClasses: { root: 'stats' } }),
    hits({
      container: hitsContainer,
      cssClasses: hitClasses,
      templates: { item: hitTemplate(config) },
    }),
  ])
} else {
  const links = []
  for (const { name, search: config } of collections) {
    const section = element('section', 'section')
    const sectionHeader = element('div', 'section-header')
    const link = element('a', 'link', `Show all in ${name}`)
    const hitsContainer = element('div')
    sectionHeader.append(element('h2', 'section-title', name), link)
    section.append(sectionHeader, hitsContainer)
    page.append(section)
    links.push([link, name])

    search.addWidgets([
      index({ indexName: name, indexId: `section-${name}` }).addWidgets([
        configure({ hitsPerPage: 5 }),
        hits({
          container: hitsContainer,
          cssClasses: hitClasses,
          templates: {
            item: hitTemplate(config),
            empty: (_, { html }) => html`<p class="empty">No results in ${name}.</p>`,
          },
        }),
      ]),
    ])
  }

  // Each link keeps whatever is in the search box when it is clicked.
  search.on('render', () => {
    const query = search.getUiState()[rootIndex]?.query ?? ''
    for (const [link, name] of links) {
      const target = new URLSearchParams({ collection: name })
      if (query !== '') target.set('q', query)
      link.href = `?${target}`
    }
  })
}

/** InstantSearch turns a failed request into zero hits; say what went wrong instead. */
function showError(error) {
  alert.hidden = error === undefined
  alert.textContent =
    error === undefined
      ? ''
      : `Search failed: ${error.message} Check the field names in typesense.config.json.`
}
// Listening also stops InstantSearch re-throwing the error as uncaught.
search.on('error', showError)
search.on('render', () => {
  if (search.status !== 'error') showError(undefined)
})

search.start()
