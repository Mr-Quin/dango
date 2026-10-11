import { describe, expect, it } from 'bun:test'
import { ManifestRunner } from '../engine/ManifestRunner.js'
import { zManifest } from '../manifest/schema.js'

const base = {
  apiVersion: 1,
  id: 'src',
  name: 'Source',
  version: '0.1.0',
  hosts: ['api.example.com'],
  configSchema: {
    type: 'object',
    properties: {
      baseUrl: { type: 'string' },
    },
  },
}

describe('legacy identityFields', () => {
  it('accepts a manifest without identityFields', () => {
    const manifest = zManifest.parse(base)
    expect(manifest.id).toBe('src')
    expect('identityFields' in manifest).toBe(false)
  })

  it('accepts and strips identityFields from an older manifest', () => {
    const manifest = zManifest.parse({ ...base, identityFields: ['baseUrl'] })
    expect('identityFields' in manifest).toBe(false)
  })

  it('no longer validates identityFields against configSchema', () => {
    expect(() =>
      zManifest.parse({ ...base, identityFields: ['notAField'] })
    ).not.toThrow()
  })

  it('ManifestRunner has no identityFields accessor', () => {
    const runner = new ManifestRunner(zManifest.parse(base))
    expect('identityFields' in runner).toBe(false)
  })
})
