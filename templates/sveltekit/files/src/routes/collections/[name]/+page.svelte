<script lang="ts">
  import Search from '../../../lib/Search.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<!-- Keyed so going back and forth between two collections restarts the search. -->
{#key data}
  <Search collection={data.collection} initialQuery={data.query} showBack />
{/key}
