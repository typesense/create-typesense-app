import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TYPESENSE_IMAGE } from '../src/constants.js'
import { composeFileContents, composeProjectName } from '../src/steps/compose.js'
import { buildScaffoldCommand, scaffoldInvocation } from '../src/steps/scaffold.js'
import { parseImportResponse } from '../src/steps/seed.js'
import { loadTemplate } from '../src/templates.js'

/** The commands the CLI runs and the files it generates for the project. */

describe('the import result', () => {
  it('counts each failed document, because a 200 reply can still hold failures', () => {
    expect(
      parseImportResponse('{"success":true}\n{"success":false,"error":"bad field"}\nnot json\n\n'),
    ).toEqual({
      imported: 1,
      failed: 2,
      errors: ['bad field', 'A response line could not be parsed: not json'],
    })
  })
})

describe('the scaffold command', () => {
  it('keeps a directory name with spaces as one argument', () => {
    expect(
      buildScaffoldCommand('npm create vite@latest {{dir}} -- --template vanilla', 'my app'),
    ).toEqual({
      command: 'npm',
      args: ['create', 'vite@latest', 'my app', '--', '--template', 'vanilla'],
    })
  })

  it('refuses a command without the {{dir}} placeholder', () => {
    expect(() => buildScaffoldCommand('npm create vite@latest', 'app')).toThrow(/\{\{dir\}\}/)
  })

  it('passes a bare directory name and runs in the parent directory', async () => {
    // create-vite treats an absolute path as relative to the current directory.
    const target = path.join(path.sep, 'work', 'projects', 'my-app')
    const { args, cwd } = scaffoldInvocation(await loadTemplate('vanilla'), target)
    expect(args).toContain('my-app')
    expect(args.some((arg) => arg.includes(path.sep))).toBe(false)
    expect(cwd).toBe(path.dirname(target))
  })
})

describe('docker-compose.yml', () => {
  const contents = composeFileContents({
    projectName: 'my-app',
    targetDir: '/work/my-app',
    port: 8200,
    envFile: '.env.local',
  })

  it('starts the pinned image with CORS on, on the chosen port', () => {
    expect(contents).toContain(`image: ${TYPESENSE_IMAGE}`)
    expect(contents).toContain('"--enable-cors"')
    expect(contents).toContain('"8200:8108"')
  })

  it('reads the key from the env file, and never holds a key or a variable itself', () => {
    expect(contents).toMatch(/env_file:\n\s+- \.env\.local/)
    expect(contents).not.toContain('${')
    expect(contents).not.toMatch(/--api-key/)
  })

  it('gives two projects with the same name in different folders their own containers', () => {
    expect(composeProjectName('my-app', '/a/my-app')).not.toBe(
      composeProjectName('my-app', '/b/my-app'),
    )
    expect(composeProjectName('My.App', '/a/My.App')).toMatch(/^my-app-[0-9a-f]{6}$/)
  })
})
