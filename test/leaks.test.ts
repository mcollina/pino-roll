import { it } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'

import build from '../src/pino-roll.ts'
import { createTempTestDir } from './utils.ts'

it('roll does not prevent process end', async () => {
  const logFolder = createTempTestDir()
  const stream = await build({
    file: join(logFolder, 'logfile'),
    frequency: 100,
  })
  assert.ok(stream)
})
