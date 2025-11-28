import { once } from 'node:events';
import {
  readFile,
  writeFile,
  readdir,
  lstat,
  readlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  buildStream,
  createTempTestDir,
  sleep,
  waitForFile,
  waitForRotationComplete,
} from './utils.ts';
import { removeOldFiles } from '../src/lib/utils.ts';

let logFolder: string;

beforeEach(() => {
  logFolder = createTempTestDir();
});

it(
  'rotate file based on time',
  { skip: true },
  async () => {
    const file = join(logFolder, 'log');
    const frequency = 200;

    const stream = await buildStream({ frequency, file });

    // Write first batch of messages
    stream.write('logged message #1\n');
    stream.write('logged message #2\n');
    await sleep(10)

    // Wait for the first file to be created and contain our messages
    // Use retry logic for macOS/Windows timing issues
    let foundMessage1 = false;
    const maxAttempts = process.platform === 'win32' ? 20 : 10;
    const retryDelay = process.platform === 'win32' ? 750 : 300;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (foundMessage1) break;

      if (attempt > 0) {
        await sleep(retryDelay); // Wait between attempts
      }

      try {
        await waitForFile(`${file}.1.log`);
        const content = await readFile(`${file}.1.log`, 'utf-8');
        if (content.includes('logged message #1')) {
          foundMessage1 = true;
        }
      } catch (err) {
        // File not ready yet, continue
      }
    }

    assert.ok(foundMessage1, 'First file should contain the first message');

    // Wait for rotation to create second file
    // Add extra time to ensure rotation completes
    await sleep(frequency + 100);

    stream.write('logged message #3\n');
    stream.write('logged message #4\n');
    await sleep(10)

    // Wait for second file
    await waitForRotationComplete(file, 2, 'logged message #3', {
      timeout: 4000,
    });

    const content1 = await readFile(`${file}.1.log`, 'utf-8');
    const content2 = await readFile(`${file}.2.log`, 'utf-8');

    assert.ok(
      content1.includes('logged message #1'),
      'file 1 contains message 1'
    );
    assert.ok(
      content1.includes('logged message #2'),
      'file 1 contains message 2'
    );
    assert.ok(
      content2.includes('logged message #3'),
      'file 2 contains message 3'
    );
    assert.ok(
      content2.includes('logged message #4'),
      'file 2 contains message 4'
    );

    stream.end();
    await once(stream, 'close');
  }
);

it('rotate file based on size', async () => {
  const file = join(logFolder, 'log');
  const stream = await buildStream({ size: '30b', file });

  stream.write('logged message #1\n');
  stream.write('logged message #2\n');

  await waitForFile(`${file}.1.log`);

  stream.write('logged message #3\n');
  stream.write('logged message #4\n');

  await waitForRotationComplete(file, 2, 'logged message #3');

  const content1 = await readFile(`${file}.1.log`, 'utf-8');
  const content2 = await readFile(`${file}.2.log`, 'utf-8');

  assert.ok(content1.includes('logged message #1'));
  assert.ok(content1.includes('logged message #2'));
  assert.ok(content2.includes('logged message #3'));
  assert.ok(content2.includes('logged message #4'));

  stream.end();
  await once(stream, 'close');
});

it(
  'rotate file based on both time and size',
  {
    skip: true
  },
  async () => {
    const file = join(logFolder, 'log')
    const frequency = 1000
    const stream = await buildStream({ size: '30b', frequency, file })

    stream.write('logged message #1\n')
    await sleep(10)

    await waitForFile(`${file}.1.log`)

    stream.write('logged message #2\n')
    await sleep(10)
    await sleep(frequency + 100)

    await waitForRotationComplete(file, 2, 'logged message #2', {
      timeout: 7000
    })

    const content1 = await readFile(`${file}.1.log`, 'utf-8')
    const content2 = await readFile(`${file}.2.log`, 'utf-8')

    assert.ok(content1.includes('logged message #1'))
    assert.ok(content2.includes('logged message #2'))

    stream.end()
    await once(stream, 'close')
  }
)

it('limit file count', async () => {
  const file = join(logFolder, 'log');
  const stream = await buildStream({
    size: '10b',
    file,
    limit: { count: 1 },
  });

  stream.write('message 1\n');
  await waitForFile(`${file}.1.log`);

  stream.write('message 2\n');
  await waitForFile(`${file}.2.log`);

  stream.write('message 3\n');
  await waitForFile(`${file}.3.log`);

  // file.1.log and file.2.log should be deleted by limit (count: 1 keeps only 1 old file + active)
  await sleep(100)

  const files = await readdir(logFolder)
  assert.ok(!files.includes('log.1.log'), 'log.1.log should be deleted')
  assert.ok(!files.includes('log.2.log'), 'log.2.log should be deleted')
  assert.ok(files.includes('log.3.log'), 'log.3.log should exist')

  stream.end()
  await once(stream, 'close')
})

it('creates symlink to current file', async () => {
  const file = join(logFolder, 'log');
  const stream = await buildStream({
    size: '30b',
    file,
    symlink: true,
  });

  stream.write('message 1\n');
  await waitForFile(`${file}.1.log`);

  const symlinkPath = join(logFolder, 'current.log');
  const stats = await lstat(symlinkPath);
  assert.ok(stats.isSymbolicLink(), 'symlink should exist');

  const target = await readlink(symlinkPath);
  assert.strictEqual(target, 'log.1.log', 'symlink should point to log.1.log');

  stream.write('message 2\n');
  stream.write('message 3\n');
  await waitForFile(`${file}.2.log`);

  const newTarget = await readlink(symlinkPath);
  assert.strictEqual(
    newTarget,
    'log.2.log',
    'symlink should update to log.2.log'
  );

  stream.end();
  await once(stream, 'close');
});

it('handles async removeOldFiles correctly', async () => {
  const baseFile = join(logFolder, 'log');

  // Create some test files
  await writeFile(`${baseFile}.1.log`, 'test1');
  await writeFile(`${baseFile}.2.log`, 'test2');
  await writeFile(`${baseFile}.3.log`, 'test3');

  await removeOldFiles({
    count: 1,
    baseFile,
    createdFileNames: [
      `${baseFile}.1.log`,
      `${baseFile}.2.log`,
      `${baseFile}.3.log`,
    ],
    newFileName: `${baseFile}.4.log`,
  });

  await sleep(100);

  const files = await readdir(logFolder);
  assert.ok(!files.includes('log.1.log'), 'log.1.log should be deleted');
  assert.ok(!files.includes('log.2.log'), 'log.2.log should be deleted');
  assert.ok(files.includes('log.3.log'), 'log.3.log should exist');
});
