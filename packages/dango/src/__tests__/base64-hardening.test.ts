import { describe, expect, it } from 'bun:test'
import { aesCbcDecrypt } from '../helpers/aes-cbc.js'
import { Base64DecodeError } from '../helpers/errors.js'
import { helpers } from '../helpers/registry.js'

/**
 * Bad base64 reaching a crypto/codec helper (e.g. an empty upstream field that
 * JSONata stringifies to "undefined" and hands to $aesCbcDecrypt) used to
 * surface as a raw DOMException from atob(). These pin that it now raises a
 * typed Base64DecodeError with context, so junk upstream responses classify
 * cleanly instead of crashing opaquely.
 */

// Valid AES-128 key/IV (NIST SP 800-38A F.2), so the decrypt reaches the
// ciphertext-decode step rather than failing on key/IV first.
const KEY = 'K34VFiiu0qar9xWICc9PPA=='
const IV = 'AAECAwQFBgcICQoLDA0ODw=='

describe('base64 helper hardening', () => {
  it('aesCbcDecrypt rejects invalid-base64 ciphertext with a typed error', async () => {
    await expect(
      aesCbcDecrypt('undefined', KEY, IV, 'none')
    ).rejects.toBeInstanceOf(Base64DecodeError)
  })

  it('base64Decode helper throws a typed error on invalid input', () => {
    expect(() => helpers.base64Decode('@@not base64@@')).toThrow(
      Base64DecodeError
    )
  })

  it('the typed error names the failing decode and bounds the offending input', () => {
    try {
      helpers.base64Decode('@'.repeat(500))
      throw new Error('expected Base64DecodeError')
    } catch (err) {
      expect(err).toBeInstanceOf(Base64DecodeError)
      const message = (err as Error).message
      expect(message).toContain('base64')
      // The message must not echo the whole (potentially huge) input back.
      expect(message.length).toBeLessThan(200)
    }
  })
})
