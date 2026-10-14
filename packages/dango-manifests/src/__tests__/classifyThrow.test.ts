import { describe, expect, it } from 'bun:test'
import {
  AbortedError,
  HostNotAllowedError,
  HttpStatusError,
  NetworkError,
} from '@mr-quin/dango'
import { classifyThrow } from '../../scripts/classifyThrow.js'

const TARGET = 'https://api.example.com/x'

describe('health classifyThrow', () => {
  it('reports a geo-block status as blocked and other statuses as broken', () => {
    expect(classifyThrow(new HttpStatusError(451, TARGET)).verdict).toBe(
      'blocked'
    )
    expect(classifyThrow(new HttpStatusError(403, TARGET)).verdict).toBe(
      'blocked'
    )
    expect(classifyThrow(new HttpStatusError(500, TARGET))).toMatchObject({
      verdict: 'broken',
      note: `HTTP 500 for ${TARGET}`,
    })
  })

  it('reports an unreachable network as blocked from the cause message', () => {
    const cause = new Error('connect ECONNREFUSED 1.2.3.4:443')
    expect(classifyThrow(new NetworkError(TARGET, { cause })).verdict).toBe(
      'blocked'
    )
  })

  it('reports an unreachable network as blocked from the cause code', () => {
    const cause = Object.assign(new TypeError('fetch failed'), {
      code: 'ECONNRESET',
    })
    expect(classifyThrow(new NetworkError(TARGET, { cause })).verdict).toBe(
      'blocked'
    )
  })

  it('reports any other network failure as broken', () => {
    const cause = new TypeError('certificate has expired')
    expect(classifyThrow(new NetworkError(TARGET, { cause })).verdict).toBe(
      'broken'
    )
  })

  it('reports an abort as a timeout and a rejected host as broken', () => {
    expect(classifyThrow(new AbortedError())).toMatchObject({
      verdict: 'broken',
      note: 'request timed out',
    })
    expect(
      classifyThrow(new HostNotAllowedError('host-not-allowed', TARGET)).verdict
    ).toBe('broken')
  })
})
