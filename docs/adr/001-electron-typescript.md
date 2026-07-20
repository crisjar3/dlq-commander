# ADR 001: Electron y TypeScript

- Estado: aceptado
- Fecha: 2026-07-19

## Contexto

La aplicación necesita una UI de escritorio, acceso a SDKs de brokers, almacenamiento local, cifrado ligado al sistema operativo y distribución instalable.

## Decisión

Usar Electron, React y TypeScript estricto. El proceso main posee las capacidades privilegiadas; preload expone un contrato mínimo y renderer se limita a UI.

## Alternativas consideradas

Tauri reduce tamaño, pero añade un segundo lenguaje y wrappers para SDKs JavaScript. Una aplicación web exige un backend adicional para secretos y conectividad privada. Para el alcance actual, ambas alternativas aumentan componentes y responsabilidades operativas.

## Consecuencias

El instalador es más pesado y los módulos nativos deben reconstruirse por versión de Electron. A cambio, todos los SDKs y el dominio comparten TypeScript.

## Validación

`pnpm build`, `pnpm test:e2e` y `pnpm package` deben pasar en Windows.
