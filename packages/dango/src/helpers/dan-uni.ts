import { DdplayTransformer } from '@dan-uni/dan-any/adapters'
import { UDanmaku } from '@dan-uni/dan-any/core'
import { UniChunk, UniDB } from '@dan-uni/dan-any/core/main/pure'

const udb = new UniDB().init()

export function toUniChunk(udanmakus: UDanmaku[]) {
  const uchunk = udb.makeChunk({ tmp: true })
  uchunk.upsertDanmakus(udanmakus)
  return uchunk
}

export function toCommentEntity(uchunk: UniChunk) {
  const dans = uchunk.export(DdplayTransformer)
  return dans.comments.map((d: { cid?: number; p: string; m: string }) => {
    delete d.cid
    return d
  })
}
