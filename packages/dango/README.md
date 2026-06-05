# @mr-quin/dango

Declarative engine for fetching danmaku from arbitrary sources. Each source is described by a JSON manifest the engine interprets, with no per-source TypeScript needed. A host application uses dango to talk to DanDanPlay, Bilibili, Tencent, and user-added servers without shipping fetch code per source.

A dango is a stack of items on a skewer. Each source is a stack of pipeline steps that produce one of three outputs: search results, an episode list, or danmaku comments.

## What it is

- **Schema** ([`src/manifest/schema.ts`](src/manifest/schema.ts)), zod definitions for manifests. A manifest has `apiVersion`, `id`, `name`, `hosts`, optional `configSchema`/`urlMatch`/`protoDescriptors`, and three pipelines: `search`, `episodes`, `danmaku`.
- **Pipelines**: a list of named steps + a final JSONata `output` expression. Three step types:
  - `http`: one request, with optional response extraction
  - `assign`: pure transform over the current context
  - `forEach`: iterate over a JSONata-computed array, with `concurrency` and `throttleMs` controls
- **Expressions**: every templatable value (URL, query, body, header, extract, output, etc.) is a [JSONata 2](https://jsonata.org) expression evaluated against the pipeline context. A closed helper namespace (`$md5`, `$base64Encode`, `$regexExtract`, `$permute`, etc.) provides primitives; manifests cannot register new helpers at runtime.
- **Variants**: a pipeline may declare a list of `{ when, steps, output }` branches; the first whose `when` matches the inputs wins. Used for sources with config-driven fetch paths (e.g. Bilibili's XML vs protobuf danmaku).
- **Per-row `map`** (optional), a pipeline may declare a `map` expression applied row-by-row to each element of the array `output` produces (each element bound as `$`). It is a perf-shaping equivalent of folding the same expression into `output` as `[rows.(expr)]`, but runs in a tight loop instead of materializing one large projection over the whole array. Useful for large danmaku sets.
- **Wire-level header rewrites**: `rewriteHeaders` is the engine's escape hatch for Origin/Referer/User-Agent overrides. The engine passes them to the host's `FetchLike`; a browser host typically applies them via a request-header rewrite mechanism such as `chrome.declarativeNetRequest`.
- **Protobuf**: `format: 'proto'` requests pull bytes from the upstream and decode them reflectively via [`@bufbuild/protobuf`](https://github.com/bufbuild/protobuf-es) against a descriptor carried in the manifest's `protoDescriptors` field (a base64 `google.protobuf.FileDescriptorSet`). Decoding is eval-free, so it runs under a strict `unsafe-eval` CSP without any host-injected types.

## What lives here vs the host

This package is library-shippable: no `chrome.*`, `window.*`, or DOM APIs in engine code. The default `FetchLike` uses global `fetch`. A Node service could embed dango with no changes (modulo browser-only features like cookie-attached requests, which the library doesn't assume exist).

A host application is expected to provide:

- A `FetchLike` implementation, optionally rewriting `Origin`/`Referer`/`User-Agent` when `rewriteHeaders` is present
- Validation of returned items against its own canonical schemas at ingestion
- Whatever storage and rendering it needs for the raw items

Dango stops at "manifest in, raw items out."

## Public API

```ts
import { ManifestRunner, zManifest } from '@mr-quin/dango'

const manifest = zManifest.parse(manifestJson)
const runner = new ManifestRunner(manifest, { fetcher: hostFetcher })
const seasons = await runner.runSearch({ q: 'frieren' })
const episodes = await runner.runEpisodes({ seasonId: 123 })
const danmaku = await runner.runDanmaku({ cid: 456 })
```

Lower-level entry points:

- `runPipeline(manifest, variants, inputs, options)`: direct pipeline execution
- `JsonataEvaluator`: per-instance compile cache
- `ProtoRegistry`: manifest-scoped protobuf schema cache
- `findManifestForUrl(manifests, url)`: URL → manifest resolver

See [`src/index.ts`](src/index.ts) for the complete export surface.

## Trust model

Dango assumes manifests are **trusted code**. Official manifests are vetted by the project; user-installed manifests must be presented to the user with an explicit warning that they're third-party code and carry the same risks as running any untrusted code. Dango is not a sandbox: there is no JSONata evaluation timeout and no regex input caps, so a hostile manifest can still burn CPU. It does enforce a set of fixed safety and correctness guards that don't depend on trust:

| Concern                           | Guard                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth header forgery               | `Cookie`, `Authorization`, `Set-Cookie`, `Host` rejected in `headers` at runtime; `rewriteHeaders` allowlist is `Origin` / `Referer` / `User-Agent` only |
| Prototype pollution               | Step IDs must be JS identifiers; `__proto__` / `constructor` / `prototype` rejected at manifest load                                                     |
| Manifest-supplied executable code | None, JSONata is the only expression language, helpers are a closed namespace, manifests cannot register code                                            |
| Hosts allowlist                   | Resolved request URLs must match the manifest's `hosts`; private-IP, localhost, and `*.local` hosts are rejected at load and at request time             |
| Response size                     | Response bodies are capped at a fixed limit                                                                                                              |
| Runaway iteration                 | `forEach` input length and `$range` output length are capped at fixed limits                                                                             |

## Manifests live in a separate package

This package is the engine only. The actual manifests for real sources live in the sibling [`@mr-quin/dango-manifests`](../dango-manifests) package, alongside their fixtures and per-source tests. That package depends on the engine; a host application typically depends on both.

## Scripts

| Command              | Description      |
| -------------------- | ---------------- |
| `bun test`           | bun test         |
| `bun run type-check` | tsc --noEmit     |
| `bun run lint`       | oxlint           |
| `bun run build`      | Compile with tsc |

## Dependencies

- `jsonata`, `js-md5`, `fast-xml-parser`, `@bufbuild/protobuf`, `zod`

## Stability

dango is **pre-1.0** (`0.x`): the API is not frozen, so a `0.MINOR` bump may carry
breaking changes (tagged **BREAKING:** in the changelog). A `^0.2.0` range pins to
`>=0.2.0 <0.3.0`, so the next breaking minor is opt-in. `1.0.0` will freeze the
surface below and switch to standard major/minor/patch semver.

Only the exports from the package root (`@mr-quin/dango`) are public API. Deep
imports (`@mr-quin/dango/dist/...`) and anything marked `@internal` may change at
any time.

Even within the root exports, five are the surface `1.0.0` is intended to freeze
and what a host should depend on: `ManifestRunner`, `ManifestRunnerOptions`,
`FetchLike`, the `Manifest` type, and `zManifest`. Everything else exported from
the root (notably, but not limited to, `runPipeline`, `JsonataEvaluator`,
`ProtoRegistry`, the URL-match helpers, `helpers`, `zRequestSpec`, `zStep`,
`SUPPORTED_API_VERSIONS`, the cap constants, and the remaining types) is not part
of that surface and is more likely to shift before 1.0.

Manifests carry an integer `apiVersion`, versioned independently of the engine.
This engine accepts apiVersion **1** (`SUPPORTED_API_VERSIONS`). Adding optional
fields, helpers, or step types never bumps apiVersion; it is bumped only on an
incompatible schema change. A manifest declaring an apiVersion this engine does
not support fails `zManifest.parse`, so a host that gates on `safeParse` skips it:
the source is unavailable until the engine (and the host bundling it) is updated.

See [VERSIONING.md](../../VERSIONING.md) for the full policy.
