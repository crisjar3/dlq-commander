# User guide

This guide explains how to navigate DLQCommander, create a connection, inspect messages, and perform a requeue. Screenshots are generated with temporary data and the local broker lab; they contain no external credentials.

The application UI is currently in Spanish. This guide keeps literal screen, button, and field labels in **bold** so they can be matched directly to the interface.

## Before operating

DLQCommander can modify real messages. New profiles start in **Solo lectura** (Read only) mode so the operator can validate the endpoint, source, and target before enabling write operations.

Before disabling that protection:

1. Confirm that the source is a DLQ or DLT.
2. Confirm that the target is the queue or topic consumed by the intended application.
3. Review the [broker semantics](broker-semantics.md), especially Kafka's append-only behavior.
4. Run **Probar** (Test) from **Conexiones** (Connections).
5. Agree on a throttle compatible with the target consumer's capacity.

## First walkthrough

### 1. Open DLQCommander

Run `pnpm dev` from the repository or open the installed application. On first launch, DLQCommander creates the **Demo local** profile and displays its sources on the Dashboard.

![Initial Dashboard showing navigation, metrics, and sources from the Demo local profile](assets/tutorials/first-run-01-dashboard.png)

*Action:* identify navigation (1), aggregate metrics (2), and the source table (3). *Expected result:* **Orders / DLQ**, **Payments / DLQ**, and **Notifications / DLQ** appear without configuring a broker.

### 2. Read the Dashboard

The header summarizes the currently observable state:

- **Mensajes pendientes:** total depth reported by all sources.
- **Fuentes visibles:** number of configured DLQs or DLTs.
- **Perfiles activos:** number of local profiles.
- **Más antiguo:** age of the oldest message the adapter could observe.
- **Estado:** healthy, warning, or error according to depth and connectivity.

The Dashboard queries brokers every 15 seconds. **Actualizar** forces an immediate refresh. A failure in one profile appears as a warning and does not remove the remaining profiles.

### 3. Use the Demo profile

Select **Orders / DLQ**. Demo supports inspection and requeue without external infrastructure. Its data is rebuilt when the application restarts; it is intended for learning the workflow, not for preserving operational evidence.

### 4. Change appearance

Open **Ajustes** (Settings) and choose **Sistema**, **Claro**, or **Oscuro**. System follows the Windows preference; the other choices fix the theme. The selection is retained in the renderer's local storage.

![Appearance settings with the Dark theme selected](assets/tutorials/appearance-01-settings-dark.png)

*Action:* select **Oscuro** (1) or use the quick theme action in the sidebar (2). *Expected result:* the UI changes without restarting and keeps the preference after reopening.

## Create a connection

### Prerequisites

- The workstation can reach the broker endpoint.
- Credentials have the permissions described in [Broker configuration](broker-configuration.md).
- For RabbitMQ, the Management Plugin is enabled and its HTTP API is reachable.
- The profile name identifies the environment and purpose, for example `Production payments`.

### 1. Open the form

Open **Conexiones** and select **Nueva conexión**.

![Connections view with the New connection action highlighted](assets/tutorials/connection-01-open-form.png)

*Action:* select **Nueva conexión** (1). *Expected result:* the **Conectar broker** dialog opens and focus moves to **Nombre del perfil**.

### 2. Select a broker

Choose **RabbitMQ**, **Azure Service Bus**, or **Kafka**. The form displays only the applicable fields:

| Broker | Required data |
| --- | --- |
| RabbitMQ | Host, AMQP port, virtual host, username, password, and optional TLS |
| Azure Service Bus | Connection string |
| Kafka | Bootstrap servers and Client ID |

For RabbitMQ, **Opciones avanzadas** lets you override the derived Management URL. Do not include a username or password in that URL.

### 3. Connect and discover resources

Complete the endpoint and credentials, then select **Conectar y buscar**. The operation has a 15-second timeout. While discovery is running, the form prevents duplicate requests.

![RabbitMQ form showing discovered queues and routing selectors](assets/tutorials/connection-02-discovered-queues.png)

*Action:* review the result (1), choose the source (2), and choose the target (3). *Expected result:* the list contains queues or topics visible to the credential, and **Guardar perfil** remains disabled until both selections are valid.

DLQCommander lists resources with messages or DLQ/DLT-like names first. It does not hide other resources. If exactly one suggested candidate exists, it is preselected as both source and target; change the target before saving when necessary.

### 4. Recover from failed discovery

If the endpoint, credentials, virtual host, or Management URL changes after discovery, previous results become stale. Select **Buscar nuevamente** to avoid saving selections obtained from a different connection.

When the credential cannot enumerate resources, the form offers **Reintentar** and **Ingresar manualmente**.

![Manual source and target entry after a permission error](assets/tutorials/connection-03-manual-fallback.png)

