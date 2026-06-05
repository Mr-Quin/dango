/**
 * Build a base64-encoded `google.protobuf.FileDescriptorSet` from a
 * structured schema definition, suitable for a manifest's `protoDescriptors`
 * map. The descriptor is assembled directly with `@bufbuild/protobuf`'s
 * well-known descriptor types, so no `.proto` toolchain or third-party proto
 * runtime is required at build time.
 *
 * Usage: `bun run scripts/gen-proto-descriptors.ts` prints the base64 for
 * each schema in `SCHEMAS`. Edit `SCHEMAS` to add or change sources; each
 * entry lists its messages and their fields. The result decodes cleanly
 * under the engine's `createFileRegistry`.
 */
import { create, toBinary } from '@bufbuild/protobuf'
import { base64Encode } from '@bufbuild/protobuf/wire'
import {
  type DescriptorProto,
  DescriptorProtoSchema,
  type FieldDescriptorProto,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldDescriptorProtoSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
} from '@bufbuild/protobuf/wkt'

const SCALAR_TYPES = {
  double: FieldDescriptorProto_Type.DOUBLE,
  float: FieldDescriptorProto_Type.FLOAT,
  int64: FieldDescriptorProto_Type.INT64,
  uint64: FieldDescriptorProto_Type.UINT64,
  int32: FieldDescriptorProto_Type.INT32,
  fixed64: FieldDescriptorProto_Type.FIXED64,
  fixed32: FieldDescriptorProto_Type.FIXED32,
  bool: FieldDescriptorProto_Type.BOOL,
  string: FieldDescriptorProto_Type.STRING,
  bytes: FieldDescriptorProto_Type.BYTES,
  uint32: FieldDescriptorProto_Type.UINT32,
  sfixed32: FieldDescriptorProto_Type.SFIXED32,
  sfixed64: FieldDescriptorProto_Type.SFIXED64,
  sint32: FieldDescriptorProto_Type.SINT32,
  sint64: FieldDescriptorProto_Type.SINT64,
} as const

type ScalarType = keyof typeof SCALAR_TYPES

interface FieldDef {
  name: string
  number: number
  repeated?: boolean
  /** A scalar type name, or a fully-qualified message type like `.dm.v1.Item`. */
  type: ScalarType | `.${string}`
}

interface MessageDef {
  name: string
  fields: FieldDef[]
}

interface SchemaDef {
  package: string
  messages: MessageDef[]
}

function buildField(field: FieldDef): FieldDescriptorProto {
  const label = field.repeated
    ? FieldDescriptorProto_Label.REPEATED
    : FieldDescriptorProto_Label.OPTIONAL

  if (field.type.startsWith('.')) {
    return create(FieldDescriptorProtoSchema, {
      name: field.name,
      number: field.number,
      label,
      type: FieldDescriptorProto_Type.MESSAGE,
      typeName: field.type,
    })
  }

  return create(FieldDescriptorProtoSchema, {
    name: field.name,
    number: field.number,
    label,
    type: SCALAR_TYPES[field.type as ScalarType],
  })
}

function buildMessage(message: MessageDef): DescriptorProto {
  return create(DescriptorProtoSchema, {
    name: message.name,
    field: message.fields.map(buildField),
  })
}

function compile(schema: SchemaDef): string {
  const file = create(FileDescriptorProtoSchema, {
    name: `${schema.package.replace(/\./g, '_') || 'schema'}.proto`,
    package: schema.package,
    syntax: 'proto3',
    messageType: schema.messages.map(buildMessage),
  })
  const set = create(FileDescriptorSetSchema, { file: [file] })
  return base64Encode(toBinary(FileDescriptorSetSchema, set))
}

const SCHEMAS: Record<string, SchemaDef> = {
  bili: {
    package: 'dm.v1',
    messages: [
      {
        name: 'DanmakuElem',
        fields: [
          { name: 'id', number: 1, type: 'int64' },
          { name: 'progress', number: 2, type: 'int32' },
          { name: 'mode', number: 3, type: 'int32' },
          { name: 'fontsize', number: 4, type: 'int32' },
          { name: 'color', number: 5, type: 'uint32' },
          { name: 'midHash', number: 6, type: 'string' },
          { name: 'content', number: 7, type: 'string' },
          { name: 'ctime', number: 8, type: 'int64' },
          { name: 'weight', number: 9, type: 'int32' },
          { name: 'action', number: 10, type: 'string' },
          { name: 'pool', number: 11, type: 'int32' },
          { name: 'idStr', number: 12, type: 'string' },
        ],
      },
      {
        name: 'DmSegMobileReply',
        fields: [
          {
            name: 'elems',
            number: 1,
            repeated: true,
            type: '.dm.v1.DanmakuElem',
          },
        ],
      },
    ],
  },
}

for (const [name, schema] of Object.entries(SCHEMAS)) {
  console.log(`${name}:`)
  console.log(compile(schema))
  console.log()
}

export { compile }
