import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinIqiyi from '../manifests/builtin-iqiyi.json' with { type: 'json' }
import searchFixture from './fixtures/iqiyi-search.json' with { type: 'json' }
import decodeFixture from './fixtures/iqiyi-decode.json' with { type: 'json' }
import episodesFixture from './fixtures/iqiyi-episodes.json' with { type: 'json' }
import infoFixture from './fixtures/iqiyi-info.json' with { type: 'json' }
import segmentFixture from './fixtures/iqiyi-segment.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the builtin:iqiyi reference manifest end-to-end against captured
 * fixtures. search keeps template 101/102/103 albums whose pageUrl is a real
 * /v_ watch page and lifts the linkId, type and episode count. episodes decodes
 * the linkId to a tvid then walks the signed base_info album_episodes block.
 * danmaku reads the duration, derives the per-300s shard list, fetches the
 * zlib-compressed XML bullet shard and maps each row to the canonical {p, m}.
 * The shard fixture is real bullets re-deflated, exercising the decompress path.
 */

const segmentBytes = Uint8Array.from(atob(segmentFixture.b64), (c) =>
  c.charCodeAt(0)
)

describe('builtin:iqiyi manifest', () => {
  it('search: keeps /v_ watch-page albums and lifts linkId, type and count', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://mesh.if.iqiyi.com/portal/lw/search/homePageV3': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinIqiyi), {
      fetcher,
    })

    const result = await runner.runSearch({ q: '莲花楼' })

    expect(result).toEqual([
      {
        providerIds: { linkId: '25ltrdm1rl8' },
        indexedId: '25ltrdm1rl8',
        title: '莲花楼',
        type: '电视剧',
        year: 2023,
        imageUrl:
          'https://pic9.iqiyipic.com/image/20240920/e5/43/a_100517696_m_601_m35_260_360.avif',
        episodeCount: 40,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: decodes the linkId then maps the album_episodes block', async () => {
    const { fetcher } = mockFetcher({
      'https://pcw-api.iq.com/api/decode/25ltrdm1rl8': {
        body: JSON.stringify(decodeFixture),
      },
      'https://www.iqiyi.com/prelw/tvg/v2/lw/base_info': {
        body: JSON.stringify(episodesFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinIqiyi), {
      fetcher,
    })

    const result = await runner.runEpisodes({ linkId: '25ltrdm1rl8' })

    expect(result).toEqual([
      {
        providerIds: { tvid: '8010127344745600' },
        indexedId: '8010127344745600',
        title: '莲花楼第1集 李莲花偶遇方多病',
        episodeNumber: 1,
      },
      {
        providerIds: { tvid: '8051839968822800' },
        indexedId: '8051839968822800',
        title: '莲花楼第2集 方多病出手救下李莲花',
        episodeNumber: 2,
      },
    ])
  })

  it('danmaku: derives the shard list and maps the decompressed bullet XML', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://pcw-api.iqiyi.com/video/video/baseinfo/8010127344745600': {
        body: JSON.stringify(infoFixture),
      },
      'https://cmts.iqiyi.com/bullet/56/00/8010127344745600_300_1.z': {
        body: segmentBytes,
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinIqiyi), {
      fetcher,
    })

    const result = await runner.runDanmaku({ tvid: '8010127344745600' })

    // duration 300 -> ceil(300/300) = 1 shard (i=1). info + 1 shard.
    expect(calls).toHaveLength(2)
    expect(result).toEqual([
      { p: '1,1,16777215,1694838404542410326', m: '花有重开日，人无再少年' },
      { p: '1,1,16777215,1721667599880415818', m: 'zZ:楼子生日快乐&#127882;' },
      {
        p: '1,1,16777215,1691631690557105291',
        m: '让我看看有多少人是从结局回来的',
      },
      { p: '1,1,16777215,1718850911185918412', m: '前奏响起又回到了去年夏天' },
      {
        p: '1,1,16777215,1747425804001938217',
        m: '果果：淇淇生日快乐&#129373;',
      },
      { p: '1,1,16777215,1737843173594067944', m: '甲辰年腊月二十七纪念一下' },
      { p: '1,1,16777215,1691815209650378123', m: '今天是4刷哦！' },
      {
        p: '2,1,16777215,1691672625276658785',
        m: '不行，结尾太刀了我要再看一遍[二刷打卡]',
      },
    ])
  })
})
