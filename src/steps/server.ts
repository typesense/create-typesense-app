import { setTimeout as delay } from 'node:timers/promises'
import { runCompose } from '../util/docker.js'

export interface WaitForHealthOptions {
  timeoutMs?: number
  intervalMs?: number
}

/** Per-attempt cap, so one hung request cannot eat the whole budget. */
const ATTEMPT_TIMEOUT_MS = 5_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Polls `GET /health` until it reports `{"ok":true}`.
 *
 * The container accepts TCP connections before it is ready to serve, so a
 * connection succeeding is not enough — only the body counts. Fails with an
 * actionable message rather than hanging.
 */
export async function waitForHealth(
  baseUrl: string,
  { timeoutMs = 60_000, intervalMs = 500 }: WaitForHealthOptions = {},
): Promise<void> {
  const healthUrl = `${baseUrl}/health`
  const deadline = Date.now() + timeoutMs
  let lastAttempt = 'no attempt completed'

  for (;;) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, Math.max(timeoutMs, 1))),
      })
      const body = await response.text()
      try {
        const parsed: unknown = JSON.parse(body)
        if (typeof parsed === 'object' && parsed !== null && (parsed as { ok?: unknown }).ok === true) {
          return
        }
        lastAttempt = `HTTP ${response.status}, body ${body.slice(0, 120)}`
      } catch {
        lastAttempt = `HTTP ${response.status}, non-JSON body ${body.slice(0, 60)}`
      }
    } catch (error) {
      lastAttempt = messageOf(error)
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await delay(Math.min(intervalMs, remaining))
  }

  throw new Error(
    `Typesense did not become healthy at ${healthUrl} within ${Math.round(timeoutMs / 1_000)}s.\n` +
      `Last attempt: ${lastAttempt}\n` +
      'Inspect the container with: docker compose logs typesense',
  )
}

export async function composeUp(dir: string): Promise<void> {
  await runCompose(dir, ['up', '--detach'])
}

/** Volumes are removed by default, so teardown leaves nothing behind. */
export async function composeDown(
  dir: string,
  { removeVolumes = true }: { removeVolumes?: boolean } = {},
): Promise<void> {
  await runCompose(dir, ['down', ...(removeVolumes ? ['--volumes'] : [])])
}
