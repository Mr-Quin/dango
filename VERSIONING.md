# Versioning policy

dango has two independent version axes. Do not conflate them.

| Axis                  | What it versions                                                      | Where it lives                                   | Form                                     |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Engine version        | The npm package's JS/TS API (the exports you import)                  | `version` in each `package.json`                 | semver `MAJOR.MINOR.PATCH`               |
| Manifest `apiVersion` | The data-format contract of a manifest document the engine interprets | the `apiVersion` field inside each manifest JSON | single monotonic integer (`1`, `2`, ...) |

Engine semver describes the code surface. `apiVersion` describes the document schema. They bump on their own schedules. Both `@mr-quin/dango` (engine) and `@mr-quin/dango-manifests` (data) are at `0.2.0`, a pre-1.0 release: the JS/TS API is not frozen yet and may change in minor (`0.x`) bumps until `1.0.0`. `apiVersion` is `1`, the current manifest-format contract.

## Manifest `apiVersion` (data format)

`apiVersion` is the contract between a manifest author and the engine. The engine
declares the versions it understands in `SUPPORTED_API_VERSIONS` (`packages/dango/src/manifest/schema.ts`),
currently `new Set([1])`. The `zManifest` schema validates the field with
`.refine((v) => SUPPORTED_API_VERSIONS.has(v))`, so a manifest whose `apiVersion`
is not in the set fails `zManifest.parse`.

Bump `apiVersion` only on an incompatible schema change.

### Additive changes do NOT bump `apiVersion`

`zManifest` and its sub-schemas (`zRequestSpec`, the step objects, `zPipeline`)
are plain `z.object(...)` in strip mode, so unknown top-level keys are dropped,
not rejected. That makes the following additive and version-stable:

- New optional fields (`.optional()` / `.default(...)`) on the manifest, request
  spec, or a step. Old manifests omit them; the engine reads them when present.
- New JSONata helpers in the closed helper namespace. Strictly adds capability;
  old manifests are unaffected.
- A new step type added to the `zStep` discriminated union plus its branch in the
  runner. Old manifests never carry the new `type`, so they keep parsing and
  running identically.
- New `configSchema` JSON Schema keywords. `zConfigSchema` is `.passthrough()`,
  so unknown keywords already flow through to downstream consumers.

A manifest authored for a future engine that adds an unknown top-level key still
`safeParse`-succeeds on the current engine (the key is stripped), provided it does
not raise `apiVersion`.

### Incompatible changes DO bump `apiVersion`

A bump means authors set `apiVersion: 2` and the engine adds `2` to
`SUPPORTED_API_VERSIONS`. Required when:

- Removing or renaming an existing field, helper, or step type.
- Changing the semantics or default of an existing field or step (e.g. the
  `concurrency` default, `forEach` flattening behavior, what `acceptStatus` or
  `breakOn` mean).
- Making a currently-optional field required, or tightening a regex/enum so a
  previously-valid manifest fails to parse.
- Any change to runtime evaluation semantics (JSONata context shape, variant
  `when` resolution order) that alters existing manifests' output.

The mechanism is coarse: a single integer `Set`, no range negotiation. A bump is
all-or-nothing. Until the host's bundled engine adds the new integer to
`SUPPORTED_API_VERSIONS`, every manifest carrying the new version fails to parse
and is skipped; `apiVersion: 1` manifests keep working on both old and new engines.

### Forward incompatibility (manifest newer than the engine)

When a manifest declares an `apiVersion` the engine does not support:

- `zManifest.parse` throws a `ZodError` with message `unsupported apiVersion`.
- `zManifest.safeParse` returns `{ success: false }`.
- A host that calls `safeParse` and skips manifests that fail will silently drop
  a too-new manifest. The source is effectively unavailable until the host ships a
  newer engine that adds the version to the set.

The intended host behavior is to treat this as "source unavailable, update the
host," distinct from a malformed-manifest error, so users update rather than
report a bug. Authors should target the lowest `apiVersion` that has the features
they need, for the widest engine compatibility.

## The free-form manifest `version` field

`zManifest` also has a required free-form `version` string (`z.string()`, no
semver or regex enforcement). It is registry/debug metadata only. The engine never
reads it: `ManifestRunner` exposes `id` and `name` getters but no `version` getter,
and nothing in the engine consumes `manifest.version`. It is not a compatibility
signal; `apiVersion` is the only contract the engine enforces.

Each manifest's `version` is **independent and bumped per manifest**, only when
that manifest's own content changes — it is not tied to the npm package version,
and a package release must not bulk-bump it. `catalog.json` surfaces it per entry,
so a host can use it to detect that a specific manifest changed.

## Engine npm semver (the API)

The public API is everything exported from the package root (`packages/dango/src/index.ts`):
the runner, factory/helper functions, and the exported types consumers annotate
against. For a library exposing classes and types, source-level breakage counts as
runtime breakage.

