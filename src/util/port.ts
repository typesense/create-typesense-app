import net from 'node:net'

/**
 * True when something accepts connections on 127.0.0.1:port.
 *
 * A connect probe rather than trying to bind: Docker publishes on 0.0.0.0, and
 * on macOS a test bind to one address can succeed beside a listener on another.
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.setTimeout(1_000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

/** The first port after `port` that nothing listens on. */
export async function nextFreePort(port: number): Promise<number> {
  const last = Math.min(port + 100, 65_535)
  for (let candidate = port + 1; candidate <= last; candidate++) {
    if (!(await isPortInUse(candidate))) return candidate
  }
  throw new Error(`No free port between ${port + 1} and ${last}. Pass one with --port.`)
}
