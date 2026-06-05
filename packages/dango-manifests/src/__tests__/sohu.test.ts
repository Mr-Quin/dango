import { ManifestRunner, zManifest } from '@mr-quin/dango'
import { describe, expect, it } from 'bun:test'
import builtinSohu from '../manifests/sohu.json' with { type: 'json' }
import searchFixture from './fixtures/sohu-search.json' with { type: 'json' }
import albumFixture from './fixtures/sohu-album.json' with { type: 'json' }
import dmList0 from './fixtures/sohu-dmlist-0.json' with { type: 'json' }
import dmList1 from './fixtures/sohu-dmlist-1.json' with { type: 'json' }
import { mockFetcher } from './mockFetcher.js'

/**
 * Pins the sohu reference manifest end-to-end against captured
 * fixtures. search filters to site=1 album results, strips the <<<>>> markers
 * from the title and lifts the type out of the pipe-delimited meta line.
 * episodes maps the album videos list. danmaku derives the segment count from
 * the duration, fetches each paginated dmListAll window (keyed by time_begin)
 * and maps each comment to the canonical {p, m} shape, including the hex color
 * decode the manifest applies to t.c.
 */

describe('sohu manifest', () => {
  it('search: keeps site=1 albums, strips markers and parses the meta type', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://m.so.tv.sohu.com/search/pc/keyword': {
        body: JSON.stringify(searchFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinSohu), {
      fetcher,
    })

    const result = await runner.runSearch({ q: '法医秦明' })

    expect(result).toEqual([
      {
        providerIds: { aid: '9434506' },
        indexedId: '9434506',
        title: '法医秦明第二季：清道夫',
        type: '电视剧',
        year: 2018,
        imageUrl:
          'http://photocdn.tv.sohu.com/img/kis/fengmian/1213/1213822/1213822_ver_default_20180419094003.jpg',
        episodeCount: 20,
      },
      {
        providerIds: { aid: '9174927' },
        indexedId: '9174927',
        title: '法医秦明第一季',
        type: '电视剧',
        year: 2016,
        imageUrl:
          'http://photocdn.tv.sohu.com/img/kis/fengmian/1207/1207437/1207437_ver_default_20200814113317.jpg',
        episodeCount: 20,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('episodes: maps the album videos list to canonical entries', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.tv.sohu.com/v4/album/videos/9434506.json': {
        body: JSON.stringify(albumFixture),
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinSohu), {
      fetcher,
    })

    const result = await runner.runEpisodes({ aid: '9434506' })

    expect(result).toEqual([
      {
        providerIds: { vid: '4804013', aid: '9434506', durationSec: 2526 },
        indexedId: '4804013',
        title: '法医秦明第二季：清道夫第1集',
        episodeNumber: 1,
      },
      {
        providerIds: { vid: '4819265', aid: '9434506', durationSec: 2300 },
        indexedId: '4819265',
        title: '法医秦明第二季：清道夫第2集',
        episodeNumber: 2,
      },
    ])
    expect(calls).toHaveLength(1)
  })

  it('danmaku: derives the segment count from the duration and emits canonical {p, m}', async () => {
    const { fetcher, calls } = mockFetcher({
      'https://api.danmu.tv.sohu.com/dmh5/dmListAll': (url) => {
        const timeBegin = new URL(url).searchParams.get('time_begin') ?? ''
        if (timeBegin === '0') {
          return { body: JSON.stringify(dmList0) }
        }
        if (timeBegin === '300') {
          return { body: JSON.stringify(dmList1) }
        }
        return {
          body: JSON.stringify({
            msg: 'ok',
            ver: 201707,
            status: 1,
            info: { comments: [] },
          }),
        }
      },
    })
    const runner = new ManifestRunner(zManifest.parse(builtinSohu), {
      fetcher,
    })

    // durationSec 400 → maxTime 400 → ceil(400/300) = 2 segments (time_begin 0, 300)
    const result = await runner.runDanmaku({
      vid: '4804013',
      aid: '9434506',
      durationSec: 400,
    })

    expect(calls).toHaveLength(2)
    expect(result).toEqual([
      { p: '0,1,16777215,331519407', m: '欢迎来到法医秦明2第一集~' },
      {
        p: '0,1,16777215,393790055',
        m: '弹幕都咋回事啊不想看就不看门某逼着嫩看',
      },
      { p: '2,1,16729994,406633878', m: '第一部完第二部' },
      { p: '23,1,3521691,356869560', m: '张泽禹张极' },
      { p: '1200,1,16777215,390586164', m: '歼十' },
      {
        p: '1201,1,16777215,390431348',
        m: '硬核总结：一季yyds二季啥也不是啥也没有',
      },
      { p: '1202,1,16777215,389203737', m: '这演技还是差点意思' },
    ])
  })
})