The descriptions below are the post-`1.0.0` semver model:

- PATCH (`x.y.Z`): bug fixes, internal refactors, perf, docs. No change to any
  exported signature, type, or documented behavior.
- MINOR (`x.Y.0`): backward-compatible additions: new exports, new optional
  params, widened inputs, new optional result fields, accepting a new
  `apiVersion` (adding an integer to `SUPPORTED_API_VERSIONS`). Existing callers
  compile and run unchanged.
- MAJOR (`X.0.0`): anything that can break a consumer at compile or run time:
  removing/renaming an export, changing a signature or a type's shape, throwing
  where it used to return a `Result`, or dropping support for a previously-accepted
  `apiVersion` (removing an integer from `SUPPORTED_API_VERSIONS`).

Accepting a newer manifest format is minor. Dropping an old one is major.

**Pre-1.0 (current, `0.x`).** The API is not frozen. Per semver, a `0.MINOR` bump
(`0.2.0` to `0.3.0`) may carry breaking changes and `0.x.PATCH` carries fixes; a
`^0.2.0` range resolves to `>=0.2.0 <0.3.0`, so consumers are insulated from the
next breaking minor until they opt in. Breaking changes are still tagged
`**BREAKING:**` in `CHANGELOG.md`. The `1.0.0` release will freeze the surface
below and adopt the major/minor/patch model above.

## Public API surface

Pre-1.0, the API is not yet frozen: any export can still change in a `0.x` minor
bump (tagged `**BREAKING:**` in `CHANGELOG.md`). The table below is the surface
`1.0.0` is intended to freeze and what a host should depend on; treat everything
else as unstable.

| Export                  | Kind  | Role                                                 |
| ----------------------- | ----- | ---------------------------------------------------- |
| `ManifestRunner`        | value | construction entry point                             |
| `ManifestRunnerOptions` | type  | `{ fetcher?, signal? }` passed at construction       |
| `FetchLike`             | type  | injected fetcher signature                           |
| `Manifest`              | type  | the parsed-manifest shape the host stores and passes |
| `zManifest`             | value | the host's `safeParse` gate                          |

Everything else exported from the root is not part of the stable surface and may
change in a minor release without a major bump. Notably, but not limited to:
`AbortedError`, `MAX_BODY_BYTES`, `isPrivateHost`, `isPrivateHostPattern`,
`ManifestInputs`, `JsonataEvaluator`, `ProtoRegistry`, `runPipeline`, `RunOptions`,
`MAX_FOR_EACH_ITEMS`, `HttpCacheEntry`, `HttpStepCache`, `PipelineInput`,
`findManifestForUrl`, `findManifestMatchForUrl`, `matchUrl`, `urlMatches`,
`UrlMatchResult`, `helpers`, `zRequestSpec`, `zStep`, `SUPPORTED_API_VERSIONS`, and
the types `ConfigSchema`, `Pipeline`, `RequestSpec`, `Step`, `VariantPipeline`.

Deep imports (`@mr-quin/dango/dist/...`), anything marked `@internal`, names
prefixed `_`, and undocumented behavior are never public API. Do not import them.

The manifest format is the more stable of the two contracts and is versioned
independently by `apiVersion`. A v1 manifest is supported until a major engine
release drops it (announced via `SUPPORTED_API_VERSIONS` plus a changelog entry).

## Release procedure

Both published packages share one npm version and are released together on a
single `vX.Y.Z` tag. Per-manifest `version` fields are not part of this (see
above).

1. `bun run bump <version>` — sets the npm `version` of both `package.json`s and
   regenerates `catalog.json`.
2. Move the `CHANGELOG.md` `[Unreleased]` entries into a dated `[X.Y.Z]` section.
3. `bun run check` — confirm the tree is green.
4. `git commit -am "chore: release vX.Y.Z"` (via a PR, or direct to `main` if
   unprotected).
5. Tag the release commit and push: `git tag -a vX.Y.Z -m vX.Y.Z && git push --follow-tags`.

Pushing the tag triggers `.github/workflows/release.yml`, which first fails if
the tag does not match both `package.json` versions, then publishes both packages
to npm via OIDC trusted publishing (provenance is automatic; no `NPM_TOKEN`).
Prerequisites are a `release` GitHub environment and a trusted publisher on npm
for each package. `apiVersion` is independent of the npm version; bump it only on
an incompatible manifest-format change.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com), newest
first, with an `## [Unreleased]` section at the top, entries grouped under
`Added / Changed / Deprecated / Removed / Fixed / Security`.

- Mark every breaking change with a `**BREAKING:**` prefix, regardless of the
  version digit.
- Call out `apiVersion` changes as their own entries, separate from engine-API
  entries, and always state the resulting supported range, e.g.
  `Added: manifest apiVersion 2 (engine now accepts 1-2)`.
- Released sections use an ISO date: `## [0.2.0] - 2026-06-02`.
