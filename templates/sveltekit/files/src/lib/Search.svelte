<script lang="ts">
  import { onMount } from 'svelte'
  import instantsearch from 'instantsearch.js'
  import type { Hit, TemplateWithBindEvent } from 'instantsearch.js'
  import {
    configure,
    hits,
    index,
    refinementList,
    searchBox,
    stats,
  } from 'instantsearch.js/es/widgets'
  import { collections, searchClient, type Collection, type SearchConfig } from './typesense'
  import './search.css'

  /**
   * Every field name below comes from typesense.config.json, so this page works
   * for any collection. Change what it shows there, not here.
   *
   * With `collection`, one collection with its own facets. Without it, one query
   * to every collection, each in its own section.
   */
  let {
    collection,
    initialQuery = '',
    showBack = false,
  }: { collection?: Collection; initialQuery?: string; showBack?: boolean } = $props()

  let query = $state('')
  let error = $state('')

  function label(field: string): string {
    const words = field.replace(/[_-]+/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }

  function format(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ')
    // Not toLocaleString: it would print a year as "2,008".
    return value === null || value === undefined ? '' : String(value)
  }

  function showAll(name: string): string {
    return `/collections/${encodeURIComponent(name)}${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`
  }

  function hitItem(search: SearchConfig): TemplateWithBindEvent<Hit> {
    return (hit, { html, components }) => {
      const image = search.image === null ? '' : format(hit[search.image])
      const details = search.display
        .map((field) => [field, format(hit[field])] as const)
        .filter(([, value]) => value !== '')
      return html`<article class="hit">
        ${image !== '' &&
        html`<img
          class="cover"
          src=${image}
          alt=""
          loading="lazy"
          onError=${(event: Event) => ((event.currentTarget as HTMLElement).style.display = 'none')}
        />`}
        <div class="hitBody">
          <h2 class="title">${components.Highlight({ attribute: search.title, hit })}</h2>
          <dl class="fields">
            ${details.map(
              ([field, value]) =>
                html`<div key=${field} class="field"><dt>${label(field)}</dt><dd>${value}</dd></div>`,
            )}
          </dl>
        </div>
      </article>`
    }
  }

  // InstantSearch owns the DOM inside the empty containers below, and runs only in the browser.
  onMount(() => {
    // The root index carries the query; on the federated page every section is an index under it.
    const root = collection?.name ?? collections[0]?.name ?? ''
    const instance = instantsearch({
      searchClient,
      indexName: root,
      initialUiState: initialQuery === '' ? undefined : { [root]: { query: initialQuery } },
      future: { preserveSharedStateOnUnmount: true },
    })

    instance.addWidgets([
      searchBox({
        container: '#searchbox',
        placeholder: collection === undefined ? 'Search' : `Search ${collection.name}`,
        autofocus: true,
        cssClasses: {
          root: 'searchRoot',
          input: 'input',
          submit: 'hiddenButton',
          reset: 'hiddenButton',
          loadingIndicator: 'hiddenButton',
        },
      }),
    ])

    if (collection === undefined) {
      instance.addWidgets(
        collections.map(({ name, search }, i) =>
          index({ indexName: name, indexId: `section-${name}` }).addWidgets([
            configure({ hitsPerPage: 5 }),
            hits({
              container: `#section-${i}`,
              templates: {
                item: hitItem(search),
                empty: (_, { html }) => html`<p class="empty">No results in ${name}.</p>`,
              },
              cssClasses: { list: 'hitList' },
            }),
          ]),
        ),
      )
    } else {
      instance.addWidgets([
        ...collection.search.facets.map((attribute, i) =>
          refinementList({
            container: `#facet-${i}`,
            attribute,
            limit: 8,
            searchable: true,
            searchablePlaceholder: `Filter ${label(attribute).toLowerCase()}`,
            cssClasses: {
              list: 'facetList',
              label: 'facetLabel',
              checkbox: 'facetCheckbox',
              count: 'facetCount',
              searchableRoot: 'facetSearch',
            },
          }),
        ),
        stats({ container: '#stats', cssClasses: { root: 'stats' } }),
        hits({
          container: '#hits',
          templates: { item: hitItem(collection.search) },
          cssClasses: { list: 'hitList' },
        }),
      ])
    }

    // InstantSearch turns a failed request into zero hits; say what went wrong instead.
    instance.on('error', (failure: Error) => {
      error = failure.message
    })
    instance.on('render', () => {
      if (instance.status !== 'error') error = ''
      query = instance.getUiState()[root]?.query ?? ''
    })
    instance.start()
    return () => instance.dispose()
  })
</script>

<svelte:head>
  <title>{collection === undefined ? 'Search' : `Search ${collection.name}`} | Typesense</title>
</svelte:head>

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
      <h1 class="heading">{collection === undefined ? 'Search' : `Search ${collection.name}`}</h1>
      <p class="subheading">Misspell it on purpose. Typesense corrects typos as you type.</p>
    </div>

    <div id="searchbox"></div>
    {#if error !== ''}
      <p role="alert" class="error">
        Search failed: {error} Check the field names in typesense.config.json.
      </p>
    {/if}

    {#if collection === undefined}
      {#each collections as { name }, i (name)}
        <section class="section">
          <div class="sectionHeader">
            <h2 class="sectionTitle">{name}</h2>
            <a href={showAll(name)} class="link">Show all in {name}</a>
          </div>
          <div id="section-{i}"></div>
        </section>
      {/each}
    {:else}
      {#if showBack}
        <a href="/" class="link back">← All collections</a>
      {/if}
      <div class={collection.search.facets.length > 0 ? 'layout' : undefined}>
        {#if collection.search.facets.length > 0}
          <aside class="sidebar">
            {#each collection.search.facets as field, i (field)}
              <section>
                <h2 class="facetHeading">{label(field)}</h2>
                <div id="facet-{i}"></div>
              </section>
            {/each}
          </aside>
        {/if}
        <section>
          <div id="stats"></div>
          <div id="hits"></div>
        </section>
      </div>
    {/if}
  </main>
</div>
