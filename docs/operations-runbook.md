# Runbook operativo

## Preparación

1. Abrir Conexiones y crear el perfil.
2. Mantener `Solo lectura` activo durante la primera verificación.
3. Guardar y usar `Probar` para validar credenciales y fuente.
4. Abrir Dashboard y confirmar que la fuente y profundidad esperadas aparecen.
5. Habilitar operaciones únicamente cuando el perfil, DLQ y destino hayan sido revisados.

## Inspeccionar

1. Abrir la fuente desde Dashboard.
2. Revisar la advertencia de semántica del broker.
3. Filtrar por message ID, causa, header o contenido.
4. Abrir un mensaje y revisar Payload, Headers y Metadata.
5. Correlacionar con `rawHash` cuando el body no deba copiarse fuera de la aplicación.

## Ejecutar requeue

1. Seleccionar mensajes explícitamente.
2. Presionar Requeue y comprobar origen, destino y cantidad.
3. Configurar el máximo por segundo según capacidad del consumidor.
4. Confirmar la operación.
5. Esperar estado terminal: completado, fallido o cancelado.
6. Abrir Auditoría y comprobar solicitados, exitosos y fallidos.

Un resultado parcial se presenta como completado con contador de fallos. Revisar el último error y procesar nuevamente solo los mensajes que permanezcan en la DLQ.

En Kafka, un resultado exitoso significa que se publicó una copia en el topic destino. El registro original seguirá visible en la DLT; use la auditoría y los headers de origen para evitar repetir accidentalmente la misma operación.

## Cancelar y recuperar

La cancelación detiene el siguiente mensaje del lote; no revierte los ya reenviados. Los snapshots cifrados quedan en SQLite para análisis, pero el MVP no ofrece restauración automática. La recuperación operativa consiste en identificar el mensaje por hash/auditoría y reenviarlo mediante las herramientas autorizadas del broker.

## Incidentes comunes

| Síntoma | Comprobación | Acción |
| --- | --- | --- |
| Perfil bloquea requeue | Etiqueta `Solo lectura` | Editar/recrear perfil con operaciones habilitadas tras aprobación |
| Mensaje ya no disponible | Otro consumidor u operador lo movió | Actualizar inspector y reconciliar auditoría |
| RabbitMQ cambia orden | Advertencia de inspección | Evitar inspecciones repetidas en colas sensibles al orden |
| Kafka conserva el registro DLT | Semántica append-only esperada | Verificar el registro copiado en destino y correlacionar por topic, partición y offset |
| Azure muestra profundidad baja | Credencial sin `Manage` | Usar credencial con runtime-properties o validar en Azure Portal |
| Cifrado no disponible | Estado local indica `Sin cifrado` | Corregir keychain/DPAPI; no se permite operar con snapshots sin cifrar |
