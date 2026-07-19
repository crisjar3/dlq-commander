# Matriz de pruebas

## Comandos

| Capa | Comando | Criterio de aprobación |
| --- | --- | --- |
| Tipos | `pnpm typecheck` | Main, preload, shared y renderer compilan en strict |
| Lint | `pnpm lint` | Sin errores; renderer no importa Node/Electron |
| Unitarias | `pnpm test` | Schemas, capabilities, vault y adapters aislados pasan |
| Integración | `pnpm test:integration` | RabbitMQ y Kafka conectan, inspeccionan y entregan al destino real |
| E2E demo | `pnpm test:e2e` | Electron abre, renderer aislado, requeue y auditoría pasan |
| E2E brokers | `pnpm test:e2e:brokers` | La UI guarda perfiles y main conecta con ambos brokers reales |
| Build | `pnpm build` | Artefactos main/preload/renderer se generan |
| Packaging | `pnpm package` | Directorio instalable se construye con el runtime SQLite incluido en Electron |

Las pruebas externas requieren primero `pnpm lab:up` y `pnpm lab:seed`. Cada test genera identificadores únicos para no depender del orden ni del contenido previamente cargado.

## Integración RabbitMQ local

Cadena utilizada: `amqp://dlqcommander:dlqcommander@localhost:5672/%2F`.

1. Publicar un mensaje identificado de forma única en `orders.dlq`.
2. Probar la conexión y obtener el source mediante `RabbitMqAdapter`.
3. Inspeccionar hasta encontrar el identificador sin hacer `ack` del mensaje.
4. Ejecutar requeue y esperar publisher confirm antes del `ack` del original.
5. Consumir `orders` y comprobar que body y headers corresponden al fixture.
6. Aprobar solo si el mensaje aparece en destino y no hay excepción del canal AMQP.

El recorrido E2E adicional guarda el perfil desde React, cifra el secreto mediante `safeStorage`, cruza preload/IPC y verifica que el source real tenga profundidad mayor a cero.

## Integración Kafka local

Bootstrap utilizado: `localhost:9092`; DLT `orders.events.dlt`; destino `orders.events`.

1. Publicar un registro con key e identificador únicos en el topic DLT.
2. Probar conectividad y existencia de ambos topics mediante el admin client.
3. Calcular depth desde offsets y consumir con un group ID efímero sin commits.
4. Localizar el registro por `topic:partition:offset` y publicar una copia al destino.
5. Consumir el destino con otro group ID único y validar value, key y headers.
6. Volver a medir la DLT y aprobar solo si el depth no disminuyó, confirmando la semántica append-only.

El recorrido E2E crea el perfil Kafka desde la UI y verifica discovery a través del proceso principal real de Electron.

## Integración Azure

Requiere un namespace de desarrollo y una cola con DLQ. La credencial de prueba debe documentar si tiene `Listen`, `Send` y `Manage`.

1. Dead-letter un mensaje conocido.
2. Verificar que peek no reduce la profundidad.
3. Reenviar el mensaje y confirmar aparición en destino.
4. Simular fallo de send y confirmar que el mensaje permanece en DLQ.
5. Repetir sin `Manage` para comprobar el fallback de profundidad.

Estas pruebas de Azure no se ejecutan automáticamente porque requieren credenciales externas. Nunca usar producción como fixture automatizado.

## Packaging smoke test

Instalar o abrir el directorio generado en `release/win-unpacked`, recorrer el demo y cerrar/reabrir la aplicación. Confirmar que la base persiste y que el preload funciona fuera del dev server.
