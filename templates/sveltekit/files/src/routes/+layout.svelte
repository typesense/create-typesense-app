<script lang="ts">
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
</script>

<svelte:head>
  <link rel="icon" href="/favicon.png" />
  <!-- The Typesense Cloud dashboard's typefaces: Palanquin for text, Catamaran for headings. -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Catamaran:wght@500;600;700&family=Palanquin:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
