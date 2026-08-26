# Agent context: packages/dango-manifests

## Purpose

Ships the JSON manifests that drive [@mr-quin/dango](../dango/AGENTS.md). One manifest per source. This package is data + tests + a manual live smoke; engine logic lives in dango.

## Layout

- `src/manifests/*.json`: the manifests. Filenames mirror the manifest `id`, the bare `<source>` (`<source>.json`).
- `src/__tests__/<manifest>.test.ts`: per-manifest pipeline tests.
- `src/__tests__/fixtures/<source>-*.json`: captured representative responses. Each manifest owns its fixtures.
- `scripts/smoke-test.ts`: manual end-to-end test against the real source APIs. Not in CI.

## Consumer entry point

There is no `index.ts`. Consumers import each manifest JSON directly via the package's `./manifests/*` subpath export:

```ts
import ddp from '@mr-quin/dango-manifests/manifests/dandanplay.json' with { type: 'json' }
```

Adding an aggregate index is a footgun: it forces every consumer to load every manifest even when they need one, and it makes bundlers think this package has a single runtime entry point when it actually has none.

## URL strategy

Sources call their upstream API directly: point at the upstream host and list it in `hosts`. This package has no dependency on any host application's backend or proxy. Authenticated sources sign requests in-pipeline using config-supplied secrets (see DanDanPlay below), never a hosted credential service.

## DanDanPlay (`dandanplay`)

One manifest for every DanDanPlay endpoint: the official API, a proxy, or a self-hosted compatible server. The official DDP API is just the special case where `baseUrl` is unset and `appId`/`appSecret` are supplied. `hosts: ['*']` since `baseUrl` is config-driven.

Each pipeline's first `assign` step resolves the endpoint and auth into `prep.req` (`{ url, headers }`), which the http step references:

```
req: ($base := baseUrl ? $replace(baseUrl, /\/$/, '') : 'https://api.dandanplay.net';
      $p := '/api/v2/search/anime';
      $ts := $string($now());
      $headers := (appId and appSecret)
        ? { 'X-AppId': appId, 'X-Timestamp': $ts,
            'X-Signature': $sha256Base64(appId & $ts & $p & appSecret) }
        : ((auth.enabled and auth.headers) ? $merge(auth.headers.{ key: value }) : {});
      { 'url': $base & $p, 'headers': $headers })
```

Three auth modes, by config:

- **Sign** (official, or any server wanting open-API auth): `appId` + `appSecret` present. `X-Signature = Base64(SHA256(appId + timestamp + path + appSecret))`, `path` is the API path without query. The secret only feeds the local hash, never sent.
- **Custom headers** (self-hosted): `auth.enabled` + `auth.headers` (a `{key,value}` array), no creds. Builds the header map via the grouping operator.
- **None** (proxy that signs server-side): neither set, headers `{}`.

`baseUrl`, `appId`, `appSecret`, `auth`, `chConvert` are all optional config, so they are **not** in pipeline `inputs` (the engine requires every listed input present); only `q` / `bangumiId` / `episodeId` are. Paths are `/api/v2/...`; a host points `baseUrl` at a proxy/self-hosted server to override the official default. There is no separate `ddp-compat` manifest, it is this manifest with a different `baseUrl`.

## Bilibili (`bilibili`)

Two parallel `media_bangumi` + `media_ft` calls under `search`, plus an optional third for user uploads (see below). Episodes go through `/pgc/view/web/season`. Danmaku has two variants:

- `xml`: single call, response is XML; the manifest splits each `<d p="...">` attribute's comma-separated fields and rebuilds the canonical `time,mode,color,uid` shape.
- `protobuf` (default), `forEach` over `$range(1, 31)` (up to 30 six-minute segments = 3 hour cap). Each iteration decodes the `dm.v1.DmSegMobileReply` message against the precompiled descriptor carried in `protoDescriptors.bili` (base64 `FileDescriptorSet`; regenerate via `scripts/gen-proto-descriptors.ts`). Bilibili returns 304 past the last segment, which the request opts into via `acceptStatus: [304]`; the engine treats the empty body as an empty payload.

Modes 2 and 3 (substyles of scroll-right) collapse to mode 1 in the canonical output; modes outside `{1,4,5,6}` are filtered out.

### User uploads (UGC)

`configSchema.includeUserUploads` (boolean, default false) adds a third WBI-signed search, `search_type=video`. It is a `forEach` whose `in` evaluates to `[]` when the flag is off, so the gated branch costs zero requests instead of duplicating the whole search pipeline as a second variant.

