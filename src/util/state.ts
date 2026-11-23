import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { STATE_FILE } from '../constants.js'

/**
 * Marks a run as in progress so a failed run can be resumed.
 *
 * This is what lets the empty-directory check tell "we started here and crashed"
 * apart from "someone else's project lives here" — a distinction that filename
 * guessing kept getting wrong. Deleted on success, so a *finished* project is
 * correctly refused rather than silently scaffolded over.
 */
export interface RunState {
  version: 1
  template: string
}

function stateFile(targetDir: string): string {
  return path.join(targetDir, STATE_FILE)
}

export function hasRunState(targetDir: string): boolean {
  return existsSync(stateFile(targetDir))
}

export async function readRunState(targetDir: string): Promise<RunState | undefined> {
  const raw = await readFile(stateFile(targetDir), 'utf8').catch(() => undefined)
  if (raw === undefined) return undefined

  try {
    const parsed = JSON.parse(raw) as RunState
    return parsed.version === 1 ? parsed : undefined
  } catch {
    // A corrupt marker is no worse than none — treat the run as fresh.
    return undefined
  }
}

export async function markRunStarted(targetDir: string, state: RunState): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  await writeFile(stateFile(targetDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export async function clearRunState(targetDir: string): Promise<void> {
  await rm(stateFile(targetDir), { force: true })
}
