import type { ConfigSchema } from './schema.js'

export type ConfigIssueCode =
  | 'type'
  | 'required'
  | 'requiredAlternatives'
  | 'enum'
  | 'oneOf'
  | 'anyOf'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'badPattern'
  | 'format'
  | 'minimum'
  | 'maximum'
  | 'minItems'
  | 'maxItems'
  | 'additionalProperties'

export interface ConfigIssue {
  /** Keys and array indexes from the config root to the offending value. */
  path: (string | number)[]
  code: ConfigIssueCode
  /** English fallback; hosts that localize build their own text from `code` and `params`. */
  message: string
  params?: Record<string, unknown>
}

type Path = (string | number)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The manifests read `''` as not set (`baseUrl ? ... : official`), so it
// counts as absent for `required` and skips the value's other checks.
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function numberKeyword(schema: ConfigSchema, key: string): number | undefined {
  const value = schema[key]
  return typeof value === 'number' ? value : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.every((item) => typeof item === 'string') ? value : undefined
}

function schemaList(value: unknown): ConfigSchema[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }
  return value.every(isRecord) ? (value as ConfigSchema[]) : undefined
}

// `oneOf: [{ const, title }]`: a choice list with a label per option.
function labelledOptions(branches: ConfigSchema[] | undefined) {
  if (!branches?.every((branch) => 'const' in branch)) {
    return undefined
  }
  return branches.map((branch) => branch.const)
}

// `anyOf: [{ required: [...] }, ...]` on an object: one of the key sets has
// to be filled in, such as a server URL or a pair of credentials.
function requiredAlternatives(branches: ConfigSchema[] | undefined) {
  if (!branches) {
    return undefined
  }
  const alternatives: string[][] = []
  for (const branch of branches) {
    const keys = stringList(branch.required)
    const onlyRequired = Object.keys(branch).every((key) => {
      return key === 'required' || key === 'title' || key === 'description'
    })
    if (!keys || keys.length === 0 || !onlyRequired) {
      return undefined
    }
    alternatives.push(keys)
  }
  return alternatives
}

function typeMatches(type: ConfigSchema['type'], value: unknown): boolean {
  switch (type) {
    case undefined:
      return true
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'null':
      return value === null
  }
}

class Collector {
  readonly issues: ConfigIssue[] = []

  add(
    path: Path,
    code: ConfigIssueCode,
    message: string,
    params?: Record<string, unknown>
  ): void {
    this.issues.push(
      params === undefined
        ? { path: [...path], code, message }
        : { path: [...path], code, message, params }
    )
  }
}

function validateNode(
  schema: ConfigSchema,
  value: unknown,
  path: Path,
  out: Collector
): void {
  if (isAbsent(value)) {
    return
  }
  if (!typeMatches(schema.type, value)) {
    out.add(path, 'type', `Expected ${schema.type}`, { expected: schema.type })
    return
  }
  validateChoices(schema, value, path, out)
  validateBranches(schema, value, path, out)
  if (typeof value === 'string') {
    validateString(schema, value, path, out)
  } else if (typeof value === 'number') {
    validateNumber(schema, value, path, out)
  } else if (Array.isArray(value)) {
    validateArray(schema, value, path, out)
  } else if (isRecord(value)) {
    validateObject(schema, value, path, out)
  }
}

function validateChoices(
  schema: ConfigSchema,
  value: unknown,
  path: Path,
  out: Collector
): void {
  const options =
    schema.enum ??
    labelledOptions(schemaList(schema.oneOf)) ??
    labelledOptions(schemaList(schema.anyOf))
  if (options === undefined) {
    return
  }
  if (!options.some((option) => option === value)) {
    out.add(path, 'enum', `Must be one of ${options.join(', ')}`, { options })
  }
}

function matchesSchema(schema: ConfigSchema, value: unknown): boolean {
  const branch = new Collector()
  validateNode(schema, value, [], branch)
  return branch.issues.length === 0
}

function validateBranches(
  schema: ConfigSchema,
  value: unknown,
  path: Path,
  out: Collector
): void {
  const oneOf = schemaList(schema.oneOf)
  if (oneOf && labelledOptions(oneOf) === undefined) {
    const matching = oneOf.filter((branch) => matchesSchema(branch, value))
    if (matching.length !== 1) {
      out.add(path, 'oneOf', 'Must match exactly one of the allowed forms')
    }
  }
  const anyOf = schemaList(schema.anyOf)
  if (!anyOf || labelledOptions(anyOf) !== undefined) {
    return
  }
  const alternatives = requiredAlternatives(anyOf)
  if (alternatives && isRecord(value)) {
    const satisfied = alternatives.some((keys) => {
      return keys.every((key) => !isAbsent(value[key]))
    })
    if (!satisfied) {
      const fields = alternatives.map((keys) => keys.join(' and ')).join(' or ')
      out.add(path, 'requiredAlternatives', `Fill in ${fields}`, {
        alternatives,
      })
    }
    return
  }
  if (!anyOf.some((branch) => matchesSchema(branch, value))) {
    out.add(path, 'anyOf', 'Must match at least one of the allowed forms')
  }
}

