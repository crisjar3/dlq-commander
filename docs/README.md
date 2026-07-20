# Documentación de DLQCommander

Este directorio contiene la documentación pública del comportamiento actual de DLQCommander. Elija la ruta según su objetivo.

## Usuarios y operadores

| Necesidad | Documento |
| --- | --- |
| Conocer la interfaz y completar un primer recorrido | [Guía de usuario](user-guide.md) |
| Crear conexiones y asignar permisos mínimos | [Configuración de brokers](broker-configuration.md) |
| Ejecutar requeue y responder a incidentes | [Runbook operativo](operations-runbook.md) |
| Entender qué cambia en cada broker | [Semántica por broker](broker-semantics.md) |
| Conocer protección de credenciales y datos locales | [Modelo de seguridad](security-model.md) |

## Desarrollo y mantenimiento

| Necesidad | Documento |
| --- | --- |
| Instalar, ejecutar, probar y empaquetar | [Desarrollo, pruebas y distribución](development.md) |
| Comprender procesos, IPC, persistencia y flujos | [Arquitectura](architecture.md) |
| Consultar cobertura y criterios de aprobación | [Matriz de pruebas](testing-matrix.md) |
| Revisar decisiones técnicas aceptadas | [Decisiones de arquitectura](adr/001-electron-typescript.md) |

## Recorridos recomendados

**Primera evaluación:** [Guía de usuario](user-guide.md#primer-recorrido) → [Configuración de brokers](broker-configuration.md) → [Semántica por broker](broker-semantics.md).

**Preparación operativa:** [Modelo de seguridad](security-model.md) → [Runbook operativo](operations-runbook.md) → [Matriz de pruebas](testing-matrix.md).

**Contribución técnica:** [Arquitectura](architecture.md) → [Desarrollo](development.md) → [ADRs](adr/001-electron-typescript.md).

## Convenciones

- Los nombres de botones y pantallas se muestran en **negrita** y coinciden con la interfaz en español.
- Los comandos se ejecutan desde la raíz del repositorio con PowerShell, salvo que se indique lo contrario.
- DLQ identifica una dead-letter queue; DLT identifica un dead-letter topic.
- Una fuente es la cola o topic que DLQCommander inspecciona. El destino recibe los mensajes reenviados.
