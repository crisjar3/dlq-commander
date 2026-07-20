# DLQCommander

DLQCommander es una consola de escritorio para inspeccionar y reenviar mensajes de dead-letter queues (DLQ) y dead-letter topics (DLT). Centraliza operaciones sobre RabbitMQ, Apache Kafka y Azure Service Bus sin exponer credenciales al renderer ni exigir una plataforma web con acceso a redes privadas.

La aplicación está dirigida a operadores SRE, equipos de plataforma y desarrolladores que necesitan diagnosticar mensajes fallidos, revisar su contenido y ejecutar requeue con confirmación, límite de velocidad y auditoría local.

## Características

- Dashboard con profundidad, antigüedad y estado de las fuentes configuradas.
- Descubrimiento automático de colas y topics antes de guardar una conexión.
- Entrada manual cuando el broker no permite discovery o RabbitMQ Management API no está disponible.
- Inspector con búsqueda, selección masiva y vistas de Payload, Headers y Metadata.
- Requeue con confirmación explícita, throttle, progreso y resultado por lote.
- Auditoría local de operaciones y snapshots cifrados previos al requeue.
- Perfiles en solo lectura por defecto.
- Temas Sistema, Claro y Oscuro con preferencia persistida localmente.
- Perfil Demo local para recorrer la interfaz sin infraestructura externa.

## Brokers compatibles

| Broker | Discovery | Inspección | Requeue |
| --- | --- | --- | --- |
| RabbitMQ | Management HTTP API | `basic.get` seguido de `nack(requeue=true)` | Publicación confirmada y `ack` del original |
| Apache Kafka | KafkaJS Admin | Consumer efímero sin commits | Copia append-only al topic destino |
| Azure Service Bus | Runtime properties | `peekMessages` sobre `$DeadLetterQueue` | Envío al destino y `completeMessage` |
| Demo local | Datos integrados | Memoria local | Elimina el mensaje del conjunto demo |

Las diferencias operativas importan: en Kafka el registro original permanece en la DLT después del requeue. Consulte [Semántica por broker](docs/broker-semantics.md) antes de operar una fuente real.

## Requisitos

- Windows 10 u 11.
- Node.js `22.x`.
- pnpm `11.9.0`.
- Docker Desktop para el laboratorio RabbitMQ y Kafka.

El proyecto declara las versiones esperadas en `package.json`. No use npm para instalar dependencias, ya que `pnpm-lock.yaml` es la fuente reproducible del árbol de paquetes.

## Inicio rápido

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

El primer arranque crea el perfil **Demo local** con tres fuentes y mensajes de ejemplo. Desde el Dashboard puede abrir **Orders / DLQ**, inspeccionar mensajes, ejecutar un requeue y revisar el resultado en **Auditoría**.

Para conocer cada pantalla y operación, siga la [Guía de usuario](docs/user-guide.md).

## Laboratorio local

El laboratorio levanta RabbitMQ con Management Plugin y Kafka en modo KRaft, crea las fuentes esperadas y carga mensajes de prueba:

```powershell
pnpm lab:up
pnpm lab:seed
pnpm dev
```

RabbitMQ queda disponible en `localhost:5672` y su Management API en `http://localhost:15672`. Kafka publica el listener `localhost:9092`. Las credenciales, colas y topics del laboratorio se documentan en [Configuración de brokers](docs/broker-configuration.md).

Para detener el laboratorio:

```powershell
pnpm lab:down
```

## Compilación y distribución

```powershell
pnpm build
pnpm package
pnpm dist
```

- `build` valida tipos y genera `out/main`, `out/preload` y `out/renderer`.
- `package` crea una aplicación desempaquetada en `release/win-unpacked`.
- `dist` genera el instalador NSIS en `release`.

La distribución actual no está firmada digitalmente. Consulte [Desarrollo, pruebas y distribución](docs/development.md) para el flujo completo y los artefactos de cada comando.

## Documentación

- [Índice oficial](docs/README.md)
- [Guía de usuario y tutoriales visuales](docs/user-guide.md)
- [Configuración de brokers y permisos](docs/broker-configuration.md)
- [Arquitectura](docs/architecture.md)
- [Modelo de seguridad](docs/security-model.md)
- [Runbook operativo](docs/operations-runbook.md)
- [Matriz de pruebas](docs/testing-matrix.md)
- [Decisiones de arquitectura](docs/adr/001-electron-typescript.md)

## Limitaciones actuales

- Los perfiles guardados se prueban o eliminan; para cambiar su configuración se deben recrear.
- No existe purge ni edición de payload antes del requeue.
- Los perfiles Kafka admiten PLAINTEXT; no exponen TLS ni SASL en la interfaz.
- Amazon SQS no está implementado.
- No hay actualización automática ni firma de código.

## Licencia

[MIT](LICENSE)
