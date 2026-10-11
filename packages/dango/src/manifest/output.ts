import { z } from 'zod'

const zProviderIds = z.record(z.string(), z.unknown())

/**
 * A search hit. `indexedId` is the source's own id for the title, always a
 * string. Rows are loose: a manifest may emit extra fields a host chooses to
 * read later. URLs are plain strings; the host decides how strictly to treat
 * them.
 */
export const zSearchRow = z.looseObject({
  indexedId: z.string(),
  title: z.string(),
  providerIds: zProviderIds,
  type: z.string().optional(),
  imageUrl: z.string().optional(),
  episodeCount: z.number().optional(),
  year: z.number().optional(),
  alternativeTitles: z.array(z.string()).optional(),
  externalLink: z.string().optional(),
})
export type SearchRow = z.infer<typeof zSearchRow>

/** Output of the `season` pipeline; same shape as a search row. */
export const zSeasonRow = zSearchRow
export type SeasonRow = SearchRow

export const zEpisodeRow = z.looseObject({
  indexedId: z.string(),
  title: z.string(),
  providerIds: zProviderIds,
  episodeNumber: z.union([z.number(), z.string()]).optional(),
  alternativeTitle: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  externalLink: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
})
export type EpisodeRow = z.infer<typeof zEpisodeRow>

export const zParseUrlOutput = z.object({
  seasonInsert: zSearchRow,
  episodeMeta: zEpisodeRow.optional(),
})
export type ParseUrlOutput = z.infer<typeof zParseUrlOutput>

/** One danmaku comment: `p` is the comma-separated attribute string. */
export const zCommentRow = z.looseObject({
  p: z.string(),
  m: z.string(),
  cid: z.number().optional(),
})
export type CommentRow = z.infer<typeof zCommentRow>
