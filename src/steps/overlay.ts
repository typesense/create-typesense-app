import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

/** Placeholders that only exist to keep an empty directory in git. */
const IGNORED = new Set(['.gitkeep', '.DS_Store'])

/**
 * Copies a template's `files/` tree over the scaffolded project.
 *
 * The overlay owns what it writes: app/page.tsx replaces the framework's default
 * page on purpose, so existing files are overwritten rather than skipped.
 *
 * Returns the project-relative paths written, sorted, so a caller can report them.
 */
export async function applyOverlay(filesDir: string, targetDir: string): Promise<string[]> {
  const entries = await readdir(filesDir, { recursive: true, withFileTypes: true })
  const written: string[] = []

  for (const entry of entries) {
    if (!entry.isFile() || IGNORED.has(entry.name)) continue

    // parentPath is absolute; make the path relative to the overlay root.
    const absolute = path.join(entry.parentPath, entry.name)
    const relative = path.relative(filesDir, absolute)
    const destination = path.join(targetDir, relative)

    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(absolute, destination)
    written.push(relative)
  }

  return written.sort()
}

/**
 * Deletes what the overlay supersedes, after it has been applied.
 *
 * A framework CLI scaffolds a demo page plus its assets. Once our entry point
 * replaces theirs, those files are unreferenced but still sitting in the project,
 * and a reader cannot tell which of them matter.
 *
 * Returns the paths actually removed. Missing paths are not an error: a framework
 * CLI is free to stop shipping a file between releases, and that should not fail
 * a scaffold.
 */
export async function removeSuperseded(targetDir: string, paths: string[]): Promise<string[]> {
  const root = path.resolve(targetDir)
  const removed: string[] = []

  for (const entry of paths) {
    const absolute = path.resolve(root, entry)
    // Belt and braces: the manifest validator already rejects escaping paths.
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`Refusing to remove "${entry}": it resolves outside the project.`)
    }

    const existed = await readdir(path.dirname(absolute))
      .then((entries) => entries.includes(path.basename(absolute)))
      .catch(() => false)
    if (!existed) continue

    await rm(absolute, { recursive: true, force: true })
    removed.push(entry)
  }

  return removed
}
