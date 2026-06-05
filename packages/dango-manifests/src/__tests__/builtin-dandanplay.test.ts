import { ManifestRunner, zManifest } from '@mr-quin/dango'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test'
import builtinDandanplay from '../manifests/builtin-dandanplay.json' with { type: 'json' }
import bangumiFixture from './fixtures/ddp-bangumi.json' with { type: 'json' }
import commentsFixture from './fixtures/ddp-comments.json' with { type: 'json' }
import searchFixture from './fixtures/ddp-search.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the dandanplay reference manifest, the unified DDP source. It
 * targets a configurable baseUrl (default official api.dandanplay.net) over the
 * /api/v2 paths and picks one of three auth modes: DDP signing when
 * appId/appSecret are set (X-Signature = Base64(SHA256(appId+ts+path+appSecret)),
 * vectors computed independently with python hashlib under a pinned clock), a
 * proxy mode with no auth headers, or a self-hosted mode with custom headers.
 * search/episodes/danmaku map to the canonical shapes.
 */

const APP_ID = 'testappid'
const APP_SECRET = 'testappsecret'
const TS = '1704067200'
const OFFICIAL = 'https://api.dandanplay.net'

function readHeaders(call: { init?: unknown }): Record<string, string> {
  return (call.init as { headers?: Record<string, string> }).headers ?? {}
}

