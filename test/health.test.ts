import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { waitForHealth } from '../src/steps/server.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

/** Serves /health with a caller-controlled body, so polling can be tested for real. */
async function startFakeTypesense(
  handler: (hit: number) => { status: number; body: string },
): Promise<{ baseUrl: string; hits: () => number }> {
  let hits = 0
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end()
      return
    }
    hits += 1
    const { status, body } = handler(hits)
    response.writeHead(status, { 'content-type': 'application/json' }).end(body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}`, hits: () => hits }
}

/** A port nothing is listening on. */
async function unusedBaseUrl(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `http://127.0.0.1:${port}`
}

describe('waitForHealth', () => {
  it('resolves as soon as /health reports ok', async () => {
    const fake = await startFakeTypesense(() => ({ status: 200, body: '{"ok":true}' }))
    await expect(waitForHealth(fake.baseUrl, { timeoutMs: 2_000 })).resolves.toBeUndefined()
    expect(fake.hits()).toBe(1)
  })

  it('keeps polling while the server is still coming up', async () => {
    const fake = await startFakeTypesense((hit) =>
      hit < 3 ? { status: 503, body: '{"ok":false}' } : { status: 200, body: '{"ok":true}' },
    )
    await waitForHealth(fake.baseUrl, { timeoutMs: 5_000, intervalMs: 20 })
    expect(fake.hits()).toBe(3)
  })

  it('does not treat ok:false as healthy', async () => {
    const fake = await startFakeTypesense(() => ({ status: 200, body: '{"ok":false}' }))
    await expect(
      waitForHealth(fake.baseUrl, { timeoutMs: 200, intervalMs: 20 }),
    ).rejects.toThrow()
    expect(fake.hits()).toBeGreaterThan(1)
  })

  it('times out with an actionable message instead of hanging', async () => {
    const baseUrl = await unusedBaseUrl()
    await expect(waitForHealth(baseUrl, { timeoutMs: 300, intervalMs: 50 })).rejects.toThrow(
      /docker compose logs/,
    )
  })

  it('names the URL it gave up on', async () => {
    const baseUrl = await unusedBaseUrl()
    await expect(waitForHealth(baseUrl, { timeoutMs: 200, intervalMs: 50 })).rejects.toThrow(
      new RegExp(baseUrl.replace(/[.]/g, '\\.')),
    )
  })

  it('survives malformed JSON from a half-started server', async () => {
    const fake = await startFakeTypesense((hit) =>
      hit < 2 ? { status: 200, body: '<html>nope' } : { status: 200, body: '{"ok":true}' },
    )
    await expect(
      waitForHealth(fake.baseUrl, { timeoutMs: 5_000, intervalMs: 20 }),
    ).resolves.toBeUndefined()
    expect(fake.hits()).toBe(2)
  })
})
