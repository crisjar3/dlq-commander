# Testing matrix

The test strategy combines isolated rules, adapters against real brokers, and complete Electron workflows. No layer replaces another: unit tests validate decisions, integration tests validate protocols, and E2E tests validate boundaries and visible behavior.

## Suites and acceptance criteria

| Layer | Command | Acceptance criterion |
| --- | --- | --- |
| Documentation | `pnpm docs:check` | Local links and resources exist, and every image has alt text |
| Types | `pnpm typecheck` | Main, preload, shared, and renderer satisfy strict TypeScript |
| Lint | `pnpm lint` | No errors or warnings; renderer import boundaries remain intact |
| Unit | `pnpm test` | Schemas, discovery, vault, jobs, persistence, and isolated adapters pass |
| Integration | `pnpm test:integration` | RabbitMQ and Kafka connect, inspect, and deliver to targets; Azure discovery runs only with its local variable |
| Demo E2E | `pnpm test:e2e` | Electron opens, renderer is isolated, themes persist, and requeue is audited |
| Broker E2E | `pnpm test:e2e:brokers` | Electron discovers resources, saves profiles, and tests real RabbitMQ/Kafka connections |
| Build | `pnpm build` | Main, preload, and renderer are generated under `out` |
| Packaging | `pnpm package` | `release/win-unpacked` is created with the required runtime |

## Prepare integration services

```powershell
pnpm lab:up
pnpm lab:seed
docker compose ps
```

RabbitMQ and Kafka must report healthy. Every seed run adds data, so tests use unique identifiers and do not rely on an exact depth.

## Real RabbitMQ

Lab connection: `amqp://dlqcommander:dlqcommander@localhost:5672/%2F`.

The integration suite:

1. publishes a uniquely identified message to `orders.dlq`;
2. tests the connection and obtains the source through `RabbitMqAdapter`;
3. inspects until it locates the message without acknowledging it;
4. performs requeue and waits for publisher confirm before acknowledging the original;
5. consumes from `orders` and compares body and headers;
6. passes when the message appears in the target without an AMQP exception.

The discovery suite verifies that the Management API returns `orders` and `orders.dlq`. The additional E2E test completes the React form, discovers queues, invalidates results after a virtual-host change, saves an encrypted profile, and runs **Probar**.

## Real Kafka

Bootstrap server: `localhost:9092`; DLT: `orders.events.dlt`; target: `orders.events`.

The integration suite:

1. publishes a record with a unique key and identifier to the DLT;
2. confirms topics and connectivity through Kafka Admin;
3. calculates depth from offsets;
4. inspects with an ephemeral group ID and no commits;
5. copies the record to the target while preserving key, value, and headers;
6. consumes from the target with another unique group ID;
7. verifies that DLT depth did not decrease.

The discovery suite verifies that `orders.events` and `orders.events.dlt` appear and that internal topics do not. E2E saves and tests a Kafka profile through Electron's real IPC boundary.

## Azure Service Bus

Unit tests simulate peek, runtime properties, send, complete, and send failure. The automated external integration covers discovery only.

Enable it with:

```powershell
$env:AZURE_SERVICE_BUS_CONNECTION_STRING = '<development-connection-string>'
pnpm test:integration
Remove-Item Env:AZURE_SERVICE_BUS_CONNECTION_STRING
```

The test is skipped when the variable is absent. When present, it must enumerate at least one queue without writing the credential to files, snapshots, or error output.

Real inspection and requeue validation requires a development namespace:

1. create a source queue and target queue;
2. move a known message to `$DeadLetterQueue`;
3. confirm that peek does not reduce depth;
4. requeue and verify arrival in the target;
5. force a send failure and confirm that the original is not completed;
6. repeat without `Manage` to verify the depth fallback.

Never use production as an automated fixture.

## Demo E2E

Each test creates a temporary `userData` directory and launches the compiled application. The suite confirms:

- visible Dashboard and Demo sources;
- absence of `require` and `process` in the renderer;
- persistence of Light, Dark, and System themes;
- message selection, requeue confirmation, and terminal progress;
- a completed Audit entry.

The temporary directory is deleted when Electron closes.

## Broker E2E

The suite keeps one Electron instance for all scenarios and uses temporary `userData`. It validates:

- RabbitMQ and Kafka discovery through IPC;
- persistence, testing, and source listing against real brokers;
- RabbitMQ profile creation from discovered selectors in the UI;
- stale state after connection details change;
- manual fallback after invalid RabbitMQ credentials.

## Packaging smoke test

After `pnpm package`:

1. open `release/win-unpacked/DLQCommander.exe`;
2. confirm that the Dashboard displays Demo;
3. open a message and change the theme;
4. close and reopen the application;
5. confirm database and theme persistence and preload functionality;
6. verify that no console or external navigation appears.

## Completion evidence

Before publishing, include in the change description:

- Node.js and pnpm versions;
- commands run and their results;
- Docker health for broker-backed suites;
- confirmation that `git diff --check` passed;
- confirmation that no credentials or local databases were versioned;
- any skipped suite and its reason.
