// Re-encodes a .irvis file to a larger threshold. The stored values are
// within T1 of the measured ones; encoding them again with the tolerance
// T2 − T1 keeps every value within T2. Specification:
// docs/irvis-format.md#re-encoding
import type { ByteSink, ByteSource } from '../bytes.ts';
import { IrvisError } from './errors.ts';
import { IrvisReader } from './reader.ts';
import { IrvisWriter } from './writer.ts';

/** What reencodeIrvis wrote. */
export interface ReencodeResult {
  /** Frames copied. */
  readonly frames: number;
  /** Frames left out because their chunk is damaged before them. */
  readonly skipped: number;
  /** Bytes of the new file. */
  readonly bytes: number;
  /**
   * The first damage found: IrvisReader.damage, or the first frame that
   * failed to decode; null when every frame was copied.
   */
  readonly damage: IrvisReader['damage'];
}

/**
 * Writes the frames, chunks, frame fields, masks and view-state changes of
 * `source` to `sink` with the threshold `threshold` (raw units), which may
 * not be smaller than the source's. The header records the source's
 * threshold in `thresholdHistory`. A source cut short or without its index
 * is copied up to its last valid record. With an intact index, a frame that
 * does not decode costs the rest of its chunk, and copying goes on at the
 * next keyframe. The copy is a complete file either way.
 */
export async function reencodeIrvis(
  source: ByteSource,
  sink: ByteSink,
  threshold: number,
): Promise<ReencodeResult> {
  const reader = await IrvisReader.open(source);
  const { header } = reader;
  if (!Number.isInteger(threshold) || threshold < header.threshold) {
    throw new IrvisError(
      `cannot re-encode to threshold ${String(threshold)}: it must be an integer of at least the file's ${String(header.threshold)}`,
    );
  }
  const writer = await IrvisWriter.create(sink, {
    profile: header.profile,
    width: header.width,
    height: header.height,
    fps: header.fps,
    path: header.path,
    threshold,
    thresholdHistory: [...header.thresholdHistory, header.threshold],
    tolerance: threshold - header.threshold,
    frameFields: header.frameFields,
    viewState: header.viewState,
    keyframeIntervalMs: Number.POSITIVE_INFINITY,
    detectNuc: false,
  });
  let view = 0;
  const views = reader.viewStates;
  let copied = 0;
  let skipped = 0;
  let damage = reader.damage;
  for (let i = 0; i < reader.frameCount; i++) {
    let frame;
    try {
      frame = await reader.readFrame(i);
    } catch (error) {
      // A damaged record although the index is intact: the frames after it
      // in its chunk depend on it, but the next chunk starts over.
      if (!(error instanceof IrvisError)) throw error;
      damage ??= { offset: reader.frames[i]?.offset ?? 0, reason: error.message };
      const chunk = reader.frames[i]?.chunk;
      let next = i + 1;
      while (next < reader.frameCount && reader.frames[next]?.chunk === chunk) next++;
      skipped += next - i;
      i = next - 1;
      continue;
    }
    while (view < views.length && (views[view]?.timestamp ?? 0) <= frame.frame.timestamp) {
      const change = views[view++];
      if (change) await writer.appendViewState(change.timestamp, change.values);
    }
    await writer.appendFrame(frame.frame, {
      fields: frame.fields,
      ...(frame.keyframe ? { chunk: frame.chunk.reason } : {}),
    });
    copied++;
  }
  for (; view < views.length; view++) {
    const change = views[view];
    if (change) await writer.appendViewState(change.timestamp, change.values);
  }
  await writer.close();
  return { frames: copied, skipped, bytes: writer.size, damage };
}
