import {
  IrvisWriter,
  type ByteSink,
  type IrvisWriterOptions,
  type ThermalFrame,
  type ViewStateValues,
} from '@irvis/core';
export interface Recorder {
  /** False means the frame was dropped because storage is busy. No queue is allocated. */
  append(frame: ThermalFrame, view?: ViewStateValues): boolean;
  stop(): Promise<void>;
}
export async function createRecorder(
  sink: ByteSink,
  options: IrvisWriterOptions,
  onError: (error: unknown) => void,
): Promise<Recorder> {
  let writer: IrvisWriter;
  try {
    writer = await IrvisWriter.create(sink, options);
    await writer.flush();
  } catch (error) {
    await sink.close().catch(() => {});
    throw error;
  }
  let pending: Promise<unknown> | null = null;
  let stopped = false;
  let failure: unknown;
  let finishing: Promise<void> | undefined;
  function fail(error: unknown) {
    if (failure) return;
    failure = error;
    stopped = true;
    onError(error);
  }
  function run(operation: () => Promise<unknown>) {
    const deadline = setTimeout(
      () => fail(new Error('Recording storage is too slow; recording stopped.')),
      1000,
    );
    pending = operation()
      .catch(fail)
      .finally(() => {
        clearTimeout(deadline);
        pending = null;
      });
  }
  return {
    append(frame, view) {
      if (pending || stopped) return false;
      const copy = structuredClone(frame);
      const values = view ? structuredClone(view) : undefined;
      run(async () => {
        if (values) await writer.appendViewState(copy.timestamp, values);
        await writer.appendFrame(copy);
        await writer.flush();
      });
      return true;
    },
    stop() {
      finishing ??= (async () => {
        stopped = true;
        await pending;
        try {
          if (failure)
            throw failure instanceof Error ? failure : new Error('Recording storage failed.');
          await writer.close();
        } finally {
          await sink.close();
        }
      })();
      return finishing;
    },
  };
}
