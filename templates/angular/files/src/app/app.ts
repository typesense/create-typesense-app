import { NgTemplateOutlet } from '@angular/common'
import { afterNextRender, Component, type OnDestroy, signal } from '@angular/core'
import instantsearch from 'instantsearch.js/es'
import type { Hit } from 'instantsearch.js'
import {
  connectHits,
  connectRefinementList,
  connectSearchBox,
  connectStats,
} from 'instantsearch.js/es/connectors'
import { configure, index } from 'instantsearch.js/es/widgets'
import { type Collection, collections, type SearchConfig, searchClient } from '../typesense'

/**
 * Every field name below comes from typesense.config.json, so this page works for
 * any collection. Change what it shows there, not here.
 *
 * InstantSearch's connectors hand back state instead of rendering, and the state
 * goes straight into signals that the template reads.
 */
type Document = Record<string, unknown>

interface Facet {
  items: { label: string; value: string; count: number; isRefined: boolean }[]
  refine: (value: string) => void
  searchForItems: (query: string) => void
}

export function label(field: string): string {
  const words = field.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function format(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  // Not toLocaleString: it would print a year as "2,008".
  return value === null || value === undefined ? '' : String(value)
}

/** The page to show: ?collection=<name> is "Show all in <name>"; one collection needs no choice. */
function pick(params: URLSearchParams): { collection?: Collection; showBack: boolean } {
  const [only] = collections
  if (collections.length === 1) return { collection: only, showBack: false }
  const collection = collections.find((entry) => entry.name === params.get('collection'))
  return { collection, showBack: collection !== undefined }
}

@Component({
  imports: [NgTemplateOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  protected readonly label = label
  protected readonly format = format

  private readonly params = new URLSearchParams(window.location.search)
  protected readonly page = pick(this.params)
  protected readonly collections = collections
  protected readonly title = this.page.collection ? `Search ${this.page.collection.name}` : 'Search'

  protected readonly query = signal('')
  protected readonly error = signal<string | undefined>(undefined)
  protected readonly stats = signal('')
  protected readonly hits = signal<Hit<Document>[]>([])
  protected readonly facets = signal<Record<string, Facet | undefined>>({})
  /** Federated page: each collection's top hits, undefined until its first results. */
  protected readonly sections = signal<Record<string, Hit<Document>[] | undefined>>({})

  private refineQuery: (query: string) => void = () => {}

  // The root index carries the query; on the federated page every section is an index of its own.
  private readonly search = instantsearch({
    searchClient,
    indexName: this.page.collection?.name ?? collections[0]?.name ?? '',
    initialUiState: this.page.collection && {
      [this.page.collection.name]: { query: this.params.get('q') ?? '' },
    },
    future: { preserveSharedStateOnUnmount: true },
  })

  constructor() {
    document.title = `${this.title} | Typesense`
    // Not the autofocus attribute: a browser applies it only to markup present at page load.
    afterNextRender(() => document.querySelector<HTMLInputElement>('input.input')?.focus())
    // InstantSearch turns a failed request into zero hits; say what went wrong instead.
    this.search.on('error', ({ error }: { error: Error }) => this.error.set(error.message))

    this.search.addWidgets([
      connectSearchBox(({ query, refine }) => {
        this.query.set(query)
        this.refineQuery = refine
      })({}),
    ])

    const { collection } = this.page
    if (collection === undefined) {
      this.search.addWidgets(
        collections.map(({ name }) =>
          index({ indexName: name, indexId: `section-${name}` }).addWidgets([
            configure({ hitsPerPage: 5 }),
            connectHits<Document>(({ hits, results }) => {
              this.sections.update((all) => ({ ...all, [name]: results ? hits : undefined }))
            })({}),
          ]),
        ),
      )
    } else {
      this.search.addWidgets([
        connectStats(({ nbHits, processingTimeMS }) => {
          this.stats.set(`${nbHits} results found in ${processingTimeMS}ms`)
        })({}),
        connectHits<Document>(({ hits }) => this.hits.set(hits))({}),
        ...collection.search.facets.map((field) =>
          connectRefinementList(({ items, refine, searchForItems }) => {
            this.facets.update((all) => ({ ...all, [field]: { items, refine, searchForItems } }))
          })({ attribute: field, limit: 8 }),
        ),
      ])
    }

    this.search.start()
  }

  ngOnDestroy(): void {
    this.search.dispose()
  }

  protected onInput(event: Event): void {
    this.error.set(undefined)
    this.refineQuery((event.target as HTMLInputElement).value)
  }

  protected showAll(name: string): string {
    const query = this.query()
    return `?collection=${encodeURIComponent(name)}${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`
  }

  /** The title with the query's matches marked; InstantSearch has escaped the rest. */
  protected highlighted(hit: Hit<Document>, search: SearchConfig): string | undefined {
    const value = (hit._highlightResult as Record<string, { value?: unknown }> | undefined)?.[
      search.title
    ]?.value
    return typeof value === 'string' ? value : undefined
  }

  protected image(hit: Hit<Document>, search: SearchConfig): string {
    return search.image === null ? '' : format(hit[search.image])
  }

  protected details(hit: Hit<Document>, search: SearchConfig): (readonly [string, string])[] {
    return search.display
      .map((field) => [field, format(hit[field])] as const)
      .filter(([, value]) => value !== '')
  }

  // Real data has dead image URLs; a broken-image icon helps nobody.
  protected hide(event: Event): void {
    ;(event.target as HTMLElement).style.display = 'none'
  }
}
