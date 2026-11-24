<script setup lang="ts">
import { AisHits, AisRefinementList, AisStats } from 'vue-instantsearch/vue3/es'
import { label, type Collection } from '../typesense'
import DocumentHit from './DocumentHit.vue'

/** One collection with its own facets: the home page when only one is selected. */
defineProps<{ collection: Collection; showBack: boolean }>()
</script>

<template>
  <a v-if="showBack" href="/" class="link back">← All collections</a>
  <div :class="{ layout: collection.search.facets.length > 0 }">
    <aside v-if="collection.search.facets.length > 0" class="sidebar">
      <section v-for="field in collection.search.facets" :key="field">
        <h2 class="facet-heading">{{ label(field) }}</h2>
        <AisRefinementList
          :attribute="field"
          :limit="8"
          searchable
          :searchable-placeholder="`Filter ${label(field).toLowerCase()}`"
        />
      </section>
    </aside>

    <section>
      <AisStats />
      <AisHits>
        <template #default="{ items }">
          <ul class="hit-list">
            <li v-for="item in items" :key="item.objectID">
              <DocumentHit :hit="item" :search="collection.search" />
            </li>
          </ul>
        </template>
      </AisHits>
    </section>
  </div>
</template>
