# ADR 001: Electron and TypeScript

- Status: accepted
- Date: 2026-07-19

## Context

The application needs a desktop UI, broker SDK access, local persistence, operating-system-backed encryption, and an installable distribution.

## Decision

Use Electron, React, and strict TypeScript. The main process owns privileged capabilities, preload exposes a minimal contract, and the renderer is limited to presentation and user interaction.

## Alternatives considered

Tauri produces smaller binaries but adds a second language and wrappers around JavaScript SDKs. A web application requires an additional backend to hold secrets and reach private networks. Both alternatives add components and operational responsibilities for the current scope.

## Consequences

The installer is larger, and native modules must match the Electron runtime. In return, broker SDKs and the domain model share one TypeScript toolchain.

## Validation

`pnpm build`, `pnpm test:e2e`, and `pnpm package` must pass on Windows.
