import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCliArgs, validateServerUrl } from '../src/cli.js'
import { DEFAULT_PORT } from '../src/constants.js'
import { validateProjectName, validateTargetDir } from '../src/prompts.js'
import { markRunStarted } from '../src/util/state.js'

/** What the CLI accepts from the command line and the first prompts. */

describe('command-line flags', () => {
  it('reads a full set of flags', () => {
    expect(
      parseCliArgs([
        'my-app',
        '-t',
        'vue',
        '--yes',
        '--server-url',
        'https://xyz.a1.typesense.net/',
        '--collections',
        ' movies, ,films ',
        '--api-key-stdin',
      ]),
    ).toMatchObject({
      projectName: 'my-app',
      templateId: 'vue',
      yes: true,
      serverUrl: 'https://xyz.a1.typesense.net',
      collections: ['movies', 'films'],
      apiKeyStdin: true,
      port: DEFAULT_PORT,
    })
  })

  it('rejects flags that cannot work, with a message that says why', () => {
    expect(() => parseCliArgs(['-t', 'ember'])).toThrow(/Unknown template "ember"/)
    expect(() => parseCliArgs(['--port', '70000'])).toThrow(/between 1 and 65535/)
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/between 1 and 65535/)
    expect(() => parseCliArgs(['--collections', 'movies'])).toThrow(/needs --server-url/)
    expect(() => parseCliArgs(['--server-url', 'ftp://host'])).toThrow(/--server-url/)
    expect(() => parseCliArgs(['one', 'two'])).toThrow(/at most one directory/)
    // A key value as a flag would land in shell history.
    expect(() => parseCliArgs(['--api-key', 'secret'])).toThrow()
  })

  it('tells a user of the removed --dataset empty what to do, and still accepts --dataset books', () => {
    expect(() => parseCliArgs(['--dataset', 'empty'])).toThrow(/empty dataset was removed/)
    expect(() => parseCliArgs(['--dataset', 'books'])).not.toThrow()
  })
})

describe('the server URL', () => {
  it('accepts http and https URLs only', () => {
    expect(validateServerUrl('http://localhost:8108')).toBeUndefined()
    expect(validateServerUrl('https://xyz.a1.typesense.net')).toBeUndefined()
    expect(validateServerUrl('')).toMatch(/required/)
    expect(validateServerUrl('localhost:8108')).toBeDefined()
    expect(validateServerUrl('ftp://host')).toMatch(/http/)
  })
})

describe('the project name', () => {
  it('accepts a name that is a valid npm package and directory name', () => {
    expect(validateProjectName('my-search-app')).toBeUndefined()
    expect(validateProjectName('app_2.0')).toBeUndefined()
  })

  it('rejects names that are empty, a path, hidden, or not lowercase', () => {
    expect(validateProjectName('  ')).toMatch(/required/)
    expect(validateProjectName('a/b')).toMatch(/not a path/)
    expect(validateProjectName('..')).toBeDefined()
    expect(validateProjectName('.app')).toMatch(/dot/)
    expect(validateProjectName('My App')).toMatch(/lowercase/)
  })
})

describe('the project directory', () => {
  async function dirWith(files: string[]): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'cta-dir-'))
    for (const file of files) await writeFile(path.join(dir, file), '')
    return dir
  }

  it('accepts a directory that does not exist yet, or that holds only files from an earlier run', async () => {
    expect(validateTargetDir(path.join(tmpdir(), 'cta-does-not-exist', 'app'))).toBeUndefined()
    const leftovers = await dirWith(['.env', '.env.local', 'docker-compose.yml'])
    await mkdir(path.join(leftovers, 'data'))
    expect(validateTargetDir(leftovers)).toBeUndefined()
  })

  it("refuses a directory that holds someone else's files", async () => {
    expect(validateTargetDir(await dirWith(['index.html', 'package.json']))).toMatch(
      /is not empty \(2 entries\)/,
    )
  })

  it('resumes a directory where an earlier run started and failed, whatever it holds', async () => {
    const dir = await dirWith(['package.json', 'next.config.ts'])
    await markRunStarted(dir, { version: 1, template: 'nextjs' })
    expect(validateTargetDir(dir)).toBeUndefined()
  })
})
