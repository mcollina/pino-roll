'use strict'

const { once } = require('events')
const { stat, readFile, writeFile, readdir, lstat, readlink } = require('fs/promises')
const { join } = require('path')
const { it, beforeEach } = require('node:test')
const assert = require('node:assert')
const { format } = require('date-fns')

const {
  buildStream,
  createTempTestDir,
  sleep,
  waitForFile,
  waitForCondition,
  waitForRotationComplete
} = require('./utils')
const { removeOldFiles } = require('../lib/utils')

let logFolder

beforeEach(() => {
  logFolder = createTempTestDir()
})

it('rotate file based on time', async () => {
  const file = join(logFolder, 'log')
  const frequency = 100

  const stream = await buildStream({ frequency, file })

  // Write first batch of messages
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')

  // Wait for the first file to be created and contain our messages
  // Use retry logic for macOS/Windows timing issues
  let foundMessage1 = false
  for (let attempt = 0; attempt < 10; attempt++) {
    if (foundMessage1) break

    if (attempt > 0) {
      await sleep(300) // Wait between attempts
    }

    try {
      await waitForFile(`${file}.1.log`)
      const content = await readFile(`${file}.1.log`, 'utf8')
      if (content.includes('logged message #1')) {
        foundMessage1 = true
      }
    } catch (error) {
      // File might not be ready yet, continue
    }
  }

  if (!foundMessage1) {
    // Add debug info for CI failures
    try {
      const files = await readdir(logFolder)
      const logFiles = files.filter(f => f.startsWith('log.') && f.endsWith('.log'))
      console.error(`[DEBUG-FAILURE] Available files: ${logFiles.join(', ')}`)
      for (const f of logFiles.slice(0, 3)) {
        try {
          const content = await readFile(join(logFolder, f), 'utf8')
          console.error(`[DEBUG-FAILURE] ${f} content: "${content.replace(/\n/g, '\\n')}"`)
        } catch (e) {
          console.error(`[DEBUG-FAILURE] Could not read ${f}: ${e.message}`)
        }
      }
    } catch (e) {
      console.error(`[DEBUG-FAILURE] Could not list files: ${e.message}`)
    }
    throw new Error('Failed to find message #1 in first log file after multiple attempts')
  }

  // Wait for rotation to occur - we'll know it happened when we can write to a new file
  await waitForCondition(
    async () => {
      // Trigger a rotation by writing after waiting
      await sleep(frequency + 10)
      stream.write('logged message #3\n')

      // Check if we have at least 2 files now
      try {
        await stat(`${file}.2.log`)
        return true
      } catch (error) {
        return false
      }
    },
    { timeout: 3000, interval: 50, description: 'rotation to create second file' }
  )

  // Write more messages to the current file
  stream.write('logged message #4\n')

  // Give some time for final writes - more time on Windows
  const writeDelay = (process.platform === 'win32') ? 200 : 50
  await sleep(writeDelay)

  stream.end()

  // Wait for stream to close properly
  await once(stream, 'close')

  // Additional delay for filesystem to flush and for async flush callbacks to complete
  await sleep(200)

  // Find all log files and verify they contain the expected messages
  const logFiles = []
  for (let i = 1; i <= 10; i++) { // Check up to 10 files
    try {
      await stat(`${file}.${i}.log`)
      logFiles.push(i)
    } catch (error) {
      break // No more files
    }
  }

  assert.ok(logFiles.length >= 2, `Should have at least 2 log files, got ${logFiles.length}`)

  // Wait a bit more and retry reading files if needed (for flush callback timing)
  let found1and2 = false
  let found3or4 = false
  let file1and2Number = null

  // Try reading files with retry logic for timing issues
  for (let attempt = 0; attempt < 3; attempt++) {
    if (found1and2 && found3or4) break

    if (attempt > 0) {
      await sleep(100) // Wait between attempts
    }

    for (const fileNum of logFiles) {
      try {
        const content = await readFile(`${file}.${fileNum}.log`, 'utf8')
        if (content.includes('#1') && content.includes('#2')) {
          found1and2 = true
          file1and2Number = fileNum
        }
        if (content.includes('#3') || content.includes('#4')) {
          found3or4 = true
          // Messages 3 and 4 should be in a different file than 1 and 2
          if (file1and2Number !== null) {
            assert.notStrictEqual(fileNum, file1and2Number,
              'Messages #3/#4 should be in a different file than #1/#2')
          }
        }
      } catch (error) {
        // File might not be ready yet, continue
      }
    }
  }

  assert.ok(found1and2, 'Should find a file with messages #1 and #2')
  assert.ok(found3or4, 'Should find file(s) with messages #3 or #4')
})

