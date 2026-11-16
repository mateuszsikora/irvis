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
  } catch (error) {
    await sink.close().catch(() => {});
    throw error;
  }
  let pending: Promise<unknown> | null = null;
  let stopped = false;
  let failure: unknown;
  let finishing: Promise<void> | undefined;
  function run(operation: () => Promise<unknown>) {
    pending = operation()
      .catch((error: unknown) => {
        failure = error;
        stopped = true;
        onError(error);
      })
      .finally(() => {
        pending = null;
      });
  }
  const timer = setInterval(() => {
    if (!pending && !stopped) run(() => writer.flush());
  }, 1000);
  return {
    append(frame, view) {
      if (pending || stopped) return false;
      const copy = structuredClone(frame);
      const values = view ? structuredClone(view) : undefined;
      run(async () => {
        if (values) await writer.appendViewState(copy.timestamp, values);
        await writer.appendFrame(copy);
      });
      return true;
    },
    stop() {
      finishing ??= (async () => {
        stopped = true;
        clearInterval(timer);
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
