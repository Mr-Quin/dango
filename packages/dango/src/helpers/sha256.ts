import { u8 } from './_subtle-bytes.js'

/** Base64 of the SHA-256 digest of a UTF-8 string. For API signing schemes
 * like DanDanPlay's `Base64(SHA256(appId + timestamp + path + appSecret))`. */
export async function sha256Base64(input: string): Promise<string> {
  const msg = new TextEncoder().encode(input)
  const buf = u8(msg.length)
  buf.set(msg)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  let binary = ''
  for (const b of digest) binary += String.fromCharCode(b)
  return btoa(binary)
}
