import {
  Adapter,
  ArtplayerAdapter,
  ArtplayerMetadata,
  BiliCommandGrpcAdapter,
  BiliCommandGrpcMetadata,
  BiliGrpcAdapter,
  BiliGrpcMetadata,
  BiliUpAdapter,
  BiliUpMetadata,
  BiliXmlAdapter,
  BiliXmlMetadata,
  DanuniJsonAdapter,
  DanuniJsonMetadata,
  DanuniPbAdapter,
  DanuniPbMetadata,
  DdplayAdapter,
  DdplayMetadata,
  DplayerAdapter,
  DplayerMetadata,
  Metadata,
  TencentAdapter,
  TencentMetadata,
  VodAdapter,
  VodMetadata,
} from '@dan-uni/dan-any/adapters'
import { UDanmaku } from '@dan-uni/dan-any/core'
import { UniDB } from '@dan-uni/dan-any/core/main/pure'
import { fileParser } from '@dan-uni/dan-any/utils'
import JSONbig from 'json-bigint'

const JSONBig = JSONbig({
  useNativeBigInt: true,
})

const metadata2adapter = {
  [BiliXmlMetadata.type]: BiliXmlAdapter,
  [BiliGrpcMetadata.type]: BiliGrpcAdapter,
  [BiliCommandGrpcMetadata.type]: BiliCommandGrpcAdapter,
  [BiliUpMetadata.type]: BiliUpAdapter,
  [DanuniJsonMetadata.type]: DanuniJsonAdapter,
  [DanuniPbMetadata.type]: DanuniPbAdapter,
  [ArtplayerMetadata.type]: ArtplayerAdapter,
  [DplayerMetadata.type]: DplayerAdapter,
  [DdplayMetadata.type]: DdplayAdapter,
  [TencentMetadata.type]: TencentAdapter,
  [VodMetadata.type]: VodAdapter,
}

export function findAdapterByMetadata(
  metadata: Metadata | Metadata['type']
): Adapter {
  const type = typeof metadata === 'string' ? metadata : metadata.type
  const adapter = metadata2adapter[type]
  if (!adapter) {
    throw new Error(`Unsupported '@dan-uni/dan-any' metadata type: ${type}`)
  }
  return adapter
}

export async function parseDanAnyBody(
  format: string,
  raw: Uint8Array,
  params?: [
    (
      | Parameters<typeof DanuniJsonAdapter>[1]
      | Parameters<typeof ArtplayerAdapter>[1]
      | Parameters<typeof DplayerAdapter>[1]
      | Parameters<typeof DdplayAdapter>[1]
      | Parameters<typeof TencentAdapter>[1]
      | Parameters<typeof VodAdapter>[1]
    ),
    (
      | Parameters<typeof ArtplayerAdapter>[2]
      | Parameters<typeof DplayerAdapter>[2]
      | Parameters<typeof DdplayAdapter>[2]
    ),
  ]
): Promise<UDanmaku[]> {
  const udb = new UniDB().init()
  switch (format) {
    case BiliXmlMetadata.type:
      return (await udb.import(BiliXmlAdapter(await fileParser(raw, 'string'))))
        .$danmakus
    case BiliGrpcMetadata.type:
      return (await udb.import(BiliGrpcAdapter(await fileParser(raw, 'bin'))))
        .$danmakus
    case BiliCommandGrpcMetadata.type:
      return (
        await udb.import(BiliCommandGrpcAdapter(await fileParser(raw, 'bin')))
      ).$danmakus
    case BiliUpMetadata.type:
      return (
        await udb.import(BiliUpAdapter(await fileParser(raw, 'json', JSONBig)))
      ).$danmakus
    case DanuniJsonMetadata.type:
      return (
        await udb.import(
          DanuniJsonAdapter(
            await fileParser(raw, 'json'),
            params?.[0] as Parameters<typeof DanuniJsonAdapter>[1] | undefined
          )
        )
      ).$danmakus
    case DanuniPbMetadata.type:
      return (await udb.import(DanuniPbAdapter(await fileParser(raw, 'bin'))))
        .$danmakus
    case ArtplayerMetadata.type:
      return (
        await udb.import(
          ArtplayerAdapter(
            await fileParser(raw, 'json'),
            params?.[0] as Parameters<typeof ArtplayerAdapter>[1] | undefined,
            params?.[1] as Parameters<typeof ArtplayerAdapter>[2] | undefined
          )
        )
      ).$danmakus
    case DplayerMetadata.type:
      return (
        await udb.import(
          DplayerAdapter(
            await fileParser(raw, 'json'),
            params?.[0] as Parameters<typeof DplayerAdapter>[1] | undefined,
            params?.[1] as Parameters<typeof DplayerAdapter>[2] | undefined
          )
        )
      ).$danmakus
    case DdplayMetadata.type:
      return (
        await udb.import(
          DdplayAdapter(
            await fileParser(raw, 'json'),
            params?.[0] as Parameters<typeof DdplayAdapter>[1] | undefined,
            params?.[1] as Parameters<typeof DdplayAdapter>[2] | undefined
          )
        )
      ).$danmakus
    case TencentMetadata.type:
      return (
        await udb.import(
          TencentAdapter(
            await fileParser(raw, 'json'),
            params?.[0] as Parameters<typeof TencentAdapter>[1] | undefined
          )
        )
      ).$danmakus
    case VodMetadata.type:
      return (
        await udb.import(
          VodAdapter(
            await fileParser(raw, 'json'),
            params?.[0] as Parameters<typeof VodAdapter>[1] | undefined,
            params?.[1] as Parameters<typeof VodAdapter>[2] | undefined
          )
        )
      ).$danmakus
    default:
      throw new Error(`Unsupported '@dan-uni/dan-any' format: ${format}`)
  }
}
