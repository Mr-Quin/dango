import { z } from 'zod'
import { isPrivateHostPattern } from '../engine/host-policy.js'
import {
  ArtplayerMetadata,
  BiliCommandGrpcMetadata,
  BiliGrpcMetadata,
  BiliUpMetadata,
  BiliXmlMetadata,
  DanuniJsonMetadata,
  DanuniPbMetadata,
  DdplayMetadata,
  DplayerMetadata,
  TencentMetadata,
  VodMetadata,
} from '@dan-uni/dan-any/adapters'

/** A JSONata expression evaluated against the pipeline context. */
const zExpr = z.string()

// String fields anywhere in the schema are JSONata expressions that must
// evaluate to a string. Keeps the surface uniform.
const zString = zExpr

const zHttpMethod = z.enum(['GET', 'POST'])
export const zResponseFormat = z.enum(['json', 'xml', 'text', 'jsonp', 'proto'])
const DAN_ANY_FORMAT_TYPES = [
  BiliXmlMetadata.type,
  BiliGrpcMetadata.type,
  BiliCommandGrpcMetadata.type,
  BiliUpMetadata.type,
  DanuniJsonMetadata.type,
  DanuniPbMetadata.type,
  ArtplayerMetadata.type,
  DplayerMetadata.type,
  DdplayMetadata.type,
  TencentMetadata.type,
  VodMetadata.type,
] as const
export const zDanAnyFormat = z.enum(DAN_ANY_FORMAT_TYPES)

// Headers allowed in `rewriteHeaders`. Auth-bearing names (Cookie, Auth) are
// forbidden everywhere; these three are the ones the host applies via DNR.
export const REWRITE_HEADER_ALLOWLIST = new Set([
  'origin',
  'referer',
  'user-agent',
])

const zRewriteHeaders = z
  .record(z.string(), zExpr)
  .refine(
    (obj) =>
      Object.keys(obj).every((k) =>
        REWRITE_HEADER_ALLOWLIST.has(k.toLowerCase())
      ),
    {
      message:
        'rewriteHeaders key not in allowlist (Origin/Referer/User-Agent)',
    }
  )

export const zRequestSpec = z.object({
  method: zHttpMethod.default('GET'),
  url: zString,
  /**
   * Either a static map of `name → expr` (each value evaluated as a string),
   * or a single expression that evaluates to a `{ name: value }` object. Use
   * the single-expression form when header names are dynamic (e.g. a
   * user-configured auth-header list).
   */
  headers: z.union([z.record(z.string(), zString), zString]).optional(),
  /** Expression evaluating to an object; values become URL-encoded query params. */
  query: zExpr.optional(),
  /** Expression evaluating to an object (JSON-encoded), string, or null. */
  body: zExpr.optional(),
  /**
   * Format of the response body.
   * When it is the metadata.type from `@dan-uni/dan-any/adapters`, the engine decodes the body with the corresponding adapter and exposes the result as a UDanmaku[] object.
   */
  format: z.union([zResponseFormat, zDanAnyFormat]).default('json'),
  /** Browser-context only. Lets the browser attach cookies for the host. */
  credentials: z.enum(['include', 'omit']).default('omit'),
  /** Key in Manifest.protoDescriptors; required when format is 'proto'. */
  protoSchema: z.string().optional(),
  /** Fully-qualified protobuf type (e.g. `pkg.SubMsg`); required when format is 'proto'. */
  protoMessage: z.string().optional(),
  /** 
   * Parameters to pass to the adapter of `@dan-uni/dan-any`.
   * Can be string-type expr (will be parsed by evalExpr)
   */
  dananyParams: z.array(z.string()).optional(),
  /** Host-applied overrides for headers fetch can't set (Origin/Referer/UA). */
  rewriteHeaders: zRewriteHeaders.optional(),
  /**
   * Extra HTTP status codes the engine treats as a successful response (body
   * parsed as usual; empty bodies decode to empty payloads). 2xx is always
   * accepted. Use for upstreams that abuse 3xx as "no more data" signals
   * (e.g. Bilibili's `seg.so` returns 304 past the last danmaku segment).
   */
  acceptStatus: z.array(z.number().int()).default([]),
  /**
   * Decompress the raw response body before applying `format`. Use for
   * upstreams that ship deflate/gzip payloads without `Content-Encoding`
   * (e.g. iQiyi's `.z` danmaku segments). The decompressed text/bytes are
   * then parsed per `format`.
   */
  decompress: z.enum(['deflate', 'deflate-raw', 'gzip']).optional(),
})
export type RequestSpec = z.infer<typeof zRequestSpec>

