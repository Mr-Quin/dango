import { describe, expect, it } from 'bun:test'
import {
  zCommentRow,
  zEpisodeRow,
  zParseUrlOutput,
  zSearchRow,
  zSeasonRow,
} from '../manifest/output.js'

const searchRow = {
  indexedId: '18398',
  title: 'Frieren',
  providerIds: { animeId: 18398 },
}

const episodeRow = {
  indexedId: '1',
  title: 'Episode 1',
  providerIds: { episodeId: 1 },
}

describe('zSearchRow', () => {
  it('accepts the required fields alone', () => {
    expect(zSearchRow.parse(searchRow)).toEqual(searchRow)
  })

  it('accepts every optional field', () => {
    const row = {
      ...searchRow,
      type: 'tvseries',
      imageUrl: 'not-a-url-on-purpose',
      episodeCount: 28,
      year: 2023,
      alternativeTitles: ['a', 'b'],
      externalLink: 'https://example.com/x',
    }
    expect(zSearchRow.parse(row)).toEqual(row)
  })

  it('keeps extra fields', () => {
    const row = { ...searchRow, typeDescription: 'TV', nested: { a: 1 } }
    expect(zSearchRow.parse(row)).toEqual(row)
  })

  it('rejects a numeric indexedId', () => {
    const result = zSearchRow.safeParse({ ...searchRow, indexedId: 123 })
    expect(result.success).toBe(false)
  })

  it('rejects a missing title', () => {
    const { title: _title, ...row } = searchRow
    expect(zSearchRow.safeParse(row).success).toBe(false)
  })

  it('rejects providerIds that is not an object', () => {
    expect(
      zSearchRow.safeParse({ ...searchRow, providerIds: 'x' }).success
    ).toBe(false)
    expect(
      zSearchRow.safeParse({ ...searchRow, providerIds: null }).success
    ).toBe(false)
    expect(
      zSearchRow.safeParse({ ...searchRow, providerIds: [1] }).success
    ).toBe(false)
  })

  it('rejects wrongly typed optional fields', () => {
    expect(
      zSearchRow.safeParse({ ...searchRow, episodeCount: '28' }).success
    ).toBe(false)
    expect(
      zSearchRow.safeParse({ ...searchRow, alternativeTitles: 'a' }).success
    ).toBe(false)
  })
})

describe('zSeasonRow', () => {
  it('has the same shape as a search row', () => {
    expect(zSeasonRow.parse(searchRow)).toEqual(searchRow)
    expect(zSeasonRow.safeParse({ ...searchRow, indexedId: 1 }).success).toBe(
      false
    )
  })
})

describe('zEpisodeRow', () => {
  it('accepts the required fields alone', () => {
    expect(zEpisodeRow.parse(episodeRow)).toEqual(episodeRow)
  })

  it('accepts a numeric or string episodeNumber', () => {
    expect(zEpisodeRow.parse({ ...episodeRow, episodeNumber: 1 })).toBeDefined()
    expect(
      zEpisodeRow.parse({ ...episodeRow, episodeNumber: 'SP1' })
    ).toBeDefined()
    expect(
      zEpisodeRow.safeParse({ ...episodeRow, episodeNumber: true }).success
    ).toBe(false)
  })

  it('accepts every optional field and extra fields', () => {
    const row = {
      ...episodeRow,
      episodeNumber: 3,
      alternativeTitle: ['x'],
      imageUrl: 'https://example.com/i.jpg',
      externalLink: 'https://example.com/e',
      params: { k: 'v' },
      extra: true,
    }
    expect(zEpisodeRow.parse(row)).toEqual(row)
  })

  it('rejects a numeric indexedId, missing title and bad providerIds', () => {
    expect(zEpisodeRow.safeParse({ ...episodeRow, indexedId: 1 }).success).toBe(
      false
    )
    const { title: _title, ...noTitle } = episodeRow
    expect(zEpisodeRow.safeParse(noTitle).success).toBe(false)
    expect(
      zEpisodeRow.safeParse({ ...episodeRow, providerIds: 'x' }).success
    ).toBe(false)
  })
})

describe('zParseUrlOutput', () => {
  it('accepts a season alone', () => {
    const value = { seasonInsert: searchRow }
    expect(zParseUrlOutput.parse(value)).toEqual(value)
  })

  it('accepts a season with episode metadata', () => {
    const value = { seasonInsert: searchRow, episodeMeta: episodeRow }
    expect(zParseUrlOutput.parse(value)).toEqual(value)
  })

  it('rejects a malformed seasonInsert or episodeMeta', () => {
    expect(
      zParseUrlOutput.safeParse({
        seasonInsert: { ...searchRow, indexedId: 1 },
      }).success
    ).toBe(false)
    expect(
      zParseUrlOutput.safeParse({
        seasonInsert: searchRow,
        episodeMeta: { ...episodeRow, title: undefined },
      }).success
    ).toBe(false)
    expect(zParseUrlOutput.safeParse({}).success).toBe(false)
  })
})

describe('zCommentRow', () => {
  it('accepts p and m with an optional numeric cid', () => {
    expect(zCommentRow.parse({ p: '1,1,16777215', m: 'hi' })).toEqual({
      p: '1,1,16777215',
      m: 'hi',
    })
    const withCid = { cid: 7, p: '1,1,16777215', m: 'hi' }
    expect(zCommentRow.parse(withCid)).toEqual(withCid)
  })

  it('keeps extra fields', () => {
    const row = { p: '1,1,1', m: 'hi', extra: 1 }
    expect(zCommentRow.parse(row)).toEqual(row)
  })

  it('rejects missing or non-string p and m', () => {
    expect(zCommentRow.safeParse({ m: 'hi' }).success).toBe(false)
    expect(zCommentRow.safeParse({ p: '1' }).success).toBe(false)
    expect(zCommentRow.safeParse({ p: 1, m: 'hi' }).success).toBe(false)
    expect(zCommentRow.safeParse({ p: '1', m: 2 }).success).toBe(false)
  })
})
