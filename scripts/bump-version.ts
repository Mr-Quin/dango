/**
 * Bump the npm `version` of both published packages and the engine's
 * `ENGINE_VERSION` to a target version and regenerate the manifest catalog.
 *
 * `bun run bump <version>` (e.g. `bun run bump 0.5.0`).
 *
 * Deliberately does NOT touch per-manifest `version` fields: those are
 * versioned independently and bump only when a given manifest changes, not as
 * part of a package release. See VERSIONING.md.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const PACKAGE_FILES = [
  'packages/dango/package.json',
  'packages/dango-manifests/package.json',
]

const ENGINE_VERSION_FILE = 'packages/dango/src/version.ts'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function setVersion(relPath: string, version: string): void {
  const path = join(repoRoot, relPath)
  const raw = readFileSync(path, 'utf8')
  const next = raw.replace(/^(\s*"version":\s*")[^"]+(",)$/m, `$1${version}$2`)
  if (next === raw) {
    throw new Error(`no top-level "version" field found in ${relPath}`)
  }
  writeFileSync(path, next)
}

function setEngineVersion(version: string): void {
  const path = join(repoRoot, ENGINE_VERSION_FILE)
  const raw = readFileSync(path, 'utf8')
  const constant = /^(export const ENGINE_VERSION = ')[^']+(')$/m
  if (!constant.test(raw)) {
    throw new Error(
      `no ENGINE_VERSION constant found in ${ENGINE_VERSION_FILE}`
    )
  }
  writeFileSync(path, raw.replace(constant, `$1${version}$2`))
}

function main(): void {
  const version = process.argv[2]
  if (!version || !SEMVER.test(version)) {
    console.error('usage: bun run bump <version>   (e.g. 0.5.0)')
    process.exit(1)
  }

  for (const relPath of PACKAGE_FILES) {
    setVersion(relPath, version)
    console.log(`bumped ${relPath} -> ${version}`)
  }
  setEngineVersion(version)
  console.log(`bumped ${ENGINE_VERSION_FILE} -> ${version}`)

  execFileSync('bun', ['run', 'catalog'], { cwd: repoRoot, stdio: 'inherit' })

  if (version.includes('-')) {
    console.log(
      [
        '',
        `Bumped both packages to ${version}. Commit it as:`,
        `  git commit -am "chore: start v${version.split('-')[0]} development"`,
        '',
      ].join('\n')
    )
    return
  }

  console.log(
    [
      '',
      `Bumped both packages to ${version} and regenerated the catalog. Next:`,
      `  1. move CHANGELOG.md [Unreleased] entries into a dated [${version}] section`,
      '  2. bun run check',
      `  3. git commit -am "chore: release v${version}"`,
      `  4. git tag -a v${version} -m v${version} && git push --follow-tags`,
      '',
    ].join('\n')
  )
}

main()
