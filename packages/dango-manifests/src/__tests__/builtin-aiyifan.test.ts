import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinAiyifan from '../manifests/builtin-aiyifan.json' with { type: 'json' }
import searchFixture from './fixtures/aiyifan-search.json' with { type: 'json' }
import playlistFixture from './fixtures/aiyifan-playlist.json' with { type: 'json' }
import playFixture from './fixtures/aiyifan-play.json' with { type: 'json' }
import barrageFixture from './fixtures/aiyifan-barrage.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the builtin:aiyifan reference manifest end-to-end against captured
 * fixtures. Every pipeline first GETs the yfsp.tv homepage and regex-extracts
 * the pConfig publicKey/privateKey used to sign the downstream JSON requests, so
 * the mock serves a minimal homepage carrying the real keys. search maps the
 * briefsearch result, episodes maps the languagesplaylist entries, and danmaku
 * runs the play to getBarrage flow, mapping each row to the canonical {p, m}
 * shape including the real time offsets, top-comment flag and color conversion.
 */

const homepage = `<!doctype html><html><head><script>window.__NUXT__={"pConfig":{"publicKey":"CJSuC3GpDZSuDIumCZbVLLDVEJWkD3KkE34kCZ0vNpGtDpauCZHbDcCoOZGtEJ9YEJGuD3WtCZarDcCnDpLcNpXaE3PcDMKnOp1YPcKoCZatDJSvOJCtDMKuC3aqE68u","privateKey":["SuC3JSuC3GpDZSuDIumC","unused"]}}</script></head><body></body></html>`

describe('builtin:aiyifan manifest', () => {
  it('search: extracts pConfig keys then maps the briefsearch result', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://www.yfsp.tv/': { body: homepage },
      'https://rankv21.tripdata.app/v3/list/briefsearch': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinAiyifan), {
      fetcher,
    })

    const result = await runner.runSearch({ q: '庆余年' })

    expect(result).toEqual([
      {
        providerIds: { vid: 'WdzDFf5yws5' },
        indexedId: 'WdzDFf5yws5',
        title: '庆余年第2季',
        type: '电视剧',
        year: 2024,
        imageUrl:
          'https://static.tripdata.app/upload/video/202405161324572424161s.gif',
      },
    ])
    expect(calls).toHaveLength(2)
  })

  it('episodes: maps the languagesplaylist entries', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://www.yfsp.tv/': { body: homepage },
      'https://m10.yfsp.tv/v3/video/languagesplaylist': {
        body: JSON.stringify(playlistFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinAiyifan), {
      fetcher,
    })

    const result = await runner.runEpisodes({ vid: 'WdzDFf5yws5' })

    expect(result).toEqual([
      {
        providerIds: { epKey: 'vE7hLqizOD0' },
        indexedId: 'vE7hLqizOD0',
        title: '01',
        episodeNumber: 986890,
      },
      {
        providerIds: { epKey: 'L9fhMfZuybD' },
        indexedId: 'L9fhMfZuybD',
        title: '02',
        episodeNumber: 986901,
      },
    ])
    expect(calls).toHaveLength(2)
  })

  it('danmaku: runs the play to getBarrage flow and emits canonical {p, m}', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://www.yfsp.tv/': { body: homepage },
      'https://m10.yfsp.tv/v3/video/play': {
        body: JSON.stringify(playFixture),
      },
      'https://m10.yfsp.tv/api/video/getBarrage': {
        body: JSON.stringify(barrageFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinAiyifan), {
      fetcher,
    })

    const result = await runner.runDanmaku({ epKey: 'vE7hLqizOD0' })

    // homepage + play + getBarrage
    expect(calls).toHaveLength(3)
    expect(result).toEqual([
      { p: '0,1,16777215,', m: '第三季什么时候出  啊' },
      { p: '0,1,16777215,', m: '第二季改太多，抱月楼这改的特别不好' },
      { p: '0,1,16777215,', m: 'Hgv ' },
      { p: '0,1,16777215,', m: '等了好久了' },
      { p: '0,1,16777215,', m: '来了...............' },
      { p: '0.204,1,16777215,', m: '1' },
      { p: '2.445,1,16646144,', m: '来了来了 终于来了' },
      {
        p: '8.194,5,16646144,',
        m: '温馨提醒：为了您的观看体验，请屏蔽关键字 肖战',
      },
    ])
  })
})
