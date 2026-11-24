<script setup lang="ts">
import { AisConfigure, AisHits, AisIndex } from 'vue-instantsearch/vue3/es'
import { collections } from '../typesense'
import DocumentHit from './DocumentHit.vue'

/** One query, every selected collection: each in its own section. */
const props = defineProps<{ query: string }>()

// No router: "Show all" reloads this page with the collection and query in the URL.
function showAll(name: string) {
  const params = new URLSearchParams({ collection: name })
  if (props.query !== '') params.set('q', props.query)
  return `?${params}`
}
</script>

<template>
  <!-- AisIndex renders a <div>; it carries .section, so the sections space out. -->
  <AisIndex
    v-for="collection in collections"
    :key="collection.name"
    :index-name="collection.name"
    :index-id="`section-${collection.name}`"
    class="section"
  >
    <AisConfigure :hits-per-page.camel="5" />
    <section>
      <div class="section-header">
        <h2 class="section-title">{{ collection.name }}</h2>
        <a :href="showAll(collection.name)" class="link">Show all in {{ collection.name }}</a>
      </div>
      <AisHits>
        <template #default="{ items }">
          <p v-if="items.length === 0" class="empty">No results in {{ collection.name }}.</p>
          <ul v-else class="hit-list">
            <li v-for="item in items" :key="item.objectID">
              <DocumentHit :hit="item" :search="collection.search" />
            </li>
          </ul>
        </template>
      </AisHits>
    </section>
  </AisIndex>
</template>
