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


## API

### build(options) => SonicBoom

Creates a Pino transport (a Sonic-boom stream) to writing into files.
Automatically rolls your files based on a given frequency, size, or both.

#### Options

You can specify any of [Sonic-Boom options](https://github.com/pinojs/sonic-boom#sonicboomopts) _except `dest`_

* `file`: absolute or relative path to the log file.
  Your application needs the write right on the parent folder.
  Number will be appened to this file name.
  When the parent folder already contains numbered files, numbering will continue based on the highest number.
  If this path does not exist, the logger with throw an error unless you set `mkdir` to `true`.
  `file` may also be a function that returns a string.

* `size?`: the maximum size of a given log file.
  Can be combined with frequency.
  Use `k`, `m` and `g` to express values in KB, MB or GB.
  Numerical values will be considered as MB.

* `frequency?`: the amount of time a given log file is used.
  Can be combined with size.
  Use `daily` or `hourly` to rotate file every day (or every hour).
  Existing file within the current day (or hour) will be re-used.
  Numerical values will be considered as a number of milliseconds.
  Using a numerical value will result in a file during start/end of the frequency specified.

* `extension?`: appends the provided string after the file number.

* `symlink?`: creates a symlink to the current log file.
  The symlink will be updated to the latest log file upon rotation.
  The name of the symlink is always called `current.log`.

* `limit?`: strategy used to remove oldest files when rotating them:

* `limit.count?`: number of log files, **in addition to the currently used file**.

* `limit.removeOtherLogFiles?`: boolean:  
When true, will remove files not created by the current process. 
When false/undefined, count limitation will only apply to files created by the current process. 

* `dateFormat?`: the format for appending the current date/time to the file name.
  When specified, appends the date/time in the provided format to the log file name.
  Supports date formats from `date-fns` (see: [date-fns format documentation](https://date-fns.org/v4.1.0/docs/format)).
  For example:
    Daily: `'yyyy-MM-dd'` → `error.2024-09-24.log`
    Hourly: `'yyyy-MM-dd-hh'` → `error.2024-09-24-05.log`

## License

MIT
