# Modelo de seguridad

## Objetivo y alcance

DLQCommander protege credenciales y snapshots locales mientras separa la interfaz de las operaciones privilegiadas. Este modelo cubre perfiles RabbitMQ, Apache Kafka, Azure Service Bus y Demo local.

La aplicación actúa con los permisos de las credenciales configuradas. No sustituye los controles de acceso del broker ni implementa autorización interna por usuario.

## Límites de confianza

| Componente | Responsabilidad | Acceso permitido |
| --- | --- | --- |
| Renderer | Presentación, filtros y captura de intención | API limitada de preload |
| Preload | Validar y transportar mensajes IPC | `contextBridge` e `ipcRenderer` por canales definidos |
| Main | Brokers, SQLite, cifrado, jobs y auditoría | Node, Electron y SDKs |
| Broker externo | Fuente y destino de mensajes | Solo mediante su adapter |

La ventana usa `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` y `webSecurity: true`. La sesión bloquea solicitudes de permisos, ventanas nuevas y navegación no controlada. El renderer no puede usar `require`, `process` ni acceder directamente al sistema de archivos.

## Contrato IPC

`src/shared/ipc-contract.ts` enumera cada método, canal, entrada y salida. Preload valida antes de enviar; main vuelve a validar antes de ejecutar y valida la respuesta. Los handlers convierten fallos conocidos en errores con código, mensaje sanitizado y señal de recuperación.

No existe un canal IPC genérico expuesto a la UI. Agregar una capacidad privilegiada requiere incorporarla al contrato y a sus schemas Zod.

## Credenciales

Las credenciales entran por el formulario y cruzan IPC durante discovery o guardado. Discovery las mantiene en memoria y no crea un perfil. Al guardar, `SecretVault` cifra el JSON mediante `safeStorage.encryptString` antes de escribir SQLite.

Los perfiles que vuelven al renderer contienen configuración no secreta, pero nunca `encrypted_secret` ni el secreto descifrado. Si el sistema operativo informa que el cifrado no está disponible, guardar credenciales o archivar snapshots falla cerrado.

La aplicación no escribe connection strings, contraseñas, Basic Auth ni URLs autenticadas en auditoría. Los scripts de documentación usan únicamente credenciales del Compose local.

## Datos locales

La base se ubica en `app.getPath('userData')/dlq-commander.db`. SQLite usa WAL, por lo que durante la ejecución pueden existir archivos `-wal` y `-shm` junto a la base.

| Dato | Protección | Exposición en UI |
| --- | --- | --- |
| Configuración no secreta del perfil | SQLite local | Sí |
| Credenciales | Campo cifrado con `safeStorage` | No |
| Auditoría | SQLite local, sin payload | Sí |
| Snapshot previo al requeue | Campo cifrado con `safeStorage` | No |
| Hash SHA-256 del body | SQLite local | Metadata del mensaje |
| Preferencia de tema | `localStorage` del renderer | Sí, en Ajustes |

Los snapshots son evidencia forense local, no un backup transaccional del broker. Copiar la base a otro equipo no garantiza poder descifrarla porque `safeStorage` depende de la cuenta y del mecanismo del sistema operativo.

## Controles operativos

- Los perfiles nuevos empiezan en **Solo lectura**.
- Requeue exige selección, destino y confirmación explícita.
- El operador define un throttle entre `0.2` y `100` mensajes por segundo.
- Solo se permite un job activo por perfil y fuente.
- El JobRunner intenta cifrar un snapshot antes de modificar cada mensaje.
- Cada inicio y estado terminal se registra en auditoría.
- Los errores parciales conservan contadores de éxito y fallo.

## Garantía de requeue por broker

- RabbitMQ espera publisher confirms antes de hacer `ack` del original.
- Kafka espera la publicación en el topic destino; el registro original permanece en la DLT.
- Azure envía al destino antes de `completeMessage`.
- Demo elimina el mensaje del conjunto en memoria después de una operación exitosa.

Estas secuencias reducen la posibilidad de pérdida por fallo del envío, pero no proporcionan una transacción distribuida entre origen y destino.

## Riesgos residuales

- RabbitMQ no tiene peek nativo para esta implementación; `basic.get` y `nack(requeue=true)` pueden alterar orden y estado de redelivery.
- Kafka relee con consumers efímeros sin commits y puede recorrer el topic hasta el límite solicitado.
- Sin `Manage`, Azure no puede consultar el contador exacto y usa el tamaño de la muestra observada.
- Un host o una sesión de usuario comprometidos pueden acceder a datos mientras la aplicación los descifra para operar.
- `safeStorage` protege datos en reposo, no reemplaza permisos del sistema operativo, cifrado de disco ni políticas de sesión.
- No hay RBAC interno: toda persona con acceso a la sesión puede usar los perfiles allí guardados.
- La distribución actual no está firmada digitalmente ni tiene actualización automática.
- Los jobs viven en memoria; cerrar la aplicación interrumpe el procesamiento pendiente sin revertir mensajes ya confirmados.

## Recomendaciones de operación

1. Use identidades separadas por ambiente y privilegio mínimo.
2. Mantenga perfiles en solo lectura salvo durante una ventana autorizada.
3. No reutilice connection strings de administración para operación cotidiana si una policy más limitada cubre el caso.
4. Proteja el perfil de Windows y habilite cifrado de disco según la política de la organización.
5. Revise auditoría y destino después de cada lote.
6. Rote de inmediato cualquier credencial compartida por chat, ticket, captura o log.

Consulte [Runbook operativo](operations-runbook.md) para preparación y recuperación, y [Arquitectura](architecture.md) para el flujo de cifrado e IPC.