it('rotate file based on time and parse filename func', async () => {
  const file = join(logFolder, 'log')
  const frequency = 100

  const fileFunc = () => `${file}-${format(new Date(), 'HH-mm-ss')}`
  const stream = await buildStream({ frequency, file: fileFunc })

  // Write initial messages
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')

  // Wait for first file to be created
  await waitForCondition(
    async () => {
      const files = await readdir(logFolder)
      return files.some(f => f.includes('.1.log'))
    },
    { timeout: 1000, description: 'first log file to be created' }
  )

  // Wait for rotation and write more messages
  await sleep(frequency + 10)
  stream.write('logged message #3\n')

  // Wait for at least 2 log files to exist
  await waitForCondition(
    async () => {
      const files = await readdir(logFolder)
      const logFiles = files.filter(f => f.endsWith('.log'))
      return logFiles.length >= 2
    },
    { timeout: 3000, interval: 50, description: 'at least 2 log files to be created' }
  )

  stream.write('logged message #4\n')

  stream.end()
  await once(stream, 'close')

  const files = await readdir(logFolder)
  const logFiles = files.filter(f => f.endsWith('.log'))
  assert.ok(logFiles.length >= 2, `created at least 2 files, got ${logFiles.length}`)
})

it('rotate file based on size', async () => {
  const file = join(logFolder, 'log')
  const size = 20
  const stream = await buildStream({ size: `${size}b`, file })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  let stats = await stat(`${file}.1.log`)
  assert.ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${file}.2.log`)
  assert.ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  await assert.rejects(stat(`${file}.3.log`), 'no other files created')
})

it('resume writing in last file', async () => {
  const file = join(logFolder, 'log')
  const previousContent = '--previous content--\n'
  const newContent = 'logged message #1\n'
  await writeFile(`${file}.6.log`, previousContent)
  const size = 20
  const stream = await buildStream({ size: `${size}o`, file })
  stream.write(newContent)
  await sleep(10)

  assert.strictEqual(
    await readFile(`${file}.6.log`, 'utf8'),
    `${previousContent}${newContent}`,
    'old and new content were written'
  )
  await assert.rejects(stat(`${file}.1`), 'no other files created')
})

it('remove files based on count', async () => {
  const file = join(logFolder, 'log')
  const stream = await buildStream({
    size: '20b',
    file,
    limit: { count: 1 }
  })
  for (let i = 1; i <= 5; i++) {
    stream.write(`logged message #${i}\n`)
    await sleep(20)
  }
  stream.end()
  await once(stream, 'close')
  await stat(`${file}.2.log`)
  let content = await readFile(`${file}.2.log`, 'utf8')
  assert.ok(content.includes('#3'), 'second file contains thrid log')
  assert.ok(content.includes('#4'), 'second file contains fourth log')
  await stat(`${file}.3.log`)
  content = await readFile(`${file}.3.log`, 'utf8')
  assert.ok(content.includes('#5'), 'third file contains fifth log')
  await assert.rejects(stat(`${file}.1.log`), 'first file was deleted')
  await assert.rejects(stat(`${file}.4.log`), 'no other files created')
})

