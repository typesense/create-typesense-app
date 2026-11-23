'use client'

import { Catamaran, Palanquin } from 'next/font/google'
import Link from 'next/link'
import { notFound, useParams, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  Configure,
  Highlight,
  Hits,
  Index,
  InstantSearch,
  RefinementList,
  SearchBox,
  Stats,
  useInstantSearch,
} from 'react-instantsearch'
import type { Hit } from 'instantsearch.js'
import { collections, searchClient, type Collection, type SearchConfig } from '../lib/typesense'
import styles from './search.module.css'

/**
 * Every field name below comes from typesense.config.json, so these pages work
 * for any collection. Change what they show there, not here.
 */
type Document = Record<string, unknown>

// The Typesense Cloud dashboard's typefaces: Palanquin for text, Catamaran for headings.
const body = Palanquin({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-body',
})
const heading = Catamaran({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-heading',
})

function label(field: string): string {
  const words = field.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  // Not toLocaleString: it would print a year as "2,008".
  return value === null || value === undefined ? '' : String(value)
}

function DocumentHit({ hit, search }: { hit: Hit<Document>; search: SearchConfig }) {
  const image = search.image === null ? '' : format(hit[search.image])
  const details = search.display
    .map((field) => [field, format(hit[field])] as const)
    .filter(([, value]) => value !== '')

  return (
    <article className={styles.hit}>
      {image !== '' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.cover}
          src={image}
          alt=""
          loading="lazy"
          // Real data has dead image URLs; a broken-image icon helps nobody.
          onError={(event) => (event.currentTarget.style.display = 'none')}
        />
      )}
      <div className={styles.hitBody}>
        <h2 className={styles.title}>
          <Highlight attribute={search.title} hit={hit} />
        </h2>
        <dl className={styles.fields}>
          {details.map(([field, value]) => (
            <div key={field} className={styles.field}>
              <dt>{label(field)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  )
}

// Made once per collection: an inline component would remount every hit on each render.
const hitComponents = Object.fromEntries(
  collections.map(({ name, search }) => [
    name,
    function CollectionHit({ hit }: { hit: Hit<Document> }) {
      return <DocumentHit hit={hit} search={search} />
    },
  ]),
)

/** InstantSearch turns a failed request into zero hits; say what went wrong instead. */
function SearchError() {
  const { error } = useInstantSearch({ catchError: true })
  if (error === undefined) return null
  return (
    <p role="alert" className={styles.error}>
      Search failed: {error.message} Check the field names in typesense.config.json.
    </p>
  )
}

function Shell({
  title,
  indexName,
  initialQuery,
  children,
}: {
  title: string
  indexName: string
  initialQuery?: string
  children: ReactNode
}) {
  return (
    <div className={`${body.variable} ${heading.variable} ${styles.page}`}>
      <header className={styles.topbar}>
        <a href="https://typesense.org" aria-label="Typesense">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.logo} src="/typesense-logo.svg" alt="Typesense" />
        </a>
        <nav className={styles.nav}>
          <a href="https://typesense.org/docs/">docs</a>
          <a href="https://github.com/typesense/typesense">github</a>
          <a href="https://cloud.typesense.org">cloud</a>
        </nav>
      </header>
      <main className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.heading}>{title}</h1>
          <p className={styles.subheading}>
            Misspell it on purpose. Typesense corrects typos as you type.
          </p>
        </div>

        <InstantSearch
          searchClient={searchClient}
          indexName={indexName}
          initialUiState={initialQuery ? { [indexName]: { query: initialQuery } } : undefined}
          future={{ preserveSharedStateOnUnmount: true }}
        >
          <SearchBox
            placeholder={title}
            classNames={{
              root: styles.searchRoot,
              input: styles.input,
              submit: styles.hiddenButton,
              reset: styles.hiddenButton,
            }}
            autoFocus
          />
          <SearchError />
          {children}
        </InstantSearch>
      </main>
    </div>
  )
}

/** One collection with its own facets: the home page when only one is selected. */
export function CollectionPage({
  collection,
  initialQuery,
  showBack = false,
}: {
  collection: Collection
  initialQuery?: string
  showBack?: boolean
}) {
  const { name, search } = collection
  const facets = search.facets.length > 0

  return (
    <Shell title={`Search ${name}`} indexName={name} initialQuery={initialQuery}>
      {showBack && (
        <Link href="/" className={`${styles.link} ${styles.back}`}>
          ← All collections
        </Link>
      )}
      <div className={facets ? styles.layout : undefined}>
        {facets && (
          <aside className={styles.sidebar}>
            {search.facets.map((field) => (
              <section key={field}>
                <h2 className={styles.facetHeading}>{label(field)}</h2>
                <RefinementList
                  attribute={field}
                  limit={8}
                  searchable
                  searchablePlaceholder={`Filter ${label(field).toLowerCase()}`}
                  classNames={{
                    list: styles.facetList,
                    label: styles.facetLabel,
                    checkbox: styles.facetCheckbox,
                    count: styles.facetCount,
                    searchBox: styles.facetSearch,
                  }}
                />
              </section>
            ))}
          </aside>
        )}

        <section>
          <Stats classNames={{ root: styles.stats }} />
          <Hits<Document>
            hitComponent={hitComponents[name]}
            classNames={{ list: styles.hitList }}
          />
        </section>
      </div>
    </Shell>
  )
}

/** The top 5 hits of one collection, inside an <Index>, with a link to all of them. */
function Section({ collection, rootIndex }: { collection: Collection; rootIndex: string }) {
  const { results, uiState } = useInstantSearch()
  const query = uiState[rootIndex]?.query ?? ''
  const href = `/collections/${encodeURIComponent(collection.name)}${
    query === '' ? '' : `?q=${encodeURIComponent(query)}`
  }`

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{collection.name}</h2>
        <Link href={href} className={styles.link}>
          Show all in {collection.name}
        </Link>
      </div>
      {results.nbHits === 0 ? (
        <p className={styles.empty}>No results in {collection.name}.</p>
      ) : (
        <Hits<Document>
          hitComponent={hitComponents[collection.name]}
          classNames={{ list: styles.hitList }}
        />
      )}
    </section>
  )
}

/** One query, every selected collection: each in its own section. */
export function FederatedPage() {
  // The root index carries the query; every section, its own included, is an <Index>.
  const rootIndex = collections[0]?.name ?? ''
  return (
    <Shell title="Search" indexName={rootIndex}>
      {collections.map((collection) => (
        <Index
          key={collection.name}
          indexName={collection.name}
          indexId={`section-${collection.name}`}
        >
          <Configure hitsPerPage={5} />
          <Section collection={collection} rootIndex={rootIndex} />
        </Index>
      ))}
    </Shell>
  )
}

/** The home page: the full page for one collection, or one section for each of several. */
export function HomePage() {
  const [only] = collections
  return collections.length === 1 && only !== undefined ? (
    <CollectionPage collection={only} />
  ) : (
    <FederatedPage />
  )
}

/** "Show all in <collection>": one collection with its facets, keeping the query. */
export function ShowAllPage() {
  const { name } = useParams<{ name: string }>()
  const query = useSearchParams().get('q') ?? undefined
  const collection = collections.find((entry) => entry.name === decodeURIComponent(name))
  if (collection === undefined) notFound()
  return <CollectionPage collection={collection} initialQuery={query} showBack />
}
