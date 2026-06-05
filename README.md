# dango

Declarative danmaku source manifest engine. A danmaku source is described by a JSON manifest the engine interprets at runtime, so adding or fixing a source needs no per-source fetch code.

A dango is a stack of items on a skewer. Each source is a stack of pipeline steps producing one of three outputs: search results, an episode list, or danmaku comments.

## Packages

| Package                                                | Description                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@mr-quin/dango`](packages/dango)                     | The engine. `ManifestRunner`, the manifest schema, the JSONata pipeline, http/proto/url-match. Library-shippable, no platform assumptions. |
| [`@mr-quin/dango-manifests`](packages/dango-manifests) | Built-in manifests (JSON) for the danmaku sources, plus fixtures and per-source tests.                                                     |

## Quick start

```bash
bun install
bun run build      # tsc emit for the engine
bun run check      # build + type-check + lint + format:check + test
```

```ts
import { ManifestRunner, zManifest } from '@mr-quin/dango'
import bilibili from '@mr-quin/dango-manifests/manifests/bilibili.json' with { type: 'json' }

const runner = new ManifestRunner(zManifest.parse(bilibili))
const seasons = await runner.runSearch({ q: 'frieren' })
```

## Toolchain

bun (package manager, runtime, test runner), `tsc` (build), oxlint (lint), oxfmt (format). See [CLAUDE.md](CLAUDE.md) for the full agent/contributor guide.

## License

MIT
