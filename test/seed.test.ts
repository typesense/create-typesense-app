/**
 * Typesense's bulk import answers with one JSON object per line rather than a
 * single status — a 200 can still mean every document failed. Misreading that
 * would report "Indexed 225 documents" over an empty collection, so the parsing
 * is pinned down here.
 */
import { describe, expect, it } from 'vitest'
import { parseImportResponse } from '../src/steps/seed.js'

describe('parseImportResponse', () => {
  it('counts a fully successful import', () => {
    const body = ['{"success":true}', '{"success":true}', '{"success":true}'].join('\n')
    expect(parseImportResponse(body)).toEqual({ imported: 3, failed: 0, errors: [] })
  })

  it('counts failures separately and keeps their messages', () => {
    const body = [
      '{"success":true}',
      '{"success":false,"error":"Field `publication_year` must be an int32.","document":"{\\"id\\":\\"9\\"}"}',
      '{"success":true}',
    ].join('\n')
    const outcome = parseImportResponse(body)
    expect(outcome.imported).toBe(2)
    expect(outcome.failed).toBe(1)
    expect(outcome.errors[0]).toContain('must be an int32')
  })

  it('treats an all-failed import as zero imported, not as success', () => {
    const body = [
      '{"success":false,"error":"Bad JSON."}',
      '{"success":false,"error":"Bad JSON."}',
    ].join('\n')
    expect(parseImportResponse(body)).toMatchObject({ imported: 0, failed: 2 })
  })

  it('ignores blank lines and trailing newlines', () => {
    expect(parseImportResponse('{"success":true}\n\n{"success":true}\n')).toMatchObject({
      imported: 2,
      failed: 0,
    })
  })

  it('handles an empty body', () => {
    expect(parseImportResponse('')).toEqual({ imported: 0, failed: 0, errors: [] })
  })

  it('counts an unparseable line as a failure rather than throwing', () => {
    const outcome = parseImportResponse('{"success":true}\n<html>gateway timeout')
    expect(outcome.imported).toBe(1)
    expect(outcome.failed).toBe(1)
    expect(outcome.errors.join(' ')).toMatch(/gateway timeout|could not be parsed/i)
  })

  it('keeps only a handful of error messages, so the output stays readable', () => {
    const body = Array.from({ length: 50 }, () => '{"success":false,"error":"nope"}').join('\n')
    const outcome = parseImportResponse(body)
    expect(outcome.failed).toBe(50)
    expect(outcome.errors.length).toBeLessThanOrEqual(5)
  })
})
