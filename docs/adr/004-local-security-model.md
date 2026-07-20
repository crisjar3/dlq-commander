# ADR 004: Local security and conservative defaults

- Status: accepted
- Date: 2026-07-19

## Context

The application handles credentials and potentially sensitive payloads while performing irreversible broker operations.

## Decision

Use `safeStorage`, local SQLite, renderer sandboxing, read-only profiles by default, explicit confirmation, and encrypted snapshots before requeue. Reject secret persistence and message archival when encryption is unavailable.

## Alternatives considered

Plaintext credentials or local environment variables reduce implementation effort but do not protect data at rest. A remote vault requires external identity, network availability, and administration beyond the application's local boundary.

## Consequences

Encrypted data depends on the operating-system account and protection mechanism. Copying only the database to another machine does not guarantee secret recovery.

## Validation

E2E tests verify that `require` and `process` are unavailable in the renderer. Unit tests verify that the vault fails closed when encryption is unavailable.
