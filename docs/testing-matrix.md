# Matriz de pruebas

La estrategia combina reglas aisladas, adapters contra brokers reales y recorridos de la aplicación Electron. Ninguna capa reemplaza a las demás: unit tests validan decisiones; integración valida protocolos; E2E valida fronteras y UI.

## Suites y criterios

| Capa | Comando | Criterio de aprobación |
| --- | --- | --- |
| Documentación | `pnpm docs:check` | Enlaces y recursos locales existen; imágenes tienen alt text; no hay referencias a archivos privados |
| Tipos | `pnpm typecheck` | Main, preload, shared y renderer cumplen TypeScript strict |
| Lint | `pnpm lint` | No hay errores ni warnings; renderer respeta límites de imports |
| Unitarias | `pnpm test` | Schemas, discovery, vault, jobs, persistencia y adapters aislados pasan |
| Integración | `pnpm test:integration` | RabbitMQ y Kafka conectan, inspeccionan y entregan al destino; Azure discovery corre solo con variable local |
| E2E Demo | `pnpm test:e2e` | Electron abre, renderer está aislado, temas persisten y requeue queda auditado |
| E2E brokers | `pnpm test:e2e:brokers` | Electron descubre recursos, guarda perfiles y prueba RabbitMQ/Kafka reales |
| Build | `pnpm build` | Se generan main, preload y renderer bajo `out` |
| Packaging | `pnpm package` | Se crea `release/win-unpacked` con el runtime requerido |

## Preparar integración

```powershell
pnpm lab:up
pnpm lab:seed
docker compose ps
```

RabbitMQ y Kafka deben aparecer saludables. Cada ejecución de seed agrega datos, por lo que las pruebas usan identificadores únicos y no dependen de una profundidad exacta.

## RabbitMQ real

Conexión de laboratorio: `amqp://dlqcommander:dlqcommander@localhost:5672/%2F`.

La suite de integración:

1. publica un mensaje identificado de forma única en `orders.dlq`;
2. prueba la conexión y obtiene la fuente mediante `RabbitMqAdapter`;
3. inspecciona hasta localizar el mensaje sin hacer `ack`;
4. ejecuta requeue y espera publisher confirm antes del `ack` original;
5. consume `orders` y compara body y headers;
6. aprueba cuando el mensaje aparece en destino sin excepción AMQP.

La suite de discovery verifica que Management API devuelve `orders` y `orders.dlq`. El E2E adicional completa el formulario React, descubre colas, invalida resultados cuando cambia el vhost, guarda un perfil cifrado y ejecuta **Probar**.

## Kafka real

Bootstrap: `localhost:9092`; DLT: `orders.events.dlt`; destino: `orders.events`.

La suite de integración:

1. publica un registro con key e identificador únicos en la DLT;
2. confirma topics y conectividad con Kafka Admin;
3. calcula profundidad desde offsets;
4. inspecciona con un group ID efímero sin commits;
5. copia el registro al destino preservando key, value y headers;
6. consume el destino con otro group ID único;
7. comprueba que la profundidad de la DLT no disminuyó.

La suite de discovery verifica que aparecen `orders.events` y `orders.events.dlt` y que no aparecen topics internos. El E2E guarda y prueba un perfil Kafka a través del IPC real de Electron.

## Azure Service Bus

Las unitarias simulan peek, runtime properties, envío, complete y fallo de envío. La integración externa automatizada cubre discovery únicamente.

Para habilitarla:

```powershell
$env:AZURE_SERVICE_BUS_CONNECTION_STRING = '<connection-string-de-desarrollo>'
pnpm test:integration
Remove-Item Env:AZURE_SERVICE_BUS_CONNECTION_STRING
```

La prueba se omite cuando la variable no existe. Cuando existe, debe enumerar al menos una cola sin escribir la credencial en archivos, snapshots o salida de error.

La validación manual de inspección y requeue requiere un namespace de desarrollo:

1. crear una cola origen y una cola destino;
2. mover un mensaje conocido a `$DeadLetterQueue`;
3. confirmar que peek no reduce la profundidad;
4. reenviar y comprobar aparición en destino;
5. provocar un fallo de send y comprobar que el original no se completa;
6. repetir sin `Manage` para verificar el fallback de profundidad.

No use producción como fixture automatizado.

## E2E con Demo

Cada test crea un directorio `userData` temporal y arranca la aplicación compilada. La suite confirma:

- Dashboard y fuentes Demo visibles;
- ausencia de `require` y `process` en renderer;
- persistencia de temas Claro, Oscuro y Sistema;
- selección de un mensaje, confirmación de requeue y progreso terminal;
- entrada completada en Auditoría.

El directorio temporal se elimina al cerrar Electron.

## E2E con brokers

La suite mantiene una instancia Electron para el conjunto de escenarios y usa un `userData` temporal. Valida:

- discovery RabbitMQ y Kafka por IPC;
- guardado, prueba y listado de fuentes reales;
- creación RabbitMQ desde la UI con selectores descubiertos;
- estado obsoleto cuando cambia la conexión;
- fallback manual ante credenciales RabbitMQ inválidas.

## Smoke test de packaging

Después de `pnpm package`:

1. abra `release/win-unpacked/DLQCommander.exe`;
2. confirme que Dashboard muestra Demo;
3. abra un mensaje y cambie el tema;
4. cierre y vuelva a abrir;
5. confirme persistencia de base, tema y funcionamiento de preload;
6. verifique que no aparece una consola ni una navegación externa.

## Evidencia de cierre

Antes de publicar, conserve en la descripción del cambio:

- versiones de Node y pnpm;
- comandos ejecutados y resultado;
- estado de Docker para suites reales;
- confirmación de `git diff --check`;
- confirmación de que no se versionaron credenciales ni bases locales;
- cualquier suite omitida y su motivo.
