# Desarrollo, pruebas y distribución

Esta guía permite preparar un entorno limpio, ejecutar DLQCommander, validar brokers y producir artefactos de Windows usando únicamente comandos versionados en el repositorio.

## Requisitos

| Herramienta | Versión o condición | Uso |
| --- | --- | --- |
| Windows | 10 u 11 | Ejecución, `safeStorage` y packaging actual |
| Node.js | `22.x` | Toolchain y runtime de scripts |
| pnpm | `11.9.0` | Instalación reproducible y scripts |
| Docker Desktop | Compose v2 | Laboratorio RabbitMQ y Kafka |
| Git | Versión vigente | Flujo de contribución |

Compruebe versiones:

```powershell
node --version
pnpm --version
docker compose version
```

## Instalación

```powershell
git clone https://github.com/crisjar3/dlq-commander.git
cd dlq-commander
pnpm install --frozen-lockfile
```

`--frozen-lockfile` falla si `package.json` y `pnpm-lock.yaml` no coinciden. Este comportamiento evita resolver versiones diferentes en desarrollo y CI.

## Desarrollo local

```powershell
pnpm dev
```

Electron Vite compila main y preload, levanta el servidor del renderer y abre la ventana. Los cambios del renderer se actualizan durante desarrollo. Cierre la ventana o interrumpa el proceso para terminar la sesión.

Para recorrer la UI sin brokers, use **Demo local**. Para trabajar con adapters reales, prepare el laboratorio antes de abrir la aplicación.

## Laboratorio Docker

```powershell
pnpm lab:up
pnpm lab:seed
```

`lab:up` ejecuta `docker compose up -d --wait`. El Compose contiene:

- RabbitMQ `4.1-management` en `5672` y `15672`, con definiciones precargadas;
- Kafka `3.9.1` en KRaft, listener de host `9092`;
- un contenedor de inicialización que crea `orders.events` y `orders.events.dlt`.

`lab:seed` publica 20 mensajes en `orders.dlq` y 20 registros en `orders.events.dlt`. Ejecutarlo de nuevo agrega fixtures; no limpia contenido anterior.

Compruebe el estado:

```powershell
docker compose ps
```

Detenga y elimine los contenedores:

```powershell
pnpm lab:down
```

El Compose no declara volúmenes persistentes de datos para los brokers. La configuración local completa se encuentra en [Configuración de brokers](broker-configuration.md).

## Comandos del proyecto

| Comando | Responsabilidad | Artefacto o resultado |
| --- | --- | --- |
| `pnpm dev` | Ejecutar Electron en modo desarrollo | Ventana interactiva y proceso en terminal |
| `pnpm typecheck` | Validar TypeScript de Node y renderer | Sin archivos emitidos |
| `pnpm lint` | Ejecutar ESLint sin warnings permitidos | Reporte en terminal |
| `pnpm test` | Ejecutar unit tests con Vitest | Resultado de schemas, servicios, adapters y persistencia |
| `pnpm test:integration` | Probar RabbitMQ/Kafka reales y Azure opt-in | Resultado en terminal |
| `pnpm test:e2e` | Compilar y recorrer Electron con Demo | Trazas bajo `test-results` cuando falla |
| `pnpm test:e2e:brokers` | Recorrer discovery y perfiles contra Docker | Trazas bajo `test-results` cuando falla |
| `pnpm build` | Validar tipos y compilar los tres procesos | `out/main`, `out/preload`, `out/renderer` |
| `pnpm package` | Construir aplicación desempaquetada | `release/win-unpacked` |
| `pnpm dist` | Crear distribución NSIS | Instalador y metadatos bajo `release` |
| `pnpm docs:capture` | Compilar y regenerar capturas tutoriales | `docs/assets/tutorials/*.png` |
| `pnpm docs:check` | Validar enlaces, imágenes y referencias públicas | Reporte en terminal |

`out`, `release`, `test-results` y reportes de Playwright están ignorados por Git. Las capturas de documentación sí se versionan.

## Orden de validación

Para una validación completa:

```powershell
pnpm install --frozen-lockfile
pnpm lab:up
pnpm lab:seed
pnpm docs:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:brokers
pnpm package
```

