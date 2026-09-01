# Changelog

All notable changes to dango (`@mr-quin/dango` and `@mr-quin/dango-manifests`)
are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org). Pre-1.0 (`0.x`): the API
is not frozen, so a `0.MINOR` bump may carry breaking changes; they are tagged
**BREAKING:** regardless. `1.0.0` will freeze the public surface.
See [VERSIONING.md](./VERSIONING.md) for the full policy.

The engine version and the manifest `apiVersion` are tracked independently.

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.8.3] - 2026-09-01

Two manifest fixes for the same JSONata trap: a `forEach` whose input list
collapsed to a bare value when upstream returned exactly one row.

### Fixed

- `@mr-quin/dango-manifests`: mango (芒果TV) episodes threw
  `forEach.in must evaluate to an array, got string` for a show whose showlist
  carries a single month tab, because JSONata unwraps a single-element
  projection. A newly launched variety show failed until it ran into a second
  month, at which point the projection became an array again and the failure
  disappeared on its own. The month extract is now wrapped in `[...]`.
  (mango manifest `0.7.0` → `0.7.1`.)
- `@mr-quin/dango-manifests`: youku danmaku had the same shape through `$map`,
  which returns a bare object rather than a one-element array for a video short
  enough to need a single segment. The `iters` expression is now wrapped in
  `[...]`. (youku manifest `0.5.1` → `0.5.2`.)

## [0.8.2] - 2026-08-26

An opt-in bilibili option: search user uploads, not only the official bangumi
catalogue. Engine untouched.

### Added

- `@mr-quin/dango-manifests`: bilibili search can now include user-uploaded
  (UGC) videos, behind an opt-in `includeUserUploads` config flag (boolean,
  default `false`). Anime and shows that exist only as user uploads were
  unreachable, so their danmaku was too. When the flag is on, search adds a
  WBI-signed `search_type=video` call and appends those hits with
  `{ bvid, aid }` providerIds; `episodes`, `season`, and `parseUrl` gained a
  matching variant that reads `/x/web-interface/view`, listing a collection's
  videos (`ugc_season`) or the video's own parts (`pages`) as episodes.
  `urlMatch` also claims `/video/BV…` and `/video/av…` pages, which is not
  gated by the flag. Danmaku is unchanged; both branches resolve to a `cid`.
  (bilibili manifest `0.5.0` → `0.6.0`.)

## [0.8.1] - 2026-07-25

A mango search repair: sibling seasons upstream moved into a content block the
manifest did not read.

### Fixed

- `@mr-quin/dango-manifests`: mango (芒果TV) search returned only the newest
  season of a series. Upstream now emits a single `mediaRebirthV2` entry and
  demotes every sibling season and spin-off into a `clipMerge` block, so
  searching 大侦探 yielded 第十一季 alone instead of all eleven seasons. Search
  output now unions both blocks (deduped by `clipId`) and also reads
  `mediaRebirthV3`, which carries mango-own media of the same shape.
  `clipMerge` rows only carry `clipId`/`title`/`img`, so `type`, `year` and
  `episodeCount` are absent on those results; `episodeCount` is now generally
  absent anyway, since upstream dropped `videoCount` from the media rows.
  (mango manifest `0.6.0` → `0.7.0`.)

## [0.8.0] - 2026-07-24

Typed base64 errors in the engine, plus repairs to four provider manifests
whose live search or danmaku had drifted.

### Added

- `@mr-quin/dango`: `Base64DecodeError`, raised by the codec/crypto helpers
  (`base64Decode`, and `aesCbcDecrypt`/`aesCbcEncrypt` via `base64ToBytes`) when
  given input that is not valid base64. It previously surfaced as a raw
  `DOMException` from `atob`, so a junk or empty upstream field now classifies as
  a typed engine error with context instead of an opaque platform exception.

### Fixed

- `@mr-quin/dango-manifests`: hanjutv search returned an empty encrypted payload
  and threw. The manifest now warms up the mobile identity via
  `/api/common/configs` before the s5 search and guards the empty-data path.
