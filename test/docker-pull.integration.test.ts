/**
 * Exercises the pull path against a real Docker, using a tiny throwaway image so
 * it costs a fraction of a second and never touches the Typesense image the rest
 * of the suite relies on.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterAll, describe, expect, it } from 'vitest'
import {
  checkDocker,
  composeImages,
  composePull,
  imageExists,
  missingImages,
} from '../src/util/docker.js'
import { createPullTracker } from '../src/util/pullProgress.js'

const docker = await checkDocker()

// Tiny (a few kB) and unrelated to anything else the suite uses.
const TINY_IMAGE = 'hello-world:linux'

function composeDir(image: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cta-pull-'))
  writeFileSync(
    path.join(dir, 'docker-compose.yml'),
    `services:\n  probe:\n    image: ${image}\n`,
  )
  return dir
}

afterAll(async () => {
  if (docker.available) {
    await execa('docker', ['rmi', TINY_IMAGE], { reject: false }).catch(() => undefined)
  }
})

describe.skipIf(!docker.available)('image detection', () => {
  it('reads the images straight out of the compose file', async () => {
    expect(await composeImages(composeDir('typesense/typesense:30.2'))).toEqual([
      'typesense/typesense:30.2',
    ])
  })

  it('reports a nonexistent image as absent rather than throwing', async () => {
    expect(await imageExists('cta-does-not-exist/nope:1')).toBe(false)
  })

  it(
    'lists nothing missing when the image is already cached',
    async () => {
      await execa('docker', ['pull', TINY_IMAGE], { timeout: 120_000 })
      expect(await missingImages(composeDir(TINY_IMAGE))).toEqual([])
      expect(await imageExists(TINY_IMAGE)).toBe(true)
    },
    150_000,
  )

  it(
    'lists the image as missing once it is not cached',
    async () => {
      await execa('docker', ['rmi', TINY_IMAGE], { reject: false })
      expect(await missingImages(composeDir(TINY_IMAGE))).toEqual([TINY_IMAGE])
    },
    60_000,
  )
})

describe.skipIf(!docker.available)('composePull', () => {
  it(
    'streams progress lines that the tracker understands, and finishes',
    async () => {
      await execa('docker', ['rmi', TINY_IMAGE], { reject: false })
      // A warm pull emits only the two `Image ... Pulling/Pulled` lines and no
      // layer lines, so the layer assertion below is only meaningful cold.
      expect(await imageExists(TINY_IMAGE)).toBe(false)

      const dir = composeDir(TINY_IMAGE)
      const tracker = createPullTracker()
      const descriptions: string[] = []
      await composePull(dir, (line) => {
        if (tracker.ingest(line)) descriptions.push(tracker.describe(TINY_IMAGE))
      })

      // Something was reported, the tracker parsed it, and the image is now here.
      expect(descriptions.length).toBeGreaterThan(0)
      expect(tracker.snapshot().layers).toBeGreaterThan(0)
      expect(tracker.snapshot().done).toBe(true)
      expect(await imageExists(TINY_IMAGE)).toBe(true)
      expect(await missingImages(dir)).toEqual([])
    },
    180_000,
  )

  it('fails with a readable error for an image that does not exist', async () => {
    const dir = composeDir('cta-does-not-exist/nope:1')
    await expect(composePull(dir)).rejects.toThrow(/pull/i)
  }, 120_000)
})
