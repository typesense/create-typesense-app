'use client'

import { Hits, InstantSearch, RefinementList, SearchBox, Stats } from 'react-instantsearch'
import { collectionName, searchClient } from '../lib/typesense'
import styles from './search.module.css'

interface Book {
  title: string
  authors: string[]
  publication_year: number
  average_rating: number
  ratings_count: number
  image_url: string
}

function BookHit({ hit }: { hit: Book }) {
  return (
    <article className={styles.hit}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.cover} src={hit.image_url} alt="" loading="lazy" />
      <div>
        <h2 className={styles.title}>{hit.title}</h2>
        <p className={styles.meta}>
          {hit.authors.join(', ')} · {hit.publication_year}
        </p>
        <p className={styles.rating}>
          ★ {hit.average_rating} · {hit.ratings_count.toLocaleString()} ratings
        </p>
      </div>
    </article>
  )
}

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Search {collectionName}</h1>
        <p className={styles.subheading}>
          Misspell it on purpose. Typesense corrects typos as you type.
        </p>
      </header>

      <InstantSearch searchClient={searchClient} indexName={collectionName} future={{
        preserveSharedStateOnUnmount: true,
      }}>
        <SearchBox
          placeholder='Try "hary potr"'
          classNames={{ root: styles.searchRoot, input: styles.input, submit: styles.hiddenButton, reset: styles.hiddenButton }}
          autoFocus
        />

        <div className={styles.layout}>
          {/* One facet, per the plan. `authors` is faceted in scripts/schema.ts. */}
          <aside className={styles.sidebar}>
            <h2 className={styles.facetHeading}>Author</h2>
            <RefinementList
              attribute="authors"
              limit={8}
              searchable
              searchablePlaceholder="Filter authors"
              classNames={{
                list: styles.facetList,
                label: styles.facetLabel,
                count: styles.facetCount,
                searchBox: styles.facetSearch,
              }}
            />
          </aside>

          <section>
            <Stats classNames={{ root: styles.stats }} />
            <Hits<Book> hitComponent={BookHit} classNames={{ list: styles.hitList }} />
          </section>
        </div>
      </InstantSearch>
    </main>
  )
}
