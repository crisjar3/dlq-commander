# DLQCommander documentation

This directory contains the public documentation for DLQCommander's current behavior. Choose a path based on your role and objective.

## Users and operators

| Need | Document |
| --- | --- |
| Learn the interface and complete a first walkthrough | [User guide](user-guide.md) |
| Create connections and assign minimum permissions | [Broker configuration](broker-configuration.md) |
| Perform requeue operations and respond to incidents | [Operations runbook](operations-runbook.md) |
| Understand how behavior differs by broker | [Broker semantics](broker-semantics.md) |
| Understand credential protection and local data | [Security model](security-model.md) |

## Development and maintenance

| Need | Document |
| --- | --- |
| Install, run, test, and package the application | [Development, testing, and distribution](development.md) |
| Understand processes, IPC, persistence, and workflows | [Architecture](architecture.md) |
| Review coverage and acceptance criteria | [Testing matrix](testing-matrix.md) |
| Review accepted technical decisions | [Architecture decisions](adr/001-electron-typescript.md) |

## Recommended reading paths

**First evaluation:** [User guide](user-guide.md#first-walkthrough) → [Broker configuration](broker-configuration.md) → [Broker semantics](broker-semantics.md).

**Operational readiness:** [Security model](security-model.md) → [Operations runbook](operations-runbook.md) → [Testing matrix](testing-matrix.md).

**Technical contribution:** [Architecture](architecture.md) → [Development](development.md) → [ADRs](adr/001-electron-typescript.md).

## Conventions

- Button and screen names shown in **bold** match the current Spanish-language UI.
- Commands are run from the repository root in PowerShell unless stated otherwise.
- DLQ means dead-letter queue; DLT means dead-letter topic.
- A source is the queue or topic inspected by DLQCommander. The target receives requeued messages.
