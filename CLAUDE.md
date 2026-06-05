# CLAUDE.md: Agent Guide for dango

Context for Claude and other agents working in this repo.

## What this is

dango is a declarative danmaku source manifest engine. A source is described by a JSON manifest the engine interprets at runtime, so adding or fixing a source needs no per-source fetch code. It ships as two versioned libraries, `@mr-quin/dango` (engine) and `@mr-quin/dango-manifests` (built-in manifests), which a host application consumes.

Two packages:

- `packages/dango` (`@mr-quin/dango`): the engine. Library-shippable: no `chrome.*`, `window`, DOM, or `node:` builtins. Runs in a browser, a service worker, or Node.
- `packages/dango-manifests` (`@mr-quin/dango-manifests`): the built-in manifests (JSON) plus their fixtures and per-source tests. Depends on the engine for tests only; the published package is data.

## Toolchain

This repo is bun-first. Do not introduce pnpm, npm, yarn, vitest, biome, or prettier.

- **Package manager + runtime + test runner**: bun
- **Build (JS + d.ts emit)**: `tsc` (TypeScript)
- **Lint**: oxlint (`oxc`)
- **Format**: oxfmt (`oxc`)

| Task                     | Command                |
| ------------------------ | ---------------------- |
| Install                  | `bun install`          |
| Build the engine         | `bun run build`        |
| Type-check both packages | `bun run type-check`   |
| Lint                     | `bun run lint`         |
| Format                   | `bun run format`       |
| Check formatting         | `bun run format:check` |
| Test                     | `bun test`             |
| Everything (CI parity)   | `bun run check`        |

`bun test` resolves `@mr-quin/dango` from `dist`, so run `bun run build` before testing the manifests package (the `check` script and CI do this for you).

## Code style

- Single quotes, no semicolons, ES5 trailing commas, 2-space indent, 80 col. Enforced by oxfmt.
- `import type` for type-only imports.
- `function` declarations for named/exported functions; arrows for callbacks.
- No `any`. Use `unknown` and narrow.
- The engine (`packages/dango`) must stay platform-agnostic: no `chrome.*`, `window`, DOM-only globals beyond standard web APIs (`fetch`, `Response`, `TextEncoder`, `crypto.subtle`, `DecompressionStream`), and no `node:` builtins. The build config (`tsconfig.build.json`) sets `types: []` to keep ambient Node/Bun globals out of engine code; that guard is intentional, do not loosen it.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org): `<type>[scope]: <summary>`. Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`. Mark a breaking change with `!` after the type/scope (e.g. `feat!:`) or a `BREAKING CHANGE:` footer. Keep the summary imperative and roughly under 72 chars; put detail in the body.

## Lint and format philosophy

Prefer fixing the code over disabling a lint rule. Only silence a rule (or skip a category) when there is a genuine reason, and say why. `oxlint` runs `correctness` as error and `suspicious` as warn; the `perf` category is intentionally not enabled (its `no-await-in-loop` opinion conflicts with the engine's deliberately sequential pipeline execution).

## Testing

- `bun test`, Jest-compatible API from `bun:test`. No network in tests; a `mockFetcher` fixture serves both string and `Uint8Array` (proto) bodies.
- Time-dependent tests use `setSystemTime` from `bun:test`.
- Fixtures under `**/__tests__/fixtures/**` are captured upstream responses; keep them byte-stable (they are excluded from formatting).

## Build and publish

- `tsc -p tsconfig.build.json` emits ESM + `.d.ts` to `packages/dango/dist`. The package is ESM-only.
- `exports` points at `dist`; `files` ships only `dist` (engine) / `src/manifests` (manifests).
- Publishing is manual-version + tag driven: bump the `version` in each package, tag `vX.Y.Z`, push. `.github/workflows/release.yml` builds, tests, and runs `bun publish --access public` for both packages under the `@mr-quin` scope (needs the `NPM_TOKEN` secret).
- The two version axes are the npm `version` (engine API/semver) and the manifest `apiVersion` (`SUPPORTED_API_VERSIONS`, currently `{1}`). Adding optional manifest fields, helpers, or step types is non-breaking; bump `apiVersion` only on incompatible changes.

The two version axes (engine npm semver and manifest `apiVersion`) and the full release policy, including the pre-1.0 (`0.x`) stability caveat and the public-API surface `1.0.0` will freeze, are documented in `VERSIONING.md` at the repo root, which is the source of truth.

## Consumer note (strict CSP)

The engine decodes protobuf reflectively via `@bufbuild/protobuf` against a base64 `FileDescriptorSet` carried in each manifest under `protoDescriptors`. This path is eval-free, so it runs unchanged under a strict `unsafe-eval` CSP with no host-injected types or precompiled descriptors required.

## Per-package context

Each package has an `AGENTS.md` with package-specific conventions and gotchas. Read it before working in that package. The engine's manifest authoring rules and the closed JSONata helper namespace are documented in `packages/dango/AGENTS.md`.
