import { describe, expect, it } from 'bun:test'
import { ManifestRunner } from '../engine/ManifestRunner.js'
import { zManifest } from '../manifest/schema.js'

// A manifest's `identityFields` declares which configValues keys partition its
// content namespace. It is required and explicit: omitting it is an authoring
// error, and any entry must name a real configSchema property.
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

describe('manifest identityFields declaration', () => {
  it('rejects a manifest that omits identityFields (no implicit default)', () => {
    // `base` deliberately has no identityFields key.
    expect(() => zManifest.parse(base)).toThrow()
  })

  it('accepts an empty list (fixed-site source, namespace is the id alone)', () => {
    const manifest = zManifest.parse({ ...base, identityFields: [] })
    expect(manifest.identityFields).toEqual([])
  })

  it('accepts entries that name declared configSchema properties', () => {
    const manifest = zManifest.parse({ ...base, identityFields: ['baseUrl'] })
    expect(manifest.identityFields).toEqual(['baseUrl'])
  })

  it('rejects an entry that is not a configSchema property', () => {
    expect(() =>
      zManifest.parse({ ...base, identityFields: ['notAField'] })
    ).toThrow(/not a configSchema property/)
  })

  it('rejects a non-empty list when the manifest has no configSchema', () => {
    const noSchema = {
      apiVersion: 1,
      id: 'src',
      name: 'Source',
      version: '0.1.0',
      hosts: ['api.example.com'],
      identityFields: ['baseUrl'],
    }
    expect(() => zManifest.parse(noSchema)).toThrow(
      /not a configSchema property/
    )
  })

  it('rejects duplicate entries', () => {
    expect(() =>
      zManifest.parse({ ...base, identityFields: ['baseUrl', 'baseUrl'] })
    ).toThrow(/duplicate/)
  })
})

describe('ManifestRunner.identityFields', () => {
  it('returns the declared list', () => {
    const runner = new ManifestRunner(
      zManifest.parse({ ...base, identityFields: ['baseUrl'] })
    )
    expect(runner.identityFields()).toEqual(['baseUrl'])
  })

  it('returns [] for a fixed-site source', () => {
    const runner = new ManifestRunner(
      zManifest.parse({ ...base, identityFields: [] })
    )
    expect(runner.identityFields()).toEqual([])
  })

  it('returns a copy, not the live manifest array', () => {
    const runner = new ManifestRunner(
      zManifest.parse({ ...base, identityFields: ['baseUrl'] })
    )
    runner.identityFields().push('mutated')
    expect(runner.identityFields()).toEqual(['baseUrl'])
  })
})
