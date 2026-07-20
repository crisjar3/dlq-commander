# Semántica por broker

DLQCommander presenta una experiencia común, pero no trata todos los brokers como una cola universal. Este documento define qué significa inspeccionar, medir profundidad y ejecutar requeue en cada adapter.

## Matriz de capacidades

| Capacidad | Demo | RabbitMQ | Kafka | Azure Service Bus |
| --- | --- | --- | --- | --- |
| Discovery automático | Datos integrados | Management API | Kafka Admin | Runtime properties |
| Inspección | Memoria local | `basic.get` + `nack` | Consumer efímero sin commit | `peekMessages` nativo |
| Profundidad | Exacta en memoria | `checkQueue` exacta | Suma de offsets `high - low` | Runtime properties con `Manage`; muestra como fallback |
| Requeue | Elimina del conjunto demo | Publish confirm + `ack` | Copia al topic destino | Send + complete |
| Original tras requeue | Eliminado | Confirmado en la DLQ | Permanece en la DLT | Completado |
| Selección masiva | Sí | Sí, secuencial | Sí, secuencial | Sí, secuencial |
| Editar payload | No | No | No | No |
| Purge | No | No | No | No |

## RabbitMQ

### Discovery

La Management HTTP API lista todas las colas visibles en el virtual host. DLQCommander usa `messages` como contador, prioriza nombres compatibles con DLQ/DLT o colas con mensajes y no oculta el resto. El puerto AMQP no sirve para este discovery; la API HTTP debe ser accesible por separado.

### Inspección

RabbitMQ no ofrece al adapter un navegador no destructivo de cola. El Inspector usa `basic.get(noAck=false)` y devuelve cada mensaje con `nack(requeue=true)`. La fuente conserva el mensaje, pero RabbitMQ puede cambiar su posición y marcarlo como redelivered.

No use inspecciones repetidas cuando el orden estricto sea una condición operativa.

### Requeue

El adapter busca el mensaje, retiene temporalmente los no seleccionados, publica el elegido en la cola destino y espera publisher confirms. Solo después hace `ack` del original. Si la publicación falla, el original no se confirma y vuelve a la DLQ.

El resultado reduce la fuente y agrega el mensaje al destino, sujeto a confirmaciones independientes del broker; no es una transacción distribuida.

## Apache Kafka

### Discovery

Kafka Admin lista topics y excluye nombres internos con prefijo `__`. El protocolo no devuelve un contador por topic durante esta operación, por lo que la lista muestra conteo desconocido. Los nombres DLQ/DLT se priorizan.

### Inspección

La DLT es un topic ordinario y append-only. El adapter crea un consumer group efímero, lee desde el inicio y desactiva commits automáticos. El ID visible combina `topic:partition:offset` y localiza un registro sin depender de su key.

La profundidad suma `high - low` en todas las particiones. Representa registros disponibles en el log, no lag de un consumer group de negocio.

### Requeue

Requeue reproduce key, value y headers en el topic destino. También agrega:

- `x-dlq-commander-source-topic`;
- `x-dlq-commander-source-partition`;
- `x-dlq-commander-source-offset`;
- `x-dlq-commander-requeued-at`.

El original no se borra ni se modifica. La profundidad de la DLT no disminuye. Para evitar duplicados, correlacione la auditoría con topic, partición y offset antes de repetir una operación.

Los perfiles actuales admiten PLAINTEXT; TLS y SASL no están expuestos en la UI.

## Azure Service Bus

### Discovery y profundidad

`ServiceBusAdministrationClient.listQueuesRuntimeProperties()` enumera colas y entrega `deadLetterMessageCount`. Requiere permiso `Manage`.

Después de guardar, el Dashboard intenta `getQueueRuntimeProperties`. Si la credencial no tiene `Manage`, conserva conectividad y muestra como profundidad el tamaño de una muestra obtenida con peek. Ese valor es un mínimo observable, no el total confirmado.

### Inspección

El adapter abre la subcola `deadLetter` y usa `peekMessages` desde el inicio. Peek no bloquea, completa ni retira mensajes.

### Requeue

El adapter recibe mensajes en peek-lock hasta localizar el ID seleccionado. Abandona los no seleccionados, envía el elegido a la cola destino y completa el original después del envío exitoso. Si no puede enviar o localizar el mensaje, no lo completa.

## Demo local

Demo simula tres fuentes en memoria. Su profundidad es exacta para la sesión. Inspeccionar no modifica datos y requeue elimina el mensaje seleccionado. Al reiniciar el proceso, el adapter vuelve a crear el conjunto inicial.

Demo valida el flujo de interfaz, auditoría y jobs, pero no demuestra conectividad, permisos ni garantías de un broker externo.

## Reglas comunes

- El perfil configura una fuente y un destino concretos.
- El Inspector solicita hasta 250 mensajes; el contrato admite un máximo de 500 por página.
- Requeue procesa la selección secuencialmente con throttle.
- Un lote con al menos un éxito puede terminar como completado y conservar un contador de fallos.
- Cerrar la aplicación no revierte publicaciones o completes ya confirmados.
- Los snapshots cifrados apoyan investigación local, pero no restauran automáticamente mensajes.
