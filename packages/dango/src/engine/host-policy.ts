// Blocks danmaku manifests from targeting the local network or loopback.
// Engine code must stay platform-agnostic, so detection is pure string /
// numeric parsing with no DNS resolution.

type Ipv4Octets = [number, number, number, number]

function parseIpv4Octets(host: string): Ipv4Octets | null {
  const parts = host.split('.')
  if (parts.length !== 4) {
    return null
  }
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }
    const n = Number(part)
    if (n > 255) {
      return null
    }
    octets.push(n)
  }
  return octets as Ipv4Octets
}

function isPrivateIpv4(host: string): boolean {
  const octets = parseIpv4Octets(host)
  if (octets === null) {
    return false
  }
  const [a, b] = octets
  if (a === 127) {
    return true
  }
  if (a === 10) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  return false
}

function normalizeIpv6(host: string): string {
  // URL hostnames bracket IPv6 literals; strip brackets and any zone id.
  let h = host
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1)
  }
  const zoneIndex = h.indexOf('%')
  if (zoneIndex !== -1) {
    h = h.slice(0, zoneIndex)
  }
  return h.toLowerCase()
}

function isLoopbackIpv6(host: string): boolean {
  const h = normalizeIpv6(host)
  return h === '::1' || h === '0:0:0:0:0:0:0:1'
}

/**
 * True if a concrete hostname targets loopback, link-local, or a private
 * network range. Operates on already-resolved hostnames (no wildcards).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true
  }
  if (host.endsWith('.local')) {
    return true
  }
  if (isLoopbackIpv6(host)) {
    return true
  }
  return isPrivateIpv4(host)
}

/**
 * True if a manifest `hosts` allowlist entry would permit a private host.
 * Rejects bare private hostnames and any wildcard whose suffix is private
 * (e.g. `*.local`, `*.localhost`). The literal `*` is allowed: request-time
 * host matching still rejects private resolved hosts.
 */
export function isPrivateHostPattern(pattern: string): boolean {
  if (pattern === '*') {
    return false
  }
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return isPrivateHost(suffix) || suffix === 'local' || suffix === 'localhost'
  }
  return isPrivateHost(pattern)
}
