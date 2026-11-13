import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slugify } from '../src/markdown.ts';

// Every heading in the repository's Markdown files when the check was ported
// to TypeScript, plus headings with non-ASCII text and punctuation, each with
// the anchor the earlier implementation of the check computed for it.
const CORPUS = JSON.parse(readFileSync(join(import.meta.dirname, 'github-slugs.json'), 'utf8')) as [
  string,
  string,
][];

describe('GitHub slugs', () => {
  it('match the corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(150);
    const got = CORPUS.map(([text]) => [text, slugify(text)]);
    expect(got).toEqual(CORPUS);
  });
});
