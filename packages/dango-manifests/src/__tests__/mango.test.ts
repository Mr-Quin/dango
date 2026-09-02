import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinMango from '../manifests/mango.json' with { type: 'json' }
import searchFixture from './fixtures/mango-search.json' with { type: 'json' }
import showlistBootstrap from './fixtures/mango-showlist-bootstrap.json' with { type: 'json' }
import showlistMonth from './fixtures/mango-showlist-month.json' with { type: 'json' }
import showlistMonth2 from './fixtures/mango-showlist-month-2.json' with { type: 'json' }
import videoInfo from './fixtures/mango-video-info.json' with { type: 'json' }
import getctl from './fixtures/mango-getctl.json' with { type: 'json' }
import danmakuSeg0 from './fixtures/mango-danmaku-0.json' with { type: 'json' }
import danmakuSeg1 from './fixtures/mango-danmaku-1.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the mango reference manifest end-to-end against captured
 * fixtures. search filters to source=imgo media and lifts collection_id out of
 * the /b/<id> URL. episodes runs the two-stage showlist forEach (bootstrap to
 * discover months, then one request per month) and drops cross-collection
 * leakage. danmaku derives the segment count from the video duration, fetches
 * the per-minute CDN JSON shards and maps each row to the canonical {p, m}
 * CommentEntity shape.
 */

describe('mango manifest', () => {
  it('search: keeps mango-own (imgo/empty source) mediaRebirthV2/V3 media, appends the clipMerge siblings, and uses clipId as the collectionId', async () => {
    const { fetcher, calls } = mockFetcher({
      // did/mac/seqId are per-run md5s, so match on the query-stripped URL.
      'https://mobileso.bz.mgtv.com/aphone/search/rebirth/v2': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMango), {
      fetcher,
    })

    const result = await runner.runSearch({ q: 'frieren' })

    expect(result).toEqual([
      {
        providerIds: { collectionId: '444555' },
        indexedId: '444555',
        title: "Frieren: Beyond Journey's End",
        type: '动漫',
        year: 2023,
        imageUrl: 'https://example.com/frieren.jpg',
        episodeCount: 28,
      },
      {
        providerIds: { collectionId: '444558' },
        indexedId: '444558',
        title: "Frieren: Beyond Journey's End DVD版",
        type: '动漫',
        year: 2023,
        imageUrl: 'https://example.com/frieren-dvd.jpg',
        episodeCount: 28,
      },
      {
        providerIds: { collectionId: '444556' },
        indexedId: '444556',
        title: "Frieren: Beyond Journey's End Season 2",
        imageUrl: 'https://example.com/frieren-s2.jpg',
      },
      {
        providerIds: { collectionId: '444557' },
        indexedId: '444557',
        title: "Frieren: Beyond Journey's End Recap",
        imageUrl: 'https://example.com/frieren-recap.jpg',
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: discovers months, fetches each, filters cross-collection leakage', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://pcweb.api.mgtv.com/variety/showlist': (url) => {
        const month = new URL(url).searchParams.get('month') ?? ''
        if (month === '') {
          return { body: JSON.stringify(showlistBootstrap) }
        }
        if (month === '202309') {
          return { body: JSON.stringify(showlistMonth) }
        }
        return { body: JSON.stringify(showlistMonth2) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMango), {
      fetcher,
    })

    const result = await runner.runEpisodes({ collectionId: '444555' })

    // bootstrap declares two months → 1 bootstrap + 2 month requests
    expect(calls).toHaveLength(3)
    expect(result).toEqual([
      {
        providerIds: { vid: 'v1', cid: '444555' },
        indexedId: 'v1',
        title: '第1集 相遇',
        episodeNumber: 1,
      },
      {
        providerIds: { vid: 'v2', cid: '444555' },
        indexedId: 'v2',
        title: '第2集 冒险',
        episodeNumber: 2,
      },
    ])
  })

  it('episodes: handles a show whose showlist has a single month tab', async () => {
    const singleMonthBootstrap = {
      ...showlistBootstrap,
      data: { ...showlistBootstrap.data, tab_m: [{ m: '202309' }] },
    }
    const { fetcher, calls } = mockFetcher({
      'https://pcweb.api.mgtv.com/variety/showlist': (url) => {
        const month = new URL(url).searchParams.get('month') ?? ''
        if (month === '') {
          return { body: JSON.stringify(singleMonthBootstrap) }
        }
        return { body: JSON.stringify(showlistMonth) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMango), {
      fetcher,
    })

    const result = await runner.runEpisodes({ collectionId: '444555' })

    expect(calls).toHaveLength(2)
    expect(result).toEqual([
      {
        providerIds: { vid: 'v1', cid: '444555' },
        indexedId: 'v1',
        title: '第1集 相遇',
        episodeNumber: 1,
      },
    ])
  })

  it('danmaku: derives segment count from duration and emits canonical {p, m}', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://pcweb.api.mgtv.com/video/info': {
        body: JSON.stringify(videoInfo),
      },
      'https://galaxy.bz.mgtv.com/getctlbarrage': {
        body: JSON.stringify(getctl),
      },
      'https://cdn1.mgtv.com/v100/0.json': {
        body: JSON.stringify(danmakuSeg0),
      },
      'https://cdn1.mgtv.com/v100/1.json': {
        body: JSON.stringify(danmakuSeg1),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMango), {
      fetcher,
    })

    const result = await runner.runDanmaku({ cid: '444555', vid: 'v1' })

    // duration 01:30 → 90s → ceil(90/60) = 2 segments (0,1). info + ctl + 2 segs
    expect(calls).toHaveLength(4)
    expect(result).toEqual([
      { p: '1,1,16777215,5@mgtv', m: 'first' },
      { p: '5,1,16777215,65@mgtv', m: 'second' },
      { p: '65,1,16777215,12@mgtv', m: 'late' },
    ])
  })

  it('danmaku: yields nothing when the ctl bootstrap has no cdn', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://pcweb.api.mgtv.com/video/info': {
        body: JSON.stringify(videoInfo),
      },
      'https://galaxy.bz.mgtv.com/getctlbarrage': {
        body: JSON.stringify({ data: { cdn_list: '', cdn_version: '' } }),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMango), {
      fetcher,
    })

    const result = await runner.runDanmaku({ cid: '444555', vid: 'v1' })

    expect(result).toEqual([])
    expect(calls).toHaveLength(2)
  })
})
