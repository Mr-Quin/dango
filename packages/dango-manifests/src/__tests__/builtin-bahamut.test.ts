import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinBahamut from '../manifests/builtin-bahamut.json' with { type: 'json' }
import searchFixture from './fixtures/bahamut-search.json' with { type: 'json' }
import videoFixture from './fixtures/bahamut-video.json' with { type: 'json' }
import danmuFixture from './fixtures/bahamut-danmu.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the bahamut reference manifest end-to-end against captured
 * fixtures. search lifts video_sn and parses the year and episode count out of
 * the Traditional Chinese info string. episodes flattens the episodes object
 * (whose values are arrays grouped by season) into canonical entries. danmaku
 * is a single danmu.php fetch mapping each row to {p, m}: time is divided by 10,
 * position maps to a danmaku mode and the hex color is converted to an int.
 */

describe('bahamut manifest', () => {
  it('search: lifts video_sn and parses year and episode count from info', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.gamer.com.tw/mobile_app/anime/v1/search.php': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBahamut), {
      fetcher,
    })

    const result = await runner.runSearch({ q: '鬼滅' })

    expect(result).toEqual([
      {
        providerIds: { videoSn: '38250' },
        indexedId: '38250',
        title: '鬼滅之刃 柱訓練篇',
        type: '动漫',
        year: 2024,
        imageUrl: 'https://p2.bahamut.com.tw/B/ACG/c/16/0000133416.JPG',
        episodeCount: 8,
      },
      {
        providerIds: { videoSn: '33295' },
        indexedId: '33295',
        title: '鬼滅之刃 刀匠村篇',
        type: '动漫',
        year: 2023,
        imageUrl: 'https://p2.bahamut.com.tw/B/ACG/c/87/0000122787.JPG',
        episodeCount: 11,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: flattens the season-grouped episodes object', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.gamer.com.tw/anime/v1/video.php': {
        body: JSON.stringify(videoFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBahamut), {
      fetcher,
    })

    const result = await runner.runEpisodes({ videoSn: '38250' })

    expect(result).toEqual([
      {
        providerIds: { videoSn: '38250' },
        indexedId: '38250',
        title: '第1集',
        episodeNumber: 1,
      },
      {
        providerIds: { videoSn: '38331' },
        indexedId: '38331',
        title: '第2集',
        episodeNumber: 2,
      },
      {
        providerIds: { videoSn: '41294' },
        indexedId: '41294',
        title: '第1集',
        episodeNumber: 1,
      },
      {
        providerIds: { videoSn: '41295' },
        indexedId: '41295',
        title: '第2集',
        episodeNumber: 2,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('danmaku: maps time/10, position mode and hex color to canonical {p, m}', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.gamer.com.tw/anime/v1/danmu.php': {
        body: JSON.stringify(danmuFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinBahamut), {
      fetcher,
    })

    const result = await runner.runDanmaku({ videoSn: '38250' })

    expect(result).toEqual([
      { p: '0,1,16777215,andy475713', m: '1' },
      { p: '0.2,4,16711718,FeiFei88', m: '2025／8／24' },
      { p: '5.4,5,16639293,emu9025', m: '2025/8/12簽' },
      { p: '0.4,1,16777215,efg130', m: '20250802' },
      { p: '0.8,1,16749718,star112999', m: '20240821 我來啦' },
    ])
    expect(calls).toHaveLength(1)
  })
})
