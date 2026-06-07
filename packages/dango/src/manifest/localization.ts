import type { ConfigSchema, Manifest } from './schema.js'

/** Display strings resolved into one locale; `configSchema`/`cookieSet` are absent when the manifest omits them. */
export interface ResolvedDisplayStrings {
  name: string
  configSchema?: ConfigSchema
  cookieSet?: { title?: string }
}

/**
 * Resolve a manifest's display strings into `locale`. Per string, a locale
 * override wins, otherwise the source-language value. Returns a fresh object
 * and does not mutate `manifest`. No `locale`, or no matching tag, yields the
 * source values.
 */
export function getDisplayStrings(
  manifest: Manifest,
  locale?: string
): ResolvedDisplayStrings {
  const overrides = buildOverrides(manifest.locales, locale)
  const pick = (path: string, source: string | undefined) =>
    overrides[path] ?? source

  const resolved: ResolvedDisplayStrings = {
    name: overrides['name'] ?? manifest.name,
  }

  if (manifest.configSchema) {
    resolved.configSchema = localizeConfigSchema(
      manifest.configSchema,
      'configSchema',
      pick
    )
  }

  if (manifest.cookieSet) {
    resolved.cookieSet = {
      title: pick('cookieSet.title', manifest.cookieSet.title),
    }
  }

  return resolved
}

type Pick = (path: string, source: string | undefined) => string | undefined

/**
 * Flatten `locales` into one path→string map for `locale`. Tags match
 * case-insensitively; when several tags apply (`zh`, `zh-CN`) the most specific
 * wins per key.
 */
function buildOverrides(
  locales: Manifest['locales'],
  locale: string | undefined
): Record<string, string> {
  if (!locales || !locale) return {}

  const byLower = new Map<string, Record<string, string>>()
  for (const [tag, map] of Object.entries(locales)) {
    byLower.set(tag.toLowerCase(), map)
  }

  // Merge least- to most-specific so a more specific tag overrides.
  const parts = locale.toLowerCase().split('-')
  const merged: Record<string, string> = {}
  for (let i = 1; i <= parts.length; i++) {
    const candidate = byLower.get(parts.slice(0, i).join('-'))
    if (candidate) Object.assign(merged, candidate)
  }
  return merged
}

/** Deep-copy a configSchema, overriding `title`/`description` from the locale. */
function localizeConfigSchema(
  node: ConfigSchema,
  path: string,
  pick: Pick
): ConfigSchema {
  const out: ConfigSchema = { ...node }

  const title = pick(`${path}.title`, out.title)
  if (title !== undefined) out.title = title
  const description = pick(`${path}.description`, out.description)
  if (description !== undefined) out.description = description

  if (out.properties) {
    const props: Record<string, ConfigSchema> = {}
    for (const [key, child] of Object.entries(out.properties)) {
      props[key] = localizeConfigSchema(
        child,
        `${path}.properties.${key}`,
        pick
      )
    }
    out.properties = props
  }

  if (out.items) {
    out.items = localizeConfigSchema(out.items, `${path}.items`, pick)
  }

  return out
}
