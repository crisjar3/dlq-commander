# ADR 003: Validated IPC contract

- Status: accepted
- Date: 2026-07-19

## Context

IPC is the privilege boundary between an untrusted UI and operations involving credentials or production messages.

## Decision

`src/shared/ipc-contract.ts` is the single source for channels, inputs, and outputs. Main and preload validate with Zod. Renderer code does not import Electron.

## Alternatives considered

Manually maintained string channels do not detect drift or invalid payloads. A local HTTP API increases network exposure without adding a capability required by the desktop application.

## Consequences

Contract changes fail compilation or runtime validation close to the boundary. Zod is bundled into preload because the sandbox cannot resolve arbitrary dependencies.

## Validation

Type checking, schema tests, and renderer-isolation E2E tests must pass. ESLint forbids Electron and Node.js imports in the renderer.