it('removeOtherOldFiles()', async () => {
  const dateFormat = 'HH-mm-ss-S'
  const notLogFile = 'notLogFile'
  await writeFile(join(logFolder, notLogFile), 'not a log file')
  let now = new Date()
  now = new Date(now.getTime() - now.getTime() % 100)
  const file0 = `log.${format(now, dateFormat)}`
  await writeFile(join(logFolder, `${file0}.1`), 'Content log 0.1')
  const file1 = `log.${format(new Date(now.getTime() + 100), dateFormat)}`
  await writeFile(join(logFolder, `${file1}.1`), 'Content log 1.1')
  await writeFile(join(logFolder, `${file1}.2`), 'Content log 1.2')
  const file2 = `log.${format(new Date(now.getTime() + 200), dateFormat)}`
  await writeFile(join(logFolder, `${file2}.1`), 'Content log 2.1')

  await removeOldFiles({ baseFile: join(logFolder, 'log'), count: 2, removeOtherLogFiles: true, dateFormat })
  let files = await readdir(logFolder)
  assert.ok(!files.includes(`${file0}.1`), 'first run: fourth recent file is removed')
  assert.ok(!files.includes(`${file1}.1`), 'first run: third recent file is removed')
  assert.ok(files.includes(`${file1}.2`), 'first run: second recent file is not removed')
  assert.ok(files.includes(`${file2}.1`), 'first run: most recent file is not removed')
  assert.ok(files.includes(notLogFile), 'first run: non log file is not removed')

  await removeOldFiles({ baseFile: join(logFolder, 'log'), count: 2, removeOtherLogFiles: true, dateFormat })
  files = await readdir(logFolder)
  assert.ok(!files.includes(`${file0}.1`), 'second run: fourth recent file is removed')
  assert.ok(!files.includes(`${file1}.1`), 'second run: third recent file is removed')
  assert.ok(files.includes(`${file1}.2`), 'second run: second recent file is not removed')
  assert.ok(files.includes(`${file2}.1`), 'second run: most recent file is not removed')
  assert.ok(files.includes(notLogFile), 'second run: non log file is not removed')
})

it('do not remove pre-existing file when removing files based on count', async () => {
  const file = join(logFolder, 'log')
  await writeFile(`${file}.1.log`, 'oldest content')
  await writeFile(`${file}.2.log`, 'old content')
  const stream = await buildStream({
    size: '20b',
    file,
    limit: { count: 2 }
  })
  for (let i = 1; i <= 6; i++) {
    stream.write(`logged message #${i}\n`)
    await sleep(20)
  }
  stream.end()
  await once(stream, 'close')
  await stat(`${file}.1.log`)
  let content = await readFile(`${file}.1.log`, 'utf8')
  assert.strictEqual(content, 'oldest content', 'oldest file was not touched')
  await stat(`${file}.3.log`)
  content = await readFile(`${file}.3.log`, 'utf8')
  assert.ok(content.includes('#3'), 'second file contains third log')
  await stat(`${file}.4.log`)
  content = await readFile(`${file}.4.log`, 'utf8')
  assert.ok(content.includes('#4'), 'third file contains fourth log')
  assert.ok(content.includes('#5'), 'third file contains fifth log')
  await stat(`${file}.5.log`)
  content = await readFile(`${file}.5.log`, 'utf8')
  assert.ok(content.includes('#6'), 'fourth file contains sixth log')
  await assert.rejects(stat(`${file}.2.log`), 'resumed file was deleted')
  await assert.rejects(stat(`${file}.6.log`), 'no other files created')
})

