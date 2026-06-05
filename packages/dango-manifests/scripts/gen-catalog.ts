/**
 * Generate `catalog.json`, a CDN-consumable index of the shipped manifests.
 *
 * A host discovers and fetches manifests over a CDN (jsDelivr/unpkg serve the
 * published package files) by reading this catalog, then fetching each entry's
 * `file` path relative to the package root. The generator scans
 * `src/manifests/*.json` and emits one entry per manifest, sorted by `id`.
 *
 * `bun run scripts/gen-catalog.ts` writes the file.
 * `bun run scripts/gen-catalog.ts --check` exits non-zero if it is stale.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const manifestsDir = join(packageRoot, 'src', 'manifests')
const catalogPath = join(packageRoot, 'catalog.json')
const packageJsonPath = join(packageRoot, 'package.json')

interface CatalogEntry {
  id: string
  name: string
  version: string
  apiVersion: number
  file: string
}

interface Catalog {
  packageVersion: string
  manifests: CatalogEntry[]
}

interface ManifestShape {
  id: string
  name: string
  version: string
  apiVersion: number
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version: string
  }
  return pkg.version
}

function readManifest(fileName: string): ManifestShape {
  const raw = JSON.parse(
    readFileSync(join(manifestsDir, fileName), 'utf8')
  ) as ManifestShape
  return raw
}

function generateCatalog(): Catalog {
  const fileNames = readdirSync(manifestsDir).filter((f) => f.endsWith('.json'))

  const manifests = fileNames
    .map((fileName) => {
      const manifest = readManifest(fileName)
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        apiVersion: manifest.apiVersion,
        file: `src/manifests/${fileName}`,
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  return {
    packageVersion: readPackageVersion(),
    manifests,
  }
}

function serialize(catalog: Catalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

function main(): void {
  const check = process.argv.includes('--check')
  const next = serialize(generateCatalog())

  if (check) {
    let current = ''
    try {
      current = readFileSync(catalogPath, 'utf8')
    } catch {
      current = ''
    }
    if (current !== next) {
      console.error(
        'catalog.json is out of date. Run `bun run catalog` and commit the result.'
      )
      process.exit(1)
    }
    return
  }

  writeFileSync(catalogPath, next)
}

if (import.meta.main) {
  main()
}

export { generateCatalog, serialize }
export type { Catalog, CatalogEntry }
