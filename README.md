# DLQCommander

DLQCommander es una consola de escritorio para inspeccionar y reenviar mensajes desde dead-letter queues. El MVP implementa perfiles RabbitMQ, Apache Kafka y Azure Service Bus, además de un entorno demo integrado, filtros, selección masiva, throttle, cancelación, archivo cifrado y auditoría local.

## Estado actual

- Electron con `contextIsolation`, sandbox y renderer sin Node.
- Contrato IPC único validado con Zod en entrada y salida.
- SQLite local con migraciones, perfiles, auditoría y snapshots archivados.
- Credenciales y snapshots cifrados con `safeStorage` del sistema operativo.
- RabbitMQ: cola DLQ configurada manualmente, inspección `basic.get` + `nack`, requeue con publisher confirms y `ack` posterior.
- Kafka: topics DLT y destino configurados manualmente, inspección con consumer efímero sin commits y requeue como copia append-only al destino.
- Azure Service Bus: peek nativo de DLQ, conteo por runtime properties cuando la credencial tiene permiso `Manage`, requeue send + complete.
- JobRunner en memoria con throttle, progreso, cancelación cooperativa y resultados parciales.
- UI React con dashboard, conexiones, inspector virtualizado, detalle, confirmación y auditoría.

SQS, purge, editar-y-reenviar, auto-update y firma pertenecen a fases siguientes y no se presentan como implementados.

## Requisitos

- Node.js 22.
- npm 11 o compatible.
- Windows 10/11 para validar `safeStorage` y el instalador actual.
- Docker Desktop para el laboratorio RabbitMQ + Kafka.

## Arranque rápido

```powershell
npm install
npm run dev
```

La aplicación crea un perfil `Demo local` en el primer arranque. Ese perfil permite recorrer dashboard, inspector, requeue y auditoría sin credenciales externas.

## Laboratorio de brokers

Levantar RabbitMQ y Kafka, esperar sus healthchecks y cargar mensajes de ejemplo:

```powershell
npm run lab:up
npm run lab:seed
npm run dev
```

### RabbitMQ

| Campo | Valor |
| --- | --- |
| Host | `localhost` |
| Puerto | `5672` |
| Virtual host | `/` |
| Usuario | `dlqcommander` |
| Contraseña | `dlqcommander` |
| Cola DLQ | `orders.dlq` |
| Cola destino | `orders` |

Cadena AMQP exacta para pruebas automatizadas:

```text
amqp://dlqcommander:dlqcommander@localhost:5672/%2F
```

La consola de administración queda disponible en [http://localhost:15672](http://localhost:15672) con las mismas credenciales. Este usuario y contraseña son exclusivamente locales.

### Kafka

| Campo | Valor |
| --- | --- |
| Bootstrap servers | `localhost:9092` |
| Client ID | `dlq-commander` |
| Topic DLT | `orders.events.dlt` |
| Topic destino | `orders.events` |

Kafka se ejecuta en modo KRaft y publica un listener separado para el host. En este laboratorio la cadena de conexión es simplemente:

```text
localhost:9092
```

El requeue de Kafka publica una copia en `orders.events`; el registro original permanece en `orders.events.dlt` porque el log es append-only.

Para detener y eliminar los contenedores y volúmenes del laboratorio:

```powershell
npm run lab:down
```

## Validación

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:e2e
npm run test:e2e:brokers
npm run package
```

- `test:integration` prueba ambos adapters contra los contenedores reales y verifica la entrega en sus destinos.
- `test:e2e` abre Electron con el broker demo, valida el aislamiento del renderer y comprueba requeue + auditoría.
- `test:e2e:brokers` crea perfiles RabbitMQ/Kafka desde el renderer y recorre preload, IPC, persistencia, conexión y discovery reales.

Los comandos de integración requieren haber ejecutado `npm run lab:up` y `npm run lab:seed`.

## Datos locales

La base se guarda en `app.getPath('userData')/dlq-commander.db`. Los secretos no aparecen en respuestas IPC, logs ni tablas visibles. Eliminar el perfil elimina su secreto cifrado. Los snapshots previos al requeue se cifran a nivel de campo.

## Documentación

- [Modelo de seguridad](docs/security-model.md)
- [Semántica por broker](docs/broker-semantics.md)
- [Runbook operativo](docs/operations-runbook.md)
- [Matriz de pruebas](docs/testing-matrix.md)
- [Plan técnico detallado](DLQCommander-Plan-Tecnico-Detallado.md)
