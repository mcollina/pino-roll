# pino-roll
[![npm version](https://img.shields.io/npm/v/pino-roll)](https://www.npmjs.com/package/pino-roll)
[![Build Status](https://img.shields.io/github/workflow/status/feugy/pino-roll/CI)](https://github.com/feugy/pino-roll/actions)
[![Known Vulnerabilities](https://snyk.io/test/github/feugy/pino-roll/badge.svg)](https://snyk.io/test/github/feugy/pino-roll)
<!-- [![Coverage Status](https://coveralls.io/repos/github/feugy/pino-roll/badge.svg?branch=master)](https://coveralls.io/github/feugy/pino-roll?branch=master) -->
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://standardjs.com/)

A Pino transport that automatically rolls your log files

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

* `size?`: the maximum size of a given log file.
  Can be combined with frequency.
  Use `k`, `m` and `g` to express values in KB, MB or GB.
  Numerical values will be considered as MB.

* `frequency?`: the amount of time a given log file is used.
  Can be combined with size.
  Use `daily` or `hourly` to rotate file every day (or every hour).
  Existing file within the current day (or hour) will be re-used.
  Numerical values will be considered as a number of milliseconds.
  Using a numerical value will always create a new file upon startup.

* `extension?` appends the provided string *after* the file number.

* `prefix?` appends the provided string *before* the file number.

## License

MIT