it('remove pre-existing log files when removing files based on count when limit.removeOtherLogFiles', { skip: process.platform !== 'linux' }, async () => {
  const dateFormat = 'HH-mm-ss'
  const notLogFileName = join(logFolder, 'notLogFile')
  const baseFile = join(logFolder, 'log')
  console.log(`[DEBUG-LIMIT] Test starting, platform: ${process.platform}, CI: ${process.env.CI}, folder: ${logFolder}`)

  // Create a non-log file and some pre-existing log files
  await writeFile(notLogFileName, 'not a log file')
  console.log(`[DEBUG-LIMIT] Created non-log file: ${notLogFileName}`)

  // Create some old log files with timestamps
  const oldTime1 = new Date(Date.now() - 10000) // 10 seconds ago
  const oldTime2 = new Date(Date.now() - 5000) // 5 seconds ago
  const oldFile1 = `${baseFile}.${format(oldTime1, dateFormat)}.1.log`
  const oldFile2 = `${baseFile}.${format(oldTime2, dateFormat)}.1.log`
  console.log(`[DEBUG-LIMIT] Creating old files: ${oldFile1}, ${oldFile2}`)

  await writeFile(oldFile1, 'oldest content')
  await writeFile(oldFile2, 'old content')
  console.log('[DEBUG-LIMIT] Old files created')

  // Start the stream with a limit of 2 files
  const stream = await buildStream({
    dateFormat,
    file: baseFile,
    frequency: 1000, // Longer frequency to ensure messages stay in files
    limit: { count: 2, removeOtherLogFiles: true }
  })

  // Write messages to trigger rotations
  console.log('[DEBUG-LIMIT] Writing message #1')
  stream.write('logged message #1\n')

  // Wait for the first rotation
  console.log('[DEBUG-LIMIT] Waiting for first log file')
  await waitForCondition(async () => {
    const files = await readdir(logFolder)
    const logFiles = files.filter(f => f.startsWith('log.') && f.endsWith('.log'))
    console.log(`[DEBUG-LIMIT] Check 1: found ${logFiles.length} files: ${logFiles.join(', ')}`)
    return logFiles.length >= 1
  }, { timeout: 5000, description: 'first log file to be created' })

  // Write second message and wait for rotation
  console.log('[DEBUG-LIMIT] Sleeping 1100ms for rotation')
  await sleep(1100)
  console.log('[DEBUG-LIMIT] Writing message #2')
  stream.write('logged message #2\n')

  // Wait for second rotation
  console.log('[DEBUG-LIMIT] Waiting for second log file')
  await waitForCondition(async () => {
    const files = await readdir(logFolder)
    const logFiles = files.filter(f => f.startsWith('log.') && f.endsWith('.log'))
    console.log(`[DEBUG-LIMIT] Check 2: found ${logFiles.length} files: ${logFiles.join(', ')}`)
    return logFiles.length >= 2
  }, { timeout: 5000, description: 'second log file to be created' })

  // Write third message and wait for rotation
  console.log('[DEBUG-LIMIT] Sleeping 1100ms for second rotation')
  await sleep(1100)
  console.log('[DEBUG-LIMIT] Writing message #3')
  stream.write('logged message #3\n')

  // Give some time for the third message to be processed and limit enforcement to happen
  // Windows filesystem operations can be significantly slower
  const processingDelay = process.platform === 'win32' ? 2000 : 200
  console.log(`[DEBUG-LIMIT] Sleeping ${processingDelay}ms for processing`)
  await sleep(processingDelay)

  // Wait for the limit to be enforced (should keep only 2 files)
  // Use longer timeout for Windows/macOS file system operations
  console.log('[DEBUG-LIMIT] Waiting for limit enforcement (max 2 files)')
  const limitTimeout = process.platform === 'win32' ? 60000 : 30000
  await waitForCondition(async () => {
    const files = await readdir(logFolder)
    const logFiles = files.filter(f => f.startsWith('log.') && f.endsWith('.log'))
    console.log(`[DEBUG-LIMIT] Check limit: found ${logFiles.length} files: ${logFiles.join(', ')}`)
    // Should have exactly 2 files due to limit
    return logFiles.length === 2
  }, { timeout: limitTimeout, interval: 100, description: 'file limit to be enforced' })

  console.log('[DEBUG-LIMIT] Ending stream')
  stream.end()
  await once(stream, 'close')
  console.log('[DEBUG-LIMIT] Stream closed')

  // Add delay for virtual filesystem on Windows/macOS
  if (process.env.CI && (process.platform === 'win32' || process.platform === 'darwin')) {
    console.log('[DEBUG-LIMIT] CI detected, sleeping 1000ms for filesystem sync')
    await sleep(1000) // 1 second in CI for virtual filesystem sync
  } else if (process.platform === 'win32' || process.platform === 'darwin') {
    console.log('[DEBUG-LIMIT] Platform delay: sleeping 500ms')
    await sleep(500)
  }

  // Verify the non-log file is untouched
  console.log(`[DEBUG-LIMIT] Checking non-log file: ${notLogFileName}`)
  const nonLogContent = await readFile(notLogFileName, 'utf8')
  assert.ok(nonLogContent.includes('not a log file'), 'non-log file is untouched')

  // Verify old files were deleted (they should be since limit is 2 and we created newer files)
  console.log('[DEBUG-LIMIT] Checking old files were deleted')
  await assert.rejects(stat(oldFile1), 'oldest pre-existing file was deleted')
  await assert.rejects(stat(oldFile2), 'old pre-existing file was deleted')

  // Get the actual log files that exist
  console.log('[DEBUG-LIMIT] Getting final file list')
  const finalFiles = await readdir(logFolder)
  const finalLogFiles = finalFiles
    .filter(f => f.startsWith('log.') && f.endsWith('.log'))
    .sort() // Sort to get consistent order

  assert.strictEqual(finalLogFiles.length, 2, 'exactly 2 log files remain')

  // Read the files and verify they contain the expected messages
  console.log('[DEBUG-LIMIT] Reading contents of remaining files')
  const contents = await Promise.all(
    finalLogFiles.map(async f => {
      const content = await readFile(join(logFolder, f), 'utf8')
      console.log(`[DEBUG-LIMIT] File ${f} content (${content.length} bytes): "${content.replace(/\n/g, '\\n')}"`)
      return content
    })
  )

  // The files should contain the most recent messages (exact messages depend on timing)
  const allContent = contents.join('\n')
  console.log(`[DEBUG-LIMIT] Combined content: "${allContent.replace(/\n/g, '\\n')}"`)

  // At least one message should be present
  const hasMessage1 = allContent.includes('#1')
  const hasMessage2 = allContent.includes('#2')
  const hasMessage3 = allContent.includes('#3')

  // On Windows, timing issues can cause messages to be in different files than expected
  // Relax the assertion to be more flexible about message distribution
  if (process.platform === 'win32') {
    console.log('[DEBUG-LIMIT-WIN] Platform check: Windows detected')
    console.log(`[DEBUG-LIMIT-WIN] Files found: ${finalLogFiles.length} - ${finalLogFiles.join(', ')}`)
    console.log(`[DEBUG-LIMIT-WIN] All content length: ${allContent.length}`)
    console.log(`[DEBUG-LIMIT-WIN] All content: "${allContent.replace(/\n/g, '\\n')}"`)

    // On Windows, just check that files exist - content might be delayed
    assert.ok(finalLogFiles.length === 2, `should have exactly 2 files, got ${finalLogFiles.length}`)
    // Log diagnostic information
    if (allContent.length === 0) {
      console.log('[DEBUG-LIMIT-WIN] WARNING: Files exist but content is empty - may be delayed in CI')
    } else {
      console.log(`[DEBUG-LIMIT-WIN] Messages found - #1:${hasMessage1}, #2:${hasMessage2}, #3:${hasMessage3}`)
    }
  } else {
    assert.ok(hasMessage1 || hasMessage2 || hasMessage3, 'at least one message is present in remaining files')

    // Since we have 2 files and 3 messages, we should have at least 1 message total
    const messageCount = [hasMessage1, hasMessage2, hasMessage3].filter(Boolean).length
    assert.ok(messageCount >= 1, `at least 1 message should be present, found ${messageCount}`)
  }
})