`test:integration` y `test:e2e:brokers` requieren el laboratorio saludable. El resto no depende de Docker.

### Azure opt-in

La integración de Azure ejecuta discovery únicamente cuando la sesión define una connection string:

```powershell
$env:AZURE_SERVICE_BUS_CONNECTION_STRING = '<connection-string-de-desarrollo>'
pnpm test:integration
Remove-Item Env:AZURE_SERVICE_BUS_CONNECTION_STRING
```

Use un namespace de desarrollo. La suite no escribe el valor en archivos ni snapshots. La inspección y el requeue de Azure se validan mediante unit tests aislados; el recorrido real con mensajes debe ejecutarse siguiendo la sección Azure de [Matriz de pruebas](testing-matrix.md).

## Capturas de tutorial

Las capturas se producen desde la aplicación compilada, con un directorio `userData` temporal y datos del laboratorio local:

```powershell
pnpm lab:up
pnpm lab:seed
pnpm docs:capture
```

El script fija la ventana en `1440x900`, fuerza datos no sensibles y agrega marcadores temporales al DOM. No modifica el código de la UI ni reutiliza perfiles locales. Revise visualmente cada PNG antes de versionarlo.

## Build

```powershell
pnpm build
```

El comando ejecuta primero `pnpm typecheck` y después `electron-vite build`. Un resultado aprobado contiene:

```text
out/
  main/index.js
  preload/index.js
  renderer/index.html
```

Los nombres internos adicionales pueden cambiar con el bundler. Las tres entradas anteriores representan los límites ejecutables requeridos.

## Packaging

### Aplicación desempaquetada

```powershell
pnpm package
```

Abra `release/win-unpacked/DLQCommander.exe` y compruebe Dashboard, Demo, tema y cierre/reapertura. Este comando es apropiado para smoke tests locales.

### Instalador

```powershell
pnpm dist
```

Electron Builder genera un instalador NSIS que permite elegir directorio. La configuración se encuentra en `package.json`. El instalador actual no está firmado; Windows puede mostrar una advertencia de reputación.

## Integración continua

`.github/workflows/ci.yml` ejecuta en `windows-latest`:

1. checkout;
2. configuración de pnpm y Node 22;
3. instalación con lockfile congelado;
4. validación de documentación;
5. typecheck;
6. lint;
7. unit tests;
8. E2E con Demo;
9. packaging desempaquetado.

Las suites con brokers no forman parte del job público porque requieren Docker y servicios adicionales. Deben aprobarse localmente antes de publicar cambios en adapters o discovery.

## Estructura del repositorio

| Ruta | Contenido |
| --- | --- |
| `src/main` | Brokers, discovery, jobs, seguridad, IPC y SQLite |
| `src/preload` | API limitada expuesta mediante `contextBridge` |
| `src/renderer` | Aplicación React y estilos |
| `src/shared` | Tipos, schemas, capacidades y contrato IPC |
| `tests/unit` | Pruebas aisladas |
| `tests/integration` | Brokers reales y Azure opt-in |
| `tests/e2e` | Electron con Demo |
| `tests/e2e-brokers` | Electron contra Docker |
| `docker` | Definiciones del laboratorio |
| `scripts` | Seed, validación documental y capturas |
| `docs` | Documentación pública y recursos gráficos |

## Reglas de contribución

- Use pnpm y conserve `pnpm-lock.yaml` coherente.
- Mantenga renderer libre de imports de Node y Electron.
- Valide todo payload IPC con schemas compartidos.
- No registre credenciales, connection strings ni cuerpos de mensajes reales.
- Documente la semántica de cualquier operación nueva por broker.
- Ajuste pruebas según el límite modificado: unitarias para reglas, integración para adapters y E2E para flujos visibles.
- Ejecute `git diff --check` antes del commit.

## Limitaciones de distribución

El proyecto produce actualmente artefactos de Windows. No hay configuración de firma, auto-update ni targets para macOS o Linux. Kafka solo expone PLAINTEXT en perfiles. La UI no permite editar perfiles, purgar fuentes ni modificar payloads antes del requeue.
