# User guide

This guide explains how to connect a broker namespace, find resources, inspect dead-letter messages, and perform a controlled requeue. The application UI is currently in Spanish; literal screen and control names appear in **bold**.

All tutorial screenshots use the local Demo profile or Docker lab. They contain no external credentials.

## Before operating

DLQCommander can modify real messages. New profiles start in **Solo lectura** (Read only) mode. Before enabling operations:

1. Confirm the broker and namespace.
2. Confirm that the selected queue, topic, or subscription is the intended source.
3. Review the [broker semantics](broker-semantics.md).
4. Run **Probar** from **Conexiones**.
5. Verify the destination in the requeue confirmation.
6. Choose a throttle compatible with the receiving application.

## First walkthrough

### Open DLQCommander

Run `pnpm dev` or open the installed application. The first launch creates **Demo local**.

![Initial Dashboard showing navigation, metrics, and connected profiles](assets/tutorials/first-run-01-dashboard.png)

*Action:* identify navigation (1), connection metrics (2), and the connections table (3). *Expected result:* **Demo local** is available without external infrastructure.

The Dashboard lists connections rather than every broker resource. This keeps the first screen usable when a namespace contains hundreds of queues or topics.

### Explore the Demo namespace

Select **Demo local**. The resource explorer opens with its search field focused.

![Resource explorer filtering the Demo namespace](assets/tutorials/resource-explorer-01-search.png)

*Action:* type part of a resource name (1) and open a matching row (2). *Expected result:* filtering happens immediately without another broker request.

### Change appearance

Open **Ajustes** and choose **Sistema**, **Claro**, or **Oscuro**. The preference is retained locally.

![Appearance settings with the Dark theme selected](assets/tutorials/appearance-01-settings-dark.png)

*Action:* select **Oscuro** (1) or use the sidebar theme action (2). *Expected result:* the complete application changes theme without restarting.

## Create a connection

### Prerequisites

- The workstation can reach the broker endpoint.
- Credentials have the permissions listed in [Broker configuration](broker-configuration.md).
- RabbitMQ Management API is enabled and reachable for namespace exploration.
- The profile name identifies the environment and purpose.

### Open the form

Open **Conexiones** and select **Nueva conexión**.

![Connections view with the New connection action highlighted](assets/tutorials/connection-01-open-form.png)

*Action:* select **Nueva conexión** (1). *Expected result:* **Conectar broker** opens and focus moves to **Nombre del perfil**.

### Enter broker settings

Choose the broker and complete its fields:

| Broker | Required data |
| --- | --- |
| RabbitMQ | Host, AMQP port, virtual host, username, password, and optional TLS |
| Azure Service Bus | Namespace connection string |
| Kafka | Bootstrap servers and Client ID |

RabbitMQ **Opciones avanzadas** can override the derived Management URL. Credentials must never be included in that URL.

### Connect and search

Select **Conectar y buscar**. Discovery has a 15-second timeout and blocks duplicate requests.

![Connection form showing the searchable namespace preview](assets/tutorials/connection-02-discovered-queues.png)

*Action:* review the result count (1), search by name (2), and optionally select a resource to open after saving (3). *Expected result:* queues and topics visible to the credential appear in a virtualized list.

Saving a namespace does not require a source or destination. **Guardar y explorar** stores the endpoint and encrypted credential, then opens the resource explorer. A selected Azure topic opens its subscriptions; a selected inspectable resource opens its Inspector.

Search is case-insensitive and ranks exact names, prefixes, segment prefixes, and substrings. No network request is sent for each keystroke.

### Use manual fallback

If administrative discovery is unavailable, choose **Ingresar manualmente**.

![Manual fixed route after a discovery permission error](assets/tutorials/connection-03-manual-fallback.png)

*Action:* select manual mode (1), enter the source (2), and enter the destination (3). *Expected result:* **Guardar ruta fija** becomes available.

Manual mode creates a fixed-route profile. Azure manual mode supports a queue source or a topic/subscription source. Manual entry avoids enumeration permissions but does not bypass permissions required to inspect or requeue.

### Test a saved connection

Return to **Conexiones**, locate the profile, and select **Probar**. Namespace profiles validate broker connectivity and resource discovery. Legacy and manually created fixed profiles validate their configured source.

Profiles can be tested, explored, or deleted. Editing an existing profile is not currently available.

## Explore resources

### Search large namespaces

