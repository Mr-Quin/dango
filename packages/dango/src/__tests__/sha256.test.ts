import { describe, expect, it } from 'bun:test'
import { sha256Base64 } from '../helpers/sha256.js'

/**
 * Pins sha256Base64 against the NIST "abc" vector (base64 of the well-known
 * SHA-256 digest) and checks the empty-string digest, covering the helper used
 * by signed sources like DanDanPlay.
 */

describe('sha256Base64', () => {
  it('matches the SHA-256 "abc" digest in base64', async () => {
    expect(await sha256Base64('abc')).toBe(
      'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='
    )
  })

  it('matches the SHA-256 empty-string digest in base64', async () => {
    expect(await sha256Base64('')).toBe(
      '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
    )
  })
})
