import { z } from 'zod'
import { helpers } from '../helpers/registry.js'
import { compareEngineVersions } from './compatibility.js'
import {
  zManifest,
  zPipeline,
  zRequestSpec,
  zStep,
  zVariantPipeline,
} from './schema.js'

/**
 * A piece of the manifest surface, as a dotted path through the schema.
 * Pipelines, request specs and steps are named once wherever they appear:
 * `pipeline.map`, `request.decompress`, `step.http.cache.ttlSeconds`. Arrays
 * add `[]` (`manifest.urlMatch[].host`), an enum value is `path=value`
 * (`request.decompress=gzip`), and a helper is `helper.$name`.
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
 * it. A manifest that uses any of it must declare at least the newest `since`
 * as its `minEngineVersion`. Add an entry with every new field, enum value,
 * step type or helper; `since` is the release main is heading for (its `-dev`
 * version).
 */
export const ENGINE_FEATURES: readonly EngineFeature[] = []

const anchors = new Map<unknown, string>([
  [zPipeline, 'pipeline'],
  [zVariantPipeline, 'pipeline'],
  [zRequestSpec, 'request'],
])
for (const step of zStep.options) {
  anchors.set(step, `step.${step.shape.type.value}`)
}

function isStepAnchor(anchor: string | undefined): boolean {
  return anchor !== undefined && anchor.startsWith('step.')
}

function unwrap(schema: z.core.$ZodType): z.core.$ZodType {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable
  ) {
    return unwrap(schema.unwrap())
  }
  if (schema instanceof z.ZodPipe) {
    return unwrap(schema.in)
  }
  return schema
}

function enumerate(
  schema: z.core.$ZodType,
  at: string,
  out: Set<SurfaceName>
): void {
  const anchor = anchors.get(schema)
  const path = anchor ?? at
  if (anchor !== undefined) {
    out.add(anchor)
  }
  const inner = unwrap(schema)
  if (inner !== schema) {
    enumerate(inner, path, out)
    return
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.core.$ZodType> = schema.shape
    for (const [key, field] of Object.entries(shape)) {
      if (isStepAnchor(anchor) && key === 'type') {
        continue
      }
      out.add(`${path}.${key}`)
      enumerate(field, `${path}.${key}`, out)
    }
  } else if (schema instanceof z.ZodArray) {
    enumerate(schema.element, `${path}[]`, out)
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      enumerate(option, path, out)
    }
  } else if (schema instanceof z.ZodEnum) {
    for (const option of schema.options) {
      out.add(`${path}=${String(option)}`)
    }
  }
}

/** Every surface name this engine's schema and helper registry define. */
export function engineSurface(): SurfaceName[] {
  const names = new Set<SurfaceName>()
  enumerate(zManifest, 'manifest', names)
  for (const name of Object.keys(helpers)) {
    names.add(`helper.$${name}`)
  }
  return [...names].sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesOption(option: z.core.$ZodType, value: unknown): boolean {
  const inner = unwrap(option)
  if (inner instanceof z.ZodArray) {
    return Array.isArray(value)
  }
  if (inner instanceof z.ZodObject) {
    return isRecord(value)
  }
  return !Array.isArray(value) && !isRecord(value)
}

function detectStep(value: unknown, out: Set<SurfaceName>): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return
  }
  const option = zStep.options.find(
    (step) => step.shape.type.value === value.type
  )
  if (option) {
    detect(option, value, '', out)
    return
  }
  out.add(`step.${value.type}`)
  for (const key of Object.keys(value)) {
    if (key !== 'type') {
      out.add(`step.${value.type}.${key}`)
    }
  }
}

function detect(
  schema: z.core.$ZodType,
  value: unknown,
  at: string,
  out: Set<SurfaceName>
): void {
  if (value === undefined) {
    return
  }
  if (schema === zStep) {
    detectStep(value, out)
    return
  }
  const anchor = anchors.get(schema)
  const path = anchor ?? at
  if (anchor !== undefined) {
    out.add(anchor)
  }
  const inner = unwrap(schema)
  if (inner !== schema) {
    detect(inner, value, path, out)
    return
  }
  if (schema instanceof z.ZodObject) {
    if (!isRecord(value)) {
      return
    }
    const shape: Record<string, z.core.$ZodType> = schema.shape
    for (const [key, field] of Object.entries(value)) {
      if (isStepAnchor(anchor) && key === 'type') {
        continue
      }
      out.add(`${path}.${key}`)
      const fieldSchema = shape[key]
      if (fieldSchema !== undefined) {
        detect(fieldSchema, field, `${path}.${key}`, out)
      }
    }
  } else if (schema instanceof z.ZodArray) {
    if (Array.isArray(value)) {
      for (const item of value) {
        detect(schema.element, item, `${path}[]`, out)
      }
    }
  } else if (schema instanceof z.ZodUnion) {
    const options: readonly z.core.$ZodType[] = schema.options
    const option = options.find((candidate) => matchesOption(candidate, value))
    if (option) {
      detect(option, value, path, out)
    }
  } else if (schema instanceof z.ZodEnum && typeof value === 'string') {
    out.add(`${path}=${value}`)
  }
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
 * The surface a manifest document uses, read from the raw JSON alongside the
 * schema: parsing would fill in defaults and drop fields this engine does not
 * know.
 */
export function surfaceUsedBy(raw: unknown): Set<SurfaceName> {
  const used = new Set<SurfaceName>()
  detect(zManifest, raw, 'manifest', used)
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
 * The lowest `minEngineVersion` a manifest can declare, or undefined when
 * every engine that reads the field can run it. A manifest may declare more,
 * for example to require a release that fixed behaviour it depends on.
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
