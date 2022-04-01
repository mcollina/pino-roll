const { join } = require('path')
const pino = require('pino')

const transport = pino.transport({
  target: '.',
  options: { file: join('logs', 'log.json'), frequency: 'daily', mkdir: true }
})

const logger = pino(transport)

let i = 0
setInterval(() => logger.info(`frame #${i++}`), 100)
