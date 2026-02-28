'use strict'

const { join } = require('path')
const pino = require('pino')

const transport = pino.transport({
  target: join(__dirname, 'pino-roll-dynamic-transport.js'),
  options: {
    folder: join(__dirname, 'logs'),
    baseName: 'server',
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd'
  }
})

const logger = pino(transport)

logger.info('hello from custom pino-roll transport')

transport.on('ready', () => {
  logger.info('transport ready')
})