function tryRegExp(pattern: string, flags: string): RegExp | undefined {
  try {
    return new RegExp(pattern, flags)
  } catch {
    return undefined
  }
}

// JSON Schema patterns are ECMA-262 regexes with Unicode semantics, but
// manifests written for plain JS regexes use escapes the u flag rejects, such
// as `\-` outside a class.
function compilePattern(pattern: string): RegExp | undefined {
  return tryRegExp(pattern, 'u') ?? tryRegExp(pattern, '')
}

// URL.canParse is missing from browsers some hosts still support.
function isUrl(value: string): boolean {
  try {
    return new URL(value).href.length > 0
  } catch {
    return false
  }
}

function validateString(
  schema: ConfigSchema,
  value: string,
  path: Path,
  out: Collector
): void {
  const minLength = numberKeyword(schema, 'minLength')
  if (minLength !== undefined && value.length < minLength) {
    out.add(path, 'minLength', `Must be at least ${minLength} characters`, {
      min: minLength,
    })
  }
  const maxLength = numberKeyword(schema, 'maxLength')
  if (maxLength !== undefined && value.length > maxLength) {
    out.add(path, 'maxLength', `Must be at most ${maxLength} characters`, {
      max: maxLength,
    })
  }
  const pattern = schema.pattern
  if (typeof pattern === 'string' && pattern.length > 0) {
    const regex = compilePattern(pattern)
    if (!regex) {
      out.add(path, 'badPattern', `The schema pattern ${pattern} is invalid`, {
        pattern,
      })
    } else if (!regex.test(value)) {
      out.add(path, 'pattern', `Must match ${pattern}`, { pattern })
    }
  }
  if ((schema.format === 'uri' || schema.format === 'url') && !isUrl(value)) {
    out.add(path, 'format', 'Not a valid URL', { format: schema.format })
  }
}

function validateNumber(
  schema: ConfigSchema,
  value: number,
  path: Path,
  out: Collector
): void {
  const minimum = numberKeyword(schema, 'minimum')
  if (minimum !== undefined && value < minimum) {
    out.add(path, 'minimum', `Must be at least ${minimum}`, { min: minimum })
  }
  const maximum = numberKeyword(schema, 'maximum')
  if (maximum !== undefined && value > maximum) {
    out.add(path, 'maximum', `Must be at most ${maximum}`, { max: maximum })
  }
}

function validateArray(
  schema: ConfigSchema,
  value: unknown[],
  path: Path,
  out: Collector
): void {
  const minItems = numberKeyword(schema, 'minItems')
  if (minItems !== undefined && value.length < minItems) {
    out.add(path, 'minItems', `Must have at least ${minItems} items`, {
      min: minItems,
    })
  }
  const maxItems = numberKeyword(schema, 'maxItems')
  if (maxItems !== undefined && value.length > maxItems) {
    out.add(path, 'maxItems', `Must have at most ${maxItems} items`, {
      max: maxItems,
    })
  }
  const items = schema.items
  if (!items) {
    return
  }
  value.forEach((item, index) => {
    validateNode(items, item, [...path, index], out)
  })
}

function validateObject(
  schema: ConfigSchema,
  value: Record<string, unknown>,
  path: Path,
  out: Collector
): void {
  const properties = schema.properties ?? {}
  for (const key of stringList(schema.required) ?? []) {
    if (isAbsent(value[key])) {
      out.add([...path, key], 'required', 'Required')
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    validateNode(propertySchema, value[key], [...path, key], out)
  }
  if (schema.additionalProperties !== false) {
    return
  }
  for (const key of Object.keys(value)) {
    if (!(key in properties)) {
      out.add([...path, key], 'additionalProperties', 'Unknown setting')
    }
  }
}

/**
 * Checks a config against a manifest's `configSchema`. Supports the subset the
 * manifests use: `type`, `enum`, labelled enums (`oneOf`/`anyOf` of `const`),
 * `required`, `anyOf` key alternatives, general `oneOf`/`anyOf` subschemas,
 * `properties`, `items`, `additionalProperties: false`, `minLength`,
 * `maxLength`, `pattern` (reported as `badPattern` when it is not a regex),
 * `format: 'uri' | 'url'`, `minimum`, `maximum`,
 * `minItems` and `maxItems`. Any other keyword, such as `allOf`, `$ref` or
 * another `format`, is ignored rather than reported, so a schema that relies
 * on one accepts values it would otherwise reject. `undefined`, `null` and
 * `''` count as not set. An empty list means the config is valid; without a
 * schema every config is.
 */
export function validateConfig(
  schema: ConfigSchema | undefined,
  value: unknown
): ConfigIssue[] {
  if (!schema) {
    return []
  }
  const out = new Collector()
  validateNode(schema, value, [], out)
  return out.issues
}
