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
