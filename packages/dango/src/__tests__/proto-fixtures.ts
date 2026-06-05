import {
  create,
  createFileRegistry,
  fromBinary,
  toBinary,
} from '@bufbuild/protobuf'
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt'
import { base64Decode } from '@bufbuild/protobuf/wire'

/**
 * Test-only proto encoder built entirely on `@bufbuild/protobuf`. Given a
 * base64 `FileDescriptorSet` (the same shape a manifest carries under
 * `protoDescriptors`) and a fully-qualified message name, it resolves the
 * message reflectively and encodes plain field objects to wire bytes. This
 * mirrors the engine's decode path so encode/decode stay symmetric, with no
 * codegen and no third-party proto runtime.
 */
export function encodeProtoMessage(
  descriptorBase64: string,
  messageName: string,
  value: Record<string, unknown>
): Uint8Array {
  const set = fromBinary(
    FileDescriptorSetSchema,
    base64Decode(descriptorBase64)
  )
  const registry = createFileRegistry(set)
  const type = registry.getMessage(messageName)
  if (type === undefined) {
    throw new Error(`unknown proto message "${messageName}"`)
  }
  return toBinary(type, create(type, value))
}
