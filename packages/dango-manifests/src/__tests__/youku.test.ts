import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinYouku from '../manifests/youku.json' with { type: 'json' }
import searchFixture from './fixtures/youku-search.json' with { type: 'json' }
import episodesFixture from './fixtures/youku-episodes.json' with { type: 'json' }
import videoInfo from './fixtures/youku-video-info.json' with { type: 'json' }
import danmakuSeg0 from './fixtures/youku-danmaku-0.json' with { type: 'json' }
import danmakuSeg1 from './fixtures/youku-danmaku-1.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the youku reference manifest end-to-end against captured
 * fixtures. search filters to Youku-owned results, strips HTML from titles and
 * lifts the type/year out of the dot-separated feature string. episodes maps
 * the openapi videos list. danmaku is the multi-step signed flow: read the
 * video duration, pull the cna guid from an etag header and the _m_h5_tk token
 * from a Set-Cookie header, build a per-minute signed POST in an assign step,
 * then forEach those requests and map each row to the canonical {p, m} shape.
 * The signing uses $millis so the segment URLs are non-deterministic; the mock
 * matches them by stripping the query string.
 */

describe('youku manifest', () => {
  it('search: keeps Youku-owned results, strips HTML and parses the feature string', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://search.youku.com/api/search': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinYouku), {
      fetcher,
    })

    const result = await runner.runSearch({ q: 'frieren' })

    expect(result).toEqual([
      {
        providerIds: { showId: 'ya0123abc' },
        indexedId: 'ya0123abc',
        title: 'Frieren',
        type: '动漫',
        year: 2023,
        imageUrl: 'https://example.com/p.jpg',
        episodeCount: 28,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: maps the openapi videos list to canonical entries', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://openapi.youku.com/v2/shows/videos.json': {
        body: JSON.stringify(episodesFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinYouku), {
      fetcher,
    })

    const result = await runner.runEpisodes({ showId: 'ya0123abc' })

    expect(result).toEqual([
      {
        providerIds: { vid: 'vid_1' },
        indexedId: 'vid_1',
        title: '第1集',
        episodeNumber: 1,
        imageUrl: 'https://example.com/1.jpg',
      },
      {
        providerIds: { vid: 'vid_2' },
        indexedId: 'vid_2',
        title: '第2集',
        episodeNumber: 2,
        imageUrl: 'https://example.com/2.jpg',
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: paginates past the 100-per-page limit until a short page', async () => {
    const makeVideos = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        id: `vid_${from + i}`,
        title: `第${from + i}集`,
        stage: String(from + i),
        thumbnail_v2: `https://example.com/${from + i}.jpg`,
      }))
    const { fetcher, calls } = mockFetcher({
      'https://openapi.youku.com/v2/shows/videos.json': (url) => {
        const page = new URL(url).searchParams.get('page')
        const videos = page === '1' ? makeVideos(1, 100) : makeVideos(101, 160)
        return { body: JSON.stringify({ videos }) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinYouku), {
      fetcher,
    })

    const result = (await runner.runEpisodes({
      showId: 'ya0123abc',
    })) as unknown[]

    // page 1 returns a full 100, page 2 returns 60 (< 100) and stops.
    expect(result).toHaveLength(160)
    expect(result[0]).toEqual({
      providerIds: { vid: 'vid_1' },
      indexedId: 'vid_1',
      title: '第1集',
      episodeNumber: 1,
      imageUrl: 'https://example.com/1.jpg',
    })
    expect(result[159]).toEqual({
      providerIds: { vid: 'vid_160' },
      indexedId: 'vid_160',
      title: '第160集',
      episodeNumber: 160,
      imageUrl: 'https://example.com/160.jpg',
    })
    expect(calls).toHaveLength(2)
  })

  it('danmaku: handles a video short enough to need a single segment', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://openapi.youku.com/v2/videos/show.json': {
        body: JSON.stringify({ duration: '30' }),
      },
      'https://log.mmstat.com/eg.js': {
        body: '',
        headers: { etag: '"cna-guid-value"' },
      },
      'https://acs.youku.com/h5/mtop.com.youku.aplatform.weakget/1.0/': {
        body: '{}',
        headers: {
          'set-cookie':
            '_m_h5_tk=abcdef0123456789abcdef0123456789_1700000000000; path=/',
        },
      },
      'https://acs.youku.com/h5/mopen.youku.danmu.list/1.0/': {
        body: JSON.stringify(danmakuSeg0),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinYouku), {
      fetcher,
    })

    const result = await runner.runDanmaku({ vid: 'vid_1' })

    // floor(30/60)+1 = 1 → info + cna + tkEnc + 1 segment POST
    expect(calls).toHaveLength(4)
    expect(result).toEqual([
      { p: '5,1,16777215,100', m: 'hello youku' },
      { p: '12.345,1,16777215,101', m: 'second' },
    ])
  })

  it('danmaku: runs the signed multi-step flow and emits canonical {p, m}', async () => {
    let segmentCall = 0
    const { fetcher, calls } = mockFetcher({
      'https://openapi.youku.com/v2/videos/show.json': {
        body: JSON.stringify(videoInfo),
      },
      'https://log.mmstat.com/eg.js': {
        body: '',
        headers: { etag: '"cna-guid-value"' },
      },
      'https://acs.youku.com/h5/mtop.com.youku.aplatform.weakget/1.0/': {
        body: '{}',
        headers: {
          'set-cookie':
            '_m_h5_tk=abcdef0123456789abcdef0123456789_1700000000000; path=/',
        },
      },
      'https://acs.youku.com/h5/mopen.youku.danmu.list/1.0/': () => {
        const idx = segmentCall++
        const body = idx === 0 ? danmakuSeg0 : danmakuSeg1
        return { body: JSON.stringify(body) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinYouku), {
      fetcher,
    })

    const result = await runner.runDanmaku({ vid: 'vid_1' })

    // duration 90s → floor(90/60)+1 = 2 → range(0,2) = 2 segments.
    // info + cna + tkEnc + 2 segment POSTs = 5 calls.
    expect(calls).toHaveLength(5)
    expect(result).toEqual([
      {
        p: '480.606,1,16777215,UMTc0MzA0ODk3NTY=@youku',
        m: '怎么没人发',
      },
      {
        p: '485.04,1,16777215,UNjA4MTc1Nzk4OA==@youku',
        m: '没人吗',
      },
      {
        p: '489.39,1,16777215,UMTMyODc0ODU4NTI=@youku',
        m: '有人哦',
      },
      {
        p: '491,1,16777215,UNDMxOTUwMzE0NA==@youku',
        m: '有人有人',
      },
      {
        p: '496.89,1,16777215,UMTgzNDk4NDM5MTY=@youku',
        m: '绿毛也好帅啊',
      },
      {
        p: '496,1,16777215,UNTQzMDYwNzY1Ng==@youku',
        m: '这是六美的哥哥吧',
      },
      {
        p: '504.546,1,16777215,UMTg0NDk2NTIxODg=@youku',
        m: '都没人啊。',
      },
      {
        p: '515,1,16777215,UNjA3MDM3NjY1Ng==@youku',
        m: '我开弹幕了吗？',
      },
      {
        p: '528,1,16777215,UNDMxOTUwMzE0NA==@youku',
        m: '头小身大的比例…………',
      },
      {
        p: '539.895,1,16524894,UNDczNjAwNTc0OA==@youku',
        m: '而非通过后即可',
      },
      {
        p: '539.306,1,16432790,UNTgxODg4MTUwOA==@youku',
        m: '不会是逆天开挂或者后宫吧',
      },
    ])
  })
})
