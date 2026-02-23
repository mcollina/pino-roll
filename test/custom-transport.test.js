'use strict'

const { once } = require('events')
const { readdir, readFile } = require('fs/promises')
const { join } = require('path')
const { it, beforeEach } = require('node:test')
const assert = require('node:assert')
const pino = require('pino')

const { createTempTestDir, waitForCondition } = require('./utils')

let logFolder

beforeEach(() => {
  logFolder = createTempTestDir()
})

it('supports dynamic filenames via a custom transport wrapper', async () => {
  const transport = pino.transport({
    target: join(__dirname, '..', 'fixtures', 'custom-pino-roll-transport.js'),
    options: {
      folder: logFolder,
      prefix: 'server',
      mkdir: true
    }
  })

  try {
    await once(transport, 'ready')
    const logger = pino(transport)
    logger.info('logged from wrapper transport')

    let fileName

    await waitForCondition(
      async () => {
        const files = await readdir(logFolder)
        fileName = files.find(file => file.startsWith('server-') && file.endsWith('.1.log'))
        if (!fileName) return false

        const content = await readFile(join(logFolder, fileName), 'utf8')
        return content.includes('logged from wrapper transport')
      },
      {
        timeout: 5000,
        interval: 50,
        description: 'custom transport log file to contain message'
      }
    )

    assert.ok(fileName, 'custom transport created a dated log file')
  } finally {
    if (!transport.closed) {
      transport.end()
      await once(transport, 'close')
    }
  }
})
