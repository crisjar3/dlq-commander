# ADR 006: Kafka client for Electron

- Status: accepted
- Date: 2026-07-19

## Context

The Kafka adapter must run inside the Electron 43 main process in development and from the packaged ASAR. An initial evaluation used `@confluentinc/kafka-javascript`: the client connected from Node.js, but its native addon prevented the Electron main process from starting in this environment.

The adapter needs local PLAINTEXT connectivity, topic administration, manual reads without commits, and production with headers. The current UI does not configure transactions, Schema Registry, or librdkafka-specific features.

## Decision

Use `kafkajs` 2.2.x, a JavaScript client without a native addon, behind `KafkaAdapter`. The domain and UI depend on `BrokerAdapter`, not KafkaJS, which keeps the IPC boundary stable.

## Consequences

- The application avoids another native dependency and its ABI and packaging matrix.
- The current profile supports PLAINTEXT; TLS and SASL are not available in the UI.
- The adapter contract requires `topic:partition:offset` identifiers, no inspection commits, and append-only requeue semantics regardless of the internal client.

## Validation

- The integration test connects to `localhost:9092`, inspects the DLT, copies a record, and consumes it from the target.
- The E2E test starts the real Electron binary, saves a profile, and performs connection and discovery through IPC.
- Packaging must complete without rebuilding Kafka addons for Electron's ABI.
