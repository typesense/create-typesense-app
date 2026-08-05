/**
 * First-run failures worth explaining. Anyone who already runs Typesense on 8108
 * hits the port clash immediately, and docker's own wording ("driver failed
 * programming external connectivity on endpoint ... Bind for 0.0.0.0:8108
 * failed") gives them nothing to act on.
 */
import { describe, expect, it } from 'vitest'
import { describeStartFailure } from '../src/steps/server.js'

const REAL_DOCKER_ERROR = `\`docker compose up --detach\` failed:
Network my-app_default  Creating
Network my-app_default  Created
Container my-app-typesense  Creating
Container my-app-typesense  Starting
Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint my-app-typesense (a37d49a0): Bind for 0.0.0.0:8108 failed: port is already allocated`

describe('describeStartFailure', () => {
  it('recognises a port clash and says what to do about it', () => {
    const message = describeStartFailure(REAL_DOCKER_ERROR, 8108)
    expect(message).toMatch(/8108 is already in use/i)
    expect(message).toContain('--port')
  })

  it('names the port that was actually requested', () => {
    expect(describeStartFailure(REAL_DOCKER_ERROR.replace(/8108/g, '9108'), 9108)).toContain('9108')
  })

  it.each([
    'Bind for 0.0.0.0:8108 failed: port is already allocated',
    'listen tcp 0.0.0.0:8108: bind: address already in use',
    'Ports are not available: exposing port TCP 0.0.0.0:8108 -> 127.0.0.1:0',
  ])('recognises the clash from docker phrasing: %s', (stderr) => {
    expect(describeStartFailure(stderr, 8108)).toMatch(/already in use/i)
  })

  it('mentions an existing Typesense as the likely cause', () => {
    expect(describeStartFailure(REAL_DOCKER_ERROR, 8108)).toMatch(/already have one running|Typesense/i)
  })

  it('passes anything it does not recognise through untouched', () => {
    const other = '`docker compose up --detach` failed:\nno space left on device'
    expect(describeStartFailure(other, 8108)).toBe(other)
  })

  it('keeps the original docker output available for diagnosis', () => {
    expect(describeStartFailure(REAL_DOCKER_ERROR, 8108)).toContain('port is already allocated')
  })
})
