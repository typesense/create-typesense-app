<script setup lang="ts">
import type { Middleware } from 'instantsearch.js'
import { ref } from 'vue'
import { AisInstantSearch, AisSearchBox } from 'vue-instantsearch/vue3/es'
import CollectionPage from './components/CollectionPage.vue'
import FederatedPage from './components/FederatedPage.vue'
import { collections, searchClient } from './typesense'

/**
 * Every field name the UI uses comes from typesense.config.json, so these pages
 * work for any collection. Change what they show there, not here.
 *
 * One selected collection gets its full page; several get one section each, and
 * `?collection=<name>&q=<query>` opens the full page of one of them.
 */
const params = new URLSearchParams(window.location.search)
const requested = collections.find(({ name }) => name === params.get('collection'))
const page = requested ?? (collections.length === 1 ? collections[0] : undefined)
// The root index carries the query; on the federated page every section is an <AisIndex>.
const indexName = page?.name ?? collections[0]?.name ?? ''
const initialQuery = params.get('q') ?? ''
const heading = page === undefined ? 'Search' : `Search ${page.name}`
document.title = `${heading} | Typesense`

const query = ref(initialQuery)
const error = ref<Error>()

// InstantSearch turns a failed request into zero hits; this keeps the error to show instead.
const middlewares: Middleware[] = [
  ({ instantSearchInstance }) => {
    const onRender = () => {
      error.value = instantSearchInstance.status === 'error' ? instantSearchInstance.error : undefined
    }
    return {
      onStateChange: ({ uiState }) => {
        query.value = uiState[indexName]?.query ?? ''
      },
      subscribe: () => instantSearchInstance.addListener('render', onRender),
      unsubscribe: () => instantSearchInstance.removeListener('render', onRender),
    }
  },
]
</script>

<template>
  <div class="page">
    <header class="topbar">
      <a href="https://typesense.org">
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
        <h1 class="heading">{{ heading }}</h1>
        <p class="subheading">Misspell it on purpose. Typesense corrects typos as you type.</p>
      </div>

      <AisInstantSearch
        :search-client="searchClient"
        :index-name="indexName"
        :initial-ui-state="initialQuery === '' ? undefined : { [indexName]: { query: initialQuery } }"
        :middlewares="middlewares"
        :future="{ preserveSharedStateOnUnmount: true }"
      >
        <!-- biome-ignore lint/a11y/noAutofocus: the search box is the whole page -->
        <AisSearchBox :placeholder="heading" autofocus />
        <p v-if="error" role="alert" class="error">
          Search failed: {{ error.message }} Check the field names in typesense.config.json.
        </p>
        <CollectionPage
          v-if="page"
          :collection="page"
          :show-back="requested !== undefined && collections.length > 1"
        />
        <FederatedPage v-else :query="query" />
      </AisInstantSearch>
    </main>
  </div>
</template>
