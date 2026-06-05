import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinMaiduidui from '../manifests/builtin-maiduidui.json' with { type: 'json' }
import searchFixture from './fixtures/maiduidui-search.json' with { type: 'json' }
import sactionsFixture from './fixtures/maiduidui-sactions.json' with { type: 'json' }
import barrage0 from './fixtures/maiduidui-barrage-0.json' with { type: 'json' }
import barrage1 from './fixtures/maiduidui-barrage-1.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the maiduidui reference manifest end-to-end against captured
 * fixtures. search keeps drama/movie/variety results and flattens vodList into
 * canonical entries. episodes maps the listVodSactions data array. danmaku is a
 * per-minute forEach over vodBarrage: the segment count derives from
 * durationSec, so a small duration yields two signed POSTs whose request body
 * carries data.times = i * 60. The handler dispatches page 0 / page 1 off that
 * value and maps each barrage row to the canonical {p, m} shape.
 */

function segmentTimes(init: unknown): number {
  const body = (init as { body?: string } | undefined)?.body ?? '{}'
  const parsed = JSON.parse(body) as { data?: { times?: number } }
  return parsed.data?.times ?? -1
}

describe('maiduidui manifest', () => {
  it('search: keeps drama/movie/variety results and flattens vodList', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://mob.mddcloud.com.cn/searchApi/search/getAllSearchResult4820.action':
        {
          body: JSON.stringify(searchFixture),
        },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMaiduidui), {
      fetcher,
    })

    const result = await runner.runSearch({ q: '黄金十年' })

    expect(result).toEqual([
      {
        providerIds: { vodUuid: '35806b2aa5f811eeb2aee43d1ad5fd70' },
        indexedId: '35806b2aa5f811eeb2aee43d1ad5fd70',
        title: '黄金十年',
        type: '剧集',
        imageUrl:
          'http://qiniufile.mddcloud.com.cn/prod/image/202312/29/20231229111313012543.png',
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: maps the listVodSactions data array', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://mob.mddcloud.com.cn/api/vod/listVodSactions.action': {
        body: JSON.stringify(sactionsFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMaiduidui), {
      fetcher,
    })

    const result = await runner.runEpisodes({
      vodUuid: '35806b2aa5f811eeb2aee43d1ad5fd70',
    })

    expect(result).toEqual([
      {
        providerIds: {
          sactionUuid: 'd17172a7b09011eeb2aee43d1ad5fd70',
          vodUuid: '35806b2aa5f811eeb2aee43d1ad5fd70',
          durationSec: 2054,
        },
        indexedId: 'd17172a7b09011eeb2aee43d1ad5fd70',
        title: '黄金十年01',
        episodeNumber: undefined,
      },
      {
        providerIds: {
          sactionUuid: 'b35653aeb0a311eeb2aee43d1ad5fd70',
          vodUuid: '35806b2aa5f811eeb2aee43d1ad5fd70',
          durationSec: 2502,
        },
        indexedId: 'b35653aeb0a311eeb2aee43d1ad5fd70',
        title: '黄金十年02',
        episodeNumber: undefined,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('danmaku: walks per-minute segments and emits canonical {p, m}', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://mob.mddcloud.com.cn/api/barrage/vodBarrage396.action': (
        _url,
        init
      ) => {
        const times = segmentTimes(init)
        if (times === 0) {
          return { body: JSON.stringify(barrage0) }
        }
        if (times === 60) {
          return { body: JSON.stringify(barrage1) }
        }
        return { body: JSON.stringify({ data: { barrageList: [] } }) }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinMaiduidui), {
      fetcher,
    })

    const result = await runner.runDanmaku({
      sactionUuid: 'd17172a7b09011eeb2aee43d1ad5fd70',
      vodUuid: '35806b2aa5f811eeb2aee43d1ad5fd70',
      durationSec: 120,
    })

    // ceil(120 / 60) = 2 segments → range(0, 2) → i in {0, 1}
    expect(calls).toHaveLength(2)
    expect(result).toEqual([
      { p: '30,1,16777215,48889213', m: '超级赞👍🏻' },
      { p: '40,1,16777215,52970085', m: '终于上架了啊' },
      { p: '41,1,16777215,71415509', m: '超级赞👍🏻' },
      { p: '56,1,16777215,71673898', m: '2026年5月26日' },
      { p: '64,1,16777215,71684334', m: '2026年5月26日' },
    ])
  })
})
