# ADR 002: Explicit broker capabilities

- Status: accepted
- Date: 2026-07-19

## Context

RabbitMQ, Azure Service Bus, and Kafka do not provide equivalent inspection, deletion, or redrive semantics.

## Decision

Every adapter declares `BrokerCapabilities`. The UI determines action availability and warnings from those capabilities rather than assuming one universal queue model.

## Alternatives considered

A uniform interface with unsupported methods simplifies types but hides operationally dangerous differences. Broker-name conditionals spread across the UI produce behavior drift.

## Consequences

Every broker adapter must document semantics and capabilities before exposing actions. Some UI behavior deliberately varies by broker.

## Validation

Unit tests verify inspection modes. The UI disables unsupported actions and write operations on read-only profiles.
