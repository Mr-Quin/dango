import { helpers } from '../helpers/registry.js'
import { compareEngineVersions } from './compatibility.js'
import { zManifest, zPipeline, zRequestSpec, zStep } from './schema.js'

/**
 * A piece of the manifest surface, named by where it appears:
 * `manifest.<field>`, `pipeline.<field>`, `request.<field>`,
 * `step.<type>` and `step.<type>.<field>`, or `helper.$<name>`.
 */
export type SurfaceName = string

export interface EngineFeature {
  surface: SurfaceName
  /** The engine release that first understands it. */
  since: string
}

/** The first engine release that reads `minEngineVersion`. */
export const MIN_ENGINE_VERSION_SINCE = '0.10.0'

/**
 * Surface added after `MIN_ENGINE_VERSION_SINCE`, with the release that added
 * it. A manifest that uses any of it must declare the newest `since` as its
 * `minEngineVersion`. Add an entry with every new field, step type or helper;
 * `since` is the release main is heading for (its `-dev` version).
 */
export const ENGINE_FEATURES: readonly EngineFeature[] = []

const PIPELINE_FIELDS = [
  'search',
  'episodes',
  'danmaku',
  'season',
  'parseUrl',
  'loginProbe',
] as const

/** Every surface name this engine's schema and helper registry define. */
export function engineSurface(): SurfaceName[] {
  const names: SurfaceName[] = []
  for (const key of Object.keys(zManifest.shape)) {
    names.push(`manifest.${key}`)
  }
  for (const key of Object.keys(zPipeline.shape)) {
    names.push(`pipeline.${key}`)
  }
  names.push('pipeline.when')
  for (const key of Object.keys(zRequestSpec.shape)) {
    names.push(`request.${key}`)
  }
  for (const step of zStep.options) {
    const type = step.shape.type.value
    names.push(`step.${type}`)
    for (const key of Object.keys(step.shape)) {
      if (key !== 'type') {
        names.push(`step.${type}.${key}`)
      }
    }
  }
  for (const name of Object.keys(helpers)) {
    names.push(`helper.$${name}`)
  }
  return names.sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  return [value]
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out)
    }
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectStrings(item, out)
    }
  }
}

/**
 * The surface a manifest document uses, read from the raw JSON: parsing would
 * fill in defaults and drop fields this engine does not know.
 */
export function surfaceUsedBy(raw: unknown): Set<SurfaceName> {
  const used = new Set<SurfaceName>()
  if (!isRecord(raw)) {
    return used
  }
  for (const key of Object.keys(raw)) {
    used.add(`manifest.${key}`)
  }
  for (const field of PIPELINE_FIELDS) {
    for (const pipeline of asArray(raw[field] ?? [])) {
      if (!isRecord(pipeline)) {
        continue
      }
      for (const key of Object.keys(pipeline)) {
        used.add(`pipeline.${key}`)
      }
      for (const step of asArray(pipeline.steps ?? [])) {
        if (!isRecord(step) || typeof step.type !== 'string') {
          continue
        }
        used.add(`step.${step.type}`)
        for (const key of Object.keys(step)) {
          if (key !== 'type') {
            used.add(`step.${step.type}.${key}`)
          }
        }
        if (isRecord(step.request)) {
          for (const key of Object.keys(step.request)) {
            used.add(`request.${key}`)
          }
        }
      }
    }
  }
  const strings: string[] = []
  collectStrings(raw, strings)
  for (const text of strings) {
    for (const match of text.matchAll(/\$([A-Za-z_]\w*)\s*\(/g)) {
      used.add(`helper.$${match[1]}`)
    }
  }
  return used
}

/**
 * The `minEngineVersion` a manifest has to declare, or undefined when every
 * engine that reads the field can run it.
 */
export function requiredMinEngineVersion(
  raw: unknown,
  features: readonly EngineFeature[] = ENGINE_FEATURES
): string | undefined {
  const used = surfaceUsedBy(raw)
  let required: string | undefined
  for (const feature of features) {
    if (!used.has(feature.surface)) {
      continue
    }
    if (compareEngineVersions(feature.since, MIN_ENGINE_VERSION_SINCE) <= 0) {
      continue
    }
    if (
      required === undefined ||
      compareEngineVersions(feature.since, required) > 0
    ) {
      required = feature.since
    }
  }
  return required
}
