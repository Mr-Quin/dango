import { describe, expect, it } from 'bun:test'
import { isPrivateHost, isPrivateHostPattern } from '../engine/host-policy.js'

/**
 * Exercises the private-host detector that blocks manifests from reaching the
 * local network or loopback. Asserts loopback/private/link-local ranges,
 * localhost and *.local names are rejected, while ordinary public hosts and
 * the catch-all `*` allowlist entry pass through.
 */

describe('isPrivateHost', () => {
  it('blocks loopback IPv4 across the whole /8', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('127.1.2.3')).toBe(true)
  })

  it('blocks 10/8, 172.16/12, 192.168/16, 169.254/16', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true)
    expect(isPrivateHost('172.16.0.1')).toBe(true)
    expect(isPrivateHost('172.31.255.255')).toBe(true)
    expect(isPrivateHost('192.168.1.1')).toBe(true)
    expect(isPrivateHost('169.254.1.1')).toBe(true)
  })

  it('does not block public IPv4 just outside the private ranges', () => {
    expect(isPrivateHost('172.15.0.1')).toBe(false)
    expect(isPrivateHost('172.32.0.1')).toBe(false)
    expect(isPrivateHost('192.169.0.1')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
  })

  it('blocks localhost and *.local / *.localhost names', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('LOCALHOST')).toBe(true)
    expect(isPrivateHost('printer.local')).toBe(true)
    expect(isPrivateHost('foo.localhost')).toBe(true)
  })

  it('blocks IPv6 loopback', () => {
    expect(isPrivateHost('::1')).toBe(true)
    expect(isPrivateHost('0:0:0:0:0:0:0:1')).toBe(true)
  })

  it('allows ordinary public hostnames', () => {
    expect(isPrivateHost('api.example.com')).toBe(false)
    expect(isPrivateHost('localhost.example.com')).toBe(false)
  })
})

describe('isPrivateHostPattern', () => {
  it('rejects bare private host entries', () => {
    expect(isPrivateHostPattern('localhost')).toBe(true)
    expect(isPrivateHostPattern('127.0.0.1')).toBe(true)
    expect(isPrivateHostPattern('192.168.0.10')).toBe(true)
  })

  it('rejects wildcard entries whose suffix is private', () => {
    expect(isPrivateHostPattern('*.local')).toBe(true)
    expect(isPrivateHostPattern('*.localhost')).toBe(true)
  })

  it('allows public host patterns and the catch-all', () => {
    expect(isPrivateHostPattern('api.example.com')).toBe(false)
    expect(isPrivateHostPattern('*.example.com')).toBe(false)
    expect(isPrivateHostPattern('*')).toBe(false)
  })
})
