# ADR 005: SQLite from the Electron runtime

- Status: accepted
- Date: 2026-07-19

## Context

The initial evaluation used `better-sqlite3`, whose binaries depend on Electron's exact ABI. Updating Electron for security advisories required Python and local compilers, making a clean installation non-reproducible.

## Decision

Use `DatabaseSync` from `node:sqlite`, available in the Node.js runtime bundled with Electron 43. Repositories retain prepared SQL, WAL, foreign keys, and explicit migrations.

## Alternatives considered

Requiring Python and Visual Studio Build Tools increases global prerequisites. Keeping a vulnerable Electron version is unacceptable. A WASM database avoids native addons but adds more complex persistence and flushing behavior in main.

## Consequences

The application requires an Electron version whose runtime includes `node:sqlite`. The native addon, ABI rebuild, and ASAR unpack requirements disappear. Repositories remain the persistence boundary; Drizzle is not part of the current implementation.

## Validation

A clean installation, repository tests, E2E tests, and the `release/win-unpacked` smoke test must pass with Electron 43.
