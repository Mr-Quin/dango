import { describe, expect, it } from 'bun:test'
import { loadManifest } from '../index.js'

/**
 * loadManifest tells a usable manifest from one written for a newer engine
 * and from one that is broken, checking compatibility before the schema so a
 * future manifest reads as incompatible even when this engine cannot parse it.
 */

const base = {
  apiVersion: 1,
  id: 'src',
  name: 'Source',
  version: '0.1.0',
  hosts: ['api.example.com'],
}

describe('loadManifest', () => {
  it('returns the parsed manifest', () => {
    const result = loadManifest(base)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.manifest.id).toBe('src')
    }
  })

  it('reports an unsupported apiVersion as incompatible', () => {
    expect(loadManifest({ ...base, apiVersion: 2 })).toEqual({
      status: 'incompatible',
      incompatibility: { reason: 'api-version', apiVersion: 2 },
    })
  })

  it('reports a newer engine requirement as incompatible', () => {
    expect(loadManifest({ ...base, minEngineVersion: '99.0.0' })).toEqual({
      status: 'incompatible',
      incompatibility: { reason: 'engine-version', minEngineVersion: '99.0.0' },
    })
  })

  it('reports incompatibility even when this engine cannot parse the rest', () => {
    const future = {
      ...base,
      minEngineVersion: '99.0.0',
      search: { steps: [{ type: 'future' }], output: '[]' },
    }
    expect(loadManifest(future).status).toBe('incompatible')
  })

  it('reports a broken manifest as malformed with its issues', () => {
    expect(loadManifest({ ...base, hosts: [] })).toEqual({
      status: 'malformed',
      issues: [
        {
          path: 'hosts',
          message: 'Too small: expected array to have >=1 items',
        },
      ],
    })
  })

  it('reports a malformed minEngineVersion as malformed', () => {
    const result = loadManifest({ ...base, minEngineVersion: 'next' })
    expect(result.status).toBe('malformed')
  })

  it('reports a document that is not a manifest as malformed', () => {
    expect(loadManifest('nope').status).toBe('malformed')
  })
})
