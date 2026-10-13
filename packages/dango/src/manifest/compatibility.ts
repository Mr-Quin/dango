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

// A prerelease engine (`1.2.0-rc.1`) counts as its release, so a build of the
// release candidate runs the manifests written for that release.
function parseEngineVersion(): VersionTriple {
  const [release] = ENGINE_VERSION.split('-')
  const parsed = parseVersion(release)
  if (parsed === null) {
    throw new Error(`ENGINE_VERSION is not semver: ${ENGINE_VERSION}`)
  }
  return parsed
}

const engine = parseEngineVersion()

export function isApiVersionSupported(apiVersion: number): boolean {
  return SUPPORTED_API_VERSIONS.has(apiVersion)
}

/** False for a malformed version as well as for one newer than this engine. */
export function isEngineVersionSatisfied(minEngineVersion: string): boolean {
  const required = parseVersion(minEngineVersion)
  if (required === null) {
    return false
  }
  for (let i = 0; i < required.length; i++) {
    if (engine[i] !== required[i]) {
      return engine[i] > required[i]
    }
  }
  return true
}

/** The fields of a manifest, or of its catalog entry, that decide compatibility. */
export interface ManifestRequirements {
  apiVersion: number
  minEngineVersion?: string
}

export type ManifestCompatibility =
  | { compatible: true }
  | { compatible: false; reason: 'api-version'; apiVersion: number }
  | { compatible: false; reason: 'engine-version'; minEngineVersion: string }

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