- `@mr-quin/dango-manifests`: mango search returned 403 from the web search
  endpoint. Moved to the aphone rebirth search endpoint with a device signature.
- `@mr-quin/dango-manifests`: migu search returned 403 as a GET. It now POSTs the
  open-search request, and the danmaku color parsing is corrected.
- `@mr-quin/dango-manifests`: youku danmaku threw on a cold mtop token. The
  pipeline now guards the missing-token path.

## [0.7.0] - 2026-06-13

Manifests now declare their content-namespace identity, letting a host derive a
stable per-deployment namespace key for a saved season.

### Added

- `@mr-quin/dango`: `identityFields`, a required manifest field listing the
  `configSchema` config keys whose values partition the manifest's content
  namespace across deployments. An empty list means the namespace is the
  manifest id alone (fixed-site sources like bilibili/tencent); a self-hostable
  source lists the deployment-varying field(s) (e.g. dandanplay declares
  `["baseUrl"]`, since a self-hosted DanDanPlay-compatible server has its own
  private id space). The schema rejects entries that don't name a declared
  top-level `configSchema` property.
- `@mr-quin/dango`: `ManifestRunner.identityFields()`, returning the declared
  list so a host can resolve, normalize, and hash a season's identifying config
  values into a stable namespace key. The engine only declares which fields
  matter; it never computes the key.

### Changed

- **BREAKING:** `@mr-quin/dango`: `identityFields` is now required on every
  manifest; a manifest that omits it is rejected at parse time, with no implicit
  default. `apiVersion` stays `1` (a pre-1.0 `0.x` breaking format change).
- `@mr-quin/dango-manifests`: every manifest now declares `identityFields`
  (dandanplay `["baseUrl"]`, all others `[]`) and is bumped to `0.5.0`.

### Fixed

- `@mr-quin/dango-manifests`: mango (芒果TV) episodes came back reverse-
  chronological (newest first) because mgtv returns months newest-first and the
  per-month lists are reversed too. The episodes pipeline now sorts by the `ts`
  timestamp ascending, restoring episode order. (mango manifest `0.4.0` →
  `0.4.1`.)

## [0.6.0] - 2026-06-07

Concurrent `forEach` steps now fail fast, plus a host opt-in for partial
results on per-iteration failures.

### Added

- `continueOnError` option on `RunOptions` (engine): a host-app-supplied,
  default-off opt-in that makes every `forEach` step tolerate per-iteration
  request failures — a failed iteration is skipped and the rest still run,
  yielding partial results. Threaded through `ManifestRunner` per call; hosts
  typically set it only on `runDanmaku`, where one missing segment shouldn't
  drop the whole overlay. A genuine abort always propagates regardless.

### Fixed

- Concurrent `forEach` steps now fail fast: when one iteration's request fails,
  the in-flight sibling requests are cancelled and no further requests are
  dispatched before the step rejects. Previously the remaining requests kept
  firing after the failure had already doomed the step.

## [0.5.0] - 2026-06-07

Host-app opt-in for private/loopback endpoints, plus localizable host-rejection
errors.

### Added

- `allowPrivateHosts` option on `RunOptions` (engine): a host-app-supplied,
  default-off opt-in that lifts the request-time private/loopback-host block for
  a deliberately user-authorized local endpoint (e.g. a self-hosted
  dandanplay-compatible server). It cannot be set from a manifest, and the
  `hosts` allowlist still applies, so a host outside the allowlist — private or
  not — is still rejected.
- `HostNotAllowedError` class and `HostRejectionCode` type (engine), exported
  from the package root. A rejected request now throws this typed error carrying
  a stable `code` (`'private-host-blocked'` | `'host-not-allowed'`) and the
  offending `url`, so a host app can localize off the code.

### Changed

- Request-time host rejection now throws `HostNotAllowedError` (a subclass of
  `Error`) instead of a plain `Error`, and the private-host rejection message
  text changed. Consumers that matched the old message string should switch to
  the typed error's `code`.

