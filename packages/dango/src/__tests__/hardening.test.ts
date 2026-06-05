import { describe, expect, it } from 'bun:test'
import { runPipeline } from '../engine/runner.js'
import { zManifest } from '../manifest/schema.js'
import { mockFetcher } from './fixtures.js'

/**
 * Engine hardening guards: private-host rejection at manifest load and at
 * request time, the fixed response body size cap, and the fixed forEach.in
 * length cap. Each guard is asserted both ways: a rejection case and a
 * within-limit case that passes through unchanged.
 */

function baseManifest(overrides: Record<string, unknown>) {
  return zManifest.parse({
    apiVersion: 1,
    id: 'test',
    name: 'test',
    version: '0.1.0',
    hosts: ['api.example.com'],
    ...overrides,
  })
}

describe('private host rejection at manifest load', () => {
  it('rejects a hosts entry of localhost', () => {
    expect(() =>
      baseManifest({
        hosts: ['localhost'],
        search: {
          inputs: [],
          steps: [{ type: 'assign', id: 'x', values: { a: '1' } }],
          output: '[]',
        },
      })
    ).toThrow(/private\/loopback/)
  })

  it('rejects a private IPv4 hosts entry', () => {
    expect(() =>
      baseManifest({
        hosts: ['192.168.1.10'],
        search: {
          inputs: [],
          steps: [{ type: 'assign', id: 'x', values: { a: '1' } }],
          output: '[]',
        },
      })
    ).toThrow(/private\/loopback/)
  })

  it('rejects a *.local wildcard hosts entry', () => {
    expect(() =>
      baseManifest({
        hosts: ['*.local'],
        search: {
          inputs: [],
          steps: [{ type: 'assign', id: 'x', values: { a: '1' } }],
          output: '[]',
        },
      })
    ).toThrow(/private\/loopback/)
  })

  it('accepts a public hosts entry', () => {
    expect(() =>
      baseManifest({
        hosts: ['api.example.com'],
        search: {
          inputs: [],
          steps: [{ type: 'assign', id: 'x', values: { a: '1' } }],
          output: '[]',
        },
      })
    ).not.toThrow()
  })
})

describe('private host rejection at request time', () => {
  it('blocks a request whose resolved URL is a private host even under hosts:["*"]', async () => {
    const manifest = baseManifest({
      hosts: ['*'],
      search: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'r',
            request: { method: 'GET', url: "'http://127.0.0.1/secret'" },
          },
        ],
        output: 'r',
      },
    })
    const { fetcher } = mockFetcher({
      'http://127.0.0.1/secret': { body: '{}' },
    })
    await expect(
      runPipeline(manifest, manifest.search!, {}, { fetcher })
    ).rejects.toThrow(/not in manifest.hosts allowlist/)
  })

  it('allows a public host under hosts:["*"]', async () => {
    const manifest = baseManifest({
      hosts: ['*'],
      search: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'r',
            request: { method: 'GET', url: "'https://api.example.com/x'" },
            extract: { v: 'ok' },
          },
        ],
        output: 'r.v',
      },
    })
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: '{"ok":true}' },
    })
    await expect(
      runPipeline(manifest, manifest.search!, {}, { fetcher })
    ).resolves.toBe(true)
  })
})

describe('response body size cap', () => {
  const manifest = baseManifest({
    search: {
      inputs: [],
      steps: [
        {
          type: 'http',
          id: 'r',
          request: { method: 'GET', url: "'https://api.example.com/x'" },
          extract: { v: 'ok' },
        },
      ],
      output: 'r.v',
    },
  })

  it('rejects a body whose actual bytes exceed the fixed cap', async () => {
    const big = `{"ok":"${'a'.repeat(21 * 1024 * 1024)}"}`
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: big },
    })
    await expect(
      runPipeline(manifest, manifest.search!, {}, { fetcher })
    ).rejects.toThrow(/exceeds cap/)
  })

  it('allows a body within the fixed cap', async () => {
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: '{"ok":true}' },
    })
    await expect(
      runPipeline(manifest, manifest.search!, {}, { fetcher })
    ).resolves.toBe(true)
  })
})

describe('forEach.in length cap', () => {
  function forEachManifest() {
    return baseManifest({
      search: {
        inputs: [],
        steps: [
          {
            type: 'forEach',
            id: 'loop',
            in: '$range(0, count)',
            as: 'i',
            request: {
              method: 'GET',
              url: "'https://api.example.com/x'",
            },
          },
        ],
        output: 'loop',
      },
    })
  }

  it('rejects when the array exceeds the fixed cap', async () => {
    // The array comes in via an input, not $range, whose own 10k cap would
    // otherwise clamp the count before the forEach guard ever sees it.
    const manifest = baseManifest({
      search: {
        inputs: ['items'],
        steps: [
          {
            type: 'forEach',
            id: 'loop',
            in: 'items',
            as: 'i',
            request: { method: 'GET', url: "'https://api.example.com/x'" },
          },
        ],
        output: 'loop',
      },
    })
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: '{}' },
    })
    const items = Array.from({ length: 10_001 }, (_, i) => i)
    await expect(
      runPipeline(manifest, manifest.search!, { items }, { fetcher })
    ).rejects.toThrow(/exceeding cap/)
  })

  it('allows an array within the fixed cap', async () => {
    const manifest = forEachManifest()
    const { fetcher, calls } = mockFetcher({
      'https://api.example.com/x': { body: '{}' },
    })
    await runPipeline(manifest, manifest.search!, { count: 3 }, { fetcher })
    expect(calls).toHaveLength(3)
  })
})