describe('dandanplay manifest', () => {
  beforeAll(() => {
    setSystemTime(new Date('2024-01-01T00:00:00Z'))
  })
  afterAll(() => {
    setSystemTime()
  })

  it('search: defaults to the official API and signs with appId/appSecret', async () => {
    const { fetcher, calls } = mockFetcher({
      [`${OFFICIAL}/api/v2/search/anime`]: {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinDandanplay), {
      fetcher,
    })

    const result = await runner.runSearch({
      q: 'frieren',
      appId: APP_ID,
      appSecret: APP_SECRET,
    })

    expect(result).toEqual([
      {
        providerIds: { animeId: 18398, bangumiId: '400602' },
        indexedId: '18398',
        title: '葬送的芙莉莲',
        type: 'tvseries',
        typeDescription: 'TV动画',
        imageUrl: 'https://img.dandanplay.net/anime/18398.jpg',
        episodeCount: 28,
        year: 2023,
      },
      {
        providerIds: { animeId: 17000, bangumiId: '300000' },
        indexedId: '17000',
        title: 'Cyberpunk: Edgerunners',
        type: 'ova',
        typeDescription: 'OVA',
        imageUrl: 'https://img.dandanplay.net/anime/17000.jpg',
        episodeCount: 10,
        year: 2022,
      },
      {
        providerIds: { animeId: 19000, bangumiId: '500000' },
        indexedId: '19000',
        title: '未定档作品',
        type: 'tvseries',
        typeDescription: 'TV动画',
        imageUrl: 'https://img.dandanplay.net/anime/19000.jpg',
        episodeCount: 0,
      },
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${OFFICIAL}/api/v2/search/anime?keyword=frieren`)
    expect(readHeaders(calls[0])).toEqual({
      'X-AppId': APP_ID,
      'X-Timestamp': TS,
      'X-Signature': '+ghRrdLeGVYp2AJBTUBeItigTN88Ox9AvJk9fjBb3Zg=',
    })
  })

  it('episodes: signs the bangumi request and maps to canonical shape', async () => {
    const { fetcher, calls } = mockFetcher({
      [`${OFFICIAL}/api/v2/bangumi/400602`]: {
        body: JSON.stringify(bangumiFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinDandanplay), {
      fetcher,
    })

    const result = await runner.runEpisodes({
      bangumiId: '400602',
      appId: APP_ID,
      appSecret: APP_SECRET,
    })

    expect(result).toEqual([
      {
        providerIds: {
          episodeId: 183980001,
          animeId: 18398,
          bangumiId: '400602',
        },
        indexedId: '183980001',
        title: '第1话 旅途的终点',
        episodeNumber: 1,
      },
      {
        providerIds: {
          episodeId: 183980002,
          animeId: 18398,
          bangumiId: '400602',
        },
        indexedId: '183980002',
        title: '第2话 不杀人的魔法',
        episodeNumber: 2,
      },
      {
        providerIds: {
          episodeId: 183980003,
          animeId: 18398,
          bangumiId: '400602',
        },
        indexedId: '183980003',
        title: '第3话 蓝月草',
        episodeNumber: 3,
      },
    ])

    expect(calls[0].url).toBe(`${OFFICIAL}/api/v2/bangumi/400602`)
    expect(readHeaders(calls[0])['X-Signature']).toBe(
      '7YCYKXIhMr1RA0NhAMvakUvGOsoxKYqvDUyATl0573Q='
    )
  })

  it('danmaku: signs the comment request and emits {cid, p, m} entries', async () => {
    const { fetcher, calls } = mockFetcher({
      [`${OFFICIAL}/api/v2/comment/183980001`]: {
        body: JSON.stringify(commentsFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinDandanplay), {
      fetcher,
    })

    const result = await runner.runDanmaku({
      episodeId: 183980001,
      appId: APP_ID,
      appSecret: APP_SECRET,
    })

    expect(result).toEqual([
      { cid: 1000000001, p: '12.34,1,16777215,abcdef01', m: '弹幕一' },
      { cid: 1000000002, p: '23.45,4,16711680,abcdef02', m: '弹幕二' },
      { cid: 1000000003, p: '34.56,5,65280,abcdef03', m: '底部' },
      { cid: 1000000004, p: '45.67,1,255,abcdef04', m: '蓝色' },
    ])

    expect(calls[0].url).toBe(
      `${OFFICIAL}/api/v2/comment/183980001?withRelated=true`
    )
    expect(readHeaders(calls[0])['X-Signature']).toBe(
      'ZaBtpH2ypqVji7pA2HsbvfA/q5uDOKd/Ez3+YDNiifg='
    )
  })

  it('threads chConvert into the danmaku query when provided', async () => {
    const { fetcher, calls } = mockFetcher({
      [`${OFFICIAL}/api/v2/comment/183980001`]: {
        body: JSON.stringify(commentsFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinDandanplay), {
      fetcher,
    })

    await runner.runDanmaku({
      episodeId: 183980001,
      appId: APP_ID,
      appSecret: APP_SECRET,
      chConvert: 1,
    })

    expect(calls[0].url).toContain('chConvert=1')
  })

  it('proxy mode: a custom baseUrl with no credentials sends no auth headers', async () => {
    const proxy = 'https://ddp.example/proxy'
    const { fetcher, calls } = mockFetcher({
      [`${proxy}/api/v2/search/anime`]: { body: JSON.stringify(searchFixture) },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinDandanplay), {
      fetcher,
    })

    const result = await runner.runSearch({ q: 'frieren', baseUrl: proxy })

    expect(result).toHaveLength(3)
    expect(calls[0].url).toBe(`${proxy}/api/v2/search/anime?keyword=frieren`)
    expect(readHeaders(calls[0])).toEqual({})
  })

  it('self-hosted mode: a custom baseUrl attaches the configured auth headers', async () => {
    const server = 'https://my.ddp.server'
    const { fetcher, calls } = mockFetcher({
      [`${server}/api/v2/search/anime`]: {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinDandanplay), {
      fetcher,
    })

    await runner.runSearch({
      q: 'frieren',
      baseUrl: `${server}/`,
      auth: { enabled: true, headers: [{ key: 'X-Token', value: 'sekret' }] },
    })

    expect(calls[0].url).toBe(`${server}/api/v2/search/anime?keyword=frieren`)
    expect(readHeaders(calls[0])).toEqual({ 'X-Token': 'sekret' })
  })
})