## [0.4.0] - 2026-06-07

Localization for manifest-authored display strings.

### Added

- `getDisplayStrings(manifest, locale)` and the `ResolvedDisplayStrings` type
  (engine): resolves a manifest's display strings — `name`, `configSchema`
  `title`/`description` (recursive), and `cookieSet.title` — into a locale, with
  BCP-47 narrowing (`zh-TW` → `zh`) and per-key fallback to the source language.
  Pure and off the execution path; the runner never reads it.
- `locales` optional field on the manifest (`zManifest`): translations keyed by
  BCP-47 locale then by dotted path to the field. Additive; manifest `apiVersion`
  stays 1.
- `zh-CN` translations for all thirteen built-in manifests.

### Changed

- `@mr-quin/dango-manifests`: reworded the DanDanPlay `appId`/`appSecret` config
  help for accuracy (dropped a misleading "never sent" claim) and set the
  Bilibili display name to `B站`.

## [0.3.0] - 2026-06-05

Pre-1.0 release bundling the CDN catalog index, engine security hardening, and a
breaking manifest-id rename.

### Changed

- **BREAKING:** built-in manifest ids drop the `builtin:` prefix. Each shipped
  manifest's `id` is now the bare source name (`builtin:bilibili` becomes
  `bilibili`, and likewise for every source). Consumers that reference a manifest
  by id must migrate `builtin:X` to `X`. New ids: `aiyifan`, `bahamut`,
  `bilibili`, `dandanplay`, `hanjutv`, `iqiyi`, `maiduidui`, `mango`, `migu`,
  `renren`, `sohu`, `tencent`, `youku`.
- **BREAKING:** manifest filenames drop the `builtin-` prefix to match the bare
  ids: `src/manifests/builtin-<source>.json` becomes `src/manifests/<source>.json`.
  Consumers importing a manifest via the `./manifests/*` subpath must migrate the
  path (e.g. `.../manifests/builtin-bilibili.json` to `.../manifests/bilibili.json`).
  The package `exports` glob is unchanged and resolves the bare names.

### Added

- `catalog.json`: a CDN-consumable index of the shipped manifests, generated from
  the manifests on disk and validated in CI. A host reads the catalog over a CDN
  (jsDelivr / unpkg) and fetches each entry's `file` path. Regenerated by
  `bun run catalog`; `bun run check` fails on a stale copy.
- Engine security caps for untrusted manifests: a JSONata evaluation timeout
  (`DEFAULT_EVAL_TIMEOUT_MS`, `JsonataTimeoutError`), an expression-cache bound
  (`DEFAULT_MAX_CACHE_SIZE`), a response body-size limit
  (`DEFAULT_MAX_BODY_BYTES`), and a `forEach` iteration cap
  (`DEFAULT_MAX_FOR_EACH_ITEMS`), all exported and overridable by the host.

## [0.2.0] - 2026-06-02

Pre-1.0 release. Two packages published under the `@mr-quin` scope
(bun + tsc + oxlint + oxfmt, ESM-only). The API is not frozen yet; `1.0.0` will
freeze it.

### Changed

- **BREAKING (since 0.1.0):** proto decoding migrated from `protobufjs` to
  `@bufbuild/protobuf`. The host-injected `protoTypes` constructor option and the
  `ProtoTypeOverrides` type are removed; manifests now carry a base64
  `protoDescriptors` map and the engine decodes wire bytes reflectively, so no
  precompiled types are injected from the host. The `protobufjs` runtime
  dependency is dropped. Consumers passing `protoTypes` must remove it; sources
  using `format: 'proto'` (Bilibili) must carry `protoDescriptors`.
- Built-in manifests went from 6 to 13: added Youku, Mango TV, iQIYI, Aiyifan,
  Bahamut, Maiduidui, Renren, Sohu, and merged `builtin:ddp-compat` into
  `builtin:dandanplay` (0.1.0 shipped DanDanPlay, ddp-compat, Bilibili, Tencent,
  Hanjutv, Migu).
