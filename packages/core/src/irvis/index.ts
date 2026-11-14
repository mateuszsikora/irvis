// The .irvis recording format and codec. Specification: docs/irvis-format.md
export { IrvisError } from './errors.ts';
export { crc32 } from './crc32.ts';
export {
  BLOCK_DENSE,
  BLOCK_SIZE,
  BLOCK_SKIP,
  BLOCK_SPARSE,
  type BlockStats,
  DEFAULT_TUNING,
  type EncodedFrame,
  type EncoderTuning,
  FrameDecoder,
  FrameEncoder,
  quantiserStep,
  tuningProblems,
} from './codec.ts';
export {
  type ChunkReason,
  FRAME_FIELDS,
  type FrameFieldId,
  type FrameFields,
  IRVIS_SIGNATURE,
  IRVIS_VERSION,
  type IrvisChunk,
  type IrvisHeader,
  type IrvisProfileRef,
  type JsonValue,
  type RecordingPath,
  type ViewStateChange,
  type ViewStateValues,
} from './format.ts';
export {
  NUC_HISTORY,
  NUC_MIN_FROZEN,
  NUC_MIN_STEP_KELVIN,
  NUC_STEP_FACTOR,
  NucDetector,
  type NucEvent,
  kelvinPerRaw,
} from './nuc.ts';
export { type IrvisDamage, type IrvisFrame, type IrvisFrameInfo, IrvisReader } from './reader.ts';
export { type ReencodeResult, reencodeIrvis } from './reencode.ts';
export {
  type AppendFrameOptions,
  type AppendedFrame,
  DEFAULT_DEFLATE_LEVEL,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_KEYFRAME_INTERVAL_MS,
  IrvisWriter,
  type IrvisWriterOptions,
} from './writer.ts';
