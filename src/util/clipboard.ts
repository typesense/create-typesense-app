import { log } from '@clack/prompts'
import { execa } from 'execa'

const TOOLS: [string, string[]][] = [
  ['pbcopy', []],
  ['clip', []],
  ['wl-copy', []],
  ['xclip', ['-selection', 'clipboard']],
]

/** Copies text with the first clipboard tool that works. Never throws. */
export async function copyToClipboard(text: string): Promise<boolean> {
  for (const [command, args] of TOOLS) {
    try {
      await execa(command, args, { input: text, timeout: 2_000 })
      return true
    } catch {
      // Not installed or failed: try the next tool.
    }
  }
  return false
}

/**
 * Prints a command with no clack `│` prefix, so a terminal selection pastes
 * cleanly, and copies it to the clipboard.
 */
export async function showCommand(command: string): Promise<void> {
  process.stdout.write(`\n${command}\n\n`)
  if (await copyToClipboard(command)) log.info('Copied to the clipboard.')
}

/** An error whose fix is a command, kept apart from the message so it prints unprefixed. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
