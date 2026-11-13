import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The direction of dependencies between packages:
// docs/decisions/architecture.md#interfaces-live-in-core-as-types-and-apps-inject-the-backends
const ROOT = resolve(import.meta.dirname, '../../..');
const FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** Workspace directory -> the irvis packages it may depend on. */
const ALLOWED_IRVIS: Record<string, readonly string[]> = {
  'packages/core': [],
  'packages/media': ['@irvis/core'],
  'packages/ui': ['@irvis/core', '@irvis/media'],
  'packages/backend-browser': ['@irvis/core'],
  'packages/backend-electron': ['@irvis/core'],
  'packages/backend-replay': ['@irvis/core'],
  'apps/web': [
    '@irvis/core',
    '@irvis/media',
    '@irvis/ui',
    '@irvis/backend-browser',
    '@irvis/backend-electron',
    '@irvis/backend-replay',
  ],
  'apps/desktop': ['@irvis/core'],
  'tools/capture-cli': ['@irvis/core'],
  'tools/docs-check': [],
};

/** The only packages from outside irvis that core may depend on. */
const CORE_EXTERNAL = ['fflate'];

interface Manifest {
  name?: string;
  [field: string]: unknown;
}

function workspaces(): { dir: string; manifest: Manifest }[] {
  const out = [];
  for (const parent of ['packages', 'apps', 'tools']) {
    if (!existsSync(join(ROOT, parent))) continue;
    for (const name of readdirSync(join(ROOT, parent)).sort()) {
      const file = join(ROOT, parent, name, 'package.json');
      if (existsSync(file)) {
        out.push({
          dir: `${parent}/${name}`,
          manifest: JSON.parse(readFileSync(file, 'utf8')) as Manifest,
        });
      }
    }
  }
  return out;
}

function dependencyNames(manifest: Manifest): string[] {
  return FIELDS.flatMap((field) => Object.keys((manifest[field] ?? {}) as Record<string, string>));
}

describe('package dependencies', () => {
  const all = workspaces();

  it('finds the workspaces', () => {
    expect(all.map((w) => w.dir)).toContain('packages/core');
  });

  it('lists every workspace in the dependency table', () => {
    const unknown = all.map((w) => w.dir).filter((dir) => !(dir in ALLOWED_IRVIS));
    expect(
      unknown,
      'add the new workspace to ALLOWED_IRVIS with the packages it may import',
    ).toEqual([]);
  });

  it('point only from apps towards core', () => {
    for (const { dir, manifest } of all) {
      const allowed = ALLOWED_IRVIS[dir] ?? [];
      const irvis = dependencyNames(manifest).filter((n) => n.startsWith('@irvis/'));
      expect(
        irvis.filter((n) => !allowed.includes(n)),
        `${dir} depends on`,
      ).toEqual([]);
    }
  });

  it('keep core free of packages other than fflate', () => {
    const core = all.find((w) => w.dir === 'packages/core');
    const external = dependencyNames(core?.manifest ?? {}).filter((n) => !n.startsWith('@irvis/'));
    expect(external.filter((n) => !CORE_EXTERNAL.includes(n))).toEqual([]);
  });

  it('keep electron in apps/desktop', () => {
    for (const { dir, manifest } of all) {
      if (dir === 'apps/desktop') continue;
      expect(dependencyNames(manifest), dir).not.toContain('electron');
    }
  });
});
