import { execa } from 'execa'

export type DockerStatus =
  | { available: true; composeVersion: string; serverVersion: string }
  | { available: false; reason: string }

/** Enough to fail fast on an unreachable daemon without hanging the prompts. */
const PROBE_TIMEOUT_MS = 8_000

/**
 * Detect Docker up front (PLAN.md §7). Read-only: this never starts anything.
 *
 * Two probes, because they fail for different reasons and the user needs to know
 * which: `docker compose version` proves the CLI and the compose plugin exist,
 * `docker info` proves the daemon is actually running.
 */
export async function checkDocker(): Promise<DockerStatus> {
  let composeVersion: string
  try {
    const result = await execa('docker', ['compose', 'version', '--short'], {
      timeout: PROBE_TIMEOUT_MS,
    })
    composeVersion = result.stdout.trim()
  } catch (error) {
    if (isNotFound(error)) {
      return { available: false, reason: 'the `docker` command was not found on PATH' }
    }
    return {
      available: false,
      reason: 'the Docker Compose plugin is unavailable (`docker compose version` failed)',
    }
  }

  try {
    const result = await execa('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: PROBE_TIMEOUT_MS,
    })
    return {
      available: true,
      composeVersion,
      serverVersion: result.stdout.trim() || 'unknown',
    }
  } catch {
    return {
      available: false,
      reason: 'the Docker daemon is not responding — is Docker Desktop running?',
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
