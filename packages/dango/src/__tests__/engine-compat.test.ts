import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import {
  checkManifestCompatibility,
  ENGINE_VERSION,
  zManifest,
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))

const [engineRelease] = ENGINE_VERSION.split('-')
const [major, minor, patch] = engineRelease
  .split('.')
  .map((part) => Number.parseInt(part, 10))
const nextPatch = `${major}.${minor}.${patch + 1}`
const nextMinor = `${major}.${minor + 1}.0`
const nextMajor = `${major + 1}.0.0`

const base = {
  apiVersion: 1,
  id: 'src',
  name: 'Source',
  version: '0.1.0',
  hosts: ['api.example.com'],
}

describe('ENGINE_VERSION', () => {
  it('matches the published package version', () => {
    const pkg = JSON.parse(
      readFileSync(join(here, '..', '..', 'package.json'), 'utf8')
    ) as { version: string }
    expect(ENGINE_VERSION).toBe(pkg.version)
  })
})

describe('zManifest minEngineVersion', () => {
  it('accepts a manifest that does not declare it', () => {
    const manifest = zManifest.parse(base)
    expect(manifest.minEngineVersion).toBeUndefined()
  })

  it('accepts the running engine version and older ones', () => {
    for (const version of [engineRelease, '0.0.1', '0.9.0']) {
      const manifest = zManifest.parse({ ...base, minEngineVersion: version })
      expect(manifest.minEngineVersion).toBe(version)
    }
  })

  it('rejects a manifest that needs a newer engine', () => {
    for (const version of [nextPatch, nextMinor, nextMajor]) {
      const result = zManifest.safeParse({ ...base, minEngineVersion: version })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0].path).toEqual(['minEngineVersion'])
      expect(result.error?.issues[0].message).toContain(version)
      expect(result.error?.issues[0].message).toContain(ENGINE_VERSION)
    }
  })

  it('compares numerically, not as strings', () => {
    const result = zManifest.safeParse({
      ...base,
      minEngineVersion: `${major}.${minor + 10}.0`,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a value that is not MAJOR.MINOR.PATCH', () => {
    for (const version of ['1', '1.2', 'v1.2.3', '1.2.3-beta', '>=1.0.0']) {
      const result = zManifest.safeParse({ ...base, minEngineVersion: version })
      expect(result.success).toBe(false)
    }
  })
})

describe('checkManifestCompatibility', () => {
  it('accepts a supported apiVersion with no engine requirement', () => {
    expect(checkManifestCompatibility({ apiVersion: 1 })).toEqual({
      compatible: true,
    })
  })

  it('accepts an engine requirement this engine meets', () => {
    expect(
      checkManifestCompatibility({
        apiVersion: 1,
        minEngineVersion: engineRelease,
      })
    ).toEqual({ compatible: true })
  })

  it('reports an unsupported apiVersion', () => {
    expect(checkManifestCompatibility({ apiVersion: 99 })).toEqual({
      compatible: false,
      reason: 'api-version',
      apiVersion: 99,
    })
  })

  it('reports an engine requirement this engine does not meet', () => {
    expect(
      checkManifestCompatibility({ apiVersion: 1, minEngineVersion: nextMinor })
    ).toEqual({
      compatible: false,
      reason: 'engine-version',
      minEngineVersion: nextMinor,
    })
  })

  it('treats a malformed engine requirement as unmet', () => {
    expect(
      checkManifestCompatibility({ apiVersion: 1, minEngineVersion: 'next' })
    ).toEqual({
      compatible: false,
      reason: 'engine-version',
      minEngineVersion: 'next',
    })
  })

  it('agrees with zManifest', () => {
    const cases = [
      { apiVersion: 1 },
      { apiVersion: 2 },
      { apiVersion: 1, minEngineVersion: engineRelease },
      { apiVersion: 1, minEngineVersion: nextPatch },
    ]
    for (const requirement of cases) {
      const parsed = zManifest.safeParse({ ...base, ...requirement })
      expect(checkManifestCompatibility(requirement).compatible).toBe(
        parsed.success
      )
    }
  })
})
