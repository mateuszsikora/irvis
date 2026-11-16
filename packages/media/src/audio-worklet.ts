export {};
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class Capture extends AudioWorkletProcessor {
  private samples = new Float32Array(2048);
  private used = 0;
  private start = 0;
  private outstanding = 0;
  private stopped = false;
  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<string>) => {
      if (data === 'ack') this.outstanding--;
      if (data === 'stop') {
        this.send();
        this.stopped = true;
        this.port.postMessage({ stopped: true });
      }
    };
  }
  private send() {
    if (!this.used || this.stopped) return;
    if (this.outstanding >= 2) {
      this.stopped = true;
      this.port.postMessage({ error: 'Audio storage is too slow; recording stopped.' });
      return;
    }
    const samples = this.samples.slice(0, this.used);
    this.port.postMessage({ frame: this.start, samples }, [samples.buffer]);
    this.outstanding++;
    this.used = 0;
  }
  process(inputs: Float32Array[][]) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (input)
      for (let i = 0; i < input.length; i++) {
        if (!this.used) this.start = currentFrame + i;
        this.samples[this.used++] = input[i]!;
        if (this.used === this.samples.length) this.send();
      }
    return !this.stopped;
  }
}
registerProcessor('irvis-microphone', Capture);
