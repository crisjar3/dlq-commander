# ADR 004: Seguridad local y modo conservador

- Estado: aceptado
- Fecha: 2026-07-19

## Contexto

La herramienta maneja credenciales y payloads que pueden ser sensibles, además de ejecutar operaciones irreversibles sobre brokers.

## Decisión

Usar `safeStorage`, SQLite local, sandbox, perfiles read-only por defecto, confirmación explícita y snapshots cifrados antes de requeue. Si el cifrado no está disponible, se rechaza guardar secretos o archivar operaciones.

## Alternativas consideradas

Guardar credenciales en texto plano o variables locales reduce implementación pero no es aceptable. Una bóveda remota puede agregarse después para entornos administrados.

## Consecuencias

Los datos cifrados dependen de la cuenta y mecanismos del sistema operativo. Copiar solo la base a otro equipo no garantiza recuperación de secretos.

## Validación

El E2E comprueba que `require` y `process` no existen en renderer. Unit tests comprueban que el vault falla cerrado sin cifrado.
