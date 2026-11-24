<script lang="ts">
  import Search from '../lib/Search.svelte'
  import { collections } from '../lib/typesense'
</script>

<!-- One selected collection gets its full page here; several get one section each. -->
<Search collection={collections.length === 1 ? collections[0] : undefined} />
