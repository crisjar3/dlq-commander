# Development, testing, and distribution

This guide prepares a clean environment, runs DLQCommander, validates real brokers, and produces Windows artifacts using only versioned repository commands.

## Requirements

| Tool | Version or condition | Purpose |
| --- | --- | --- |
| Windows | 10 or 11 | Application execution, `safeStorage`, and current packaging |
| Node.js | `22.x` | Toolchain and script runtime |
| pnpm | `11.9.0` | Reproducible installation and project scripts |
| Docker Desktop | Compose v2 | RabbitMQ and Kafka lab |
| Git | Current supported version | Contribution workflow |

Check installed versions:

```powershell
node --version
pnpm --version
docker compose version
```

## Installation

```powershell
git clone https://github.com/crisjar3/dlq-commander.git
cd dlq-commander
pnpm install --frozen-lockfile
```

`--frozen-lockfile` fails when `package.json` and `pnpm-lock.yaml` do not match. This prevents development and CI from resolving different dependency versions.

## Local development

```powershell
pnpm dev
```

Electron Vite compiles main and preload, starts the renderer development server, and opens the application window. Renderer changes update during development. Close the window or interrupt the process to end the session.

Use **Demo local** to explore the UI without brokers. Prepare the lab before working with real adapters.

## Docker lab

```powershell
pnpm lab:up
pnpm lab:seed
```

`lab:up` runs `docker compose up -d --wait`. Compose includes:

- RabbitMQ `4.1-management` on ports `5672` and `15672`, with definitions preloaded;
- Kafka `3.9.1` in KRaft mode with host listener `9092`;
- an initialization container that creates `orders.events` and `orders.events.dlt`.

`lab:seed` ensures 125 `catalog.queue.NNN` queues, publishes 20 messages to `orders.dlq`, and publishes 20 records to `orders.events.dlt`. The catalog queues make three RabbitMQ pages available to the broker E2E suite. Running the seed again keeps those queues and adds message fixtures; it does not clear previous content.

Check service health:

```powershell
docker compose ps
```

Stop and remove the containers:

```powershell
pnpm lab:down
```

Compose does not declare persistent broker data volumes. Complete local values are documented in [Broker configuration](broker-configuration.md).

## Project commands

| Command | Responsibility | Artifact or result |
| --- | --- | --- |
| `pnpm dev` | Run Electron in development mode | Interactive window and terminal process |
| `pnpm typecheck` | Validate Node.js and renderer TypeScript | No emitted files |
| `pnpm lint` | Run ESLint with no warnings allowed | Terminal report |
| `pnpm test` | Run unit tests with Vitest | Schema, service, adapter, and persistence results |
| `pnpm test:integration` | Test real RabbitMQ/Kafka and opt-in Azure discovery | Terminal report |
| `pnpm test:e2e` | Build and exercise Electron with Demo | Traces under `test-results` on failure |
| `pnpm test:e2e:brokers` | Exercise discovery and profiles against Docker | Traces under `test-results` on failure |
| `pnpm build` | Type-check and compile all three processes | `out/main`, `out/preload`, `out/renderer` |
| `pnpm package` | Build an unpacked application | `release/win-unpacked` |
| `pnpm dist` | Build an NSIS distribution | Installer and metadata under `release` |
| `pnpm docs:capture` | Build and regenerate tutorial screenshots | `docs/assets/tutorials/*.png` |
| `pnpm docs:check` | Validate documentation links and images | Terminal report |

`out`, `release`, `test-results`, and Playwright reports are ignored by Git. Documentation screenshots are versioned.

## Validation order

Run the complete validation sequence from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm lab:up
pnpm lab:seed
pnpm docs:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:brokers
pnpm package
```

`test:integration` and `test:e2e:brokers` require a healthy lab. The remaining commands do not depend on Docker.

### Opt-in Azure discovery

The Azure integration test runs discovery only when the shell defines a connection string:

```powershell
$env:AZURE_SERVICE_BUS_CONNECTION_STRING = '<development-connection-string>'
pnpm test:integration
Remove-Item Env:AZURE_SERVICE_BUS_CONNECTION_STRING
```

Use a development namespace. The suite does not write the value to files or snapshots. Isolated unit tests validate Azure inspection and requeue behavior; follow the Azure section in [Testing matrix](testing-matrix.md) for a real-message walkthrough.

## Tutorial screenshots

Screenshots are produced from the compiled application with temporary `userData` and local lab fixtures:

```powershell
pnpm lab:up
pnpm lab:seed
pnpm docs:capture
```

The script fixes the window at `1440x900`, uses non-sensitive data, and adds temporary numbered markers to the DOM. A temporary 184-resource Demo catalog exercises pagination and tolerant search. Reproducible Azure-style topic and subscription screenshots use an in-process documentation fixture with invented names and metrics; it never contacts Azure or stores a real credential. The script does not modify application UI code or reuse local profiles. Visually review every PNG before committing it.

The screenshots intentionally show the current Spanish UI. English documentation preserves literal control names so the instructions remain traceable to the product.

## Build

```powershell
pnpm build
```

The command first runs `pnpm typecheck`, then `electron-vite build`. An approved result contains:

```text
out/
  main/index.js
  preload/index.js
  renderer/index.html
```

Additional internal file names can change with the bundler. These three entries represent the required executable boundaries.

## Packaging

### Unpacked application

```powershell
pnpm package
```

Open `release/win-unpacked/DLQCommander.exe` and check Dashboard, Demo Resource Explorer, message inspection, theme changes, and close/reopen behavior. This command is appropriate for local smoke tests.

### Installer

```powershell
pnpm dist
```

Electron Builder creates an NSIS installer that allows the user to choose an installation directory. Configuration is stored in `package.json`. The current installer is unsigned, so Windows can display a reputation warning.

## Continuous integration

`.github/workflows/ci.yml` runs on `windows-latest`:

1. checkout;
2. pnpm and Node.js 22 setup;
3. frozen-lockfile installation;
4. documentation validation;
5. type checking;
6. linting;
7. unit tests;
8. Demo E2E tests;
9. unpacked packaging.

Broker-backed suites are not part of the public job because they require Docker and additional services. Run them locally before publishing changes to adapters or discovery.

## Repository structure

| Path | Content |
| --- | --- |
| `src/main` | Brokers, discovery, jobs, security, IPC, and SQLite |
| `src/preload` | Limited API exposed through `contextBridge` |
| `src/renderer` | React application and styles |
| `src/shared` | Types, schemas, capabilities, and IPC contract |
| `tests/unit` | Isolated tests |
| `tests/integration` | Real brokers and opt-in Azure discovery |
| `tests/e2e` | Electron with Demo |
| `tests/e2e-brokers` | Electron against Docker |
| `docker` | Lab definitions |
| `scripts` | Seed, documentation validation, and screenshot automation |
| `docs` | Public documentation and graphical assets |

## Contribution rules

- Use pnpm and keep `pnpm-lock.yaml` consistent.
- Keep Node.js and Electron imports out of the renderer.
- Validate every IPC payload with shared schemas.
- Never log credentials, connection strings, or real message bodies.
- Document the broker-specific semantics of every new operation.
- Match tests to the modified boundary: unit tests for rules, integration tests for adapters, and E2E tests for visible workflows.
- Run `git diff --check` before committing.

## Distribution limitations

The project currently produces Windows artifacts. Code signing, automatic updates, macOS targets, and Linux targets are not configured. Kafka profiles expose PLAINTEXT only. The UI cannot edit profiles, purge sources, or change payloads before requeue.
