# DLQCommander

DLQCommander is a desktop console for inspecting and requeuing messages from dead-letter queues (DLQs) and dead-letter topics (DLTs). It centralizes operations across RabbitMQ, Apache Kafka, and Azure Service Bus without exposing credentials to the renderer or requiring a web platform with access to private networks.

The application is intended for SRE operators, platform teams, and developers who need to diagnose failed messages, inspect their contents, and perform controlled requeue operations with confirmation, throttling, and local auditing.

## Features

- Connection-oriented Dashboard that remains usable with large namespaces.
- Progressive, paginated catalogs for hundreds or thousands of queues and topics.
- Keyboard-first local search with exact, prefix, substring, accent-insensitive, and typo-tolerant matching.
- Hierarchical Azure exploration with queues, topics, and lazy-loaded subscriptions.
- Namespace profiles that expose every authorized resource without one profile per queue.
- Manual entry when a broker does not allow discovery or RabbitMQ Management API is unavailable.
- Inspector with progressive loading, search, bulk selection, and Payload, Headers, and Metadata views.
- Requeue with searchable destinations, remembered source preferences, throttling, progress, and per-batch results.
- Local operation audit trail and encrypted snapshots captured before requeue.
- Read-only profiles by default.
- System, Light, and Dark themes with a locally persisted preference.
- Built-in local Demo profile for exploring the UI without external infrastructure.

## Supported brokers

| Broker | Discovery | Inspection | Requeue |
| --- | --- | --- | --- |
| RabbitMQ | Management HTTP API | `basic.get` followed by `nack(requeue=true)` | Confirmed publish followed by original-message `ack` |
| Apache Kafka | KafkaJS Admin | Ephemeral consumer without commits | Append-only copy to the target topic |
| Azure Service Bus | Queues, topics, and subscriptions | `peekMessages` on queue or subscription `$DeadLetterQueue` | Send to a queue or topic followed by `completeMessage` |
| Local Demo | Built-in data | In-memory messages | Removes the message from the demo data set |

The operational differences matter: Kafka keeps the original DLT record after a successful requeue. Read [Broker semantics](docs/broker-semantics.md) before operating on a real source.

## Requirements

- Windows 10 or 11.
- Node.js `22.x`.
- pnpm `11.9.0`.
- Docker Desktop for the RabbitMQ and Kafka lab.

The expected versions are declared in `package.json`. Do not use npm to install dependencies because `pnpm-lock.yaml` is the reproducible source of the dependency tree.

## Quick start

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The first launch creates the **Demo local** profile with three sources and sample messages. Open **Demo local** from the Dashboard, search for `orders.dlq`, inspect messages, perform a requeue, and review the result under **Auditoría**.

Follow the [User guide](docs/user-guide.md) for a complete walkthrough of every screen and operation.

## Local broker lab

The lab starts RabbitMQ with the Management Plugin and Kafka in KRaft mode, creates the expected sources, provisions 125 additional RabbitMQ catalog queues, and publishes test messages:

```powershell
pnpm lab:up
pnpm lab:seed
pnpm dev
```

RabbitMQ is available at `localhost:5672`, with its Management API at `http://localhost:15672`. Kafka exposes the `localhost:9092` listener. Lab credentials, queues, and topics are documented in [Broker configuration](docs/broker-configuration.md).

Stop the lab with:

```powershell
pnpm lab:down
```

## Build and distribution

```powershell
pnpm build
pnpm package
pnpm dist
```

- `build` checks types and generates `out/main`, `out/preload`, and `out/renderer`.
- `package` creates an unpacked application under `release/win-unpacked`.
- `dist` creates the NSIS installer under `release`.

The current distribution is not digitally signed. See [Development, testing, and distribution](docs/development.md) for the complete workflow and the artifacts produced by each command.

## Documentation

- [Documentation index](docs/README.md)
- [User guide and visual tutorials](docs/user-guide.md)
- [Broker configuration and permissions](docs/broker-configuration.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md)
- [Operations runbook](docs/operations-runbook.md)
- [Testing matrix](docs/testing-matrix.md)
- [Architecture decisions](docs/adr/001-electron-typescript.md)

## Current limitations

- Saved profiles can be tested or deleted. To change their configuration, recreate them.
- Purge and payload editing before requeue are not available.
- Kafka profiles support PLAINTEXT only; the UI does not expose TLS or SASL.
- Amazon SQS is not implemented.
- Automatic updates and code signing are not configured.

## License

[MIT](LICENSE)
