import { describe, expect, it } from 'vitest'
import { generateAdminKey } from '../src/util/apiKey.js'

describe('generateAdminKey', () => {
  it('returns a 43-character key (256 bits of entropy, base64url)', () => {
    expect(generateAdminKey()).toHaveLength(43)
  })

  it('uses only URL-safe base64 characters', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateAdminKey()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  /**
   * The key is interpolated into a compose command and an env file, so anything
   * needing quoting there would break the container start in a way that is
   * miserable to debug.
   */
  it('never contains characters that need shell or env-file quoting', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateAdminKey()).not.toMatch(/["'`$\\\s#=]/)
    }
  })

  it('generates a distinct key every time', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateAdminKey()))
    expect(keys.size).toBe(500)
  })

  it('is not a hardcoded constant', () => {
    expect(generateAdminKey()).not.toBe(generateAdminKey())
  })
})
