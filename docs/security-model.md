# Modelo de seguridad

## Objetivo y alcance

Este documento describe los límites de confianza del MVP de DLQCommander. Aplica a perfiles RabbitMQ, Apache Kafka, Azure Service Bus y al entorno demo local.

## Límites de confianza

| Componente | Responsabilidad | Acceso permitido |
| --- | --- | --- |
| Renderer | Presentación, filtros y captura de intención | API tipada de preload |
| Preload | Validar y transportar mensajes IPC | `contextBridge`, `ipcRenderer` |
| Main | Brokers, SQLite, cifrado, jobs y auditoría | Node, Electron y SDKs |
| Broker externo | Fuente y destino de mensajes | Solo mediante su adapter |

La ventana usa `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` y una CSP local. Las solicitudes de permisos, ventanas nuevas y navegación no controlada se bloquean.

## Credenciales

Las credenciales entran una vez por el formulario, cruzan IPC para guardarse y nunca regresan al renderer. `safeStorage` cifra el JSON de secretos antes de SQLite. Si el sistema operativo informa que el cifrado no está disponible, el guardado falla cerrado.

No se escriben connection strings, contraseñas ni URLs con autenticación en auditoría. Los errores conocidos se sanitizan antes de volver al renderer.

## Mensajes archivados

Antes de un requeue, el JobRunner intenta obtener el snapshot normalizado del mensaje y lo cifra con el mismo proveedor. La tabla almacena identificadores, hash SHA-256 y snapshot cifrado. El hash permite correlación sin exponer el body.

El archivo es una ayuda forense local, no un backup transaccional del broker. Si el mensaje cambió entre peek y operación, la semántica final pertenece al adapter.

## Operaciones

- Los perfiles nuevos son read-only por defecto.
- Requeue requiere selección, destino, confirmación y throttle.
- RabbitMQ confirma publish antes de `ack` en la DLQ.
- Kafka confirma el publish en el topic destino; el registro original permanece en la DLT.
- Azure envía al destino antes de `completeMessage`.
- La cancelación es cooperativa: no revierte mensajes ya confirmados.
- Cada inicio y resultado se registra en auditoría.

## Riesgos residuales

- RabbitMQ no tiene peek nativo; inspeccionar usa `basic.get` seguido de `nack(requeue=true)` y puede alterar el orden.
- Kafka usa consumers efímeros sin commits para inspección. Cada consulta puede releer el topic completo hasta el límite solicitado y no equivale a un borrado o movimiento del registro.
- Un host comprometido puede leer datos mientras la aplicación los descifra para operar.
- `safeStorage` protege datos en reposo, no sustituye control de acceso del sistema operativo.
- El MVP no implementa RBAC interno; actúa con los permisos de las credenciales configuradas.
- La distribución actual no está firmada digitalmente.
