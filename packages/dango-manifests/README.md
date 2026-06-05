# @mr-quin/dango-manifests

Built-in dango manifests for a curated set of danmaku sources. Each manifest is a JSON file declaring the search/episodes/danmaku pipelines a [@mr-quin/dango](../dango/README.md) `ManifestRunner` interprets at runtime, with no per-source TypeScript fetching code.

This package is data, not code. There is no `index.ts`: consumers import each manifest JSON directly via the `./manifests/*` subpath export.

## Shipped manifests

| Id                   | Endpoint                                    | Notes                                                                                                                                                                |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builtin:dandanplay` | `baseUrl` (default `api.dandanplay.net`)    | Unified DDP source. Default official; optional `appId`/`appSecret` signing, `auth` headers, or none (proxy). `baseUrl` overrides the endpoint (proxy / self-hosted). |
| `builtin:bilibili`   | `api.bilibili.com`                          | Parallel media_bangumi + media_ft search; xml + protobuf danmaku variants.                                                                                           |
| `builtin:tencent`    | `pbaccess.video.qq.com` + `dm.video.qq.com` | POST bodies, page-cursor episode pagination via forEach `breakOn`, two-phase danmaku (segment index then per-segment fetch).                                         |
| `builtin:hanjutv`    | `hxqapi.hiyun.tv` + `hxqapi.zmdcq.com`      | Korean-drama source; search, detail-driven episodes, per-segment danmaku.                                                                                            |
| `builtin:mango`      | `*.mgtv.com` + `*.hitv.com`                 | Mango TV; source=imgo search, two-stage showlist episodes, per-minute CDN danmaku shards.                                                                            |
| `builtin:migu`       | `*.migu.cn` + `*.miguvideo.com`             | Migu Video; content-info lookup, episodes list, segmented danmaku.                                                                                                   |
| `builtin:youku`      | `*.youku.com` + `log.mmstat.com`            | Youku; HTML-stripped search, openapi episodes, signed per-minute danmaku POSTs (cna guid + \_m_h5_tk token).                                                         |
| `builtin:iqiyi`      | `*.iqiyi.com` + `mesh.if.iqiyi.com`         | iQIYI; /v\_ watch-page search, signed base_info episodes, zlib-deflated XML bullet shards.                                                                           |
| `builtin:aiyifan`    | `yfsp.tv` + `rankv21.tripdata.app`          | Aiyifan; homepage-scraped pub/priv keys sign each JSON request; getBarrage danmaku.                                                                                  |
| `builtin:bahamut`    | `api.gamer.com.tw`                          | Bahamut Anime (Traditional Chinese); single danmu.php fetch, time in tenths of a second.                                                                             |
| `builtin:maiduidui`  | `mob.mddcloud.com.cn`                       | Maiduidui; nested search, listVodSactions episodes, per-minute vodBarrage shards.                                                                                    |
| `builtin:renren`     | `api.gorafie.com` + `static-dm.qwdjapp.com` | Renren (foreign drama); array-rooted danmaku with CSV `p` strings.                                                                                                   |
| `builtin:sohu`       | `*.sohu.com`                                | Sohu TV; site=1 search, album episodes, paginated dmListAll danmaku (decimal/hex color handling).                                                                    |

## Layout

```
src/
  manifests/
    builtin-aiyifan.json
    builtin-bahamut.json
    builtin-bilibili.json
    builtin-dandanplay.json
    builtin-hanjutv.json
    builtin-iqiyi.json
    builtin-maiduidui.json
    builtin-mango.json
    builtin-migu.json
    builtin-renren.json
    builtin-sohu.json
    builtin-tencent.json
    builtin-youku.json
  __tests__/
    builtin-*.test.ts                   # per-manifest pipeline tests
    fixtures/                           # captured representative responses
    mockFetcher.ts                      # shared test fetcher (string + Uint8Array bodies)
scripts/
  smoke-test.ts                         # manual end-to-end test against the real API
```

## Usage

```ts
import { ManifestRunner, zManifest } from '@mr-quin/dango'
import builtinDandanplay from '@mr-quin/dango-manifests/manifests/builtin-dandanplay.json' with { type: 'json' }

const manifest = zManifest.parse(builtinDandanplay)
const runner = new ManifestRunner(manifest, { fetcher })

const results = await runner.runSearch({ q: 'frieren' })
const episodes = await runner.runEpisodes({
  bangumiId: results[0].providerIds.bangumiId,
})
const danmaku = await runner.runDanmaku({
  episodeId: episodes[0].providerIds.episodeId,
})
```

## Routing notes

**DanDanPlay** (`builtin:dandanplay`) is one manifest for every DDP endpoint over the `/api/v2` paths. `baseUrl` (config) defaults to the official `api.dandanplay.net`; point it at a proxy or self-hosted server to override. Auth is picked by config: `appId` + `appSecret` sign each request (`X-Signature: Base64(SHA256(appId + timestamp + path + appSecret))`, secret never sent); else `auth.enabled` + `auth.headers` attach custom headers; else no auth (for a proxy that signs server-side). The official API is just the case with no `baseUrl` and credentials set.

**Bilibili** and **Tencent** call their public APIs directly. Both rely on `rewriteHeaders` for `Origin` / `Referer`, which a browser host's `FetchLike` applies via a request-header rewrite mechanism such as `chrome.declarativeNetRequest`. The smoke script merges those headers in directly since Node fetch lets you set them.

## Smoke testing

`bun run smoke <source> [keyword]` walks search → first result → episodes → first episode → danmaku against the real API. Not in CI; useful when adding a manifest or verifying after an upstream change.

| Source   | Command                         | Status                                                   |
| -------- | ------------------------------- | -------------------------------------------------------- |
| ddp      | `bun run smoke ddp Frieren`     | needs `DDP_APP_ID` / `DDP_APP_SECRET` env (official API) |
| bilibili | `bun run smoke bilibili Naruto` | works (after a cookie warm-up via `www.bilibili.com`)    |
| tencent  | `bun run smoke tencent 庆余年`  | works                                                    |

The smoke fetcher keeps a per-host cookie jar so bilibili's anti-bot wall lets us through, and it merges `rewriteHeaders` into the outgoing request (Node has no `Origin`/`Referer` restriction). The default `ddp` smoke hits the official API and needs `DDP_APP_ID` / `DDP_APP_SECRET`.

## Adding a new manifest

1. Drop the JSON file in `src/manifests/`. Use `id: 'builtin:<source>'`.
2. Capture representative responses from the source's API to `src/__tests__/fixtures/`.
3. Write a per-manifest test that:
   - Parses the manifest against `zManifest` (catches schema drift)
   - Runs each pipeline with a mocked `FetchLike` against the captured fixtures
   - Asserts the canonical shape the engine emits
4. (Optional) Add a section to `scripts/smoke-test.ts` to exercise the new manifest against a live endpoint.

Each manifest's tests own their own fixtures, don't share fixtures across manifests.

## Trust model

Manifests in this package are vetted at PR review time and shipped as built-ins. They are not user-installable. User-installed manifests are a separate concern a host may add with explicit consent UX. See dango's [trust model](../dango/README.md#trust-model) for the engine-level invariants that apply regardless of where a manifest comes from.

## Scripts

| Command                  | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `bun test`               | bun test, fixture-backed pipeline tests                        |
| `bun run smoke <source>` | Live end-to-end test against the real API (manual, **not CI**) |
| `bun run type-check`     | tsc --noEmit                                                   |
| `bun run lint`           | oxlint                                                         |
| `bun run build`          | Compile with tsc                                               |
