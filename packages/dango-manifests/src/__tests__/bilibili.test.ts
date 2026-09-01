import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  create,
  createFileRegistry,
  fromBinary,
  toBinary,
} from '@bufbuild/protobuf'
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt'
import { base64Decode } from '@bufbuild/protobuf/wire'
import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinBilibili from '../manifests/bilibili.json' with { type: 'json' }
import bangumiFixture from './fixtures/bilibili-search-bangumi.json' with { type: 'json' }
import ftFixture from './fixtures/bilibili-search-ft.json' with { type: 'json' }
import seasonFixture from './fixtures/bilibili-season.json' with { type: 'json' }
import ugcSearchFixture from './fixtures/bilibili-search-video.json' with { type: 'json' }
import ugcSeasonViewFixture from './fixtures/bilibili-ugc-season-view.json' with { type: 'json' }
import ugcViewFixture from './fixtures/bilibili-ugc-view.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

const XML_FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/bilibili-xml.xml', import.meta.url)),
  'utf-8'
)

const NAV_RESPONSE = {
  data: {
    wbi_img: {
      img_url:
        'https://i0.hdslb.com/bfs/wbi/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      sub_url:
        'https://i0.hdslb.com/bfs/wbi/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
    },
  },
}

const set = fromBinary(
  FileDescriptorSetSchema,
  base64Decode(builtinBilibili.protoDescriptors.bili)
)
const protoRegistry = createFileRegistry(set)

function encodeSegment(
  items: Array<{
    progress: number
    mode: number
    color: number
    content: string
    midHash?: string
  }>
): Uint8Array {
  const reply = protoRegistry.getMessage('dm.v1.DmSegMobileReply')
  if (reply === undefined) {
    throw new Error('dm.v1.DmSegMobileReply missing from descriptor')
  }
  const elems = items.map((item) => {
    return {
      progress: item.progress,
      mode: item.mode,
      color: item.color,
      content: item.content,
      midHash: item.midHash ?? '',
    }
  })
  return toBinary(reply, create(reply, { elems }))
}