A UGC hit's providerIds are `{ bvid, aid }` rather than `{ seasonId, mediaId }`, and `episodes` / `season` / `parseUrl` each carry a matching variant selected by `$exists(bvid) and $not($exists(seasonId))`. The `seasonId` half of that guard matters: a pgc _episode_ also carries a `bvid`, so `$exists(bvid)` alone would not keep the pgc branch winning. The variant reads `/x/web-interface/view`: when the video belongs to a collection (`ugc_season`), the collection's videos are the episodes and `episodeNumber` is their position via the `#$i` positional bind; otherwise the video's own parts (`pages`) are, numbered by `page`. Danmaku is untouched, both branches resolve to a `cid`.

Season identity is the landed `bvid`, not the collection id, so two videos of one collection saved from different pages are two seasons.

`urlMatch` also claims `/video/BV…` and `/video/av…` pages. That part is not gated by the checkbox, `urlMatch` is matched by the host before any config is in scope.

## Tencent (`tencent`)

POST endpoints with complex JSON bodies. Episodes pagination uses `forEach.breakOn` ("stop when this page has < 100 items"), forcing sequential iteration. Danmaku is two-phase: an `http` step hits `barrage/base/{vid}` to discover segment names, an `assign` step flattens `segment_index.*.segment_name` into an array, and a `forEach` fetches each segment in parallel.

Comment styling: `content_style` is a JSON-encoded string in the response. The manifest uses `$jsonParse` to extract the hex color, falling back to white when missing or unparseable.

## Hanjutv (`hanjutv`)

Korean-drama source on `hxqapi.hiyun.tv` (+ a `hxqapi.zmdcq.com` mirror). Search returns a flat list; episodes come from a detail lookup; danmaku is fetched per segment. Canonical output is the standard `{p, m}` shape.

## Mango (`mango`)

Mango TV (`*.mgtv.com`). Search keeps `source=imgo` media from the `mediaRebirthV2` / `mediaRebirthV3` content blocks (`mediaRebirth` without the `V` is aggregated third-party content: `source: 'iqiyi'` and an empty `clipId`), then appends the `clipMerge` block's `dataList`, deduped against the primary hits. Upstream only returns the newest season as a `mediaRebirthV2` entry and demotes every sibling season and spin-off to `clipMerge`, so dropping that block loses "seasons 1-10" for a series like 大侦探. `clipMerge` rows carry only `clipId` / `title` / `img`, hence no `type`, `year`, or `episodeCount` on those results. `videoCount` is also gone from the `mediaRebirthV2` rows themselves, so `episodeCount` is usually undefined now. Episodes run a two-stage `forEach`: bootstrap the showlist to discover months, then one request per month, dropping cross-collection leakage. Danmaku derives the segment count from the video duration and pulls per-minute CDN JSON shards.

## Migu (`migu`)

Migu Video (`*.migu.cn` / `*.miguvideo.com`). Search, a content-info lookup feeding the episodes list, and segmented danmaku mapped to the canonical shape.

## Youku (`youku`)

Youku (`*.youku.com`). Search filters to Youku-owned results and strips HTML from titles. Episodes map the openapi videos list. Danmaku is a signed multi-step flow: read the video duration, pull the cna guid from an etag header and the `_m_h5_tk` token from a Set-Cookie header, build per-minute signed POSTs in an assign step, then `forEach` those requests. Signing uses `$millis`, so segment URLs are non-deterministic.

## iQIYI (`iqiyi`)

iQIYI (`*.iqiyi.com` + `mesh.if.iqiyi.com`, `pcw-api.iq.com`). Search keeps templates 101/102/103 whose `pageUrl` is a real `/v_` watch page, which filters out cross-site redirect stubs (e.g. titles that resolve to `v.qq.com`). Episodes decode the linkId to a tvid, then read the signed `base_info` `album_episodes` block. Danmaku derives the per-300s shard list from the duration and fetches zlib-deflated XML bullet shards (`format: 'xml'`, `decompress: 'deflate'`); time comes from `showTime`.

## Aiyifan (`aiyifan`)

Aiyifan / yfsp.tv. Every pipeline first GETs the `www.yfsp.tv` homepage and regex-extracts the `pConfig` `publicKey` / `privateKey`, then signs each JSON request with `$md5(pub & '&' & $lowercase(canon) & '&' & priv)` where `canon` is the literal query string. Danmaku comes from `getBarrage`; color is `#RRGGBB` hex.

