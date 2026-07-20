# Semántica por broker

## Matriz del MVP

| Capacidad | Demo | RabbitMQ | Kafka | Azure Service Bus |
| --- | --- | --- | --- | --- |
| Discovery automático | Sí | Sí, Management API | Sí, Kafka Admin | Sí, runtime properties |
| Inspección | Memoria local | `basic.get` + `nack` | Consumer efímero sin commit | `peekMessages` nativo |
| Profundidad | Exacta | `checkQueue` exacta | Diferencia entre offsets high/low | Runtime properties con `Manage`; muestra mínima como fallback |
| Requeue | Elimina del demo | Publish confirm + ack | Copia al topic destino | Send + complete |
| Original tras requeue | Eliminado | Confirmado con `ack` | Permanece en DLT | Completado |
| Selección masiva | Sí | Sí, secuencial | Sí, secuencial | Sí, secuencial |
| Edición | No | No en MVP | No en MVP | No en MVP |
| Purge | No | No en MVP | No | No en MVP |

## RabbitMQ

RabbitMQ no ofrece un navegador de cola no destructivo. El inspector toma mensajes con `basic.get(noAck=false)` y los devuelve con `nack(requeue=true)`. La UI muestra esta advertencia porque la operación puede cambiar el orden y marcar redelivery.

Para requeue, el adapter retiene temporalmente mensajes no seleccionados, publica el elegido en la cola destino, espera publisher confirms y solo entonces hace `ack` del original. Un fallo de publish conserva el original en la DLQ.

El perfil conserva una DLQ y un destino. Durante su creación, la Management API lista todas las colas del vhost; los nombres DLQ/DLT y las colas con mensajes se priorizan sin ocultar el resto. Si la API no está disponible, la UI permite entrada manual.

## Kafka

Kafka modela una DLT como un topic ordinario y append-only. Durante la creación del perfil, Kafka Admin lista los topics, omite los internos con prefijo `__` y prioriza nombres DLQ/DLT. El perfil guarda `bootstrapServers`, `clientId`, `dltTopic` y `targetTopic`.

El inspector crea un consumer group efímero y único, lee desde el inicio y desactiva commits automáticos. El identificador visible combina `topic:partition:offset`, de modo que cada registro queda localizado sin depender de una clave de negocio. El depth se calcula como la suma de `high - low` para todas las particiones.

El requeue reproduce `key`, `value` y headers en el topic destino y agrega headers con topic, partición y offset de origen. Publicar con éxito no elimina ni modifica el registro DLT. Por ello la UI lo describe como una copia y la auditoría registra la operación sin afirmar que el origen disminuyó.

El laboratorio usa PLAINTEXT local. SASL, TLS, Schema Registry, transacciones y compactación no forman parte del perfil actual.

## Azure Service Bus

El inspector usa `peekMessages` sobre la subqueue `deadLetter`. Para requeue, el adapter recibe mensajes en peek-lock, abandona los no seleccionados, envía el seleccionado y completa el original después de un envío exitoso.

El conteo exacto usa `ServiceBusAdministrationClient.getQueueRuntimeProperties`, que requiere permiso `Manage`. Con credenciales listen/send, la app conserva conectividad y muestra como profundidad únicamente el tamaño de la muestra observada.

## Brokers futuros

SQS redrive nativo mueve mensajes sin permitir editar el payload; un redrive manual requiere send exitoso antes de delete. Esa diferencia deberá expresarse mediante capabilities antes de implementar UI.
