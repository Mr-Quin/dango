import {
  type DescMessage,
  createFileRegistry,
  type FileRegistry,
  fromBinary,
  toJson,
} from '@bufbuild/protobuf'
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt'
import { base64Decode } from '@bufbuild/protobuf/wire'

/**
 * Lazy registry over the base64 `FileDescriptorSet`s a manifest carries
 * under `protoDescriptors`. Each entry is decoded into a `FileRegistry` on
 * first use and reused after. Decoding a message resolves its fully
 * qualified name against that registry and reads the wire bytes
 * reflectively, so no codegen or `eval` is involved.
 */
export class ProtoRegistry {
  private readonly compiled = new Map<string, FileRegistry>()
  private readonly descriptors: Record<string, string>

  constructor(descriptors: Record<string, string>) {
    this.descriptors = descriptors
  }

  private getFileRegistry(schemaName: string): FileRegistry {
    const cached = this.compiled.get(schemaName)
    if (cached !== undefined) {
      return cached
    }
    const base64 = this.descriptors[schemaName]
    if (base64 === undefined) {
      throw new Error(`unknown protoSchema "${schemaName}"`)
    }
    const set = fromBinary(FileDescriptorSetSchema, base64Decode(base64))
    const registry = createFileRegistry(set)
    this.compiled.set(schemaName, registry)
    return registry
  }

  private lookupType(schemaName: string, messageName: string): DescMessage {
    const registry = this.getFileRegistry(schemaName)
    const message = registry.getMessage(messageName)
    if (message === undefined) {
      throw new Error(
        `unknown proto message "${messageName}" in protoSchema "${schemaName}"`
      )
    }
    return message
  }

  /**
   * Decode bytes to a JSONata-friendly plain object. `alwaysEmitImplicit`
   * surfaces absent fields as type defaults (predictable predicates);
   * proto field names are kept verbatim (snake_case) and int64 values are
   * rendered as decimal strings so JS numbers never lose precision.
   */
  decode(
    schemaName: string,
    messageName: string,
    bytes: Uint8Array
  ): Record<string, unknown> {
    const type = this.lookupType(schemaName, messageName)
    const message = fromBinary(type, bytes)
    const json = toJson(type, message, {
      alwaysEmitImplicit: true,
      enumAsInteger: false,
      useProtoFieldName: true,
    })
    return json as Record<string, unknown>
  }
}
