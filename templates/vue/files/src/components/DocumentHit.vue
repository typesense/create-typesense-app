<script setup lang="ts">
import { computed } from 'vue'
import { AisHighlight } from 'vue-instantsearch/vue3/es'
import { format, label, type SearchConfig } from '../typesense'

const props = defineProps<{ hit: Record<string, unknown>; search: SearchConfig }>()

const image = computed(() =>
  props.search.image === null ? '' : format(props.hit[props.search.image]),
)
const details = computed(() =>
  props.search.display
    .map((field) => [field, format(props.hit[field])] as const)
    .filter(([, value]) => value !== ''),
)

// Real data has dead image URLs; a broken-image icon helps nobody.
function hide(event: Event) {
  ;(event.currentTarget as HTMLElement).style.display = 'none'
}
</script>

<template>
  <article class="hit">
    <img v-if="image !== ''" class="cover" :src="image" alt="" loading="lazy" @error="hide" />
    <div class="hit-body">
      <h2 class="title"><AisHighlight :attribute="search.title" :hit="hit" /></h2>
      <dl class="fields">
        <div v-for="[field, value] in details" :key="field" class="field">
          <dt>{{ label(field) }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
    </div>
  </article>
</template>
