# Security model

## Objective and scope

DLQCommander protects local credentials and snapshots while separating the interface from privileged operations. This model covers RabbitMQ, Apache Kafka, Azure Service Bus, and local Demo profiles.

The application operates with the permissions granted to configured credentials. It does not replace broker access controls and does not implement internal per-user authorization.

## Trust boundaries

| Component | Responsibility | Allowed access |
| --- | --- | --- |
| Renderer | Presentation, filtering, and user-intent capture | Limited preload API |
| Preload | Validate and transport IPC messages | `contextBridge` and defined `ipcRenderer` channels |
| Main | Brokers, SQLite, encryption, jobs, and audit | Node.js, Electron, and SDKs |
| External broker | Message source and target | Accessed only through its adapter |

The window uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`. The session blocks permission requests, new windows, and uncontrolled navigation. The renderer cannot use `require`, access `process`, or read the file system directly.

## IPC contract

`src/shared/ipc-contract.ts` enumerates every method, channel, input, and output. Preload validates before sending; main validates again before execution and validates the result. Handlers convert known failures into errors with a code, sanitized message, and recoverability flag.

The UI receives no generic IPC channel. Adding a privileged capability requires adding it to the contract and its Zod schemas.

## Credentials

Credentials enter through the form and cross IPC during discovery or persistence. Discovery keeps them in memory and creates no profile. When a profile is saved, `SecretVault` encrypts its JSON with `safeStorage.encryptString` before writing to SQLite.

Profiles returned to the renderer include non-secret configuration but never `encrypted_secret` or a decrypted secret. If the operating system reports that encryption is unavailable, saving credentials or archiving snapshots fails closed.

The application does not write connection strings, passwords, Basic Auth values, or authenticated URLs to audit history. Documentation scripts use only the local Compose credentials.

## Local data

The database is stored at `app.getPath('userData')/dlq-commander.db`. SQLite uses WAL, so `-wal` and `-shm` files can exist next to the database while the application is running.

| Data | Protection | Visible in UI |
| --- | --- | --- |
| Non-secret profile configuration | Local SQLite | Yes |
| Credentials | Field encrypted with `safeStorage` | No |
| Audit history | Local SQLite without payloads | Yes |
| Pre-requeue snapshot | Field encrypted with `safeStorage` | No |
| Body SHA-256 hash | Local SQLite | Yes, in message metadata |
| Theme preference | Renderer `localStorage` | Yes, in Settings |

Snapshots are local forensic evidence, not transactional broker backups. Copying the database to another machine does not guarantee decryption because `safeStorage` depends on the operating-system account and protection mechanism.

## Operational controls

- New profiles start in **Solo lectura** (Read only) mode.
- Requeue requires a selection, target, and explicit confirmation.
- The operator chooses a throttle from `0.2` to `100` messages per second.
- Only one active job is allowed for a given profile and source.
- JobRunner attempts to encrypt a snapshot before modifying each message.
- Every start and terminal state is written to audit history.
- Partial failures retain separate success and failure counts.

## Requeue guarantees by broker

- RabbitMQ waits for publisher confirms before acknowledging the original.
- Kafka waits for target-topic publication; the original remains in the DLT.
- Azure sends to the target before calling `completeMessage`.
- Demo removes the message from its in-memory data after a successful operation.

These sequences reduce the possibility of loss after a send failure, but they do not provide a distributed transaction between source and target.

## Residual risks

- RabbitMQ has no native peek in this implementation; `basic.get` plus `nack(requeue=true)` can affect ordering and redelivery state.
- Kafka rereads with ephemeral consumers and no commits, potentially scanning the topic up to the requested limit.
- Without `Manage`, Azure cannot query the exact count and falls back to the observed sample size.
- A compromised host or user session can access data while the application decrypts it for an operation.
- `safeStorage` protects data at rest; it does not replace operating-system permissions, full-disk encryption, or session policy.
- There is no internal RBAC. Anyone with access to the user session can use its saved profiles.
- The current distribution has no digital signature or automatic update mechanism.
- Jobs live in memory. Closing the application interrupts pending processing without reverting confirmed messages.

## Operational recommendations

1. Use separate identities for each environment and apply least privilege.
2. Keep profiles read-only outside authorized operation windows.
3. Do not use administration connection strings for routine operation when a narrower policy is sufficient.
4. Protect the Windows account and enable disk encryption according to organizational policy.
5. Review audit history and the target after every batch.
6. Immediately rotate any credential shared through chat, tickets, screenshots, or logs.

See the [Operations runbook](operations-runbook.md) for preparation and recovery, and [Architecture](architecture.md) for encryption and IPC data flows.
