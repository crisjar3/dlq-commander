# Runbook operativo

Este runbook describe una operación controlada de inspección y requeue. Aplíquelo junto con los procedimientos de cambio, segregación de funciones y respuesta a incidentes de su organización.

## Preparar una fuente

1. Cree el perfil en **Conexiones** con **Solo lectura** activo.
2. Use discovery para seleccionar origen y destino; si usa entrada manual, verifique los nombres en la consola del broker.
3. Guarde el perfil y pulse **Probar**.
4. Abra el Dashboard y confirme broker, fuente, profundidad y estado.
5. Inspeccione una muestra y revise advertencias específicas del broker.
6. Para habilitar requeue, elimine y recree el perfil con **Solo lectura** desactivado después de obtener la autorización correspondiente.
7. Vuelva a pulsar **Probar** y confirme el destino antes de operar.

La UI actual no edita perfiles guardados. Recrear el perfil es la única forma visible de cambiar credenciales, enrutamiento o modo de operación.

## Inspeccionar

1. Abra la fuente desde el Dashboard.
2. Lea la advertencia de semántica del broker.
3. Filtre por Message ID, causa, header o contenido.
4. Abra el mensaje y revise Payload, Headers y Metadata.
5. Use `rawHash` para correlacionar evidencia cuando el body no deba salir de la aplicación.
6. Actualice antes del requeue si otra herramienta o consumidor puede modificar la fuente.

En RabbitMQ, limitar las inspecciones reduce alteraciones de orden. En Kafka, recuerde que la tabla representa registros del log y no mensajes consumibles de un group específico.

## Ejecutar requeue

1. Seleccione explícitamente los mensajes autorizados.
2. Pulse **Requeue** y compruebe origen, destino, perfil y cantidad.
3. Configure **Máximo por segundo** según la capacidad del consumidor y el límite de la ventana de cambio.
4. Pulse **Confirmar requeue**.
5. Mantenga la aplicación abierta mientras el job está en curso.
6. Espere un estado terminal y anote exitosos y fallidos.
7. Abra **Auditoría** y verifique las entradas de inicio y resultado.
8. Compruebe el destino mediante observabilidad o herramientas autorizadas del broker.

Pulse **Cancelar** en la confirmación para abandonar antes de iniciar. La interfaz actual no muestra un control para cancelar un job ya iniciado. El servicio implementa cancelación cooperativa, pero cerrar la aplicación no constituye una recuperación segura y no revierte mensajes confirmados.

## Interpretar el resultado

| Estado | Significado | Acción |
| --- | --- | --- |
| Completado, sin fallos | Todos los mensajes fueron confirmados según la semántica del adapter | Verificar destino y cerrar la ventana de cambio |
| Completado, con fallos | Al menos uno tuvo éxito y al menos uno falló | Actualizar y reprocesar solo los que permanezcan |
| Fallido | Ningún mensaje se confirmó o falló la preparación del lote | Revisar último error, permisos y disponibilidad |
| Cancelado | El servicio detuvo el siguiente elemento pendiente | Reconciliar procesados antes de decidir otro lote |

En Kafka, completado significa que existe una copia confirmada en destino. El registro original seguirá visible en la DLT. Use los headers de origen y auditoría para evitar repetirlo.

## Recuperación después de una interrupción

1. No repita automáticamente la selección original.
2. Reabra DLQCommander y actualice la fuente.
3. Revise Auditoría para obtener job, solicitados, exitosos y fallidos registrados.
4. Verifique el destino con el identificador nativo, hash o headers de correlación.
5. Seleccione únicamente mensajes cuya entrega no esté confirmada.
6. Registre cualquier reconciliación externa en el sistema de incidentes de la organización.

Los snapshots cifrados permanecen en SQLite para análisis local, pero la aplicación no ofrece restauración automática ni una vista para exportarlos.

## Incidentes comunes

| Síntoma | Comprobación | Acción |
| --- | --- | --- |
| Requeue está bloqueado | El perfil muestra **Solo lectura** | Recrear el perfil sin esa opción después de autorización |
| Mensaje ya no disponible | Otro actor lo movió o completó | Actualizar, revisar auditoría y reconciliar destino |
| RabbitMQ cambia el orden | Aparece advertencia receive-and-release | Detener inspecciones repetidas y coordinar con consumidores |
| Kafka conserva la DLT | Comportamiento append-only esperado | Confirmar copia y correlacionar topic, partición y offset |
| Azure muestra profundidad baja | Credencial sin `Manage` | Usar una policy con runtime properties o validar en Azure Portal |
| Discovery RabbitMQ falla | Management API inaccesible o sin permisos | Corregir URL/permisos o ingresar nombres manualmente |
| Estado local indica **Sin cifrado** | `safeStorage` no está disponible | Corregir sesión/keychain; no operar con secretos o snapshots sin cifrar |
| Job queda interrumpido al cerrar | El proceso ya no conserva estado activo | Reconciliar auditoría, fuente y destino antes de reintentar |

## Cierre de la operación

Considere la operación cerrada cuando:

- el job tiene estado terminal;
- los contadores coinciden con la selección y los fallos fueron reconciliados;
- el destino contiene los mensajes esperados;
- la semántica del origen coincide con el broker;
- Auditoría contiene el registro terminal;
- el perfil operativo se elimina o se recrea en solo lectura cuando la ventana termina.