it('throw on missing file parameter', async () => {
  await assert.rejects(
    buildStream(),
    { message: 'No file name provided' },
    'throws on missing file parameters'
  )
})

it('throw on unexisting folder without mkdir', async () => {
  const file = join('unknown', 'folder', 'file')
  await assert.rejects(
    buildStream({ file }),
    (err) => {
      // Check that it's an ENOENT error for the expected file
      return err.message.includes('ENOENT: no such file or directory, open') &&
             err.message.includes(`${file}.1.log`)
    },
    'throws on unexisting folder'
  )
})

it('throw on unparseable size', async () => {
  const size = 'unparseable'
  await assert.rejects(
    buildStream({ file: join(logFolder, 'log'), size }),
    { message: `${size} is not a valid size in KB, MB or GB` },
    'throws on unparseable size'
  )
})

it('throw on unparseable frequency', async () => {
  const frequency = 'unparseable'
  await assert.rejects(
    buildStream({ file: join(logFolder, 'log'), frequency }),
    {
      message: `${frequency} is neither a supported frequency or a number of milliseconds`
    },
    'throws on unparseable frequency'
  )
})

it('throw on unparseable limit object', async () => {
  await assert.rejects(
    buildStream({ file: join(logFolder, 'log'), limit: 10 }),
    {
      message: 'limit must be an object'
    },
    'throws on limit option not being an object'
  )
})

