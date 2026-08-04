/**
 * The hard rule from CLAUDE.md, as a test.
 *
 * The env *file writer* arrives in M2. What can already be locked down is the
 * classification it will be driven by: which variables are browser-visible and
 * which are not. If those two lists ever overlap, the whole project is a security
 * anti-pattern (PLAN.md §6), so the assertion lives here from M0 onward.
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_KEY_VAR,
  PRIVATE_ENV_VARS,
  PUBLIC_ENV_VARS,
  SEARCH_KEY_VAR,
} from '../src/constants.js'
import { assertAdminKeyNeverPublic } from '../src/summary.js'
import { loadTemplates } from '../src/templates.js'

describe('admin key exposure', () => {
  it('never lists the admin key as browser-visible', () => {
    expect(PUBLIC_ENV_VARS).not.toContain(ADMIN_KEY_VAR)
  })

  it('keeps the public and private sets disjoint', () => {
    const overlap = PUBLIC_ENV_VARS.filter((name) =>
      (PRIVATE_ENV_VARS as readonly string[]).includes(name),
    )
    expect(overlap).toEqual([])
  })

  it('exposes the search-only key and nothing else secret', () => {
    expect(PUBLIC_ENV_VARS).toContain(SEARCH_KEY_VAR)
    const secrets = PUBLIC_ENV_VARS.filter(
      (name) => /KEY/.test(name) && name !== SEARCH_KEY_VAR,
    )
    expect(secrets).toEqual([])
  })

  it('passes the runtime guard for every template prefix', async () => {
    for (const template of await loadTemplates()) {
      expect(() => assertAdminKeyNeverPublic(template.env.publicPrefix)).not.toThrow()
    }
  })

  it('would produce no prefixed admin variable for any template', async () => {
    for (const template of await loadTemplates()) {
      const prefixed = PUBLIC_ENV_VARS.map((name) => `${template.env.publicPrefix}${name}`)
      expect(prefixed).not.toContain(`${template.env.publicPrefix}${ADMIN_KEY_VAR}`)
      for (const name of prefixed) {
        expect(name).not.toMatch(/ADMIN/)
      }
    }
  })
})
