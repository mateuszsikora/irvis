/** Keep browser exception names and failed constraints, but omit the generic Error prefix. */
export function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  if (!('message' in error)) return 'Unknown error.';
  const message = String(error.message);
  const name = 'name' in error ? String(error.name) : 'Error';
  if (name === 'OverconstrainedError') {
    const constraint = 'constraint' in error ? String(error.constraint) : 'unknown';
    return `${name} (constraint: ${constraint})${message ? `: ${message}` : ''}`;
  }
  return name === 'Error' ? message : `${name}: ${message}`;
}