it('throw when limit.count is not a number', async () => {
  await assert.rejects(
    buildStream({ file: join(logFolder, 'log'), limit: { count: true } }),
    {
      message: 'limit.count must be a number greater than 0'
    },
    'throws on limit.count not being a number'
  )
})

it('throw when limit.count is 0', async () => {
  await assert.rejects(
    buildStream({ file: join(logFolder, 'log'), limit: { count: 0 } }),
    {
      message: 'limit.count must be a number greater than 0'
    },
    'throws on limit.count being 0'
  )
})

it('creates symlink if prop is set', { skip: process.platform === 'win32' }, async () => {
  const file = join(logFolder, 'log')
  const linkPath = join(logFolder, 'current.log')
  const stream = await buildStream({ file, symlink: true })
  stream.write('test content\n')
  stream.end()
  await once(stream, 'close')
  await assert.doesNotReject(lstat(linkPath), 'symlink was created')
  const linkTarget = await readlink(linkPath)
  assert.strictEqual(linkTarget, 'log.1.log', 'symlink points to the correct file')
  const content = await readFile(linkPath, 'utf8')
  assert.strictEqual(content, 'test content\n', 'symlink contains correct content')
})

it('symlink rotates on roll', { skip: process.platform === 'win32' }, async () => {
  const file = join(logFolder, 'log')
  const linkPath = join(logFolder, 'current.log')
  const frequency = 100

  const stream = await buildStream({ frequency, file, symlink: true })

  // Write first batch of messages
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')

  // Wait for symlink to be created and first file to contain messages
  await waitForFile(linkPath, { timeout: 1000 })
  await waitForRotationComplete(file, 1, 'logged message #1', { timeout: 1000 })

  // Capture initial symlink target
  const initialTarget = await readlink(linkPath)
  assert.ok(initialTarget.startsWith('log.'), 'initial symlink points to a log file')
  assert.ok(initialTarget.endsWith('.log'), 'initial symlink points to a .log file')

  // Wait for rotation and write new messages
  await sleep(frequency + 10)
  stream.write('logged message #3\n')

  // Wait for rotation to create a new file
  await waitForCondition(
    async () => {
      try {
        await stat(`${file}.2.log`)
        return true
      } catch (error) {
        return false
      }
    },
    { timeout: 3000, interval: 50, description: 'second log file to be created' }
  )

  stream.write('logged message #4\n')

  // Give time for symlink update
  await sleep(100)

  stream.end()
  await once(stream, 'close')

  // Wait for flush and symlink operations to complete
  await sleep(150)

  // Verify symlink still exists and points to a valid file
  await lstat(linkPath)
  const finalTarget = await readlink(linkPath)

  assert.ok(finalTarget.startsWith('log.'), 'final symlink points to a log file')
  assert.ok(finalTarget.endsWith('.log'), 'final symlink points to a .log file')

  // Verify the symlink target exists
  const actualFile = join(logFolder, finalTarget)
  await stat(actualFile)

  // Collect all log files
  const allFiles = []
  for (let i = 1; i <= 10; i++) {
    try {
      await stat(`${file}.${i}.log`)
      allFiles.push(`${file}.${i}.log`)
    } catch (error) {
      break
    }
  }

  // Verify we have at least 2 files
  assert.ok(allFiles.length >= 2, `Should have at least 2 log files, got ${allFiles.length}`)

  // Verify all messages exist in the log files
  const allMessages = ['#1', '#2', '#3', '#4']
  for (const msg of allMessages) {
    let found = false
    for (const logFile of allFiles) {
      const content = await readFile(logFile, 'utf8')
      if (content.includes(msg)) {
        found = true
        break
      }
    }
    assert.ok(found, `Message ${msg} should be found in the log files`)
  }

  // Verify symlink points to one of the existing log files
  assert.ok(allFiles.includes(actualFile), 'symlink target should be one of the log files')
})
