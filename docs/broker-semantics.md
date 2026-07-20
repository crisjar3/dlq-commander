# Broker semantics

DLQCommander provides a shared user experience, but it does not treat every broker as a universal queue. This document defines what inspection, depth, and requeue mean for each adapter.

## Capability matrix

| Capability | Demo | RabbitMQ | Kafka | Azure Service Bus |
| --- | --- | --- | --- | --- |
| Automatic discovery | Built-in data | Management API | Kafka Admin | Runtime properties |
| Inspection | In-memory | `basic.get` + `nack` | Ephemeral consumer without commits | Native `peekMessages` |
| Depth | Exact in memory | Exact `checkQueue` value | Sum of `high - low` offsets | Runtime properties with `Manage`; sample fallback |
| Requeue | Removes from Demo | Confirmed publish + `ack` | Copies to target topic | Send + complete |
| Original after requeue | Removed | Acknowledged in the DLQ | Remains in the DLT | Completed |
| Bulk selection | Yes | Yes, sequential | Yes, sequential | Yes, sequential |
| Payload editing | No | No | No | No |
| Purge | No | No | No | No |

## RabbitMQ

### Discovery

The Management HTTP API lists every queue visible in the virtual host in pages of 50. DLQCommander normalizes total, ready, and unacknowledged counts and uses natural alphabetical order when no search is active. The AMQP port cannot provide this discovery; the HTTP API must be reachable separately.

### Inspection

RabbitMQ does not provide this adapter with a non-destructive queue browser. The Inspector calls `basic.get(noAck=false)` and returns every message with `nack(requeue=true)`. The message remains in the source, but RabbitMQ can change its position and mark it as redelivered.

Avoid repeated inspections when strict ordering is an operational requirement.

### Requeue

The adapter locates the message, temporarily holds unselected messages, publishes the selected message to the target queue, and waits for publisher confirms. Only then does it acknowledge the original. If publishing fails, the original is not acknowledged and returns to the DLQ.

The result reduces the source and adds the message to the target, subject to independent broker confirmations. This is not a distributed transaction.

## Apache Kafka

### Discovery

Kafka Admin lists topics once per 60-second catalog cache and excludes internal names beginning with `__`. The protocol does not return a per-topic message count during this operation, so discovery displays an unknown count. DLQCommander serves the cached result in alphabetic pages of 50.

### Inspection

A DLT is an ordinary append-only topic. The adapter creates an ephemeral consumer group, reads from the beginning, and disables automatic commits. The visible ID combines `topic:partition:offset`, locating a record without relying on its business key.

Depth is the sum of `high - low` across every partition. It represents records available in the log, not the lag of a business consumer group.

### Requeue

Requeue reproduces the key, value, and headers in the target topic. It also adds:

- `x-dlq-commander-source-topic`;
- `x-dlq-commander-source-partition`;
- `x-dlq-commander-source-offset`;
- `x-dlq-commander-requeued-at`.

The original is neither deleted nor modified. DLT depth does not decrease. Before repeating an operation, correlate audit history with the topic, partition, and offset to avoid duplicate copies.

Current profiles support PLAINTEXT; TLS and SASL are not exposed in the UI.

## Azure Service Bus

### Discovery and depth

`ServiceBusAdministrationClient` enumerates queue and topic runtime properties concurrently at the namespace root through continuation-token pages. Opening a topic lazily enumerates its subscription runtime properties with a separate page cache. Queue and subscription rows use `deadLetterMessageCount` and expose available total and active metrics. These administration calls require `Manage` permission.

Queue sources open the queue `$DeadLetterQueue`; subscription sources open the subscription `$DeadLetterQueue` with both topic and subscription names. Azure topics have no directly inspectable DLQ in this model and are used as subscription containers or destinations.

### Inspection

The adapter opens the `deadLetter` subqueue and calls `peekMessages` from the beginning. Peek does not lock, complete, or remove messages.

### Requeue

The adapter receives messages in peek-lock mode until it finds the selected ID. It abandons unselected messages, sends the selected message to the target queue, and completes the original after a successful send. If it cannot send or locate the message, it does not complete it.

## Local Demo

Demo simulates three sources in memory. Its depth is exact for the current session. Inspection does not modify data, and requeue removes the selected message. Restarting the process recreates the initial data set.

Demo validates UI, audit, and job workflows. It does not prove external broker connectivity, permissions, or delivery guarantees.

## Common rules

- A profile configures one specific source and one target.
- The Inspector requests 100 messages initially and expands the cumulative window by 100, up to 500 messages per session.
- Requeue processes selected messages sequentially with throttling.
- A batch with at least one success can finish as completed while retaining a nonzero failure count.
- Closing the application does not revert already confirmed publishes or completes.
- Encrypted snapshots support local investigation but cannot automatically restore messages.
