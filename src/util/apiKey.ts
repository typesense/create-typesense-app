import { randomBytes } from 'node:crypto'

/**
 * A fresh admin key per project — never a hardcoded default.
 *
 * base64url keeps the key free of characters that would need quoting in an env
 * file, a compose file or a shell command; 32 bytes gives 43 characters.
 */
export function generateAdminKey(): string {
  return randomBytes(32).toString('base64url')
}
