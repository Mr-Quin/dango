import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  compareEngineVersions,
  engineRelease,
} from '../manifest/compatibility.js'
import {
  ENGINE_FEATURES,
  engineSurface,
  MIN_ENGINE_VERSION_SINCE,
  requiredMinEngineVersion,
  schemaSurface,
  schemaSurfaceUsedBy,
  surfaceUsedBy,
} from '../manifest/features.js'
import { ENGINE_VERSION } from '../version.js'

/**
 * Pins the manifest surface, down to nested fields and enum values, so new
 * surface cannot ship without an ENGINE_FEATURES entry, and covers how a
 * manifest's lowest minEngineVersion is computed from the surface it uses.
 */

// The surface of 0.10.0, the first engine that reads minEngineVersion. While
// main is 0.10.0-dev, surface added for that release goes here; after it,
// new surface goes into ENGINE_FEATURES.
const BASELINE_SURFACE = [
  'helper.$aesCbcDecrypt',
  'helper.$aesCbcEncrypt',
  'helper.$base64Decode',
  'helper.$base64Encode',
  'helper.$bytesToHex',
  'helper.$gatewayDecrypt',
  'helper.$hexToInt',
  'helper.$hmacSha256',
  'helper.$jsonParse',
  'helper.$jsonpUnwrap',
  'helper.$md5',
  'helper.$millis',
  'helper.$now',
  'helper.$permute',
  'helper.$range',
  'helper.$regexExtract',
  'helper.$sha256Base64',
  'helper.$sortedQueryString',
  'helper.$sortedRawString',
  'helper.$stringify',
  'helper.$timeToSeconds',
  'manifest.apiVersion',
  'manifest.configSchema',
  'manifest.cookieSet',
  'manifest.cookieSet.title',
  'manifest.cookieSet.url',
  'manifest.danmaku',
  'manifest.episodes',
  'manifest.hosts',
  'manifest.id',
  'manifest.locales',
  'manifest.loginProbe',
  'manifest.minEngineVersion',
  'manifest.name',
  'manifest.parseUrl',
  'manifest.protoDescriptors',
  'manifest.search',
  'manifest.season',
  'manifest.urlMatch',
  'manifest.urlMatch[].host',
  'manifest.urlMatch[].path',
  'manifest.version',
  'pipeline',
  'pipeline.inputs',
  'pipeline.map',
  'pipeline.output',
  'pipeline.steps',
  'pipeline.when',
  'request',
  'request.acceptStatus',
  'request.body',
  'request.credentials',
  'request.credentials=include',
  'request.credentials=omit',
  'request.decompress',
  'request.decompress=deflate',
  'request.decompress=deflate-raw',
  'request.decompress=gzip',
  'request.format',
  'request.format=json',
  'request.format=jsonp',
  'request.format=proto',
  'request.format=text',
  'request.format=xml',
  'request.headers',
  'request.method',
  'request.method=GET',
  'request.method=POST',
  'request.protoMessage',
  'request.protoSchema',
  'request.query',
  'request.rewriteHeaders',
  'request.url',
  'step.assign',
  'step.assign.id',
  'step.assign.values',
  'step.forEach',
  'step.forEach.as',
  'step.forEach.breakOn',
  'step.forEach.breakOnConsecutive',
  'step.forEach.collect',
  'step.forEach.concurrency',
  'step.forEach.extract',
  'step.forEach.id',
  'step.forEach.in',
  'step.forEach.request',
  'step.forEach.throttleMs',
  'step.http',
  'step.http.cache',
  'step.http.cache.key',
  'step.http.cache.ttlSeconds',
  'step.http.extract',
  'step.http.extractHeaders',
  'step.http.id',
  'step.http.request',
]

const base = {
  apiVersion: 1,
  id: 'src',
  name: 'Source',
  version: '0.1.0',
  hosts: ['api.example.com'],
}

const search = {
  inputs: ['q'],
  steps: [
    {
      type: 'http',
      id: 'res',
      request: { url: "'https://api.example.com'", decompress: 'gzip' },
      cache: { key: 'k', ttlSeconds: 60 },
    },
  ],
  output: '$md5(res.body)',
  map: '$',
}