## Bahamut (`bahamut`)

Bahamut Anime Gamer (`api.gamer.com.tw`), Traditional Chinese; search with simplified-Chinese keywords often misses. Danmaku is a single `danmu.php` call; the `time` field is in tenths of a second (output divides by 10). Note: episodes flatten **all** category groups under `anime.episodes.*`, so a title that ships a main group plus an alternate-version group yields each episode number once per group (distinct `videoSn`). That is the real upstream shape, not a dedup bug; revisit only if a group needs suppressing.

## Maiduidui (`maiduidui`)

Maiduidui (`mob.mddcloud.com.cn`). Search nests `data[group].vodList[]`; the `type` label lives on the parent group, so bind it (`$tn := typeName`) before descending into `vodList`. Danmaku is a per-minute `vodBarrage` `forEach`; time comes from `times`, and the rows carry no color (defaults to white).

## Renren (`renren`)

Renren (`api.gorafie.com` + `static-dm.qwdjapp.com`), strong on foreign drama. Danmaku is a single fetch whose root is an array; each row has a CSV `p` string that the manifest splits into `time,*,color,*,*,*,uid`.

## Sohu (`sohu`)

Sohu TV (`*.sohu.com`). Search filters to `site=1` albums and strips `<<<>>>` markers from titles. Danmaku paginates `dmListAll` by `time_begin` (300s windows). Color quirk: `t.c` is a **decimal** RGB string for most comments but a `#RRGGBB` **hex** string for some, so the manifest branches on a leading `#` (`$contains($cr, '#') ? $hexToInt(...) : $number(...)`). Treating every value as hex overflows past `0xFFFFFF`.

## Localization

Display strings (`name`, `configSchema` `title`/`description` at any depth, and `cookieSet.title`) are localized through an optional top-level `locales` block. Keys are BCP-47 locale tags, then the **dotted path** to the field; only strings that differ from the source language are listed.

```jsonc
"locales": {
  "zh-CN": {
    "name": "B站",
    "configSchema.properties.danmakuFormat.title": "弹幕格式",
    "cookieSet.title": "登录B站"
  }
}
```

Top-level fields stay the source / fallback language (English here), so a manifest with nothing to translate omits `locales` entirely. The engine resolves on demand via `getDisplayStrings(manifest, locale)` (narrows `zh-TW` → `zh`, falls back to the source value per key, ignores unknown keys). The execution path never reads `locales` — it is pure presentation data. All current manifests carry `zh-CN`; the catalog index still indexes the source-language `name` only.

## Conventions

- Manifests use **raw JSON, not pre-parsed**. Consumers wrap with `zManifest.parse()` at startup. Pre-parsing in this package would force a dango type dependency to flow through and tie shipping versions tighter than needed.
- One manifest per file.
- Manifest `id` is the bare `<source>` for anything shipped here.
- Tests must (1) parse against `zManifest`, (2) mock `FetchLike` with captured fixtures per pipeline, (3) assert the exact canonical output shape. Use exact URL match in the mock fetcher, silent query-string mismatches should surface as test failures.
- Fixtures are captured responses, edited only to redact noise. Keep representative shape and value types.

## Gotchas

- **URLs in manifests are JSONata expressions**, not raw strings. String literals must be wrapped in single quotes: `'https://...'`. Forgetting the quotes makes `https` look like a variable.
- **`$sortedQueryString` for canonical query strings.** Raw concat of user input into a query string breaks when the input contains `&`, `=`, or `?`. The helper URL-encodes each value; pair it with signing helpers for sign-then-send flows.
- **JSON imports need `with { type: 'json' }`** under NodeNext module mode.
- **No engine reimplementation here.** If a test fails because of dango behavior, fix dango.

## Adding a manifest

1. Drop the JSON file in `src/manifests/`. Validate locally with `zManifest.parse()` in a scratch script if you want fast feedback.
2. Capture a fixture per pipeline to `src/__tests__/fixtures/`.
3. Add `src/__tests__/<source>.test.ts` covering all three pipelines.
4. (Optional) Extend `scripts/smoke-test.ts` so the new manifest can be exercised live.
5. Run `bun test`.

## Conventions (code style)

- `/** */` for multi-line; single-line `//` for one-liners.
- `function` declarations for module-level named functions; arrows for callbacks.
- No `any`: use `unknown` and narrow.
- Tests live alongside the package; bun test discovers `src/__tests__/**/*.test.ts`.
