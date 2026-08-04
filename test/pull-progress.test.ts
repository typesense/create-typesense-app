/**
 * Lines below are copied verbatim from a real `docker compose pull` of
 * typesense/typesense:30.2 with output piped (not a TTY), which is how the CLI
 * will always see it.
 */
import { describe, expect, it } from 'vitest'
import { createPullTracker, humanBytes } from '../src/util/pullProgress.js'

const IMAGE = 'typesense/typesense:30.2'

describe('humanBytes', () => {
  it.each([
    [0, '0 MB'],
    [1_049_000, '1 MB'],
    [45_600_000, '46 MB'],
    [1_500_000_000, '1.5 GB'],
  ])('renders %i as %s', (bytes, expected) => {
    expect(humanBytes(bytes)).toBe(expected)
  })
})

describe('createPullTracker', () => {
  it('starts empty', () => {
    expect(createPullTracker().snapshot()).toEqual({
      layers: 0,
      completed: 0,
      downloadedBytes: 0,
      done: false,
    })
  })

  it('counts each layer once, even when docker repeats the line', () => {
    const tracker = createPullTracker()
    tracker.ingest(' 6ff5bb9c14a0 Pulling fs layer 0B')
    tracker.ingest(' 6edbc812af48 Pulling fs layer 0B')
    tracker.ingest(' 6ff5bb9c14a0 Pulling fs layer 0B')
    expect(tracker.snapshot().layers).toBe(2)
  })

  it('sums the latest downloaded bytes per layer, not every update', () => {
    const tracker = createPullTracker()
    tracker.ingest(' 6edbc812af48 Pulling fs layer 0B')
    tracker.ingest(' 6ff5bb9c14a0 Pulling fs layer 0B')
    tracker.ingest(' 6edbc812af48 Downloading 1.049MB')
    tracker.ingest(' 6edbc812af48 Downloading 5.243MB')
    tracker.ingest(' 6ff5bb9c14a0 Downloading 2.097MB')
    // Cumulative per layer: 5.243MB + 2.097MB, NOT 1.049 + 5.243 + 2.097.
    expect(tracker.snapshot().downloadedBytes).toBe(5_243_000 + 2_097_000)
  })

  it('counts completed layers', () => {
    const tracker = createPullTracker()
    tracker.ingest(' 6edbc812af48 Pulling fs layer 0B')
    tracker.ingest(' 4f4fb700ef54 Pulling fs layer 0B')
    tracker.ingest(' 6edbc812af48 Pull complete 0B')
    expect(tracker.snapshot()).toMatchObject({ layers: 2, completed: 1 })
  })

  it('does not count "Download complete" as a finished layer — extraction follows', () => {
    const tracker = createPullTracker()
    tracker.ingest(' 4f4fb700ef54 Pulling fs layer 0B')
    tracker.ingest(' 4f4fb700ef54 Download complete 0B')
    expect(tracker.snapshot().completed).toBe(0)
  })

  it('is done only when the image reports Pulled', () => {
    const tracker = createPullTracker()
    tracker.ingest(` Image ${IMAGE} Pulling `)
    expect(tracker.snapshot().done).toBe(false)
    tracker.ingest(` Image ${IMAGE} Pulled `)
    expect(tracker.snapshot().done).toBe(true)
  })

  it('ignores lines it does not understand', () => {
    const tracker = createPullTracker()
    expect(tracker.ingest('some unrelated warning')).toBe(false)
    expect(tracker.ingest('')).toBe(false)
    expect(tracker.snapshot().layers).toBe(0)
  })

  it('reports a change only when the snapshot actually moves', () => {
    const tracker = createPullTracker()
    expect(tracker.ingest(' 6edbc812af48 Pulling fs layer 0B')).toBe(true)
    // Docker repeats identical byte counts constantly; those are not progress.
    tracker.ingest(' 6edbc812af48 Downloading 5.243MB')
    expect(tracker.ingest(' 6edbc812af48 Downloading 5.243MB')).toBe(false)
  })

  describe('describe', () => {
    it('names the image before any layer is known', () => {
      expect(createPullTracker().describe(IMAGE)).toBe(`Pulling ${IMAGE}`)
    })

    /**
     * Layers only reach "Pull complete" during extraction, at the very end, so a
     * layer counter shown during the download sits at 0/N for the whole thing and
     * reads as stuck. Bytes are the honest signal until then.
     */
    it('omits the layer count while nothing has finished yet', () => {
      const tracker = createPullTracker()
      tracker.ingest(' 6edbc812af48 Pulling fs layer 0B')
      tracker.ingest(' 4f4fb700ef54 Pulling fs layer 0B')
      tracker.ingest(' 6edbc812af48 Downloading 218MB')
      expect(tracker.describe(IMAGE)).toBe(`Pulling ${IMAGE} — 218 MB downloaded`)
    })

    it('shows downloaded size and layer counts once known', () => {
      const tracker = createPullTracker()
      tracker.ingest(' 6edbc812af48 Pulling fs layer 0B')
      tracker.ingest(' 4f4fb700ef54 Pulling fs layer 0B')
      tracker.ingest(' 6edbc812af48 Downloading 45.6MB')
      tracker.ingest(' 4f4fb700ef54 Pull complete 0B')
      expect(tracker.describe(IMAGE)).toBe(`Pulling ${IMAGE} — 46 MB, layer 1/2`)
    })

    it('says it is done once pulled', () => {
      const tracker = createPullTracker()
      tracker.ingest(` Image ${IMAGE} Pulled `)
      expect(tracker.describe(IMAGE)).toBe(`Pulled ${IMAGE}`)
    })
  })

  it('handles a whole real pull, ending complete', () => {
    const tracker = createPullTracker()
    const realLines = [
      ` Image ${IMAGE} Pulling `,
      ' 6ff5bb9c14a0 Pulling fs layer 0B',
      ' 6edbc812af48 Pulling fs layer 0B',
      ' edb439b37967 Pulling fs layer 0B',
      ' 4f4fb700ef54 Pulling fs layer 0B',
      ' 6ff5bb9c14a0 Pulling fs layer 0B',
      ' 6edbc812af48 Downloading 1.049MB',
      ' 6edbc812af48 Downloading 22.02MB',
      ' 4f4fb700ef54 Download complete 0B',
      ' 6edbc812af48 Download complete 0B',
      ' 6edbc812af48 Extracting 1.049MB',
      ' 6edbc812af48 Pull complete 0B',
      ' 4f4fb700ef54 Pull complete 0B',
      ' edb439b37967 Pull complete 0B',
      ' 6ff5bb9c14a0 Extracting 1B',
      ' 6ff5bb9c14a0 Pull complete 0B',
      ` Image ${IMAGE} Pulled `,
    ]
    for (const line of realLines) tracker.ingest(line)

    expect(tracker.snapshot()).toMatchObject({ layers: 4, completed: 4, done: true })
    expect(tracker.describe(IMAGE)).toBe(`Pulled ${IMAGE}`)
  })
})
