# ADR 005: SQLite incluido en el runtime

- Estado: aceptado
- Fecha: 2026-07-19

## Contexto

La evaluación inicial usó `better-sqlite3`, pero sus binarios dependen del ABI exacto de Electron. Al actualizar Electron por avisos de seguridad, el addon exigió Python y compiladores locales, haciendo que una instalación limpia dejara de ser reproducible.

## Decisión

Usar `DatabaseSync` de `node:sqlite`, disponible en el runtime Node incluido por Electron 43. Los repositorios mantienen SQL preparado, WAL, foreign keys y migraciones explícitas.

## Alternativas consideradas

Instalar Python y Visual Studio Build Tools aumenta requisitos globales. Mantener una versión vulnerable de Electron no es aceptable. Un motor WASM evita addons, pero añade persistencia y flushing más complejos en main.

## Consecuencias

La aplicación requiere una versión de Electron cuyo runtime incluya `node:sqlite`. Se elimina el addon nativo, la reconstrucción por ABI y el unpack específico de ASAR. Los repositorios son la frontera de persistencia; Drizzle no forma parte de la implementación actual.

## Validación

Una instalación limpia, tests de repositorio, E2E y el smoke test de `release/win-unpacked` deben pasar con Electron 43.