*Action:* select **Ingresar manualmente** (1), then enter the source (2) and target (3). *Expected result:* the profile can be saved without discovery, but the broker validates those names when **Probar** runs or the source is opened.

Manual entry does not bypass permissions required to inspect or requeue messages. It only avoids the administrative permission needed to enumerate resources.

### 5. Save and test

Keep **Solo lectura** enabled during initial validation and select **Guardar perfil**. Credentials are encrypted through the operating system before they are persisted.

In the connection list:

1. Locate the profile by name.
2. Select **Probar**.
3. Wait for a result notification with latency.
4. Open the Dashboard and confirm the expected source name and depth.

The current UI can test and delete profiles, but it cannot edit them. To correct an endpoint, credential, or routing choice, delete and recreate the profile.

## Inspect messages

### 1. Open a source

Select a row from the Dashboard. DLQCommander requests up to 250 messages and displays any broker-specific warning above the table.

![Inspector showing the filter, virtualized table, and message selection](assets/tutorials/inspect-01-message-list.png)

*Action:* use the filter (1), review failure cause and delivery attempts (2), and select a message (3). *Expected result:* the list filters by ID, cause, header, or payload without modifying the broker.

### 2. Review message details

Select a message row to open the details panel.

![Message details with Payload, Headers, and Metadata tabs](assets/tutorials/inspect-02-message-detail.png)

*Action:* switch between **Payload**, **Headers**, and **Metadata** (1). *Expected result:* the panel displays normalized content, broker properties, and the SHA-256 hash without losing the table selection.

**Payload** displays readable text or JSON. **Headers** displays application properties. **Metadata** includes the failure reason, description, delivery attempts, content type, timestamp, and `rawHash`. The hash supports evidence correlation without copying the body into another system.

### 3. Interpret depth and warnings

- RabbitMQ reports exact queue depth, but inspection uses receive-and-release and may change ordering.
- Kafka calculates depth from offsets; reading does not commit, and requeue does not reduce the DLT.
- Azure reports the exact counter with `Manage`; without it, the UI shows at least the observable sample size.
- Demo uses in-memory data and does not represent real durability.

## Perform a requeue

### Prerequisites

- The profile is not in **Solo lectura** mode.
- The source has a configured target.
- The operator understands the broker semantics and is authorized to modify messages.

### 1. Select messages

Select one or more messages. The header checkbox selects all messages currently visible after filtering.

![Inspector with one selected message and the Requeue action enabled](assets/tutorials/requeue-01-selection.png)

*Action:* select messages (1) and review the counter in **Requeue** (2). *Expected result:* the button shows exactly how many messages will be processed.

### 2. Review confirmation

Select **Requeue**. The dialog summarizes the source, target, profile, and maximum messages per second.

![Requeue confirmation showing source, target, and throttle](assets/tutorials/requeue-02-confirmation.png)

*Action:* verify the summary (1), adjust **Máximo por segundo** (2), and select **Confirmar requeue** or **Cancelar** (3). *Expected result:* cancelling creates no operation; confirming starts a job and records its status.

The throttle accepts values from `0.2` to `100` messages per second. Cancellation is cooperative: it stops the next pending message but does not revert messages already confirmed by the broker.

### 3. Check progress and audit history

The Inspector shows processed messages, total messages, and terminal status. When processing finishes, open **Auditoría**.

![Audit view showing a completed requeue operation](assets/tutorials/requeue-03-audit.png)

*Action:* compare requested, successful, failed, and status values (1). *Expected result:* a started entry and a terminal entry correlate the operation with its source and target.

A batch can finish with both successful and failed messages. Do not repeat the complete batch. Refresh the Inspector and select only messages that remain available.

## Keyboard navigation

- `Tab` and `Shift+Tab` move through navigation, forms, tables, and actions.
- `Enter` or `Space` opens a focused source on the Dashboard.
- Resource selectors support typing, arrow keys, `Enter`, and `Escape`.
- `Escape` closes message details, confirmation, or the connection form when no operation is pending.
- Visible focus identifies the active control, and status messages are announced through accessible live regions.

## Quick troubleshooting

| Symptom | Action |
| --- | --- |
| **Conectar y buscar** is disabled | Complete all required endpoint and credential fields. |
| Discovery selections disappear | Connection data changed; run **Buscar nuevamente**. |
| The profile saves but **Probar** fails | Review manually entered names and inspection permissions. |
| **Requeue** remains disabled | Verify the selection, target, and that the profile is not read-only. |
| Kafka keeps the record in the DLT | This is expected; confirm the copy in the target and audit history. |
| Azure depth appears too low | Use a credential with `Manage` to query runtime properties. |

For diagnosis and operational recovery, see the [Operations runbook](operations-runbook.md).