Open a connection from Dashboard or select **Explorar** under **Conexiones**. The root list is fetched once and cached for 60 seconds. Search operates on that local result.

- RabbitMQ displays queues.
- Kafka displays non-internal topics.
- Azure displays separate **Queues** and **Topics** tabs.
- Demo displays its built-in queues.

Resources containing messages or DLQ/DLT-like names appear first when the query is empty. The list remains virtualized, so large namespaces do not create one DOM element per resource.

### Open Azure subscriptions

Select the Azure **Topics** tab, search for a topic, and open it. DLQCommander lazily requests only that topic's subscriptions. The breadcrumb identifies the active topic, and the subscription search remains local after loading.

Azure topics are navigation containers and valid requeue destinations. Their subscriptions are inspectable DLQ sources and cannot be selected as destinations.

### Refresh

Select **Actualizar** to bypass the 60-second cache. Permission, network, empty, and stale states remain inside the explorer so navigation and theme controls stay available.

## Inspect messages

### Load and filter

Open an inspectable queue, Kafka topic, or Azure subscription. DLQCommander initially requests 100 messages.

![Inspector showing message search and selection](assets/tutorials/inspect-01-message-list.png)

*Action:* filter by ID, cause, header, or payload (1), review failure data (2), and select a message (3). *Expected result:* the status reports matches and loaded messages without modifying the broker.

When more messages exist, **Cargar 100 más** expands the inspected window. The maximum is 500 messages per inspection session. Search covers only loaded messages; DLQCommander never presents this as a complete broker-wide scan.

### Review details

Select a row to open the message panel.

![Message details with Payload, Headers, and Metadata tabs](assets/tutorials/inspect-02-message-detail.png)

*Action:* switch between **Payload**, **Headers**, and **Metadata** (1). *Expected result:* normalized content and the SHA-256 hash appear without losing table selection.

### Understand broker warnings

- RabbitMQ uses `basic.get` followed by `nack(requeue=true)` and can change ordering.
- Kafka reads without commits; requeue copies the record and leaves the DLT unchanged.
- Azure peeks the native queue or subscription dead-letter subqueue.
- Demo uses non-durable in-memory data.

## Perform a requeue

### Select messages

The profile must have operations enabled. Select one or more visible messages.

![Inspector with a selected message and Requeue enabled](assets/tutorials/requeue-01-selection.png)

*Action:* select messages (1) and review the count in **Requeue** (2). *Expected result:* only selected message IDs enter the operation.

### Choose a destination

Open **Requeue**. The confirmation loads valid destinations from the same connection:

- RabbitMQ queues;
- Kafka topics;
- Azure queues and topics.

![Requeue confirmation with searchable destination and throttle](assets/tutorials/requeue-02-confirmation.png)

*Action:* verify the summary (1), search and select a destination (2), adjust **Máximo por segundo** (3), then confirm or cancel (4). *Expected result:* confirmation stays disabled until a valid destination is available.

After at least one message succeeds, DLQCommander remembers the destination for that profile and source. The remembered value is preselected on the next operation and can be changed before confirmation.

### Monitor and audit

The Inspector reports job progress. On completion, open **Auditoría**.

![Audit view showing a completed requeue](assets/tutorials/requeue-03-audit.png)

*Action:* compare requested, successful, failed, source, destination, and status values (1). *Expected result:* started and terminal records identify the operation outcome.

## Keyboard navigation

- `Tab` and `Shift+Tab` move through navigation and commands.
- Resource search supports `Arrow Up`, `Arrow Down`, `Home`, `End`, and `Enter`.
- `Escape` clears a resource query before closing the surrounding dialog.
- `Enter` or `Space` opens a focused Dashboard connection.
- Visible focus identifies the active control, and status changes use accessible live regions.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| **Conectar y buscar** is disabled | Complete the required endpoint and credential fields. |
| Results become stale | Run **Buscar nuevamente** after changing connection data. |
| RabbitMQ cannot enumerate queues | Verify Management API access or use a fixed manual route. |
| An Azure topic cannot be inspected | Open the topic and choose one of its subscriptions. |
| Search does not find an old message | Load more messages; search only covers the current inspected window. |
| **Confirmar requeue** is disabled | Select a valid destination and verify that the profile is writable. |
| Kafka still contains the DLT record | This is expected append-only behavior. |

For incident procedures, see the [Operations runbook](operations-runbook.md).
