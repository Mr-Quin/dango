import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import { generateCatalog, serialize } from '../../scripts/gen-catalog.js'
import catalog from '../../catalog.json' with { type: 'json' }

/**
 * Pins catalog.json against the manifests on disk. The committed catalog must
 * match the generator output (so a stale catalog fails CI), list every shipped
 * manifest exactly once sorted by id, and carry the id/name/version/apiVersion
 * the source manifest declares with a CDN-fetchable in-package file path.
 */

const here = dirname(fileURLToPath(import.meta.url))
const manifestsDir = join(here, '..', 'manifests')

interface ManifestShape {
  id: string
  name: string
  version: string
  apiVersion: number
}

function readManifest(fileName: string): ManifestShape {
  return JSON.parse(
    readFileSync(join(manifestsDir, fileName), 'utf8')
  ) as ManifestShape
}

describe('catalog.json', () => {
  it('matches the generator output (committed catalog is in sync)', () => {
    const committed = readFileSync(
      join(here, '..', '..', 'catalog.json'),
      'utf8'
    )
    expect(committed).toBe(serialize(generateCatalog()))
  })

  it('lists every manifest file exactly once, sorted by id', () => {
    const fileNames = readdirSync(manifestsDir).filter((f) =>
      f.endsWith('.json')
    )
    const ids = catalog.manifests.map((m) => m.id)
    const sorted = [...ids].sort((a, b) => a.localeCompare(b))

    expect(catalog.manifests).toHaveLength(fileNames.length)
    expect(ids).toEqual(sorted)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('mirrors each manifest id/name/version/apiVersion and points at a real file', () => {
    for (const entry of catalog.manifests) {
      const expectedFile = `src/manifests/${entry.id}.json`
      expect(entry.file).toBe(expectedFile)
      const fileName = entry.file.replace('src/manifests/', '')
      const manifest = readManifest(fileName)
      expect(entry.id).toBe(manifest.id)
      expect(entry.name).toBe(manifest.name)
      expect(entry.version).toBe(manifest.version)
      expect(entry.apiVersion).toBe(manifest.apiVersion)
    }
  })
})
