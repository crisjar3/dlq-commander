# Operations runbook

This runbook describes a controlled inspection and requeue operation. Apply it together with your organization's change-management, separation-of-duties, and incident-response procedures.

The application UI is currently in Spanish. Literal screen and action names are preserved in **bold**.

## Prepare a source

1. Create the profile under **Conexiones** with **Solo lectura** enabled.
2. Use discovery to choose the source and target. If you use manual entry, verify both names in the broker console.
3. Save the profile and select **Probar**.
4. Open the Dashboard and confirm broker, source, depth, and status.
5. Inspect a sample and review broker-specific warnings.
6. To enable requeue, delete and recreate the profile with **Solo lectura** disabled after obtaining authorization.
7. Run **Probar** again and confirm the target before operating.

The current UI cannot edit saved profiles. Recreating a profile is the only visible way to change credentials, routing, or operation mode.

## Inspect

1. Open the source from the Dashboard.
2. Read the broker-semantics warning.
3. Filter by Message ID, cause, header, or content.
4. Open a message and review Payload, Headers, and Metadata.
5. Use `rawHash` to correlate evidence when the body must not leave the application.
6. Refresh before requeue when another tool or consumer can modify the source.

For RabbitMQ, limiting inspection reduces ordering changes. For Kafka, remember that the table represents log records, not consumable messages for a specific group.

## Perform requeue

1. Explicitly select the authorized messages.
2. Select **Requeue** and verify the source, target, profile, and count.
3. Set **Máximo por segundo** according to consumer capacity and the change-window limit.
4. Select **Confirmar requeue**.
5. Keep the application open while the job is running.
6. Wait for a terminal state and record successful and failed counts.
7. Open **Auditoría** and verify the start and result entries.
8. Verify the target through authorized broker tooling or observability.

Select **Cancelar** in the confirmation dialog to stop before the job begins. The current UI does not expose a control for cancelling a running job. The service implements cooperative cancellation, but closing the application is not a safe recovery action and does not revert confirmed messages.

## Interpret results

| State | Meaning | Action |
| --- | --- | --- |
| Completed with no failures | Every message was confirmed according to adapter semantics | Verify the target and close the change window |
| Completed with failures | At least one message succeeded and at least one failed | Refresh and reprocess only messages that remain |
| Failed | No messages were confirmed or batch preparation failed | Review the last error, permissions, and availability |
| Cancelled | The service stopped before the next pending item | Reconcile processed messages before starting another batch |

For Kafka, completed means that a confirmed copy exists in the target. The original record remains in the DLT. Use source headers and audit history to avoid repeating it.

## Recover after interruption

1. Do not automatically repeat the original selection.
2. Reopen DLQCommander and refresh the source.
3. Review Audit for the job ID and its requested, successful, and failed counts.
4. Verify the target using the native identifier, hash, or correlation headers.
5. Select only messages whose delivery is not confirmed.
6. Record any external reconciliation in your organization's incident system.

Encrypted snapshots remain in SQLite for local analysis, but the application provides no automatic restore or snapshot export view.

## Common incidents

| Symptom | Check | Action |
| --- | --- | --- |
| Requeue is blocked | The profile shows **Solo lectura** | Recreate the profile without that option after authorization |
| Message is no longer available | Another actor moved or completed it | Refresh, review Audit, and reconcile the target |
| RabbitMQ ordering changes | A receive-and-release warning appears | Stop repeated inspection and coordinate with consumers |
| Kafka keeps the DLT record | Expected append-only behavior | Confirm the copy and correlate topic, partition, and offset |
| Azure depth appears too low | Credential lacks `Manage` | Use a policy with runtime-property access or validate in Azure Portal |
| RabbitMQ discovery fails | Management API is unreachable or forbidden | Correct URL/permissions or enter names manually |
| Local status shows **Sin cifrado** | `safeStorage` is unavailable | Fix the session or keychain; do not operate without encrypted secrets and snapshots |
| Job is interrupted on close | The process no longer retains active state | Reconcile audit history, source, and target before retrying |

## Close the operation

Consider the operation complete when:

- the job has a terminal state;
- counters match the selection and failures have been reconciled;
- the target contains the expected messages;
- source behavior matches the broker semantics;
- Audit contains the terminal record;
- the write-enabled profile is deleted or recreated as read-only when the change window ends.