// Step IDs become keys on the runtime context. Reject names that would
// mutate the object's prototype instead of adding own properties.
const FORBIDDEN_STEP_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const zStepId = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'step id must be a JS-identifier')
  .refine((s) => !FORBIDDEN_STEP_IDS.has(s), {
    message: 'step id is reserved (would pollute context prototype)',
  })

const zHttpStepCache = z.object({
  /**
   * Stable cache key. Entries are scoped per ManifestRunner instance and
   * shared across calls, so the key should be a literal constant, not derived
   * from per-request inputs.
   */
  key: z.string().min(1),
  /** Entry lifetime in seconds; a stale entry is re-fetched. */
  ttlSeconds: z.number().int().positive(),
})
export type HttpStepCacheSpec = z.infer<typeof zHttpStepCache>

const zHttpStep = z
  .object({
    type: z.literal('http'),
    /** Required when `extract`/`extractHeaders` is set, since extracts are stored at context[id]. */
    id: zStepId.optional(),
    request: zRequestSpec,
    /** Per-field JSONata against the response body. */
    extract: z.record(z.string(), zExpr).optional(),
    /**
     * Per-field JSONata against the response headers. Header names are
     * lower-cased before exposure (HTTP is case-insensitive). Access with
     * bracket-quoted names for headers containing `-`:
     * `` `set-cookie` ``.
     */
    extractHeaders: z.record(z.string(), zExpr).optional(),
    /**
     * Cache the extract bag stored at context[id] across runs of the same
     * ManifestRunner instance. Use for responses that change rarely and are
     * fetched on every request (e.g. Bilibili WBI keys). The cache is keyed
     * by `cache.key`, so do not cache responses that vary per request.
     */
    cache: zHttpStepCache.optional(),
  })
  .refine(
    (step) =>
      (step.extract === undefined &&
        step.extractHeaders === undefined &&
        step.cache === undefined) ||
      step.id !== undefined,
    {
      message:
        'http step requires `id` when `extract` / `extractHeaders` / `cache` is set',
      path: ['id'],
    }
  )

const zAssignStep = z.object({
  type: z.literal('assign'),
  id: zStepId,
  /** Per-field JSONata against the current context, derived values, signing inputs. */
  values: z.record(z.string(), zExpr),
})

const zForEachStep = z
  .object({
    type: z.literal('forEach'),
    id: zStepId,
    /** Expression evaluating to an array; each element drives one iteration. */
    in: zExpr,
    /** Name the current element is bound to during iteration. */
    as: z.string().min(1),
    request: zRequestSpec,
    extract: z.record(z.string(), zExpr).optional(),
    /** Per-iteration projection over the extract bag; flat-concatenated into context[id]. */
    collect: zExpr.optional(),
    concurrency: z.number().int().min(1).max(50).default(1),
    /** Minimum milliseconds between consecutive request starts. */
    throttleMs: z.number().int().min(0).max(60_000).default(0),
    /**
     * Optional stop predicate evaluated after each iteration's collected
     * result. If truthy, this iteration's result is included and subsequent
     * iterations are skipped. Forces sequential execution (concurrency:1)
     * because parallel iterations would race past the stop signal. Used for
     * cursor-style pagination ("stop when this page is partial").
     */
    breakOn: zExpr.optional(),
    /**
     * Require N consecutive truthy `breakOn` results before stopping.
     * Default 1 (stop immediately). Raise it to tolerate transient empties.
     */
    breakOnConsecutive: z.number().int().min(1).max(20).default(1),
  })
  .refine((s) => s.breakOn === undefined || s.concurrency === 1, {
    message: 'forEach.breakOn requires concurrency: 1 (sequential execution)',
    path: ['concurrency'],
  })

