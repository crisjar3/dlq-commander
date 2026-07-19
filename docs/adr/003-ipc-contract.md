# ADR 003: Contrato IPC validado

- Estado: aceptado
- Fecha: 2026-07-19

## Contexto

IPC es la frontera de privilegios entre una UI no confiable y operaciones con credenciales o mensajes productivos.

## Decisión

`src/shared/ipc-contract.ts` es la fuente única para canales, input y output. Main y preload validan con Zod. Renderer no importa Electron.

## Alternativas consideradas

Canales string manuales son pequeños al inicio, pero no detectan drift ni payloads inválidos. Generar una API HTTP local aumenta superficie de red sin aportar valor al MVP.

## Consecuencias

Cada cambio de contrato puede romper compilación o validación inmediatamente. Zod se empaqueta dentro del preload porque el sandbox no puede resolver dependencias arbitrarias.

## Validación

Typecheck, tests de schemas y E2E de aislamiento deben pasar. ESLint prohíbe imports de Electron y Node en renderer.