describe('bilibili manifest', () => {
  it('runs WBI-signed media_bangumi + media_ft searches', async () => {
    const navResponse = {
      data: {
        wbi_img: {
          img_url:
            'https://i0.hdslb.com/bfs/wbi/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
          sub_url:
            'https://i0.hdslb.com/bfs/wbi/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
        },
      },
    }
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/nav': {
        body: JSON.stringify(navResponse),
      },
      'https://api.bilibili.com/x/web-interface/wbi/search/type': (url) => {
        const params = new URL(url).searchParams
        const body =
          params.get('search_type') === 'media_bangumi'
            ? bangumiFixture
            : ftFixture
        return { body: JSON.stringify(body) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = await runner.runSearch({ q: 'frieren' })

    // 1 nav + 2 signed searches
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      const init = c.init as {
        credentials?: string
        rewriteHeaders?: Record<string, string>
      }
      expect(init.credentials).toBe('include')
      expect(init.rewriteHeaders).toEqual({
        Referer: 'https://www.bilibili.com/',
      })
    }
    // Every search call carries a w_rid signature.
    const searchCalls = calls.filter((c) => c.url.includes('/wbi/search/'))
    expect(searchCalls).toHaveLength(2)
    for (const c of searchCalls) {
      expect(new URL(c.url).searchParams.get('w_rid')).toMatch(/^[a-f0-9]{32}$/)
    }

    expect(result).toEqual([
      {
        providerIds: { seasonId: 41410, mediaId: 28219412 },
        indexedId: '41410',
        title: '葬送的芙莉莲',
        type: '番剧',
        typeDescription: '番剧',
        imageUrl: 'https://i0.hdslb.com/bfs/bangumi/image/frieren.jpg',
        episodeCount: 28,
        year: 2023,
      },
      {
        providerIds: { seasonId: 91234, mediaId: 91234 },
        indexedId: '91234',
        title: 'Demon Slayer Movie',
        type: '电影',
        typeDescription: '电影',
        imageUrl: 'https://i0.hdslb.com/bfs/bangumi/image/movie.jpg',
        episodeCount: 1,
        year: 2021,
      },
    ])
  })

  it('runs the episodes pipeline and maps to canonical shape', async () => {
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/pgc/view/web/season?season_id=41410': {
        body: JSON.stringify(seasonFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = await runner.runEpisodes({ seasonId: 41410 })

    expect(result).toEqual([
      {
        providerIds: {
          cid: 1300001,
          aid: 100001,
          bvid: 'BV1aaaaaaaa',
          epid: 700001,
        },
        indexedId: '1300001',
        title: '旅途的终点',
        episodeNumber: 1,
        imageUrl: 'https://i0.hdslb.com/bfs/bangumi/ep1.jpg',
        alternativeTitle: ['葬送的芙莉莲 第1话'],
      },
      {
        providerIds: {
          cid: 1300002,
          aid: 100002,
          bvid: 'BV1bbbbbbbb',
          epid: 700002,
        },
        indexedId: '1300002',
        title: '不杀人的魔法',
        episodeNumber: 2,
        imageUrl: 'https://i0.hdslb.com/bfs/bangumi/ep2.jpg',
        alternativeTitle: ['葬送的芙莉莲 第2话'],
      },
    ])
  })

  it('runs the season pipeline and excludes previews from episodeCount', async () => {
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/pgc/view/web/season?season_id=41410': {
        body: JSON.stringify(seasonFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runSeason({ seasonId: 41410 })) as {
      providerIds: { seasonId: number }
      indexedId: string
      type: string | undefined
      episodeCount: number
    } | null

    expect(result?.providerIds.seasonId).toBe(41410)
    expect(result?.indexedId).toBe('41410')
    expect(result?.type).toBeUndefined()
    expect(result?.episodeCount).toBe(2)
  })

  it('xml variant emits {p, m} rows, collapses mode 2/3, and keeps numeric-only text a string', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/v1/dm/list.so?oid=1300001': {
        body: XML_FIXTURE,
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = await runner.runDanmaku({
      cid: 1300001,
      danmakuFormat: 'xml',
    })

    // p is `${seconds},${mode},${color},${midHash}`; mode 2/3 collapse to 1
    // because the danmaku engine only renders modes 1, 4, 5.
    expect(result).toEqual([
      { p: '12.34,1,16777215,abcd1234@bili', m: '第一条' },
      { p: '23.45,4,16711680,efgh5678@bili', m: '底部弹幕' },
      { p: '34.56,5,255,ijkl9012@bili', m: '顶部蓝色' },
      { p: '45.67,1,16777215,mnop3456@bili', m: '反向弹幕' },
      // Purely numeric text must stay a string, not be coerced to the number
      // 666 (which would crash the host's `text.includes(...)` collapse pass).
      { p: '56.78,1,16777215,qrst7890@bili', m: '666' },
    ])
    expect(calls).toHaveLength(1)
  })

  it('protobuf variant paginates and stops after 3 consecutive empties', async () => {
    const seg1 = encodeSegment([
      {
        progress: 12340,
        mode: 1,
        color: 16777215,
        content: 'proto 1',
        midHash: 'h1',
      },
      {
        progress: 23450,
        mode: 4,
        color: 16711680,
        content: 'proto 底部',
        midHash: 'h2',
      },
    ])
    const seg2 = encodeSegment([
      {
        progress: 365000,
        mode: 5,
        color: 255,
        content: 'proto 顶部',
        midHash: 'h3',
      },
    ])
    const emptySeg = encodeSegment([])

    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/v2/dm/web/seg.so': (url) => {
        const segIdx = new URL(url).searchParams.get('segment_index')
        if (segIdx === '1') return { body: seg1 }
        if (segIdx === '2') return { body: seg2 }
        return { body: emptySeg }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runDanmaku({
      cid: 1300001,
      danmakuFormat: 'protobuf',
    })) as Array<{ p: string; m: string }>

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ p: '12.34,1,16777215,h1@bili', m: 'proto 1' })
    expect(result[2]).toEqual({ p: '365,5,255,h3@bili', m: 'proto 顶部' })
    // segs 1,2 have content; 3,4,5 empty (3 in a row) → stop.
    expect(calls.length).toBe(5)
  })

  it('protobuf variant is the default when danmakuFormat omitted', async () => {
    const emptySeg = encodeSegment([])
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/v2/dm/web/seg.so': { body: emptySeg },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })
    // No danmakuFormat input, should pick the no-`when` (default) variant.
    const result = await runner.runDanmaku({ cid: 1300001 })
    expect(result).toEqual([])
    expect(calls.length).toBe(3)
  })

  it('protobuf variant decodes 304-with-empty-body as no-more-segments', async () => {
    // Bilibili abuses 304 as "no danmaku for this segment". The manifest
    // opts in via acceptStatus: [304], and the engine decodes the empty
    // body as an empty proto message (zero elems contributed).
    const seg1 = encodeSegment([
      {
        progress: 1000,
        mode: 1,
        color: 16777215,
        content: 'only one',
        midHash: 'a',
      },
    ])
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/x/v2/dm/web/seg.so': (url) => {
        const segIdx = new URL(url).searchParams.get('segment_index')
        if (segIdx === '1') {
          return { body: seg1 }
        }
        return { status: 304, body: new Uint8Array(0) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runDanmaku({
      cid: 1300001,
      danmakuFormat: 'protobuf',
    })) as Array<{ p: string; m: string }>

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ p: '1,1,16777215,a@bili', m: 'only one' })
  })

  it('protobuf variant survives a single transient empty mid-stream', async () => {
    const segWith = (progress: number, content: string) =>
      encodeSegment([
        { progress, mode: 1, color: 16777215, content, midHash: 'x' },
      ])
    const emptySeg = encodeSegment([])
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/v2/dm/web/seg.so': (url) => {
        const segIdx = Number(new URL(url).searchParams.get('segment_index'))
        if (segIdx === 1) return { body: segWith(1000, 'a') }
        if (segIdx === 2) return { body: segWith(2000, 'b') }
        if (segIdx === 3) return { body: emptySeg }
        if (segIdx === 4) return { body: segWith(4000, 'c') }
        return { body: emptySeg }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })
    const result = (await runner.runDanmaku({
      cid: 1300001,
      danmakuFormat: 'protobuf',
    })) as Array<{ p: string; m: string }>

    expect(result).toHaveLength(3)
    expect(result.map((r) => r.m)).toEqual(['a', 'b', 'c'])
    expect(calls.length).toBe(7)
  })

  it('protobuf variant collapses mode 2 and 3 into mode 1 in p', async () => {
    const seg1 = encodeSegment([
      {
        progress: 10000,
        mode: 2,
        color: 0xffffff,
        content: 'mode 2',
        midHash: 'a',
      },
      {
        progress: 20000,
        mode: 3,
        color: 0xffffff,
        content: 'mode 3',
        midHash: 'b',
      },
    ])
    const emptySeg = encodeSegment([])
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/x/v2/dm/web/seg.so': (url) => {
        const segIdx = new URL(url).searchParams.get('segment_index')
        return { body: segIdx === '1' ? seg1 : emptySeg }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runDanmaku({
      cid: 1300001,
      danmakuFormat: 'protobuf',
    })) as Array<{ p: string; m: string }>

    expect(result).toEqual([
      { p: '10,1,16777215,a@bili', m: 'mode 2' },
      { p: '20,1,16777215,b@bili', m: 'mode 3' },
    ])
  })

  it('parseUrl resolves /bangumi/play/ss<id> via season_id query', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/pgc/view/web/season': {
        body: JSON.stringify(seasonFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runParseUrl(
      'https://www.bilibili.com/bangumi/play/ss41410'
    )) as {
      seasonInsert: { providerIds: { seasonId: number } }
      episodeMeta: {
        providerIds: { cid: number; epid: number }
        episodeNumber: number | string
      }
    } | null

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('season_id=41410')
    expect(calls[0].url).not.toContain('ep_id=')
    // seasonId comes from the fixture response, not the URL.
    expect(result?.seasonInsert.providerIds.seasonId).toBe(41410)
    // First episode is picked when only ssid is in the URL.
    expect(result?.episodeMeta.providerIds.cid).toBe(1300001)
    expect(result?.episodeMeta.providerIds.epid).toBe(700001)
    expect(result?.episodeMeta.episodeNumber).toBe(1)
  })

  it('parseUrl resolves /bangumi/play/ep<id> via ep_id query and picks the matching episode', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/pgc/view/web/season': {
        body: JSON.stringify(seasonFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runParseUrl(
      'https://www.bilibili.com/bangumi/play/ep700002'
    )) as {
      episodeMeta: {
        providerIds: { cid: number; epid: number }
        episodeNumber: number | string
      }
    } | null

    expect(calls[0].url).toContain('ep_id=700002')
    expect(calls[0].url).not.toContain('season_id=')
    expect(result?.episodeMeta.providerIds.epid).toBe(700002)
    expect(result?.episodeMeta.providerIds.cid).toBe(1300002)
    expect(result?.episodeMeta.episodeNumber).toBe(2)
  })

  it('parseUrl returns null when the URL host does not match', async () => {
    const { fetcher } = mockFetcher({})
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })
    expect(await runner.runParseUrl('https://example.com/whatever')).toBeNull()
  })

  it('loginProbe returns true when nav.data.isLogin is true', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/nav': {
        body: JSON.stringify({
          code: 0,
          message: '0',
          ttl: 1,
          data: { isLogin: true, uname: 'alice', mid: 12345 },
        }),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    expect(runner.hasLoginProbe()).toBe(true)
    expect(await runner.runLoginProbe<boolean>()).toBe(true)
    expect(calls).toHaveLength(1)
    expect((calls[0].init as { credentials?: string }).credentials).toBe(
      'include'
    )
  })

  it('loginProbe returns false when nav.data.isLogin is false', async () => {
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/nav': {
        body: JSON.stringify({
          code: -101,
          message: '账号未登录',
          ttl: 1,
          data: { isLogin: false },
        }),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    expect(await runner.runLoginProbe<boolean>()).toBe(false)
  })

  it('parseUrl emits episodeMeta=undefined when no episode matches the epid', async () => {
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/pgc/view/web/season': {
        body: JSON.stringify(seasonFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runParseUrl(
      'https://www.bilibili.com/bangumi/play/ep999999'
    )) as {
      seasonInsert: { indexedId: string }
      episodeMeta: unknown
    } | null

    expect(result?.seasonInsert.indexedId).toBe('41410')
    expect(result?.episodeMeta).toBeUndefined()
  })

  it('search omits the UGC request when includeUserUploads is false', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/nav': {
        body: JSON.stringify(NAV_RESPONSE),
      },
      'https://api.bilibili.com/x/web-interface/wbi/search/type': (url) => {
        const params = new URL(url).searchParams
        return {
          body: JSON.stringify(
            params.get('search_type') === 'media_bangumi'
              ? bangumiFixture
              : ftFixture
          ),
        }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runSearch({
      q: 'frieren',
      includeUserUploads: false,
    })) as Array<{ indexedId: string }>

    // nav + media_bangumi + media_ft. The gated forEach makes no request.
    expect(calls).toHaveLength(3)
    expect(calls.some((c) => c.url.includes('search_type=video'))).toBe(false)
    expect(result).toHaveLength(2)
  })

  it('search appends user uploads when includeUserUploads is true', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/nav': {
        body: JSON.stringify(NAV_RESPONSE),
      },
      'https://api.bilibili.com/x/web-interface/wbi/search/type': (url) => {
        const params = new URL(url).searchParams
        const type = params.get('search_type')
        if (type === 'media_bangumi')
          return { body: JSON.stringify(bangumiFixture) }
        if (type === 'media_ft') return { body: JSON.stringify(ftFixture) }
        return { body: JSON.stringify(ugcSearchFixture) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runSearch({
      q: 'frieren',
      includeUserUploads: true,
    })) as Array<Record<string, unknown>>

    expect(calls).toHaveLength(4)
    const ugcCall = calls.find((c) => c.url.includes('search_type=video'))
    expect(ugcCall).toBeDefined()
    // The UGC search is WBI-signed like the other two.
    expect(new URL(ugcCall?.url ?? '').searchParams.get('w_rid')).toMatch(
      /^[a-f0-9]{32}$/
    )

    // Official results first, user uploads appended.
    expect(result).toHaveLength(4)
    expect(result[0]?.providerIds).toEqual({
      seasonId: 41410,
      mediaId: 28219412,
    })
    expect(result[2]).toEqual({
      providerIds: { bvid: 'BV1bpj66qEHs', aid: 116777275101297 },
      indexedId: 'BV1bpj66qEHs',
      // <em class="keyword"> highlight markup is stripped.
      title: '鬼灭之刃真人版',
      type: 'MAD·AMV',
      typeDescription: 'MAD·AMV',
      // Protocol-relative cover URLs are normalized to https.
      imageUrl:
        'https://i0.hdslb.com/bfs/archive/d87bceed51f1abafdcc777c513cc2a38ef38fb14.jpg',
      year: 2026,
    })
  })

  it('episodes variant maps the parts of a standalone UGC video', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/view': {
        body: JSON.stringify(ugcViewFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runEpisodes({
      bvid: 'BV15EhG6qEAg',
    })) as Array<Record<string, unknown>>

    expect(calls[0]?.url).toContain('bvid=BV15EhG6qEAg')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      providerIds: {
        cid: 41250393999,
        aid: 117155433551659,
        bvid: 'BV15EhG6qEAg',
      },
      indexedId: '41250393999',
      title: '【中】《无限大》定档预告丨27年1月15日全球上线',
      episodeNumber: 1,
      imageUrl:
        'https://i2.hdslb.com/bfs/archive/c6f6c0e1ee112630a5c97b7937648838d7128c07.jpg',
    })
    expect(result[1]?.episodeNumber).toBe(2)
  })

  it('episodes variant lists the whole collection when the video is in a ugc_season', async () => {
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/view': {
        body: JSON.stringify(ugcSeasonViewFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runEpisodes({
      bvid: 'BV1anhG6KEaC',
    })) as Array<Record<string, unknown>>

    // The collection's videos are the episodes, not the landed video's parts.
    expect(result).toHaveLength(2)
    expect(result[0]?.providerIds).toEqual({
      cid: 41249669654,
      aid: 117155299395681,
      bvid: 'BV15dhG6GEhd',
    })
    expect(result.map((r) => r.episodeNumber)).toEqual([1, 2])
  })

  it('episodes picks the pgc variant when seasonId is present', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/pgc/view/web/season': {
        body: JSON.stringify(seasonFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    // A pgc episode's providerIds carry a bvid too; seasonId must still win.
    await runner.runEpisodes({ seasonId: 41410, bvid: 'BV1aaaaaaaa' })
    expect(calls[0]?.url).toContain('/pgc/view/web/season')
  })

  it('season variant re-fetches a UGC video by bvid', async () => {
    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/view': {
        body: JSON.stringify(ugcSeasonViewFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runSeason({ bvid: 'BV1anhG6KEaC' })) as {
      providerIds: { bvid: string }
      indexedId: string
      episodeCount: number
    } | null

    expect(result?.providerIds.bvid).toBe('BV1anhG6KEaC')
    expect(result?.indexedId).toBe('BV1anhG6KEaC')
    expect(result?.episodeCount).toBe(2)
  })

  it('parseUrl resolves /video/BV<id> to the video and its position in the collection', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/view': {
        body: JSON.stringify(ugcSeasonViewFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runParseUrl(
      'https://www.bilibili.com/video/BV1anhG6KEaC?spm_id_from=333.788'
    )) as {
      seasonInsert: { providerIds: { bvid: string }; episodeCount: number }
      episodeMeta: {
        providerIds: { cid: number; bvid: string }
        episodeNumber: number
        externalLink: string
      }
    } | null

    expect(calls[0]?.url).toContain('bvid=BV1anhG6KEaC')
    expect(calls[0]?.url).not.toContain('aid=')
    expect(result?.seasonInsert.providerIds.bvid).toBe('BV1anhG6KEaC')
    expect(result?.seasonInsert.episodeCount).toBe(2)
    expect(result?.episodeMeta.providerIds.cid).toBe(41251442543)
    // The landed video is the 2nd entry of the collection.
    expect(result?.episodeMeta.episodeNumber).toBe(2)
    expect(result?.episodeMeta.externalLink).toBe(
      'https://www.bilibili.com/video/BV1anhG6KEaC'
    )
  })

  it('parseUrl resolves /video/av<id> via the aid query', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.bilibili.com/x/web-interface/view': {
        body: JSON.stringify(ugcViewFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBilibili), {
      fetcher,
    })

    const result = (await runner.runParseUrl(
      'https://www.bilibili.com/video/av117155433551659'
    )) as {
      seasonInsert: { providerIds: { bvid: string } }
      episodeMeta: { episodeNumber: number }
    } | null

    expect(calls[0]?.url).toContain('aid=117155433551659')
    expect(calls[0]?.url).not.toContain('bvid=')
    expect(result?.seasonInsert.providerIds.bvid).toBe('BV15EhG6qEAg')
    // Standalone upload: no collection to index into.
    expect(result?.episodeMeta.episodeNumber).toBe(1)
  })
})
