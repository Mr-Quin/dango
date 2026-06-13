import { describe, expect, it } from 'bun:test'
import { ManifestRunner } from '../engine/ManifestRunner.js'
import { ProtoRegistry } from '../engine/proto.js'
import { zManifest } from '../manifest/schema.js'
import { mockFetcher } from './fixtures.js'
import { encodeProtoMessage } from './proto-fixtures.js'

/**
 * Exercises the eval-free proto decode path: manifests carry a base64
 * `FileDescriptorSet` under `protoDescriptors`, the engine decodes wire
 * bytes reflectively via `@bufbuild/protobuf` (no codegen/injection).
 * Asserts a Bilibili-style segment decodes to the expected plain object and
 * that unknown schema / message references surface clear errors. The
 * descriptor below was generated from a `dm.v1.Segment` proto3 schema with
 * fields: Item { int64 progress=2; int32 mode=3; uint32 color=8; string
 * content=7; string mid_hash=9 } and Segment { repeated Item elems=1 }.
 */
const dmSegDescriptor =
  'Cp0BCgtkbV92MS5wcm90bxIFZG0udjEiWAoESXRlbRIQCghwcm9ncmVzcxgCIAEoAxIMCgRtb2RlGAMgASgFEg0KBWNvbG9yGAggASgNEg8KB2NvbnRlbnQYByABKAkSEAoIbWlkX2hhc2gYCSABKAkiJQoHU2VnbWVudBIaCgVlbGVtcxgBIAMoCzILLmRtLnYxLkl0ZW1iBnByb3RvMw=='

function encodeSegment(
  items: Array<{
    progress: number
    mode: number
    color: number
    content: string
    midHash?: string
  }>
): Uint8Array {
  const elems = items.map((item) => {
    return {
      progress: BigInt(item.progress),
      mode: item.mode,
      color: item.color,
      content: item.content,
      midHash: item.midHash ?? '',
    }
  })
  return encodeProtoMessage(dmSegDescriptor, 'dm.v1.Segment', { elems })
}

describe('proto decode against hand-constructed wire bytes', () => {
  it('decodes bytes assembled by hand per the protobuf wire format', () => {
    // One Segment { elems: [ Item { progress: 1000, mode: 1, content: 'hi' } ] }
    // written field by field, so its correctness is independent of any encoder.
    //   0a 09          elems: field 1, LEN, length 9 (the Item below)
    //     10 e8 07     progress: field 2, VARINT, 1000
    //     18 01        mode: field 3, VARINT, 1
    //     3a 02 68 69  content: field 7, LEN, length 2, "hi"
    const wire = new Uint8Array([
      0x0a, 0x09, 0x10, 0xe8, 0x07, 0x18, 0x01, 0x3a, 0x02, 0x68, 0x69,
    ])
    const registry = new ProtoRegistry({ dm: dmSegDescriptor })
    const decoded = registry.decode('dm', 'dm.v1.Segment', wire)
    expect(decoded).toEqual({
      elems: [
        {
          progress: '1000',
          mode: 1,
          color: 0,
          content: 'hi',
          mid_hash: '',
        },
      ],
    })
  })
})

describe('format: proto', () => {
  it('decodes a Bilibili-style danmaku segment via manifest-carried descriptor', async () => {
    const manifest = zManifest.parse({
      apiVersion: 1,
      identityFields: [],
      id: 'bilibili-proto-test',
      name: 'Bilibili proto test',
      version: '0.1.0',
      hosts: ['api.bilibili.com'],
      protoDescriptors: {
        dm: dmSegDescriptor,
      },
      danmaku: {
        inputs: ['cid'],
        steps: [
          {
            type: 'http',
            id: 'seg',
            request: {
              method: 'GET',
              url: "'https://api.bilibili.com/x/v2/dm/web/seg.so?oid=' & $string(cid)",
              format: 'proto',
              protoSchema: 'dm',
              protoMessage: 'dm.v1.Segment',
            },
          },
        ],
        output:
          "[seg.elems.{ 'time': $number(progress) / 1000.0, 'mode': mode, 'color': color, 'text': content, 'userHash': mid_hash }]",
      },
    })

    const payload = encodeSegment([
      {
        progress: 1000,
        mode: 1,
        color: 16777215,
        content: 'hello',
        midHash: 'abc123',
      },
      { progress: 5500, mode: 4, color: 255, content: '世界' },
    ])

    const { fetcher } = mockFetcher({
      'https://api.bilibili.com/x/v2/dm/web/seg.so': { body: payload },
    })
    const runner = new ManifestRunner(manifest, { fetcher })
    const result = await runner.runDanmaku({ cid: 12345 })

    expect(result).toEqual([
      {
        time: 1.0,
        mode: 1,
        color: 16777215,
        text: 'hello',
        userHash: 'abc123',
      },
      {
        time: 5.5,
        mode: 4,
        color: 255,
        text: '世界',
        userHash: '',
      },
    ])
  })

  it('errors when protoSchema is unknown', async () => {
    const manifest = zManifest.parse({
      apiVersion: 1,
      identityFields: [],
      id: 'bad-proto',
      name: 'bad',
      version: '0.1.0',
      hosts: ['api.example.com'],
      protoDescriptors: { knownOne: dmSegDescriptor },
      danmaku: {
        inputs: ['x'],
        steps: [
          {
            type: 'http',
            id: 'r',
            request: {
              method: 'GET',
              url: "'https://api.example.com/x'",
              format: 'proto',
              protoSchema: 'missing',
              protoMessage: 'dm.v1.Segment',
            },
          },
        ],
        output: 'r',
      },
    })
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: new Uint8Array(0) },
    })
    const runner = new ManifestRunner(manifest, { fetcher })
    await expect(runner.runDanmaku({ x: 1 })).rejects.toThrow(
      /^unknown protoSchema "missing"$/
    )
  })

  it('errors when protoMessage path does not exist in the schema', async () => {
    const manifest = zManifest.parse({
      apiVersion: 1,
      identityFields: [],
      id: 'bad-message',
      name: 'bad',
      version: '0.1.0',
      hosts: ['api.example.com'],
      protoDescriptors: { dm: dmSegDescriptor },
      danmaku: {
        inputs: ['x'],
        steps: [
          {
            type: 'http',
            id: 'r',
            request: {
              method: 'GET',
              url: "'https://api.example.com/x'",
              format: 'proto',
              protoSchema: 'dm',
              protoMessage: 'dm.v1.NotARealMessage',
            },
          },
        ],
        output: 'r',
      },
    })
    const { fetcher } = mockFetcher({
      'https://api.example.com/x': { body: new Uint8Array(0) },
    })
    const runner = new ManifestRunner(manifest, { fetcher })
    await expect(runner.runDanmaku({ x: 1 })).rejects.toThrow(
      /^unknown proto message "dm.v1.NotARealMessage" in protoSchema "dm"$/
    )
  })
})
