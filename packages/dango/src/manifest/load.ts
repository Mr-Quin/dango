import { z } from 'zod'
import {
  checkManifestCompatibility,
  ENGINE_VERSION_PATTERN,
  type ManifestIncompatibility,
} from './compatibility.js'
import { type Manifest, zManifest } from './schema.js'

export interface ManifestIssue {
  /** Dotted path to the offending field; empty for the document itself. */
  path: string
  message: string
}

export type ManifestLoadResult =
  | { status: 'ok'; manifest: Manifest }
  | { status: 'incompatible'; incompatibility: ManifestIncompatibility }
  | { status: 'malformed'; issues: ManifestIssue[] }

const zRequirements = z.object({
  apiVersion: z.number(),
  minEngineVersion: z.string().regex(ENGINE_VERSION_PATTERN).optional(),
})

/**
 * Parses a manifest document and says why it cannot be used. Compatibility is
 * checked first: a manifest written for a newer engine may also fail this
 * engine's schema, and it should read as "needs a newer engine", not as
 * broken.
 */
export function loadManifest(raw: unknown): ManifestLoadResult {
  const requirements = zRequirements.safeParse(raw)
  if (requirements.success) {
    const compatibility = checkManifestCompatibility(requirements.data)
    if (!compatibility.compatible) {
      const { compatible: _compatible, ...incompatibility } = compatibility
      return { status: 'incompatible', incompatibility }
    }
  }
  const parsed = zManifest.safeParse(raw)
  if (!parsed.success) {
    return {
      status: 'malformed',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    }
  }
  return { status: 'ok', manifest: parsed.data }
}
