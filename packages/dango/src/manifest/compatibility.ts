import { ENGINE_VERSION } from '../version.js'

// API versions the engine understands. Bumps only on incompatible changes
// (helper removal, step-type semantics). Additive changes don't bump.
export const SUPPORTED_API_VERSIONS = new Set<number>([1])

export const ENGINE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

type VersionTriple = [number, number, number]

function parseVersion(version: string): VersionTriple | null {
  const match = ENGINE_VERSION_PATTERN.exec(version)
  if (match === null) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareTriples(a: VersionTriple, b: VersionTriple): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return 0
}

/**
 * The release an engine version belongs to. A prerelease (`0.10.0-dev`)
 * counts as its release: main carries the next release's `-dev` version, so
 * manifests written against main declare the release that ships their
 * features.
 */
export function engineRelease(version: string): string {
  const [release] = version.split('-')
  return release
}

const engine = parseVersion(engineRelease(ENGINE_VERSION))
if (engine === null) {
  throw new Error(`ENGINE_VERSION is not semver: ${ENGINE_VERSION}`)
}
const engineTriple: VersionTriple = engine

/** Orders two `MAJOR.MINOR.PATCH` versions; throws on a malformed one. */
export function compareEngineVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) {
    throw new Error(`not a MAJOR.MINOR.PATCH version: ${a}, ${b}`)
  }
  return compareTriples(left, right)
}

export function isApiVersionSupported(apiVersion: number): boolean {
  return SUPPORTED_API_VERSIONS.has(apiVersion)
}

/** False for a malformed version as well as for one newer than this engine. */
export function isEngineVersionSatisfied(minEngineVersion: string): boolean {
  const required = parseVersion(minEngineVersion)
  if (required === null) {
    return false
  }
  return compareTriples(engineTriple, required) >= 0
}

/** The fields of a manifest, or of its catalog entry, that decide compatibility. */
export interface ManifestRequirements {
  apiVersion: number
  minEngineVersion?: string
}

export type ManifestIncompatibility =
  | { reason: 'api-version'; apiVersion: number }
  | { reason: 'engine-version'; minEngineVersion: string }

export type ManifestCompatibility =
  | { compatible: true }
  | ({ compatible: false } & ManifestIncompatibility)

/**
 * Whether this engine can run a manifest with these requirements. Applies the
 * same rules `zManifest` enforces, so a host can gate a catalog entry before
 * fetching the manifest it points at.
 */
export function checkManifestCompatibility(
  requirements: ManifestRequirements
): ManifestCompatibility {
  const { apiVersion, minEngineVersion } = requirements
  if (!isApiVersionSupported(apiVersion)) {
    return { compatible: false, reason: 'api-version', apiVersion }
  }
  if (
    minEngineVersion !== undefined &&
    !isEngineVersionSatisfied(minEngineVersion)
  ) {
    return { compatible: false, reason: 'engine-version', minEngineVersion }
  }
  return { compatible: true }
}