- **BREAKING (since 0.1.0):** `builtin:dandanplay` is now one unified DDP source
  with a configurable `baseUrl` (default official `api.dandanplay.net`) and
  optional auth: `appId`/`appSecret` request signing
  (`Base64(SHA256(appId + timestamp + path + appSecret))`), custom `auth` headers,
  or none. It replaces both the old proxy-routed dandanplay and the separate
  `builtin:ddp-compat` (removed). The package references no host-specific backend;
  a host points `baseUrl` at its own proxy or a self-hosted server.

### Fixed

- **XML text coercion (since 0.1.0):** the XML parser set `parseTagValue` to its
  default `true`, so a purely numeric danmaku comment ("666") was coerced to a JS
  number. Passed through as `m`, that crashed numeric-unaware consumers (e.g. a
  `text.includes(...)` collapse pass). Now `parseTagValue: false`, so scraped XML
  text stays a raw string; manifests use `$number` where a number is wanted.
  Affects the XML sources (`builtin:bilibili` xml variant, `builtin:iqiyi`).
- **episodeNumber polluted with non-ordinal text / wrong type:** `builtin:bilibili`
  mapped `episodeNumber` to the combined `show_title` ("第1话 旅途的终点"); both the
  episodes and parseUrl pipelines now read the `title` ordinal. `builtin:migu`
  fell back to the episode name when
  `episodeNumber` was absent; it now falls back to `undefined`. `builtin:tencent`,
  `builtin:dandanplay`, and `builtin:hanjutv` now emit a numeric ordinal
  (coerced / un-stringified) instead of a string.
- **`builtin:hanjutv` danmaku mode:** an out-of-range `tp` produced an invalid
  danmaku mode (consumer parsers reject it). Unknown modes now clamp to `1`.
- **`builtin:migu` danmaku color:** `$hexToInt` now guards a missing `textcolor`
  with a white default instead of erroring.
- **`builtin:dandanplay` search year:** guarded so an empty `startDate` no longer
  throws and fails the whole search.
- **`builtin:bilibili` season:** `type` now uses `season_type_name` (matching
  search) when present, and `episodeCount` excludes `预告` previews.

### Added

- `$sha256Base64` helper (`Base64(SHA256(utf8(input)))`) for API request signing.

- `@mr-quin/dango`: the declarative manifest engine. A source is described by a
  JSON manifest the engine interprets at runtime, so adding or fixing a source
  needs no per-source fetch code. Platform-agnostic: no `chrome.*`, `window`,
  DOM-only globals, or `node:` builtins, so it runs in a browser, a service
  worker, or Node. Public entry exports `ManifestRunner`, `zManifest`, the
  URL-match helpers, the pipeline API, and the manifest types.
- `@mr-quin/dango-manifests`: the fourteen built-in source manifests (JSON) with
  fixtures and per-source tests. The published package is data. Sources:
  DanDanPlay, DanDanPlay-compatible, Bilibili, Tencent, Youku, Mango TV, Migu,
  Hanjutv, iQIYI, Aiyifan, Bahamut, Maiduidui, Renren, Sohu.
- Protobuf decoding is eval-free: `format: 'proto'` requests decode wire bytes
  reflectively via `@bufbuild/protobuf` against a base64
  `google.protobuf.FileDescriptorSet` carried in the manifest's
  `protoDescriptors` field. No codegen and no host-injected types are required,
  so it runs under a strict `unsafe-eval` CSP.
- Manifest apiVersion 1 (engine accepts 1-1), the current manifest-format
  contract.

## [0.1.0] - 2026-06-02

Initial pre-stable release: the manifest engine (protobufjs-based, with a
host-injected `protoTypes` option) plus six built-in manifests (DanDanPlay,
DanDanPlay-compatible, Bilibili, Tencent, Hanjutv, Migu). Superseded same-day by
0.2.0; see the BREAKING notes above before upgrading.
