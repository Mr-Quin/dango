import { describe, expect, it } from 'bun:test'
import { validateConfig } from '../manifest/configValidation.js'
import type { ConfigSchema } from '../manifest/schema.js'

/**
 * Tests validateConfig against the configSchema dialect: types (integer vs
 * number, NaN), enum and labelled-enum (`oneOf` of `const`) membership,
 * `required` with empty values counting as absent, `anyOf` key alternatives
 * and general subschema branches, nested objects and array items with paths,
 * string and number constraints, and `additionalProperties: false`.
 */

const dandanplay: ConfigSchema = {
  type: 'object',
  anyOf: [{ required: ['baseUrl'] }, { required: ['appId', 'appSecret'] }],
  properties: {
    baseUrl: { type: 'string' },
    appId: { type: 'string' },
    appSecret: { type: 'string' },
    auth: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        headers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'value'],
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
          },
        },
      },
    },
    chConvert: {
      type: 'integer',
      enum: [0, 1, 2],
      oneOf: [
        { const: 0, title: 'None' },
        { const: 1, title: 'Simplified' },
        { const: 2, title: 'Traditional' },
      ],
      default: 0,
    },
  },
}

function codes(schema: ConfigSchema | undefined, value: unknown) {
  return validateConfig(schema, value).map((issue) => [
    issue.path.join('.'),
    issue.code,
  ])
}

