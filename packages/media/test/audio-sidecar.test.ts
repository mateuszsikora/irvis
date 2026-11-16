import { describe, expect, it } from 'vitest';
import { alignAudio, audioHeader, audioPacket } from '../src/audio-sidecar.ts';
function concat(...chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
describe('audio sidecar', () => {
  it('aligns samples to the thermal clock, trimming pre-roll and padding gaps and the end', () => {
    const bytes = concat(
      audioHeader(48000),
      audioPacket(950, new Float32Array(4096).fill(0.25)),
      audioPacket(1100, new Float32Array(2400).fill(0.75)),
    );
    const { samples, sampleRate } = alignAudio(bytes, 1000, 200);
    expect(sampleRate).toBe(48000);
    expect(samples.length).toBe(9600);
    expect(samples[0]).toBe(0.25);
    expect(samples[1695]).toBe(0.25);
    expect(samples[1696]).toBe(0);
    expect(samples[4799]).toBe(0);
    expect(samples[4800]).toBe(0.75);
    expect(samples[7199]).toBe(0.75);
    expect(samples[7200]).toBe(0);
  });
  it('recovers all complete packets at every torn-write boundary and rejects corrupt tails', () => {
    const head = concat(audioHeader(44100), audioPacket(0, new Float32Array(441).fill(0.5)));
    const tail = audioPacket(10, new Float32Array(441).fill(0.75));
    for (let length = 0; length < tail.length; length++) {
      const { samples } = alignAudio(concat(head, tail.subarray(0, length)), 0, 20);
      expect(samples[440]).toBe(0.5);
      expect(samples[441]).toBe(0);
    }
    tail[30] = tail[30]! ^ 1;
    expect(alignAudio(concat(head, tail), 0, 20).samples[441]).toBe(0);
  });
});
