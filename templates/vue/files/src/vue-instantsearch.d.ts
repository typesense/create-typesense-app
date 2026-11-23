// vue-instantsearch ships no type declarations; its components are typed loosely here.
declare module 'vue-instantsearch/vue3/es' {
  import type { Component } from 'vue'
  export const AisConfigure: Component
  export const AisHighlight: Component
  export const AisHits: Component
  export const AisIndex: Component
  export const AisInstantSearch: Component
  export const AisRefinementList: Component
  export const AisSearchBox: Component
  export const AisStats: Component
}