export const zStep = z.discriminatedUnion('type', [
  zHttpStep,
  zAssignStep,
  zForEachStep,
])
export type Step = z.infer<typeof zStep>

const zPipeline = z.object({
  /** Per-call input names the engine validates at run time. */
  inputs: z.array(z.string()).default([]),
  steps: z.array(zStep).min(1),
  /** Final JSONata expression against the post-run context. */
  output: zExpr,
  /**
   * Optional per-row transform applied to every element of the array `output`
   * produces. Each element is the evaluation input (`$`), so the expression
   * references row fields directly. Equivalent in shape to folding the same
   * expression into `output` as `[array.(expr)]`, but the engine runs it
   * row-by-row in a tight loop instead of building one large JSONata
   * projection over the whole array. Prefer this for large danmaku sets.
   * Requires `output` to evaluate to an array.
   */
  map: zExpr.optional(),
})
export type Pipeline = z.infer<typeof zPipeline>

// Variants let a single logical pipeline pick between branches based on a
// `when` predicate against the initial inputs (e.g. Bilibili XML vs protobuf
// danmaku). Provider identity stays the same across variants.
const zVariantPipeline = zPipeline.extend({
  /** Truthy `when` selects the variant; first match wins. Omit for default. */
  when: zExpr.optional(),
})
export type VariantPipeline = z.infer<typeof zVariantPipeline>

// Pipeline fields accept either a single Pipeline or an array of variants;
// both normalize to VariantPipeline[] on parse.
const zPipelineField = z
  .union([zPipeline, z.array(zVariantPipeline).min(1)])
  .transform((v): VariantPipeline[] => (Array.isArray(v) ? v : [v]))

// API versions the engine understands. Bumps only on incompatible changes
// (helper removal, step-type semantics). Additive changes don't bump.
export const SUPPORTED_API_VERSIONS = new Set<number>([1])

// `configSchema` follows JSON Schema (draft 2020-12 subset). The engine
// validates structural fields it consumes, type, properties, default,
// required, and passes the rest through for downstream consumers (form
// renderers using rjsf, AJV validators, IDE tooling).
type JsonSchemaShape = {
  type?:
    | 'object'
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'array'
    | 'null'
  title?: string
  description?: string
  default?: unknown
  format?: string
  enum?: unknown[]
  properties?: Record<string, JsonSchemaShape>
  items?: JsonSchemaShape
  required?: string[]
  [k: string]: unknown
}
export const zConfigSchema: z.ZodType<JsonSchemaShape> = z.lazy(() =>
  z
    .object({
      type: z
        .enum([
          'object',
          'string',
          'number',
          'integer',
          'boolean',
          'array',
          'null',
        ])
        .optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      default: z.unknown().optional(),
      format: z.string().optional(),
      enum: z.array(z.unknown()).optional(),
      properties: z.record(z.string(), zConfigSchema).optional(),
      items: zConfigSchema.optional(),
      required: z.array(z.string()).optional(),
    })
    .passthrough()
)
export type ConfigSchema = z.infer<typeof zConfigSchema>

