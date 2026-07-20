# ADR 002: Capacidades explícitas por broker

- Estado: aceptado
- Fecha: 2026-07-19

## Contexto

RabbitMQ, Azure Service Bus y Kafka no comparten inspección, borrado ni redrive equivalentes.

## Decisión

Cada adapter declara `BrokerCapabilities`. La UI decide disponibilidad y advertencias desde esas capacidades, no desde una supuesta cola universal.

## Alternativas consideradas

Una interfaz uniforme con métodos no soportados simplifica tipos, pero oculta diferencias peligrosas. Condicionales dispersos por nombre de broker producen drift.

## Consecuencias

Agregar un broker exige documentar semántica y capacidades antes de mostrar acciones. Algunas pantallas varían por broker de forma deliberada.

## Validación

Las pruebas unitarias verifican modos de inspección; la UI deshabilita operaciones no soportadas o perfiles read-only.
