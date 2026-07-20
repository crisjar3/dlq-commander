# Broker configuration

This document describes the fields, permissions, and checks required to create profiles. DLQCommander uses the configured credentials; it does not elevate permissions or create queues or topics.

The application UI is currently in Spanish. Literal field and action names are preserved in **bold**.

## Common workflow

1. Open **Conexiones** and select **Nueva conexión**.
2. Choose a name that identifies the environment and domain.
3. Select the broker and complete its endpoint and credentials.
4. Select **Conectar y buscar**.
5. Choose the source and target from the discovered resources.
6. Keep **Solo lectura** enabled during initial validation.
7. Save the profile and select **Probar**.

Discovery occurs before the profile is saved. Credentials remain in memory during that call and are persisted, encrypted, only after **Guardar perfil** is selected.

## RabbitMQ

### Fields

| Field | Description | Local example |
| --- | --- | --- |
| Host | Broker DNS name or IP address, without a protocol | `localhost` |
| AMQP port | Port used for inspection and requeue | `5672` |
| Virtual host | Scope containing the source and target | `/` |
| Username | RabbitMQ identity | `dlqcommander` |
| Password | Identity secret | Environment-specific value |
| TLS | Changes AMQP to AMQPS and updates the derived Management URL | Disabled in the lab |
| Management URL | Optional HTTP base URL used for discovery | `http://localhost:15672` |

DLQCommander derives `http://{host}:15672` without TLS and `https://{host}:15671` with TLS. Use **Opciones avanzadas** when the API is behind a proxy, uses another port, or has a different base URL. The URL must not contain credentials.

### Server requirements

- RabbitMQ Management Plugin enabled.
- Network access to both the AMQP and Management HTTP ports.
- Read permission on the DLQ for inspection.
- Write permission on the target for requeue.
- Access to `GET /api/queues/{vhost}` for discovery.

Discovery sends Basic Auth through the `Authorization` header. A user can have AMQP permissions without access to the Management API. In that case, use **Ingresar manualmente** and validate the profile with **Probar**.

### Expected behavior

The result includes every queue visible in the virtual host. DLQCommander displays the `messages` count, lists non-empty or DLQ/DLT-like queues first, and uses alphabetical order for the rest.

**Probar** opens AMQP, verifies that both source and target exist, and returns latency. During requeue, the application uses publisher confirms and acknowledges the original message only after a successful publish.

### Local lab

| Field | Value |
| --- | --- |
| Host | `localhost` |
| AMQP port | `5672` |
| Virtual host | `/` |
| Username | `dlqcommander` |
| Password | `dlqcommander` |
| Management URL | `http://localhost:15672` |
| Source | `orders.dlq` |
| Target | `orders` |

The equivalent connection URI is `amqp://dlqcommander:dlqcommander@localhost:5672/%2F`. These credentials belong exclusively to the lab defined in `docker-compose.yml`.

## Apache Kafka

### Fields

| Field | Description | Local example |
| --- | --- | --- |
| Bootstrap servers | Comma-separated brokers | `localhost:9092` |
| Client ID | Client identifier shown in broker logs | `dlq-commander` |
| DLT topic | Source to inspect | `orders.events.dlt` |
| Target topic | Topic that receives the copy | `orders.events` |

The current UI configures PLAINTEXT connections. It does not expose TLS, SASL, Schema Registry, or provider-specific authentication.

### Permissions

The identity or listener ACL must allow the client to:

- list topics for discovery;
- describe the DLT and query offsets for depth;
- read the DLT with ephemeral consumers;
- describe the target topic;
- produce to the target topic for requeue.

Names beginning with `__` are treated as internal and excluded from discovery. Kafka does not provide a message count during topic listing; after the profile is saved, depth is calculated from `high - low` offsets for every partition.

### Expected behavior

**Probar** confirms that both topics exist. The Inspector uses an ephemeral group ID, starts at the beginning, and does not commit offsets. Requeue publishes the key, value, and headers to the target, adds source topic, partition, and offset references, and keeps the original DLT record.

### Local lab

| Field | Value |
| --- | --- |
| Bootstrap servers | `localhost:9092` |
| Client ID | `dlq-commander` |
| Source | `orders.events.dlt` |
| Target | `orders.events` |

## Azure Service Bus

### Connection field

The form accepts a complete connection string in this format:

```text
Endpoint=sb://<namespace>.servicebus.windows.net/;SharedAccessKeyName=<policy>;SharedAccessKey=<secret>
```

Never write a real connection string to repository files, screenshots, logs, or shared commands. For opt-in automated tests, expose it only through `AZURE_SERVICE_BUS_CONNECTION_STRING` in the local shell session.

### Permissions

| Operation | Required permission |
| --- | --- |
| Discovery and exact count | `Manage` |
| `$DeadLetterQueue` inspection | `Listen` |
| Send to target | `Send` |
| Complete the original message | `Listen` |

A `Manage` policy usually includes Listen and Send. To reduce privileges, use narrower operational credentials and enter source and target names manually, but exact runtime-property counts are unavailable without `Manage`.

### Expected behavior

Discovery enumerates queues with `listQueuesRuntimeProperties()` and displays `deadLetterMessageCount`. The saved profile treats the selected queue as the source and opens its `$DeadLetterQueue` subqueue.

**Probar** peeks into the DLQ. Inspection does not lock, complete, or remove messages. Requeue receives the message in peek-lock mode, sends it to the target, and completes the original only after a successful send.

## Local Demo

The **Demo local** profile is created automatically when the database has no profiles. It contains:

- `Orders / DLQ`, target `orders`, with 28 initial messages;
- `Payments / DLQ`, target `payments`, with 11 initial messages;
- `Notifications / DLQ`, target `notifications`, with 5 initial messages.

Demo uses no network connection or credentials. Messages live in process memory and are rebuilt after restart. The profile cannot be deleted.

## Discovery troubleshooting

| Visible state | Meaning | Recovery |
| --- | --- | --- |
| **Permisos insuficientes** | The endpoint responded, but the identity cannot enumerate resources | Adjust permissions or use manual entry |
| **No fue posible completar la búsqueda** | Timeout, network, DNS, TLS, or service availability failure | Verify connectivity and retry |
| **No se encontraron recursos** | The request succeeded and returned an empty list | Confirm the scope, virtual host, or namespace |
| **La conexión cambió** | A connection-sensitive field changed after discovery | Select **Buscar nuevamente** |
| Management API not found | The RabbitMQ URL returned 404 | Correct the Management URL or use manual entry |

The application sanitizes errors before displaying them. Passwords, connection strings, and authorization headers are never included in error messages.
