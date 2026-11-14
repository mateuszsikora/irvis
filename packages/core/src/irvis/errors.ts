/** A .irvis file that cannot be read, or a call the format does not allow. */
export class IrvisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrvisError';
  }
}