describe('engine surface', () => {
  it('lists every new piece of surface in ENGINE_FEATURES', () => {
    const known = new Set([
      ...BASELINE_SURFACE,
      ...ENGINE_FEATURES.map((feature) => feature.surface),
    ])
    const unknown = engineSurface().filter((name) => !known.has(name))
    expect(
      unknown,
      'add an ENGINE_FEATURES entry for each, with the release that ships it'
    ).toEqual([])
  })

  it('dates every feature after the baseline release and no later than this one', () => {
    for (const feature of ENGINE_FEATURES) {
      expect(
        compareEngineVersions(feature.since, MIN_ENGINE_VERSION_SINCE)
      ).toBeGreaterThan(0)
      expect(
        compareEngineVersions(feature.since, engineRelease(ENGINE_VERSION))
      ).toBeLessThanOrEqual(0)
    }
  })

  it('names nested fields and enum values', () => {
    const surface = engineSurface()
    for (const name of [
      'manifest.cookieSet.title',
      'manifest.urlMatch[].host',
      'step.http.cache.ttlSeconds',
      'step.forEach.collect',
      'pipeline.when',
      'request.decompress=gzip',
    ]) {
      expect(surface).toContain(name)
    }
  })
})

describe('schemaSurface', () => {
  it('fails on a schema type it does not know how to walk', () => {
    expect(() => schemaSurface(z.object({ at: z.date() }), 'x')).toThrow(
      'cannot enumerate date at x.at'
    )
  })

  it('reads a value against every object option of a union', () => {
    const schema = z.union([
      z.object({ kind: z.enum(['a', 'c']) }),
      z.object({ mode: z.enum(['b', 'd']) }),
    ])

    const used = schemaSurfaceUsedBy(schema, { kind: 'a', mode: 'b' }, 'x')

    expect(used.has('x.kind=a')).toBe(true)
    expect(used.has('x.mode=b')).toBe(true)
  })
})

describe('surfaceUsedBy', () => {
  it('names the fields, enum values, steps and helpers a manifest uses', () => {
    const used = surfaceUsedBy({
      ...base,
      urlMatch: [{ host: 'example.com', path: '/' }],
      cookieSet: { url: 'https://example.com', title: 'Log in' },
      search,
    })
    for (const name of [
      'manifest.search',
      'manifest.urlMatch[].host',
      'manifest.cookieSet.title',
      'pipeline.map',
      'step.http',
      'step.http.cache.ttlSeconds',
      'request.decompress',
      'request.decompress=gzip',
      'helper.$md5',
    ]) {
      expect(used.has(name)).toBe(true)
    }
    expect(used.has('step.forEach')).toBe(false)
    expect(used.has('request.decompress=deflate')).toBe(false)
  })

  it('reads every variant of a pipeline', () => {
    const used = surfaceUsedBy({
      ...base,
      danmaku: [
        { ...search, when: 'x' },
        { ...search, steps: [{ type: 'assign', id: 'a', values: {} }] },
      ],
    })
    expect(used.has('pipeline.when')).toBe(true)
    expect(used.has('step.assign.values')).toBe(true)
  })

  it('names fields, enum values and step types this engine does not know', () => {
    const used = surfaceUsedBy({
      ...base,
      search: {
        steps: [
          { type: 'http', request: { url: "'u'", decompress: 'br' } },
          { type: 'graphql', query: '{}' },
        ],
        output: '[]',
        paginate: true,
      },
    })
    for (const name of [
      'request.decompress=br',
      'step.graphql',
      'step.graphql.query',
      'pipeline.paginate',
    ]) {
      expect(used.has(name)).toBe(true)
    }
  })
})

describe('requiredMinEngineVersion', () => {
  const features = [
    { surface: 'pipeline.map', since: '0.11.0' },
    { surface: 'request.decompress=gzip', since: '0.12.2' },
    { surface: 'step.forEach', since: '0.13.0' },
    { surface: 'helper.$md5', since: MIN_ENGINE_VERSION_SINCE },
  ]

  it('is the newest release among the features a manifest uses', () => {
    expect(requiredMinEngineVersion({ ...base, search }, features)).toBe(
      '0.12.2'
    )
  })

  it('is undefined when only older surface is used', () => {
    const plain = {
      steps: [{ type: 'http', request: { url: "'https://api.example.com'" } }],
      output: '$md5(body)',
    }
    expect(
      requiredMinEngineVersion({ ...base, search: plain }, features)
    ).toBeUndefined()
  })
})
