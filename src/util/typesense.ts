export interface TypesenseClient {
  collectionExists(name: string): Promise<boolean>
  createCollection(schema: object): Promise<void>
  deleteCollection(name: string): Promise<void>
  importDocuments(name: string, jsonl: string): Promise<string>
  createKey(spec: KeySpec): Promise<CreatedKey>
  listKeys(): Promise<StoredKey[]>
  deleteKey(id: number): Promise<void>
  search(name: string, params: Record<string, string>): Promise<SearchResponse>
}

export interface KeySpec {
  description: string
  actions: string[]
  collections: string[]
}

export interface CreatedKey {
  id: number
  /** Returned in full only at creation time — Typesense never shows it again. */
  value: string
}

export interface StoredKey {
  id: number
  description: string
}

export interface SearchResponse {
  found: number
  hits: { document: Record<string, unknown> }[]
  facet_counts?: { field_name: string; counts: { value: string; count: number }[] }[]
}

export class TypesenseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'TypesenseError'
  }
}

const REQUEST_TIMEOUT_MS = 60_000

/**
 * A deliberately small client over `fetch`.
 *
 * The generated project uses the official `typesense` package; the CLI needs only
 * six calls, so adding a runtime dependency to install and keep in step with the
 * server version buys nothing here.
 */
export function createTypesenseClient(baseUrl: string, apiKey: string): TypesenseClient {
  const root = baseUrl.replace(/\/+$/, '')

  async function request(
    method: string,
    path: string,
    options: { body?: string; contentType?: string; allow404?: boolean } = {},
  ): Promise<{ status: number; text: string }> {
    let response: Response
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: {
          'X-TYPESENSE-API-KEY': apiKey,
          ...(options.contentType === undefined ? {} : { 'Content-Type': options.contentType }),
        },
        body: options.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      throw new TypesenseError(
        `Could not reach Typesense at ${root}${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      )
    }

    const text = await response.text()
    if (!response.ok && !(options.allow404 === true && response.status === 404)) {
      throw new TypesenseError(
        `Typesense replied ${response.status} to ${method} ${path}: ${text.slice(0, 300)}`,
        response.status,
      )
    }
    return { status: response.status, text }
  }

  async function requestJson<T>(
    method: string,
    path: string,
    options?: { body?: string; contentType?: string },
  ): Promise<T> {
    const { text } = await request(method, path, options)
    return JSON.parse(text) as T
  }

  return {
    async collectionExists(name) {
      const { status } = await request('GET', `/collections/${encodeURIComponent(name)}`, {
        allow404: true,
      })
      return status === 200
    },

    async createCollection(schema) {
      await request('POST', '/collections', {
        body: JSON.stringify(schema),
        contentType: 'application/json',
      })
    },

    async deleteCollection(name) {
      await request('DELETE', `/collections/${encodeURIComponent(name)}`, { allow404: true })
    },

    async importDocuments(name, jsonl) {
      // action=upsert makes a re-import over existing documents safe.
      const { text } = await request(
        'POST',
        `/collections/${encodeURIComponent(name)}/documents/import?action=upsert`,
        { body: jsonl, contentType: 'text/plain' },
      )
      return text
    },

    async createKey(spec) {
      return requestJson<CreatedKey>('POST', '/keys', {
        body: JSON.stringify(spec),
        contentType: 'application/json',
      })
    },

    async listKeys() {
      const { keys } = await requestJson<{ keys: StoredKey[] }>('GET', '/keys')
      return keys ?? []
    },

    async deleteKey(id) {
      await request('DELETE', `/keys/${id}`, { allow404: true })
    },

    async search(name, params) {
      const query = new URLSearchParams(params).toString()
      return requestJson<SearchResponse>(
        'GET',
        `/collections/${encodeURIComponent(name)}/documents/search?${query}`,
      )
    },
  }
}
