import { it, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, webkit, _electron as electron } from 'playwright';
import { scenario, exactJson } from './scenario.mjs';

it('preserves exact recorded readings and viewer wiring across runtimes', async () => {
  const bytes = Array.from(await readFile('fixtures/infiray-p2pro/static-wall/lossless-v1.irvis'));
  const { results: expected } = await scenario(bytes);
  expect(expected.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 9]);
  expect(exactJson(-0)).not.toBe(exactJson(0));
  expect(exactJson(NaN)).not.toBe(exactJson(null));
  await mkdir('.context/parity', { recursive: true });
  await writeFile('.context/parity/node.json', JSON.stringify(expected));
  const server = await createServer({
    configFile: false,
    esbuild: { jsx: 'automatic' },
    root: resolve('.'),
    server: { port: 0 },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  try {
    for (const name of ['chromium', 'webkit', 'electron']) {
      const runtime =
        name === 'electron'
          ? await electron.launch({
              args: [resolve('packages/ui/test/parity/electron.mjs')],
              env: { ...process.env, IRVIS_PARITY_URL: url },
            })
          : await { chromium, webkit }[name].launch();
      try {
        const page = name === 'electron' ? await runtime.firstWindow() : await runtime.newPage();
        await page.goto(url);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addScriptTag({
          type: 'module',
          content: `
          import { scenario } from '/packages/ui/test/parity/scenario.mjs';
          import { mount } from '/packages/ui/test/parity/mount.mjs';
          globalThis.runParity = scenario;
          globalThis.mountParity = mount;
        `,
        });
        await page.waitForFunction(() => !!globalThis.mountParity);
        const actual = await page.evaluate(async (bytes) => {
          const { results, frames } = await globalThis.runParity(bytes);
          globalThis.parityFrames = frames;
          return results;
        }, bytes);
        await writeFile(`.context/parity/${name}.json`, JSON.stringify(actual));
        expect(actual, name).toEqual(expected);
        for (let index = 0; index < 10; index++) {
          await page.evaluate(async (index) => {
            globalThis.mountParity(globalThis.parityFrames[index]);
          }, index);
          await page.getByRole('button', { name: 'Start', exact: true }).click();
          for (const key of ['min', 'max', 'centre'])
            await page.getByRole('button', { name: `Track ${key}`, exact: true }).click();
          for (const unit of ['C', 'F', 'K']) {
            await page.getByRole('combobox', { name: /^Temperature unit/ }).selectOption(unit);
            await expect
              .poll(() => page.getByLabel('Measurement readings').textContent())
              .toBe(expected[index].ui[unit]);
          }
          await page.getByRole('button', { name: 'Stop', exact: true }).click();
        }
        expect(errors, name).toEqual([]);
      } finally {
        await runtime.close();
      }
    }
  } finally {
    await server.close();
  }
});
