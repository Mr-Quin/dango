import { describe, expect, it } from 'bun:test'
import { getDisplayStrings } from '../manifest/localization.js'
import { type Manifest, zManifest } from '../manifest/schema.js'

/**
 * Tests getDisplayStrings: exact-locale hit, BCP-47 narrowing (zh-TW → zh),
 * per-key fallback to the source language, no-locale / no-match behaviour,
 * nested configSchema paths (properties, items, and labelled enum options
 * under oneOf/anyOf), unknown-key tolerance, and that the source manifest is
 * not mutated.
 */

function parse(raw: unknown): Manifest {
  return zManifest.parse(raw)
}

const base = {
  apiVersion: 1,
  id: 'sample',
  name: 'Sample',
  version: '1.0.0',
  hosts: ['api.example.com'],
  configSchema: {
    type: 'object',
    properties: {
      fmt: {
        type: 'string',
        title: 'Format',
        description: 'Wire format',
      },
      list: {
        type: 'array',
        title: 'List',
        items: { type: 'string', title: 'Item' },
      },
    },
  },
  cookieSet: { url: 'https://example.com/login', title: 'Log in' },
}

describe('getDisplayStrings', () => {
  it('resolves an exact locale across name, configSchema, and cookieSet', () => {
    const m = parse({
      ...base,
      locales: {
        'zh-CN': {
          name: '样例',
          'configSchema.properties.fmt.title': '格式',
          'configSchema.properties.fmt.description': '传输格式',
          'configSchema.properties.list.items.title': '条目',
          'cookieSet.title': '登录',
        },
      },
    })

    const d = getDisplayStrings(m, 'zh-CN')

    expect(d.name).toBe('样例')
    expect(d.configSchema?.properties?.fmt?.title).toBe('格式')
    expect(d.configSchema?.properties?.fmt?.description).toBe('传输格式')
    expect(d.configSchema?.properties?.list?.items?.title).toBe('条目')
    expect(d.cookieSet?.title).toBe('登录')
  })

  it('narrows a regional tag to the base language (zh-TW → zh)', () => {
    const m = parse({
      ...base,
      locales: { zh: { name: '樣例' } },
    })

    expect(getDisplayStrings(m, 'zh-TW').name).toBe('樣例')
  })

  it('prefers the most specific tag, per key', () => {
    const m = parse({
      ...base,
      locales: {
        zh: { name: '通用', 'cookieSet.title': '登录(通用)' },
        'zh-CN': { name: '简体' },
      },
    })

    const d = getDisplayStrings(m, 'zh-CN')
    expect(d.name).toBe('简体') // overridden by zh-CN
    expect(d.cookieSet?.title).toBe('登录(通用)') // falls through to zh
  })

  it('falls back to the source value for unlisted keys', () => {
    const m = parse({
      ...base,
      locales: { 'zh-CN': { name: '样例' } },
    })

    const d = getDisplayStrings(m, 'zh-CN')
    expect(d.name).toBe('样例')
    expect(d.configSchema?.properties?.fmt?.title).toBe('Format')
    expect(d.cookieSet?.title).toBe('Log in')
  })

  it('returns source strings when no locale is requested or none matches', () => {
    const m = parse({ ...base, locales: { 'zh-CN': { name: '样例' } } })

    expect(getDisplayStrings(m).name).toBe('Sample')
    expect(getDisplayStrings(m, 'ja').name).toBe('Sample')
    expect(
      getDisplayStrings(m, 'ja').configSchema?.properties?.fmt?.title
    ).toBe('Format')
  })

  it('applies a configSchema override even when the source field is absent', () => {
    const m = parse({
      apiVersion: 1,
      id: 'sample',
      name: 'Sample',
      version: '1.0.0',
      hosts: ['api.example.com'],
      configSchema: {
        type: 'object',
        properties: { fmt: { type: 'string', description: 'Wire format' } },
      },
      locales: {
        'zh-CN': { 'configSchema.properties.fmt.title': '格式' },
      },
    })

    // `fmt` has no source `title`; the locale supplies one (consistent with
    // how `name`/`cookieSet.title` apply overrides).
    expect(
      getDisplayStrings(m, 'zh-CN').configSchema?.properties?.fmt?.title
    ).toBe('格式')
  })

  it('localizes labelled enum options under oneOf and anyOf by index', () => {
    const m = parse({
      apiVersion: 1,
      id: 'sample',
      name: 'Sample',
      version: '1.0.0',
      hosts: ['api.example.com'],
      configSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'integer',
            enum: [0, 1],
            oneOf: [
              { const: 0, title: 'Off' },
              { const: 1, title: 'On' },
            ],
          },
          fmt: {
            type: 'string',
            anyOf: [{ const: 'xml', title: 'XML' }],
          },
        },
      },
      locales: {
        'zh-CN': {
          'configSchema.properties.mode.oneOf.1.title': '开',
          'configSchema.properties.fmt.anyOf.0.title': '旧版 XML',
        },
      },
    })

    const props = getDisplayStrings(m, 'zh-CN').configSchema?.properties
    expect(props?.mode?.oneOf).toEqual([
      { const: 0, title: 'Off' },
      { const: 1, title: '开' },
    ])
    expect(props?.fmt?.anyOf).toEqual([{ const: 'xml', title: '旧版 XML' }])
    expect(m.configSchema?.properties?.mode?.oneOf).toEqual([
      { const: 0, title: 'Off' },
      { const: 1, title: 'On' },
    ])
  })

  it('ignores unknown keys in a locale map', () => {
    const m = parse({
      ...base,
      locales: { 'zh-CN': { 'configSchema.bogus.path': 'x', name: '样例' } },
    })

    expect(getDisplayStrings(m, 'zh-CN').name).toBe('样例')
  })

  it('matches locale tags case-insensitively', () => {
    const m = parse({ ...base, locales: { 'zh-cn': { name: '样例' } } })

    expect(getDisplayStrings(m, 'zh-CN').name).toBe('样例')
  })

  it('does not mutate the source manifest', () => {
    const m = parse({
      ...base,
      locales: {
        'zh-CN': { name: '样例', 'configSchema.properties.fmt.title': '格式' },
      },
    })

    getDisplayStrings(m, 'zh-CN')

    expect(m.name).toBe('Sample')
    expect(m.configSchema?.properties?.fmt?.title).toBe('Format')
  })

  it('omits configSchema and cookieSet when the manifest has none', () => {
    const m = parse({
      apiVersion: 1,
      id: 'bare',
      name: 'Bare',
      version: '1.0.0',
      hosts: ['api.example.com'],
    })

    const d = getDisplayStrings(m, 'zh-CN')
    expect(d.name).toBe('Bare')
    expect(d.configSchema).toBeUndefined()
    expect(d.cookieSet).toBeUndefined()
  })
})
