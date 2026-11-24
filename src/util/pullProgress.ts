export interface PullProgress {
  /** Distinct layer ids seen so far. */
  layers: number
  /** Layers that reached "Pull complete". */
  completed: number
  /** Sum of the latest per-layer downloaded byte counts. */
  downloadedBytes: number
  /** True once the image itself reports "Pulled". */
  done: boolean
}

export interface PullTracker {
  /** Feeds one line of `docker compose pull` output. True if the snapshot changed. */
  ingest(line: string): boolean
  snapshot(): PullProgress
  /** A one-line human description, for a spinner. */
  describe(image: string): string
}

/** Docker reports decimal units, so 1 MB is 1e6 bytes — matching its own output. */
const UNIT_BYTES: Record<string, number> = {
  B: 1,
  kB: 1_000,
  MB: 1_000_000,
  GB: 1_000_000_000,
  TB: 1_000_000_000_000,
}

export function humanBytes(bytes: number): string {
  const { GB = 1e9, MB = 1e6 } = UNIT_BYTES
  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(1)} GB`
  }
  return `${Math.round(bytes / MB)} MB`
}

function parseSize(raw: string): number {
  const match = /^([\d.]+)(B|kB|MB|GB|TB)$/.exec(raw)
  if (!match) return 0
  const [, value, unit] = match
  return Number(value) * (UNIT_BYTES[unit ?? 'B'] ?? 1)
}

// ` 6edbc812af48 Downloading 1.049MB` — leading space, hex id, status, size.
const LAYER_LINE = /^\s+([0-9a-f]{6,})\s+(.+?)\s+([\d.]+(?:B|kB|MB|GB|TB))\s*$/
// ` Image typesense/typesense:30.2 Pulled `
const IMAGE_LINE = /^\s+Image\s+\S+\s+(Pulling|Pulled)\s*$/

/**
 * Turns the line-per-status-change output of a piped `docker compose pull` into
 * something a spinner can show.
 *
 * Docker repeats lines constantly — the same layer id appears many times, often
 * with an unchanged byte count — so ingest() reports whether anything actually
 * moved, letting the caller avoid pointless redraws.
 */
export function createPullTracker(): PullTracker {
  /** Latest cumulative bytes per layer id. Presence in the map means "seen". */
  const downloaded = new Map<string, number>()
  const completed = new Set<string>()
  let done = false

  function snapshot(): PullProgress {
    let downloadedBytes = 0
    for (const bytes of downloaded.values()) downloadedBytes += bytes
    return { layers: downloaded.size, completed: completed.size, downloadedBytes, done }
  }

  return {
    ingest(line: string): boolean {
      const imageMatch = IMAGE_LINE.exec(line)
      if (imageMatch) {
        const wasDone = done
        done = imageMatch[1] === 'Pulled'
        return done !== wasDone
      }

      const layerMatch = LAYER_LINE.exec(line)
      if (!layerMatch) return false

      const [, id, status, size] = layerMatch
      if (id === undefined) return false

      let changed = false
      if (!downloaded.has(id)) {
        downloaded.set(id, 0)
        changed = true
      }

      if (status === 'Downloading') {
        const bytes = parseSize(size ?? '0B')
        if (downloaded.get(id) !== bytes) {
          downloaded.set(id, bytes)
          changed = true
        }
      } else if (status === 'Pull complete' && !completed.has(id)) {
        completed.add(id)
        changed = true
      }

      return changed
    },

    snapshot,

    describe(image: string): string {
      const progress = snapshot()
      if (progress.done) return `Pulled ${image}`
      if (progress.layers === 0) return `Pulling ${image}`

      const size = humanBytes(progress.downloadedBytes)
      // Layers only complete during extraction, so a counter shown before then
      // would read 0/N for the entire download and look stuck.
      if (progress.completed === 0) return `Pulling ${image} — ${size} downloaded`
      return `Pulling ${image} — ${size}, layer ${progress.completed}/${progress.layers}`
    },
  }
}
