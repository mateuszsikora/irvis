// The only runtime APIs core may use besides ECMAScript itself: they exist in
// browsers, Workers, Electron and Node alike. tsconfig.lib.json compiles core
// with lib ES2022 and no @types, so everything else fails to compile.
// Adding an API here is a decision:
// docs/decisions/architecture.md#core-uses-only-apis-that-browsers-and-node-share

interface TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array<ArrayBuffer>;
}

declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

interface TextDecodeOptions {
  stream?: boolean;
}

interface TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBufferView | ArrayBuffer, options?: TextDecodeOptions): string;
}

declare var TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};

interface Console {
  debug(...data: unknown[]): void;
  error(...data: unknown[]): void;
  info(...data: unknown[]): void;
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
}

declare var console: Console;
