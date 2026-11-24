import { log } from '@clack/prompts'
import { execa } from 'execa'
import pc from 'picocolors'
import type { TemplateManifest } from '../templates.js'

const START_TIMEOUT_MS = 120_000

/** True when anything answers HTTP at the URL. */
async function answers(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  )
}

/** Opens the URL in the default browser. Never throws: the URL is printed anyway. */
export async function openBrowser(url: string): Promise<boolean> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    await execa(command, args, { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Starts the generated project's dev server in the foreground and opens its page
 * once it answers. Returns when the dev server stops, for example on Ctrl+C.
 *
 * A program cannot change the directory of the shell that started it, so the
 * last line tells the developer where the project is.
 */
export async function runDevServer(
  projectName: string,
  targetDir: string,
  template: TemplateManifest,
): Promise<void> {
  const { devCommand, devUrl } = template
  const again = `cd ${projectName} && ${devCommand}`

  // Another program on the port would answer instead, and the framework would
  // quietly move the new dev server to the next port.
  if (await answers(devUrl)) {
    log.warn(
      `${devUrl} already answers, so the dev server was not started. Stop that program, then run:\n${again}`,
    )
    return
  }

  log.step(`Starting ${pc.bold(devCommand)} in ${projectName}. Press Ctrl+C to stop it.`)
  const [command = 'npm', ...args] = devCommand.split(' ')
  const dev = execa(command, args, { cwd: targetDir, stdio: 'inherit', reject: false })

  // In a terminal, Ctrl+C reaches the dev server too. Pass the signal on anyway,
  // for a signal sent to this process alone, then wait for the dev server to stop
  // instead of exiting first, so the last line below still prints.
  const stop = () => {
    dev.kill('SIGINT')
  }
  process.on('SIGINT', stop)

  const deadline = Date.now() + START_TIMEOUT_MS
  let running = true
  void dev.finally(() => {
    running = false
  })
  while (running && Date.now() < deadline) {
    if (await answers(devUrl)) {
      if (!(await openBrowser(devUrl))) log.info(`Open ${devUrl} in your browser.`)
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  await dev
  process.off('SIGINT', stop)
  log.info(`The dev server stopped. To start it again: ${pc.bold(again)}`)
}
