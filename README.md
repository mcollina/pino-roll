# pino-roll

A Pino transport that automatically rolls your log files.

## Install

```
npm i pino-roll
```

## Usage

```js
import { join } from 'path'
import pino from 'pino'

const transport = pino.transport({
  target: 'pino-roll',
  options: { file: join('logs', 'log'), frequency: 'daily', mkdir: true }
})

const logger = pino(transport)
```

(Also works in CommonJS)

### Important note about `file` functions

`pino.transport()` sends `options` to a worker thread using the structured clone algorithm.
Functions are not cloneable, so `file: () => '...'` will throw `DataCloneError` when used this way.

If you need dynamic filenames with `pino.transport()`, use `dateFormat` + `frequency`.

```js
const transport = pino.transport({
  target: 'pino-roll',
  options: {
    file: 'log-files/file',
    frequency: 'daily',
    dateFormat: 'yyyy.MM.dd',
    mkdir: true
  }
})
```

If you do not need `pino.transport()`, you can also call `pino-roll` directly in-process and pass `file` as a function.

If you need to keep using `pino.transport()` and still compute the final path dynamically, create a custom transport module that calls `pino-roll` in the worker thread.

```js
// my-pino-roll-transport.js
'use strict'

const { join } = require('path')
const buildPinoRoll = require('pino-roll')

module.exports = async function myPinoRollTransport ({
  folder,
  prefix = 'app',
  ...rollOptions
} = {}) {
  const dateStamp = new Date().toISOString().slice(0, 10)
  const file = join(folder, `${prefix}-${dateStamp}`)
  return buildPinoRoll({ ...rollOptions, file })
}
```

```js
// app.js
const { join } = require('path')
const pino = require('pino')

const transport = pino.transport({
  target: join(__dirname, 'my-pino-roll-transport.js'),
  options: {
    folder: join(__dirname, 'logs'),
    prefix: 'server',
    frequency: 'daily',
    mkdir: true
  }
})

const logger = pino(transport)
logger.info('hello from custom transport')
```

A runnable version of this pattern is available in:
- `examples/custom-transport/pino-roll-dynamic-transport.js`
- `examples/custom-transport/app.js`

## API

### build(options) => SonicBoom

Creates a Pino transport (a Sonic-boom stream) to writing into files.
Automatically rolls your files based on a given frequency, size, or both.

#### Options

You can specify any of [Sonic-Boom options](https://github.com/pinojs/sonic-boom#sonicboomopts) _except `dest`_

* **`file`**: `string | () => string`

  - Absolute or relative path to the log file.
  - Your application must have write access to the parent folder.
  - A rotation number will be appended to this filename.
  - When the parent folder already contains numbered files, numbering will continue based on the highest number.
  - If this path does not exist, the logger will throw an error unless you set `mkdir` to `true`.
  - `file` may be a function only when you build `pino-roll` directly in-process. It is not supported in `pino.transport()` options.

  - To ensure consistency, rotated filenames now always follow the **Extension Last Format** convention:
    ```
    filename.date.count.extension
    (e.g., prod.2025-08-19.1.log)
    ```
    > The date segment is optional.

    - When no filename (e.g., `logs/`) or if a directory is passed, a default filename `app.log` will be used.

      Resulting file: `logs/app.2025-08-19.1.log`.

    - If a filename is provided without an extension (e.g., `logs/app`), the default extension `.log` will be used.
    - If a filename with an extension is provided (e.g., `logs/app.log`) and an explicit extension is set (e.g., `.json`), the explicit extension takes precedence → `logs/app.json`.

  - **Filename validation:**
    - Filenames are validated against Windows path restrictions.
    - Disallowed characters: `< > : " | ? *` (to ensure cross-platform safety).

* **`size?`**: `number | string`

  - Maximum size of a single log file before rotation.
  - Can be combined with frequency.
  - Accepts units:
    - `k` -> kilobytes (KB)
    - `m` -> megabytes (MB)
    - `g` -> gigabytes (GB)
  - If no unit is provided:
    - **Numbers** are interpreted as MB.
    - Strings without units (e.g., "100") are also treated as MB.
  - Rotation occurs as soon as the file size reaches or exceeds the specified limit.

* **`frequency?`**: `number | string`
  - The amount of time a given log file is used.
  - Can be combined with size.
  - Accepted values:
    - `weekly` -> rotates the file once per week (every Monday at midnight).
    - `daily` -> rotates the file once per day.
    - `hourly` -> rotates the file once per hour.
    - Number -> interpreted as milliseconds.
  - When using `weekly`, `daily` or `hourly`, any existing file for the current period will be reused.
  - When using a *numeric value*, rotation happens at the start/end of each specified interval.

* **`extension?`**: `string`
  - The file extension to use for rotated log files.
  - Default: `.log`
  - Default extension only applied if the provided filename does not already contain an extension.

* **`symlink?`**: `boolean`
  - If enabled, creates a symbolic link (`current.log`) pointing to the active log file.
  - On each rotation, the symlink is updated to reference the newly created log file.
  - Default: `false`

* **`limit?`**: `object`
  - Defines the strategy for removing old log files during rotation.
  - Supports two optional properties: `count` and `removeOtherLogFiles`.

  * **`limit.count?`**: `number`
    - Maximum number of log files to retain in addition to the active file.
    - For example, if count is 3, a total of 4 files will be kept (3 rotated + 1 active).

  * **`limit.removeOtherLogFiles?`**: `boolean`
    - When `true`, will remove files not created by the current process.
    - When `false` or `undefined`, the `count` limit only applies to files generated by the current process.

* **`dateFormat?`**: `string`
  - Defines the format for appending the current date/time to the log file name.
  - When specified, appends the date/time in the provided format to the log file name.
  - In order for the date/time to be appended to the log file, the **`frequency`** option should be set.
  - Supports date formats from `date-fns` (see: [date-fns format documentation](https://date-fns.org/v4.1.0/docs/format)).
  - For example:
    - Weekly: `'yyyy-MM-dd'` -> `error.2024-09-23.log` (Monday of that week)
    - Daily: `'yyyy-MM-dd'` -> `error.2024-09-24.log`
    - Hourly: `'yyyy-MM-dd-hh'` -> `error.2024-09-24-05.log`

## License

MIT
