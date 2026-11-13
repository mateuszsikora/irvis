/**
 * Where a recording is written: an OPFS file in the browser, a file written
 * by the Electron main process over IPC, or memory in tests. Every method
 * returns a promise because File and IPC are asynchronous.
 */
export interface ByteSink {
  /**
   * Appends bytes at the end. The sink may keep the chunk until the promise
   * settles, so the caller must not modify it before then. A sink with a
   * bounded queue resolves late instead of buffering without limit.
   */
  append(chunk: Uint8Array): Promise<void>;
  /** Resolves when every appended byte is on durable storage. */
  flush(): Promise<void>;
  /** Flushes and releases the sink. append and flush reject afterwards. */
  close(): Promise<void>;
}

/** Random-access reads from a recording: an OPFS or picked File, an IPC file, or memory. */
export interface ByteSource {
  /** The current length in bytes. */
  size(): Promise<number>;
  /**
   * Reads up to `length` bytes starting at `offset`. Returns fewer bytes only
   * at the end of the source, and an empty array at or past the end.
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}