describe('validateConfig', () => {
  it('accepts anything when there is no schema', () => {
    expect(validateConfig(undefined, { anything: 1 })).toEqual([])
  })

  it('accepts a valid dandanplay config', () => {
    expect(
      validateConfig(dandanplay, {
        baseUrl: 'https://ddp.example',
        chConvert: 1,
        auth: { enabled: true, headers: [{ key: 'X-Token', value: 'abc' }] },
      })
    ).toEqual([])
  })

  it('reports the key alternatives when none is filled in', () => {
    const issues = validateConfig(dandanplay, { appId: 'id', chConvert: 0 })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      path: [],
      code: 'requiredAlternatives',
      params: { alternatives: [['baseUrl'], ['appId', 'appSecret']] },
    })
  })

  it('treats an empty string as a missing value', () => {
    expect(codes(dandanplay, { baseUrl: '' })).toEqual([
      ['', 'requiredAlternatives'],
    ])
    expect(
      codes(
        { type: 'object', required: ['name'], properties: {} },
        { name: '' }
      )
    ).toEqual([['name', 'required']])
  })

  it('reports a missing required key at its own path', () => {
    expect(
      codes(dandanplay, {
        baseUrl: 'https://ddp.example',
        auth: { headers: [{ key: 'X-Token' }] },
      })
    ).toEqual([['auth.headers.0.value', 'required']])
  })

  it('rejects a value of the wrong type', () => {
    expect(
      codes(dandanplay, { baseUrl: 42, auth: { enabled: 'yes' } })
    ).toEqual([
      ['baseUrl', 'type'],
      ['auth.enabled', 'type'],
    ])
  })

  it('tells integers from other numbers', () => {
    expect(codes(dandanplay, { baseUrl: 'x', chConvert: 1.5 })).toEqual([
      ['chConvert', 'type'],
    ])
    expect(codes({ type: 'number' }, Number.NaN)).toEqual([['', 'type']])
    expect(codes({ type: 'number' }, 1.5)).toEqual([])
  })

  it('rejects a value outside the enum', () => {
    expect(
      codes({ type: 'string', enum: ['xml', 'protobuf'] }, 'json')
    ).toEqual([['', 'enum']])
  })

  it('treats a oneOf of labelled consts as an enum', () => {
    const format: ConfigSchema = {
      type: 'string',
      oneOf: [
        { const: 'xml', title: 'XML' },
        { const: 'protobuf', title: 'Protobuf' },
      ],
    }
    expect(codes(format, 'protobuf')).toEqual([])
    const issues = validateConfig(format, 'json')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'enum',
      params: { options: ['xml', 'protobuf'] },
    })
  })

  it('requires exactly one matching branch for a general oneOf', () => {
    const schema: ConfigSchema = {
      oneOf: [{ type: 'string' }, { type: 'number', minimum: 0 }],
    }
    expect(codes(schema, 'a')).toEqual([])
    expect(codes(schema, 3)).toEqual([])
    expect(codes(schema, -1)).toEqual([['', 'oneOf']])
    expect(codes(schema, true)).toEqual([['', 'oneOf']])
  })

  it('accepts a general anyOf when one branch matches', () => {
    const schema: ConfigSchema = {
      anyOf: [{ type: 'string', minLength: 3 }, { type: 'boolean' }],
    }
    expect(codes(schema, 'abc')).toEqual([])
    expect(codes(schema, false)).toEqual([])
    expect(codes(schema, 'ab')).toEqual([['', 'anyOf']])
  })

  it('checks string constraints', () => {
    const schema: ConfigSchema = {
      type: 'object',
      properties: {
        short: { type: 'string', minLength: 2, maxLength: 3 },
        code: { type: 'string', pattern: '^[a-z]+$' },
        url: { type: 'string', format: 'uri' },
      },
    }
    expect(codes(schema, { short: 'a', code: 'A1', url: 'not a url' })).toEqual(
      [
        ['short', 'minLength'],
        ['code', 'pattern'],
        ['url', 'format'],
      ]
    )
    expect(codes(schema, { short: 'abcd' })).toEqual([['short', 'maxLength']])
    expect(
      codes(schema, { short: 'ab', code: 'ok', url: 'https://a.example' })
    ).toEqual([])
  })

  it('matches a pattern with Unicode semantics', () => {
    const schema: ConfigSchema = {
      type: 'string',
      pattern: String.raw`^\p{Script=Han}+$`,
    }
    expect(codes(schema, '弹幕')).toEqual([])
    expect(codes(schema, 'abc')).toEqual([['', 'pattern']])
  })

  it('ignores keywords outside the supported subset', () => {
    const schema: ConfigSchema = {
      type: 'string',
      allOf: [{ minLength: 10 }],
      format: 'hostname',
    }
    expect(codes(schema, 'a')).toEqual([])
  })

  it('falls back to a plain regex when the pattern needs it', () => {
    const schema: ConfigSchema = { type: 'string', pattern: String.raw`^a\-b$` }
    expect(codes(schema, 'a-b')).toEqual([])
    expect(codes(schema, 'ab')).toEqual([['', 'pattern']])
  })

  it('reports a pattern that is not a regex at all', () => {
    expect(codes({ type: 'string', pattern: '(' }, 'anything')).toEqual([
      ['', 'badPattern'],
    ])
  })

  it('checks number bounds', () => {
    const schema: ConfigSchema = { type: 'integer', minimum: 1, maximum: 5 }
    expect(codes(schema, 0)).toEqual([['', 'minimum']])
    expect(codes(schema, 6)).toEqual([['', 'maximum']])
    expect(codes(schema, 3)).toEqual([])
  })

  it('checks array length and items', () => {
    const schema: ConfigSchema = {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'string' },
    }
    expect(codes(schema, [])).toEqual([['', 'minItems']])
    expect(codes(schema, ['a', 'b', 'c'])).toEqual([['', 'maxItems']])
    expect(codes(schema, ['a', 2])).toEqual([['1', 'type']])
  })

  it('rejects unknown keys only when additionalProperties is false', () => {
    const open: ConfigSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
    }
    const closed: ConfigSchema = { ...open, additionalProperties: false }
    expect(codes(open, { a: 'x', b: 1 })).toEqual([])
    expect(codes(closed, { a: 'x', b: 1 })).toEqual([
      ['b', 'additionalProperties'],
    ])
  })

  it('rejects a non-object where an object is expected', () => {
    expect(codes(dandanplay, 'not an object')).toEqual([['', 'type']])
    expect(codes(dandanplay, ['baseUrl'])).toEqual([['', 'type']])
  })

  it('gives every issue a readable message', () => {
    const issues = validateConfig(dandanplay, { chConvert: 7 })
    for (const issue of issues) {
      expect(issue.message.length).toBeGreaterThan(0)
    }
  })
})
