import { copyFile, mkdir, readdir } from 'node:fs/promises'
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
