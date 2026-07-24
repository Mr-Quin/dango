// WebCrypto's typings reject Uint8Array<ArrayBufferLike>; allocating over a
// concrete ArrayBuffer is the workaround so subtle.* accepts our buffers.

import { Base64DecodeError } from './errors.js'

export function u8(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length))
}

export const ZERO_IV: Uint8Array<ArrayBuffer> = u8(16)

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const cleaned = b64.replace(/\s+/g, '')
  let binary: string
  try {
    binary = atob(cleaned)
  } catch (cause) {
    // atob throws a bare DOMException on invalid/odd-length input; wrap it so
    // callers see a typed engine error with context.
    throw new Base64DecodeError(cleaned, { cause })
  }
  const bytes = u8(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
