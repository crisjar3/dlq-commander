# Configuración de brokers

Este documento describe los campos, permisos y comprobaciones necesarias para crear perfiles. DLQCommander usa las credenciales configuradas; no eleva permisos ni crea colas o topics.

## Flujo común

1. Abra **Conexiones** y seleccione **Nueva conexión**.
2. Asigne un nombre que identifique ambiente y dominio.
3. Seleccione el broker y complete endpoint y credenciales.
4. Pulse **Conectar y buscar**.
5. Seleccione fuente y destino entre los recursos descubiertos.
6. Mantenga **Solo lectura** durante la validación inicial.
7. Guarde el perfil y pulse **Probar**.

El discovery ocurre antes de guardar. Las credenciales permanecen en memoria durante esa llamada y solo se persisten, cifradas, después de pulsar **Guardar perfil**.

## RabbitMQ

### Campos

| Campo | Descripción | Ejemplo local |
| --- | --- | --- |
| Host | Nombre DNS o IP del broker, sin protocolo | `localhost` |
| Puerto AMQP | Puerto para inspección y requeue | `5672` |
| Virtual host | Ámbito que contiene origen y destino | `/` |
| Usuario | Identidad RabbitMQ | `dlqcommander` |
| Contraseña | Secreto de la identidad | Valor del entorno |
| TLS | Cambia AMQP a AMQPS y la URL de Management derivada | Desactivado en el laboratorio |
| Management URL | Base HTTP opcional para discovery | `http://localhost:15672` |

DLQCommander deriva `http://{host}:15672` sin TLS y `https://{host}:15671` con TLS. Use **Opciones avanzadas** cuando la API esté detrás de un proxy, use otro puerto o tenga una base URL distinta. La URL no puede contener credenciales.

### Requisitos del servidor

- RabbitMQ Management Plugin habilitado.
- Acceso de red al puerto AMQP y al puerto HTTP de Management API.
- Permiso de lectura sobre la DLQ para inspección.
- Permiso de escritura sobre el destino para requeue.
- Acceso a `GET /api/queues/{vhost}` para discovery.

El discovery usa Basic Auth en el header `Authorization`. Un usuario puede operar AMQP y aun no tener acceso a la Management API; en ese caso use **Ingresar manualmente** y valide el perfil con **Probar**.

### Comportamiento esperado

La lista incluye todas las colas visibles en el virtual host. DLQCommander muestra el contador `messages`, prioriza colas con mensajes o nombres DLQ/DLT y conserva orden alfabético para el resto.

**Probar** abre AMQP, verifica que fuente y destino existan y devuelve la latencia. Durante requeue, la aplicación publica con publisher confirms y solo confirma el mensaje original después del publish exitoso.

### Laboratorio local

| Campo | Valor |
| --- | --- |
| Host | `localhost` |
| Puerto AMQP | `5672` |
| Virtual host | `/` |
| Usuario | `dlqcommander` |
| Contraseña | `dlqcommander` |
| Management URL | `http://localhost:15672` |
| Fuente | `orders.dlq` |
| Destino | `orders` |

La cadena equivalente es `amqp://dlqcommander:dlqcommander@localhost:5672/%2F`. Estas credenciales pertenecen exclusivamente al laboratorio definido en `docker-compose.yml`.

## Apache Kafka

### Campos

| Campo | Descripción | Ejemplo local |
| --- | --- | --- |
| Bootstrap servers | Brokers separados por coma | `localhost:9092` |
| Client ID | Identificador del cliente en logs del broker | `dlq-commander` |
| Topic DLT | Fuente que se inspeccionará | `orders.events.dlt` |
| Topic destino | Topic que recibirá la copia | `orders.events` |

La interfaz actual configura conexiones PLAINTEXT. No expone TLS, SASL, Schema Registry ni autenticación específica de proveedores administrados.

### Permisos

La identidad o ACL del listener debe permitir:

- listar topics para discovery;
- describir la DLT y consultar offsets para profundidad;
- leer la DLT mediante consumers efímeros;
- describir el topic destino;
- producir en el topic destino para requeue.

Los nombres con prefijo `__` se consideran internos y no aparecen en discovery. Kafka no aporta un contador de mensajes durante la búsqueda; la profundidad se calcula después de guardar el perfil mediante offsets `high - low` por partición.

### Comportamiento esperado

**Probar** confirma que los dos topics existen. El Inspector usa un group ID efímero, comienza desde el inicio y no hace commit. Requeue publica `key`, `value` y headers al destino, añade referencias de topic, partición y offset, y conserva el registro original en la DLT.

### Laboratorio local

| Campo | Valor |
| --- | --- |
| Bootstrap servers | `localhost:9092` |
| Client ID | `dlq-commander` |
| Fuente | `orders.events.dlt` |
| Destino | `orders.events` |

## Azure Service Bus

### Campo de conexión

El formulario recibe una connection string completa con este formato:

```text
Endpoint=sb://<namespace>.servicebus.windows.net/;SharedAccessKeyName=<policy>;SharedAccessKey=<secret>
```

No escriba una connection string real en archivos del repositorio, capturas, logs o comandos compartidos. Para pruebas automatizadas opt-in, expóngala únicamente en la variable `AZURE_SERVICE_BUS_CONNECTION_STRING` de la sesión local.

### Permisos

| Operación | Permiso requerido |
| --- | --- |
| Discovery y contador exacto | `Manage` |
| Inspección de `$DeadLetterQueue` | `Listen` |
| Envío al destino | `Send` |
| Completar el mensaje original | `Listen` |

Una policy `Manage` suele incluir Listen y Send. Para reducir privilegios, se pueden usar credenciales operativas más limitadas y escribir fuente/destino manualmente, pero el contador exacto no estará disponible sin acceso a runtime properties.

### Comportamiento esperado

Discovery enumera colas con `listQueuesRuntimeProperties()` y muestra `deadLetterMessageCount`. El perfil trata la cola elegida como origen y abre su subcola `$DeadLetterQueue`.

**Probar** ejecuta un peek sobre la DLQ. La inspección no bloquea ni completa mensajes. Requeue recibe el mensaje en peek-lock, lo envía al destino y completa el original solo después del envío exitoso.

## Demo local

El perfil **Demo local** se crea automáticamente cuando la base no contiene perfiles. Incluye:

- `Orders / DLQ`, destino `orders`, 28 mensajes iniciales;
- `Payments / DLQ`, destino `payments`, 11 mensajes iniciales;
- `Notifications / DLQ`, destino `notifications`, 5 mensajes iniciales.

No usa red ni credenciales. Los mensajes viven en memoria del proceso y se reconstruyen al reiniciar. El perfil no puede eliminarse.

## Diagnóstico de discovery

| Estado visible | Significado | Recuperación |
| --- | --- | --- |
| **Permisos insuficientes** | El endpoint respondió, pero la identidad no puede enumerar recursos | Ajuste permisos o use entrada manual |
| **No fue posible completar la búsqueda** | Timeout, red, DNS, TLS o servicio no disponible | Verifique conectividad y reintente |
| **No se encontraron recursos** | La consulta fue válida y devolvió una lista vacía | Confirme ámbito, virtual host o namespace |
| **La conexión cambió** | Un campo sensible cambió después del discovery | Pulse **Buscar nuevamente** |
| Management API no encontrada | La URL RabbitMQ respondió 404 | Corrija Management URL o use entrada manual |

La aplicación sanitiza errores antes de mostrarlos. Contraseñas, connection strings y headers de autorización no forman parte de los mensajes de error.
