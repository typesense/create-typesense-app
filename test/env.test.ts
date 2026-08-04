import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  connectionEnvValues,
  envVarName,
  parseEnvContents,
  readEnvFile,
  upsertEnvContents,
  writeEnvFile,
} from '../src/steps/env.js'
import { ADMIN_KEY_VAR, HOST_VAR, PUBLIC_ENV_VARS, SEARCH_KEY_VAR } from '../src/constants.js'

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'cta-env-'))
}

describe('envVarName', () => {
  // THE hard rule. Publicness is looked up, not passed in, so a caller cannot
  // mark the admin key browser-visible by mistake.
  it.each(['NEXT_PUBLIC_', 'PUBLIC_'])('never prefixes the admin key with %s', (prefix) => {
    expect(envVarName(ADMIN_KEY_VAR, prefix)).toBe(ADMIN_KEY_VAR)
  })

  it('prefixes the search-only key', () => {
    expect(envVarName(SEARCH_KEY_VAR, 'NEXT_PUBLIC_')).toBe(`NEXT_PUBLIC_${SEARCH_KEY_VAR}`)
    expect(envVarName(SEARCH_KEY_VAR, 'PUBLIC_')).toBe(`PUBLIC_${SEARCH_KEY_VAR}`)
  })

  it('prefixes the non-secret connection details', () => {
    expect(envVarName(HOST_VAR, 'PUBLIC_')).toBe(`PUBLIC_${HOST_VAR}`)
  })

  it('rejects a name that is on neither list, rather than guessing', () => {
    expect(() => envVarName('TYPESENSE_MYSTERY', 'PUBLIC_')).toThrow(/TYPESENSE_MYSTERY/)
  })
})

describe('upsertEnvContents', () => {
  it('writes a new variable into empty content', () => {
    const result = upsertEnvContents('', { [ADMIN_KEY_VAR]: 'abc123' }, 'NEXT_PUBLIC_')
    expect(result).toContain(`${ADMIN_KEY_VAR}=abc123`)
  })

  it('replaces an existing value instead of appending a duplicate', () => {
    const existing = `${ADMIN_KEY_VAR}=old\n`
    const result = upsertEnvContents(existing, { [ADMIN_KEY_VAR]: 'new' }, 'NEXT_PUBLIC_')
    expect(result).toContain(`${ADMIN_KEY_VAR}=new`)
    expect(result).not.toContain('old')
    expect(result.match(new RegExp(`^${ADMIN_KEY_VAR}=`, 'gm'))).toHaveLength(1)
  })

  it("preserves lines it does not own, including the framework's own vars", () => {
    const existing = '# my notes\nSOME_OTHER_VAR=keep-me\n'
    const result = upsertEnvContents(existing, { [ADMIN_KEY_VAR]: 'abc' }, 'NEXT_PUBLIC_')
    expect(result).toContain('# my notes')
    expect(result).toContain('SOME_OTHER_VAR=keep-me')
  })

  it('is idempotent — applying twice equals applying once', () => {
    const once = upsertEnvContents('', { [ADMIN_KEY_VAR]: 'abc' }, 'NEXT_PUBLIC_')
    const twice = upsertEnvContents(once, { [ADMIN_KEY_VAR]: 'abc' }, 'NEXT_PUBLIC_')
    expect(twice).toBe(once)
  })

  it('does not confuse a prefixed variable with its unprefixed namesake', () => {
    const result = upsertEnvContents(
      '',
      { [ADMIN_KEY_VAR]: 'secret', [SEARCH_KEY_VAR]: 'public' },
      'NEXT_PUBLIC_',
    )
    expect(result).toMatch(new RegExp(`^${ADMIN_KEY_VAR}=secret$`, 'm'))
    expect(result).toMatch(new RegExp(`^NEXT_PUBLIC_${SEARCH_KEY_VAR}=public$`, 'm'))
    expect(result).not.toMatch(new RegExp(`^${SEARCH_KEY_VAR}=`, 'm'))
  })

  it('refuses a value containing a newline, which would inject another variable', () => {
    expect(() =>
      upsertEnvContents('', { [ADMIN_KEY_VAR]: `abc\nNEXT_PUBLIC_${ADMIN_KEY_VAR}=leaked` }, 'NEXT_PUBLIC_'),
    ).toThrow(/newline/i)
  })

  it('ends with a single trailing newline', () => {
    const result = upsertEnvContents('', { [ADMIN_KEY_VAR]: 'abc' }, 'NEXT_PUBLIC_')
    expect(result.endsWith('\n')).toBe(true)
    expect(result.endsWith('\n\n')).toBe(false)
  })
})

