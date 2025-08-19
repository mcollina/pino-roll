# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

pino-roll is a Pino transport that automatically rolls log files based on size, frequency, or both. It extends Sonic Boom for high-performance file writing with automatic rotation capabilities.

## Development Commands

### Testing
- `npm test` - Run tests with standard linting and node:test
- `npm run dev` - Run tests in watch mode
- `npm run test-ci` - Run tests with coverage for CI
- Run single test: `node --test test/[filename].test.js`

### Linting
- `npm test` includes linting via standard
- Linting only: `npx standard`
- Auto-fix linting: `npx standard --fix`

## Architecture

### Core Components

1. **pino-roll.js** - Main entry point that exports the transport builder function
   - Handles rotation scheduling based on frequency
   - Monitors file size for size-based rotation
   - Manages symlink creation and updates
   - Coordinates with utils for file operations

2. **lib/utils.js** - Core utility functions
   - File name generation and validation
   - Size/frequency parsing
   - Date formatting with date-fns
   - File system operations (detecting existing logs, removing old files)
   - Windows path compatibility

### Key Patterns

- **Sonic Boom Integration**: Extends SonicBoom for high-performance writes with `.reopen()` for rotation
- **Event-Driven Rotation**: Uses 'write' events for size monitoring and timeouts for frequency-based rotation
- **Filename Convention**: `filename.date.count.extension` format (e.g., `app.2025-08-19.1.log`)
- **Async File Operations**: All file system operations use fs/promises
- **CommonJS Module**: Project uses CommonJS (`require`/`module.exports`) not ES modules

### Testing Approach

- Uses built-in node:test framework with coverage
- Mock date utilities for time-based testing (mockdate)
- Test files mirror source structure in `test/` directory
- Integration tests with actual Pino instances
- Leak detection tests for memory management
- Tests use describe/it blocks for organization
- Built-in assert library for assertions

## Important Considerations

- File paths can be functions that return strings
- Supports both absolute and relative paths
- Creates parent directories when `mkdir: true`
- Handles existing numbered log files by continuing sequence
- Symlink feature creates/updates `current.log` pointing to active file
- Limit options control retention of old log files