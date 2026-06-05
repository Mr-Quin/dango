import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinRenren from '../manifests/builtin-renren.json' with { type: 'json' }
import searchFixture from './fixtures/renren-search.json' with { type: 'json' }
import detailsFixture from './fixtures/renren-details.json' with { type: 'json' }
import danmuFixture from './fixtures/renren-danmu.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the renren reference manifest end-to-end against captured
 * fixtures. search maps the qwtv/search data list to canonical entries.
 * episodes maps drama/details episodeList keyed by sid, deriving titles from
 * episodeNo when the upstream title is empty. danmaku reads the array-rooted
 * produce/danmu response and splits each CSV `p` string into the canonical
 * {p, m} shape, where p carries the real time offset, color and author id.
 */

describe('renren manifest', () => {
  it('search: maps the qwtv search list to canonical entries', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.gorafie.com/qwtv/search': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinRenren), {
      fetcher,
    })

    const result = await runner.runSearch({ q: '黑暗荣耀' })

    expect(result).toEqual([
      {
        providerIds: { seriesId: '40906' },
        indexedId: '40906',
        title: '黑暗荣耀 第二季',
        type: '电视剧',
        year: 2023,
        imageUrl:
          'http://img.duoduoshipin.vip/img/img/20230315/o_e9d4627912bf4f9d8aaa6e751ae0d41b.jpg',
      },
      {
        providerIds: { seriesId: '40681' },
        indexedId: '40681',
        title: '黑暗荣耀 第一季',
        type: '电视剧',
        year: 2022,
        imageUrl:
          'http://img.duoduoshipin.vip/img/img/20230308/o_5281e0efff0d41158c2ab7744dc7308c.jpg',
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: maps episodeList keyed by sid, deriving empty titles from episodeNo', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.gorafie.com/qwtv/drama/details': {
        body: JSON.stringify(detailsFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinRenren), {
      fetcher,
    })

    const result = await runner.runEpisodes({ seriesId: '40906' })

    expect(result).toEqual([
      {
        providerIds: { sid: '297185' },
        indexedId: '297185',
        title: '第1集',
        episodeNumber: 1,
      },
      {
        providerIds: { sid: '297188' },
        indexedId: '297188',
        title: '第2集',
        episodeNumber: 2,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('danmaku: splits the array-rooted CSV p strings into canonical {p, m}', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://static-dm.qwdjapp.com/v1/produce/danmu/EPISODE/297185': {
        body: JSON.stringify(danmuFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinRenren), {
      fetcher,
    })

    const result = await runner.runDanmaku({ sid: '297185' })

    expect(result).toEqual([
      { p: '0.000,1,16777215,179634455', m: '哇啊啊啊啊啊终于出来了' },
      { p: '1.000,1,16777215,98466040', m: '来了2023.3.13小皖' },
      { p: '1.000,1,16777215,199210690', m: '妍珍啊我来了' },
      { p: '1.000,1,16777215,114234609', m: '留名留名留名' },
      { p: '1.000,1,16777215,28813010', m: '啊啊啊开始了' },
      { p: '2.000,1,16777215,195180845', m: '超级好看' },
    ])
    expect(calls).toHaveLength(1)
  })
})
