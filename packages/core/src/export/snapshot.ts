import type { ThermalFrame } from '../frames.ts';
import { MemoryByteSink } from '../memory.ts';
import type { AppendFrameOptions, IrvisWriterOptions } from '../irvis/writer.ts';
import { IrvisWriter } from '../irvis/writer.ts';

export type SnapshotOptions = Omit<IrvisWriterOptions, 'width' | 'height' | 'threshold'> & {
  /** Raw-unit error bound; defaults to 0 (lossless). */
  readonly threshold?: number;
  readonly fields?: AppendFrameOptions['fields'];
};

/** A complete one-frame .irvis, including its index and trailer. */
export async function exportSnapshot(
  frame: ThermalFrame,
  options: SnapshotOptions,
): Promise<Uint8Array> {
  // Capture arrays before the first await: live sources may reuse their buffers.
  const captured = {
    ...frame,
    raw: frame.raw.slice(),
    uncertain: frame.uncertain?.slice() ?? null,
    conversion:
      frame.conversion.kind === 'lut'
        ? { ...frame.conversion, celsius: [...frame.conversion.celsius] }
        : frame.conversion.kind === 'polynomial'
          ? { ...frame.conversion, coefficients: [...frame.conversion.coefficients] }
          : { ...frame.conversion },
    cameraState: { ...frame.cameraState, values: { ...frame.cameraState.values } },
  };
  const fields = { ...options.fields };
  const sink = new MemoryByteSink();
  const writer = await IrvisWriter.create(sink, {
    ...options,
    width: frame.width,
    height: frame.height,
    threshold: options.threshold ?? 0,
  });
  await writer.appendFrame(captured, { fields });
  await writer.close();
  return sink.bytes();
}
