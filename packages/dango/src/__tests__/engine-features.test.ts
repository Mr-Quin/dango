import { describe, expect, it } from 'bun:test'
import { engineRelease } from '../manifest/compatibility.js'
import {
  ENGINE_FEATURES,
  engineSurface,
  MIN_ENGINE_VERSION_SINCE,
  requiredMinEngineVersion,
  surfaceUsedBy,
} from '../manifest/features.js'
import { compareEngineVersions } from '../manifest/compatibility.js'
import { ENGINE_VERSION } from '../version.js'

/**
 * Pins the manifest surface so a new field, step type or helper cannot ship
 * without an ENGINE_FEATURES entry, and covers how a manifest's required
 * minEngineVersion is computed from the surface it uses.
 */

// The surface every engine that reads minEngineVersion understands. Do not
// add to this list: add an ENGINE_FEATURES entry instead.
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
  'manifest.version',
  'pipeline.inputs',
  'pipeline.map',
  'pipeline.output',
  'pipeline.steps',
  'pipeline.when',
  'request.acceptStatus',
  'request.body',
  'request.credentials',
  'request.decompress',
  'request.format',
  'request.headers',
  'request.method',
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

  it('dates every feature after the first engine that reads minEngineVersion and no later than this one', () => {
    for (const feature of ENGINE_FEATURES) {
      expect(
        compareEngineVersions(feature.since, MIN_ENGINE_VERSION_SINCE)
      ).toBeGreaterThan(0)
      expect(
        compareEngineVersions(feature.since, engineRelease(ENGINE_VERSION))
      ).toBeLessThanOrEqual(0)
    }
  })
})

describe('surfaceUsedBy', () => {
  it('names the fields, steps, request options and helpers a manifest uses', () => {
    const used = surfaceUsedBy({ ...base, search })
    for (const name of [
      'manifest.search',
      'pipeline.map',
      'step.http',
      'step.http.cache',
      'request.decompress',
      'helper.$md5',
    ]) {
      expect(used.has(name)).toBe(true)
    }
    expect(used.has('step.forEach')).toBe(false)
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
})

describe('requiredMinEngineVersion', () => {
  const features = [
    { surface: 'pipeline.map', since: '0.11.0' },
    { surface: 'request.decompress', since: '0.12.2' },
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
