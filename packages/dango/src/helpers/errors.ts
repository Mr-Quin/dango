/**
 * Raised when a codec/crypto helper is handed input that is not valid base64.
 * The native `atob` throws a bare `DOMException` (InvalidCharacterError) with no
 * context; wrapping it lets a junk or empty upstream field (a common shape:
 * JSONata stringifies a missing field to the literal "undefined") classify as a
 * typed engine error instead of an opaque platform exception.
 */
export class Base64DecodeError extends Error {
  constructor(input: string, options?: { cause?: unknown }) {
    super(`invalid base64 input (${describeInput(input)})`, options)
    this.name = 'Base64DecodeError'
  }
}

/** Bounded, non-leaky description of the offending input for the message. */
function describeInput(input: string): string {
  if (input.length === 0) {
    return 'empty string'
  }
  const preview = input.length > 16 ? `${input.slice(0, 16)}…` : input
  return `length ${input.length}, starts "${preview}"`
}