const zManifestObject = z.object({
  /** Engine API version; load fails if not in SUPPORTED_API_VERSIONS. */
  apiVersion: z
    .number()
    .int()
    .positive()
    .refine((v) => SUPPORTED_API_VERSIONS.has(v), {
      message: 'unsupported apiVersion',
    }),
  /** Stable id, becomes the providerConfigId in stored records. */
  id: z.string().regex(/^[a-z][a-z0-9_:.-]*$/i),
  name: z.string(),
  /** Manifest version for the registry / debug. Not enforced by the engine. */
  version: z.string(),
  /**
   * Allowed request hosts. Plain hostnames, `*.example.com` wildcards, or
   * the literal `*` (any host, for templates like `dandanplay` where
   * the user supplies the host via a config `baseUrl`).
   */
  hosts: z
    .array(z.string())
    .min(1)
    .refine((hosts) => hosts.every((h) => !isPrivateHostPattern(h)), {
      message:
        'hosts entry targets a private/loopback address (localhost, *.local, 127/10/172.16/192.168/169.254 ranges)',
    }),
  /** Per-installation options the user sets; merged into pipeline context at run time. */
  configSchema: zConfigSchema.optional(),
  /**
   * configValues keys whose values partition this manifest's content
   * namespace across deployments. The host restricts a season's configValues
   * to these fields, normalizes, and hashes them to derive a stable
   * namespaceKey identifying the content namespace the season's providerIds
   * are valid in. Each entry must name a top-level `configSchema` property.
   *
   * An empty array means no config value partitions content: the namespace is
   * the manifest id alone (fixed-site sources like bilibili/tencent). A
   * self-hostable / multi-instance source lists the field(s) that vary per
   * deployment (e.g. `["baseUrl"]` for a DanDanPlay-compatible server).
   *
   * Required and explicit: omitting it is an authoring error, never a silent
   * default. The declaration is read per manifest version, so a later version
   * may change it (e.g. `[]` -> `["baseUrl"]`). The engine only declares which
   * fields matter; it never computes or hashes the key.
   */
  identityFields: z.array(z.string()),
  /**
   * Patterns for the host's "which source handles this URL" resolver.
   * Each entry: URL host matches `host` (exact / `*.domain`) AND pathname
   * matches the `path` regex.
   */
  urlMatch: z
    .array(z.object({ host: z.string(), path: z.string() }))
    .default([]),
  /**
   * Precompiled protobuf descriptors keyed by name; referenced via
   * `request.protoSchema`. Each value is a base64-encoded
   * `google.protobuf.FileDescriptorSet`. Decoded reflectively at runtime,
   * so no codegen/eval is needed (safe under a strict `unsafe-eval` CSP).
   */
  protoDescriptors: z.record(z.string(), z.string()).default({}),
  /** A manifest replacing a built-in source must implement all three pipelines. */
  search: zPipelineField.optional(),
  episodes: zPipelineField.optional(),
  danmaku: zPipelineField.optional(),
  /** Re-fetch a stored season's metadata. Inputs are the season's providerIds. */
  season: zPipelineField.optional(),
  /**
   * Resolve a URL to a `{ seasonInsert, episodeMeta }` pair. Named capture
   * groups from the first matching `urlMatch` entry become pipeline inputs
   * (e.g. `path: '/play/ss(?<ssid>\\d+)'` → input `ssid` available in the
   * pipeline context).
   */
  parseUrl: zPipelineField.optional(),
  /**
   * Probe whether the user's stored session/cookies grant a valid session
   * at this source. Output shape is source-specific (user-info object,
   * boolean, etc.); the host inspects it per provider.
   */
  loginProbe: zPipelineField.optional(),
  /**
   * Declarative login action: opening (or fetching) `url` is expected to
   * persist session cookies for this source. The host renders a button
   * surfaced when the user wants to authenticate; presence of this field
   * is what makes that button appear.
   */
  cookieSet: z
    .object({
      url: z.url(),
      title: z.string().optional(),
    })
    .optional(),
  /**
   * Translations for display strings, keyed by BCP-47 locale then by dotted
   * path to the field (`name`, `cookieSet.title`, and `configSchema`
   * `title`/`description` at any depth, e.g.
   * `configSchema.properties.danmakuFormat.title`). Top-level fields are the
   * source/fallback language; only differing strings are listed. Presentation
   * only — the pipeline never reads this; resolve via `getDisplayStrings`.
   */
  locales: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})

export const zManifest = zManifestObject.superRefine((manifest, ctx) => {
  // Every identity field must name a declared top-level configSchema property.
  // This catches typos and fields removed from the schema, and rejects a
  // non-empty list on a manifest with no configSchema at all.
  const props = manifest.configSchema?.properties ?? {}
  const seen = new Set<string>()
  for (const field of manifest.identityFields) {
    if (seen.has(field)) {
      ctx.addIssue({
        code: 'custom',
        path: ['identityFields'],
        message: `duplicate identityFields entry "${field}"`,
      })
    }
    seen.add(field)
    if (!(field in props)) {
      ctx.addIssue({
        code: 'custom',
        path: ['identityFields'],
        message: `identityFields entry "${field}" is not a configSchema property`,
      })
    }
  }
})
export type Manifest = z.infer<typeof zManifest>