describe('writeEnvFile', () => {
  it('creates the file, and the admin key lands unprefixed', async () => {
    const file = path.join(scratch(), '.env.local')
    await writeEnvFile(file, { [ADMIN_KEY_VAR]: 'abc123' }, 'NEXT_PUBLIC_')
    const contents = readFileSync(file, 'utf8')
    expect(contents).toMatch(new RegExp(`^${ADMIN_KEY_VAR}=abc123$`, 'm'))
    expect(contents).not.toContain(`NEXT_PUBLIC_${ADMIN_KEY_VAR}`)
  })

  it('updates an existing file in place without losing its other contents', async () => {
    const file = path.join(scratch(), '.env')
    writeFileSync(file, 'EXISTING=1\n')
    await writeEnvFile(file, { [ADMIN_KEY_VAR]: 'abc' }, 'PUBLIC_')
    const contents = readFileSync(file, 'utf8')
    expect(contents).toContain('EXISTING=1')
    expect(contents).toContain(`${ADMIN_KEY_VAR}=abc`)
  })

  it('creates missing parent directories', async () => {
    const file = path.join(scratch(), 'deep', 'my-app', '.env.local')
    await writeEnvFile(file, { [ADMIN_KEY_VAR]: 'abc' }, 'NEXT_PUBLIC_')
    expect(readFileSync(file, 'utf8')).toContain(ADMIN_KEY_VAR)
  })
})

describe('parseEnvContents', () => {
  it('reads a simple assignment', () => {
    expect(parseEnvContents(`${ADMIN_KEY_VAR}=abc\n`)).toEqual({ [ADMIN_KEY_VAR]: 'abc' })
  })

  it('ignores comments and blank lines', () => {
    expect(parseEnvContents(`# a comment\n\n${ADMIN_KEY_VAR}=abc\n`)).toEqual({
      [ADMIN_KEY_VAR]: 'abc',
    })
  })

  it('tolerates an export prefix and surrounding whitespace', () => {
    expect(parseEnvContents(`  export ${ADMIN_KEY_VAR}=abc  \n`)).toEqual({
      [ADMIN_KEY_VAR]: 'abc',
    })
  })

  it('keeps prefixed and unprefixed variables separate', () => {
    const parsed = parseEnvContents(`${ADMIN_KEY_VAR}=secret\nNEXT_PUBLIC_${SEARCH_KEY_VAR}=pub\n`)
    expect(parsed[ADMIN_KEY_VAR]).toBe('secret')
    expect(parsed[`NEXT_PUBLIC_${SEARCH_KEY_VAR}`]).toBe('pub')
  })

  it('returns an empty object for empty content', () => {
    expect(parseEnvContents('')).toEqual({})
  })

  it('round-trips what upsertEnvContents writes', () => {
    const written = upsertEnvContents('', { [ADMIN_KEY_VAR]: 'abc123' }, 'NEXT_PUBLIC_')
    expect(parseEnvContents(written)[ADMIN_KEY_VAR]).toBe('abc123')
  })
})

describe('readEnvFile', () => {
  it('returns an empty object when the file does not exist yet', async () => {
    expect(await readEnvFile(path.join(scratch(), 'nope.env'))).toEqual({})
  })

  it('reads back what writeEnvFile wrote', async () => {
    const file = path.join(scratch(), '.env.local')
    await writeEnvFile(file, { [ADMIN_KEY_VAR]: 'abc' }, 'NEXT_PUBLIC_')
    expect((await readEnvFile(file))[ADMIN_KEY_VAR]).toBe('abc')
  })
})

describe('connectionEnvValues', () => {
  it('splits a local URL into host, port and protocol', () => {
    expect(connectionEnvValues('http://127.0.0.1:8108', 'books', 'search-key')).toEqual({
      TYPESENSE_HOST: '127.0.0.1',
      TYPESENSE_PORT: '8108',
      TYPESENSE_PROTOCOL: 'http',
      TYPESENSE_COLLECTION: 'books',
      TYPESENSE_SEARCH_ONLY_API_KEY: 'search-key',
    })
  })

  it('fills in 443 for an https URL with no explicit port', () => {
    const values = connectionEnvValues('https://abc.a1.typesense.net', 'books', 'k')
    expect(values).toMatchObject({
      TYPESENSE_HOST: 'abc.a1.typesense.net',
      TYPESENSE_PORT: '443',
      TYPESENSE_PROTOCOL: 'https',
    })
  })

  it('fills in 80 for a bare http URL', () => {
    expect(connectionEnvValues('http://localhost', 'books', 'k').TYPESENSE_PORT).toBe('80')
  })

  it('keeps an explicit non-default port', () => {
    expect(connectionEnvValues('https://example.com:9443', 'books', 'k').TYPESENSE_PORT).toBe('9443')
  })

  it('never emits the admin key', () => {
    const values = connectionEnvValues('http://127.0.0.1:8108', 'books', 'search-key')
    expect(Object.keys(values)).not.toContain(ADMIN_KEY_VAR)
  })

  it('emits only names the public list knows, so every one gets prefixed', () => {
    const values = connectionEnvValues('http://127.0.0.1:8108', 'books', 'k')
    for (const name of Object.keys(values)) {
      expect(PUBLIC_ENV_VARS).toContain(name)
    }
  })

  it('round-trips through the writer with every value prefixed', () => {
    const values = connectionEnvValues('http://127.0.0.1:8108', 'books', 'search-key')
    const contents = upsertEnvContents('', values, 'NEXT_PUBLIC_')
    for (const name of Object.keys(values)) {
      expect(contents).toMatch(new RegExp(`^NEXT_PUBLIC_${name}=`, 'm'))
    }
  })

  it('rejects a URL it cannot parse rather than writing rubbish', () => {
    expect(() => connectionEnvValues('not-a-url', 'books', 'k')).toThrow()
  })
})
