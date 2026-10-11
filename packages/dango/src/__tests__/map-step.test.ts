import { describe, expect, it } from 'bun:test'
import { ManifestRunner } from '../engine/ManifestRunner.js'
import { runPipeline } from '../engine/runner.js'
import { zManifest } from '../manifest/schema.js'
import { mockFetcher } from './fixtures.js'

/**
 * Exercises the optional per-pipeline `map` field: a JSONata expression the
 * engine applies row-by-row to every element of the array produced by `output`,
 * each element bound as the evaluation input ($). Asserts (1) byte-identical
 * results to the equivalent whole-array `output.(...)` projection, (2) that the
 * map runs once per row and sees each element as $, and (3) that omitting `map`
 * leaves the output untouched.
 */

const baseManifest = {
  apiVersion: 1,
  id: 'maptest',
  name: 'MapTest',
  version: '0.1.0',
  hosts: ['api.example.com'],
}

const rowsResponse = JSON.stringify({
  list: [
    { t: 1000, c: 'a', color: 16711680 },
    { t: 2500, c: 'b', color: 65280 },
    { t: 3000, c: 'c', color: 255 },
  ],
})

describe('per-row map step', () => {
  it('produces identical output to the equivalent whole-array projection', async () => {
    const shapingBody =
      "{ 'p': $string($number(t) / 1000) & ',1,' & $string(color), 'm': c }"

    const withProjection = zManifest.parse({
      ...baseManifest,
      danmaku: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'dm',
            request: { url: "'https://api.example.com/dm'" },
            extract: { rows: 'list' },
          },
        ],
        output: `[dm.rows.(${shapingBody})]`,
      },
    })

    const withMap = zManifest.parse({
      ...baseManifest,
      danmaku: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'dm',
            request: { url: "'https://api.example.com/dm'" },
            extract: { rows: 'list' },
          },
        ],
        output: '[dm.rows]',
        map: shapingBody,
      },
    })

    const handlers = {
      'https://api.example.com/dm': { body: rowsResponse },
    }

    const projResult = await new ManifestRunner(withProjection, {
      fetcher: mockFetcher(handlers).fetcher,
    }).runDanmaku({})
    const mapResult = await new ManifestRunner(withMap, {
      fetcher: mockFetcher(handlers).fetcher,
    }).runDanmaku({})

    expect(mapResult).toEqual(projResult)
    expect(mapResult).toEqual([
      { p: '1,1,16711680', m: 'a' },
      { p: '2.5,1,65280', m: 'b' },
      { p: '3,1,255', m: 'c' },
    ])
  })

  it('binds each element as $ and runs once per row', async () => {
    const manifest = zManifest.parse({
      ...baseManifest,
      danmaku: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'dm',
            request: { url: "'https://api.example.com/dm'" },
            extract: { rows: 'list' },
          },
        ],
        output: '[dm.rows]',
        map: 'c',
      },
    })

    const result = await new ManifestRunner(manifest, {
      fetcher: mockFetcher({
        'https://api.example.com/dm': { body: rowsResponse },
      }).fetcher,
    }).runDanmaku({})

    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('leaves output untouched when map is omitted', async () => {
    const manifest = zManifest.parse({
      ...baseManifest,
      danmaku: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'dm',
            request: { url: "'https://api.example.com/dm'" },
            extract: { rows: 'list' },
          },
        ],
        output: '[dm.rows]',
      },
    })

    const result = await new ManifestRunner(manifest, {
      fetcher: mockFetcher({
        'https://api.example.com/dm': { body: rowsResponse },
      }).fetcher,
    }).runDanmaku({})

    expect(result).toEqual([
      { t: 1000, c: 'a', color: 16711680 },
      { t: 2500, c: 'b', color: 65280 },
      { t: 3000, c: 'c', color: 255 },
    ])
  })

  it('throws when output is not an array but map is set', async () => {
    const manifest = zManifest.parse({
      ...baseManifest,
      danmaku: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'dm',
            request: { url: "'https://api.example.com/dm'" },
            extract: { rows: 'list' },
          },
        ],
        output: 'dm.rows[0]',
        map: 'c',
      },
    })

    await expect(
      new ManifestRunner(manifest, {
        fetcher: mockFetcher({
          'https://api.example.com/dm': { body: rowsResponse },
        }).fetcher,
      }).runDanmaku({})
    ).rejects.toThrow(/map requires the pipeline output to be an array/)
  })

  it('runPipeline applies map over the output array', async () => {
    const manifest = zManifest.parse({
      ...baseManifest,
      danmaku: {
        inputs: [],
        steps: [
          {
            type: 'http',
            id: 'dm',
            request: { url: "'https://api.example.com/dm'" },
            extract: { rows: 'list' },
          },
        ],
        output: '[dm.rows]',
        map: '$number(t) * 2',
      },
    })

    const result = await runPipeline(
      manifest,
      manifest.danmaku ?? [],
      {},
      {
        fetcher: mockFetcher({
          'https://api.example.com/dm': { body: rowsResponse },
        }).fetcher,
      }
    )

    expect(result).toEqual([2000, 5000, 6000])
  })
})
