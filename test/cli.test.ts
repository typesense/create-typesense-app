import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInteractive, parseCliArgs } from '../src/cli.js'
import { DEFAULT_PORT, STATE_FILE } from '../src/constants.js'
import { validateProjectName, validateTargetDir } from '../src/prompts.js'

describe('parseCliArgs', () => {
  it('defaults to an interactive run with no directory', () => {
    expect(parseCliArgs([])).toEqual({
      projectName: undefined,
      templateId: undefined,
      port: DEFAULT_PORT,
      yes: false,
      help: false,
      version: false,
    })
  })

  it('reads a positional directory and short flags', () => {
    expect(parseCliArgs(['my-app', '-t', 'astro', '-y'])).toMatchObject({
      projectName: 'my-app',
      templateId: 'astro',
      yes: true,
    })
  })

  it('parses --port', () => {
    expect(parseCliArgs(['--port', '9108']).port).toBe(9108)
  })

  it.each([['0'], ['70000'], ['abc'], ['8108.5'], ['']])('rejects --port %s', (value) => {
    expect(() => parseCliArgs(['--port', value])).toThrow(/--port must be an integer/)
  })

  it('rejects an unknown template before any prompting happens', () => {
    expect(() => parseCliArgs(['-t', 'svelte'])).toThrow(/Unknown template "svelte"/)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseCliArgs(['--vector-search'])).toThrow()
  })

  it('rejects more than one directory argument', () => {
    expect(() => parseCliArgs(['a', 'b'])).toThrow(/at most one directory argument/)
  })
})

describe('isInteractive', () => {
  // Regression: @clack/prompts exports isTTY as a function, so `!isTTY` is always
  // false and a piped run would fall through to a prompt that can never resolve.
  it('is true only for a real stdin TTY outside CI', () => {
    expect(isInteractive({ isTTY: true }, false)).toBe(true)
  })

  it('is false when stdin is piped', () => {
    expect(isInteractive({ isTTY: undefined }, false)).toBe(false)
    expect(isInteractive({ isTTY: false }, false)).toBe(false)
  })

  it('is false in CI even with a TTY', () => {
    expect(isInteractive({ isTTY: true }, true)).toBe(false)
  })
})

describe('validateProjectName', () => {
  it.each(['my-search-app', 'app', 'my_app', 'app.v2', 'a1'])('accepts %s', (name) => {
    expect(validateProjectName(name)).toBeUndefined()
  })

  it.each([
    ['', /required/],
    ['   ', /required/],
    ['my/app', /single directory name/],
    ['..', /real directory name/],
    ['.hidden', /cannot start with a dot/],
    ['MyApp', /lowercase/],
    ['my app', /lowercase letters/],
  ])('rejects %s', (name, match) => {
    expect(validateProjectName(name)).toMatch(match)
  })
})

describe('validateTargetDir', () => {
  function scratch(): string {
    return mkdtempSync(path.join(tmpdir(), 'cta-test-'))
  }

  it('accepts a path that does not exist', () => {
    expect(validateTargetDir(path.join(scratch(), 'fresh'))).toBeUndefined()
  })

  it('accepts an empty directory', () => {
    expect(validateTargetDir(scratch())).toBeUndefined()
  })

  it('accepts a directory holding only our resume state, so re-runs work', () => {
    const dir = scratch()
    writeFileSync(path.join(dir, STATE_FILE), '{}')
    mkdirSync(path.join(dir, '.git'))
    expect(validateTargetDir(dir)).toBeUndefined()
  })

  it('rejects a non-empty directory', () => {
    const dir = scratch()
    writeFileSync(path.join(dir, 'package.json'), '{}')
    expect(validateTargetDir(dir)).toMatch(/is not empty \(1 entry\)/)
  })

  it('rejects an existing file', () => {
    const dir = scratch()
    const file = path.join(dir, 'my-app')
    writeFileSync(file, '')
    expect(validateTargetDir(file)).toMatch(/is not a directory/)
  })
})
