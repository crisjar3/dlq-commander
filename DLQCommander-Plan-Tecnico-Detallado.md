# DLQCommander - Plan tecnico detallado de implementacion

## Lectura del plan original

DLQCommander es una aplicacion de escritorio para operar dead-letter queues y dead-letter topics en varios brokers. El operador debe poder conectar perfiles, descubrir DLQs/DLTs, inspeccionar mensajes muertos, filtrar, reenviar con throttle, editar y reenviar cuando el broker lo permita, purgar con dry-run, archivar mensajes sensibles antes de operaciones destructivas y consultar una auditoria local.

La decision tecnica principal se mantiene: Electron + TypeScript full-stack. El proceso `main` concentra operaciones con brokers, disco, secretos, jobs y auditoria. El `renderer` es una SPA React sin acceso a Node, credenciales ni filesystem. El `preload` expone una API minima y tipada por contrato. Esta separacion no es decorativa: es el control principal para que una herramienta que maneja credenciales y mensajes productivos sea razonable en entornos empresariales.

## Principios de arquitectura que guiaran la implementacion

1. **No abstraer falsamente los brokers.** Azure Service Bus, RabbitMQ, Kafka y SQS no comparten exactamente las mismas reglas. El core expondra capacidades explicitas por broker mediante `BrokerCapabilities`, y la UI mostrara acciones disponibles segun esas capacidades.
2. **Renderer sin privilegios.** La UI no conoce connection strings, tokens, rutas locales ni SDKs de brokers. Todo acceso sensible vive en el proceso `main`.
3. **IPC como contrato, no como strings sueltos.** Cada canal tendra schema Zod para entrada y salida. Main, preload y renderer compilaran contra la misma fuente de verdad.
4. **Operaciones peligrosas como jobs auditados.** Requeue masivo, purge, editar-y-reenviar y redrive nativo se ejecutaran como jobs cancelables, con progreso, throttle, logs y auditoria.
5. **Dry-run y read-only por defecto.** La aplicacion debe iniciar en modo conservador. Las acciones destructivas requieren intencion explicita del operador.
6. **Pruebas contra brokers reales o emulados desde el inicio.** El valor de la app esta en respetar semantica real de brokers, asi que los adapters no se validaran solo con mocks.

## Supuestos tecnicos iniciales

- El repo usara TypeScript estricto en `main`, `preload`, `renderer` y `shared`.
- El gestor de paquetes recomendado sera `pnpm` por lockfile estable y velocidad local. Si el equipo ya exige `npm` o `yarn`, se puede cambiar antes del scaffold.
- La aplicacion persistira datos locales en `app.getPath('userData')/dlq.db`.
- `safeStorage` sera obligatorio para guardar credenciales. Si el sistema operativo no ofrece cifrado disponible, la app rechazara el guardado por defecto y mostrara una advertencia clara.
- El MVP cubrira RabbitMQ y Azure Service Bus. Kafka, SQS, auto-update, purge avanzado y editar-y-reenviar quedan como fases posteriores, salvo que el alcance del producto cambie.
- La CI correra typecheck, lint, unit tests, pruebas de integracion y build de Electron. Las pruebas que dependan de servicios externos reales se separaran de las que pueden correr con Docker local.

## Definition of Done global

Una fase se considera cerrada solo cuando cumple estas condiciones:

- El codigo compila con `tsc` sin errores.
- El lint no reporta errores bloqueantes.
- Las pruebas unitarias relevantes pasan.
- Las pruebas de integracion o E2E descritas para la fase pasan o quedan marcadas como dependientes de credenciales externas.
- La UI no habilita acciones que el broker no soporta.
- Los errores esperados producen mensajes accionables y no exponen secretos.
- Los cambios relevantes quedan reflejados en README, ADR o documentacion tecnica.
- La auditoria registra operaciones que modifican o intentan modificar mensajes.

## Roadmap operativo

| Fase | Objetivo | Resultado esperado |
| --- | --- | --- |
| Fase 0 | Base tecnica | Repo Electron + TypeScript, seguridad Electron, contrato IPC, DB, secretos, logging y adapters base |
| Fase 1 | MVP RabbitMQ + Azure Service Bus | Conexiones cifradas, dashboard, inspector, filtros, requeue con throttle y auditoria |
| Fase 2 | Capacidades avanzadas | Editar-y-reenviar, purge con dry-run, Kafka DLT, Schema Registry y auto-update |
| Fase 3 | Expansion enterprise | SQS, redrive nativo, alertas, agrupacion por causa, firma de codigo y documentacion de seguridad |

---

## Paso 1 - Definir alcance implementable y ADRs base

### Objetivo

Convertir el plan original en decisiones tecnicas rastreables. Antes de crear codigo, el equipo debe saber que pertenece al MVP, que queda fuera y que decisiones arquitectonicas no se deben reabrir sin evidencia.

### Que hare

- Crear `docs/adr/001-electron-typescript.md`.
- Crear `docs/adr/002-broker-capabilities.md`.
- Crear `docs/adr/003-ipc-contract.md`.
- Crear `docs/adr/004-local-security-model.md`.
- Crear una tabla de alcance con MVP, v2 y v3.
- Definir riesgos aceptados: peso de Electron, modulos nativos, diferencias semanticas de Kafka, cifrado dependiente del OS y costo de firma.

### Como lo hare

- Cada ADR seguira la estructura: contexto, decision, alternativas, consecuencias y validacion.
- El ADR de plataforma explicara por que Electron + TypeScript cubre con menos friccion la combinacion de UI rica, SDKs JS, tray, notificaciones, auto-update y empaquetado.
- El ADR de capabilities definira que el dominio no tendra una interfaz falsa de "cola universal". Cada adapter declarara capacidades y limitaciones.
- El ADR de IPC documentara que `shared/ipc-contract.ts` es la fuente de verdad y que ningun canal se invocara con strings no declarados.
- El ADR de seguridad documentara que el renderer no accede a Node, filesystem, secretos ni SDKs de broker.

### Que usare

- Markdown para ADRs.
- El plan tecnico original como fuente.
- Plantilla ADR local en `docs/adr/`.

### Entregables

- ADRs iniciales versionados.
- Matriz de alcance por fase.
- Lista de supuestos y preguntas abiertas.

### Validacion del paso

1. Revisare que cada ADR tenga `Estado`, `Contexto`, `Decision`, `Alternativas consideradas`, `Consecuencias` y `Validacion`.
2. Hare una revision de trazabilidad: cada decision fuerte del plan original debe aparecer en al menos un ADR o en la matriz de alcance.
3. Verificare que ningun ADR use frases vagas como "mejor", "robusto" o "facil" sin criterio tecnico.
4. Confirmare que el MVP no incluya accidentalmente trabajo de v2 o v3. Por ejemplo, si aparece Kafka en el MVP, debe estar justificado como cambio de alcance.
5. Criterio de aprobacion: cualquier developer nuevo puede leer los ADRs y entender por que Electron, por que IPC tipado, por que capabilities y por que read-only por defecto sin necesitar la conversacion original.

---

## Paso 2 - Inicializar el repo Electron + TypeScript

### Objetivo

Crear una base ejecutable con Electron, Vite, React y TypeScript estricto. El resultado minimo debe ser una ventana de escritorio que cargue una UI React desde Vite en desarrollo y desde archivos empaquetados en produccion.

### Que hare

- Inicializar el proyecto con `electron-vite`.
- Configurar `src/main`, `src/preload`, `src/renderer` y `src/shared`.
- Activar TypeScript estricto.
- Configurar scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e` y `package`.
- Agregar Tailwind CSS, React, Vitest, Testing Library y Playwright para Electron.
- Crear una ventana inicial con layout de dev-tool, sin landing page de marketing.

### Como lo hare

- `main/index.ts` sera responsable de bootstrap, single-instance lock, creacion de ventana y configuracion de seguridad.
- `preload/index.ts` expondra una API minima inicial, por ejemplo `api.health.check()`.
- `renderer/App.tsx` mostrara una pantalla funcional de shell: sidebar, area principal y estado de conexion local.
- `shared` contendra tipos y schemas compartidos desde el primer commit para evitar duplicacion posterior.
- `tsconfig` se separara por contexto si hace falta: uno para main/preload con Node y otro para renderer con DOM.

### Que usare

- Electron.
- electron-vite.
- React.
- TypeScript strict.
- Tailwind CSS.
- Vitest.
- Playwright Electron.
- ESLint y Prettier o la herramienta de formato que el repo adopte.

### Entregables

- App Electron ejecutable en modo dev.
- Estructura inicial de carpetas.
- Scripts base en `package.json`.
- Primer test unitario y primer test E2E de arranque.

### Validacion del paso

1. Ejecutare `pnpm install` y confirmare que el lockfile queda estable.
2. Ejecutare `pnpm typecheck`. La prueba pasa solo si TypeScript compila `main`, `preload`, `renderer` y `shared` sin `any` implicitos ni errores de modulo.
3. Ejecutare `pnpm lint`. La prueba pasa si no hay errores bloqueantes.
4. Ejecutare `pnpm dev` y abrire la app. Verificare que aparece una ventana Electron, que React renderiza, que HMR actualiza el renderer y que los logs del main no muestran errores.
5. Ejecutare un E2E inicial con Playwright que lance Electron, espere un selector estable como `[data-testid="app-shell"]` y cierre la app.
6. Criterio de aprobacion: una persona del equipo puede clonar el repo, ejecutar dos comandos documentados y ver la ventana base funcionando.

---

## Paso 3 - Endurecer seguridad Electron desde el inicio

### Objetivo

Configurar Electron para que la UI no tenga privilegios peligrosos. Este paso reduce el riesgo principal de una app Electron que maneja credenciales de brokers productivos.

### Que hare

- Configurar `BrowserWindow` con `contextIsolation: true`, `nodeIntegration: false` y `sandbox: true`.
- Deshabilitar navegacion externa no controlada.
- Bloquear `window.open` salvo allowlist explicita.
- Implementar manejo seguro de enlaces externos mediante `shell.openExternal` con validacion.
- Definir Content Security Policy para dev y produccion.
- Evitar que el renderer lea variables de entorno o paths locales.

### Como lo hare

- Centralizare la creacion de ventana en `main/window/createMainWindow.ts`.
- Agregare un modulo `main/security/electronSecurity.ts` para registrar handlers de permisos, navegacion y ventanas nuevas.
- En preload expondre solo metodos declarados, nunca objetos Node completos.
- En renderer agregare un test que compruebe que `window.require`, `process` y APIs Node no existen.

### Que usare

- APIs nativas de Electron: `BrowserWindow`, `session`, `webContents.setWindowOpenHandler`, `will-navigate`.
- Tests E2E con Playwright.
- Documentacion interna en ADR de seguridad.

### Entregables

- Configuracion segura de ventana.
- Tests de aislamiento del renderer.
- Politica inicial de permisos y navegacion.

### Validacion del paso

1. Ejecutare `pnpm test:e2e -- security` para abrir la app y evaluar desde el renderer expresiones como `typeof window.require`, `typeof process` y acceso a `fs`. La prueba pasa si Node no esta expuesto.
2. Intentare navegar desde el renderer hacia una URL externa no permitida mediante un link de prueba. La prueba pasa si Electron bloquea la navegacion interna y, si aplica, abre el navegador externo solo con URL validada.
3. Revisare los headers o meta tags de CSP en la app empaquetada. La prueba pasa si no permite scripts remotos arbitrarios en produccion.
4. Ejecutare busqueda con `rg "nodeIntegration: true|contextIsolation: false|sandbox: false" src`. La prueba pasa si no hay configuraciones inseguras.
5. Criterio de aprobacion: el renderer queda reducido a UI y API de preload; ninguna prueba demuestra acceso directo a Node, disco o secretos.

---

## Paso 4 - Crear contrato IPC tipado y validado con Zod

### Objetivo

Definir un contrato unico para toda comunicacion entre renderer y main. Esto evita drift entre UI y backend local, reduce errores en runtime y permite que TanStack Query trabaje sobre IPC como si fuera una capa de datos estable.

### Que hare

- Crear `src/shared/ipc-contract.ts`.
- Definir schemas Zod para requests, responses y eventos.
- Implementar un helper `registerIpcHandlers(contract, handlers)` en main.
- Implementar un cliente `createIpcClient(contract)` en preload/renderer.
- Crear canales iniciales: `app:health`, `connections:list`, `connections:test`, `queues:discover`, `messages:peek`, `ops:requeue`, `jobs:get`, `events:jobProgress`.

### Como lo hare

- Cada canal tendra entrada y salida declaradas.
- Main validara el input antes de ejecutar el handler.
- Main validara el output antes de responder. Esto cuesta un poco, pero detecta errores temprano durante desarrollo.
- Preload expondra `api.invoke(channel, payload)` y `api.subscribe(event, callback)` con tipos inferidos.
- Renderer consumira el cliente desde `renderer/lib/api.ts` y no importara `electron`.

### Que usare

- Zod.
- `ipcMain.handle`.
- `ipcRenderer.invoke`.
- `contextBridge.exposeInMainWorld`.
- TypeScript conditional types para inferir input/output por canal.
- TanStack Query en fases posteriores.

### Entregables

- Contrato IPC inicial.
- Wrapper de handlers en main.
- Cliente IPC tipado en preload/renderer.
- Tests unitarios de validacion.

### Validacion del paso

1. Ejecutare `pnpm typecheck`. La prueba pasa si un canal inexistente no compila y si un payload incompleto produce error de TypeScript.
2. Agregare un test unitario que invoque el validator de `connections:test` con payload invalido. La prueba pasa si Zod devuelve errores legibles y no ejecuta el handler.
3. Agregare un test de contrato donde un handler devuelve una forma incorrecta. La prueba pasa si el wrapper detecta el output invalido en desarrollo.
4. Ejecutare un E2E de `app:health`: renderer llama a preload, preload llama a main, main responde y la UI muestra estado `ok`.
5. Criterio de aprobacion: ningun componente usa canales IPC no declarados y el cambio de schema rompe compilacion o prueba antes de llegar al usuario.

---

## Paso 5 - Modelar dominio y capabilities de broker

### Objetivo

Crear el lenguaje comun de la aplicacion: mensajes muertos, fuentes, razones de muerte, operaciones, jobs y capacidades. Este modelo debe permitir diferencias reales entre brokers sin llenar la UI de excepciones ad hoc.

### Que hare

- Crear `src/shared/domain.ts`.
- Definir `BrokerType`, `BrokerCapabilities`, `DlqSource`, `DeadMessage`, `DeathReason`, `PeekRequest`, `PeekPage`, `OperationRequest`, `JobStatus` y `AuditEntry`.
- Definir reglas de normalizacion de death reasons por broker.
- Crear una matriz de capacidades inicial.

### Como lo hare

- `BrokerCapabilities` incluira al menos:
  - `canPeek`
  - `canDelete`
  - `canPurge`
  - `canEditAndResend`
  - `canNativeRedrive`
  - `supportsNonDestructivePeek`
  - `supportsMessageHeaders`
  - `supportsOriginalRoutingMetadata`
  - `supportsSchemaRegistry`
- La UI usara capabilities para mostrar, ocultar o deshabilitar acciones.
- Los adapters convertiran respuestas nativas a objetos del dominio compartido.
- Las razones de muerte se normalizaran sin perder metadata original.

### Que usare

- TypeScript discriminated unions.
- Zod schemas derivados o definidos junto al dominio.
- Tests unitarios de normalizacion.

### Entregables

- Modelo de dominio compartido.
- Matriz de capabilities.
- Tests de normalizacion.
- Documentacion breve de semantica por broker.

### Validacion del paso

1. Ejecutare tests unitarios con fixtures de RabbitMQ `x-death`, Azure Service Bus dead-letter reason, Kafka DLT headers y SQS redrive metadata.
2. Cada fixture nativo debe producir un `DeadMessage` con campos normalizados y con `rawMetadata` preservado.
3. Agregare un test de UI o unitario que pase capabilities de Kafka y confirme que `delete` o `purge destructivo` no aparece como accion disponible.
4. Ejecutare `pnpm typecheck` para confirmar que los adapters deben declarar capabilities antes de ser registrados.
5. Criterio de aprobacion: agregar un nuevo broker requiere implementar capabilities y mapping de dominio; no requiere cambiar reglas internas dispersas por toda la UI.

---

## Paso 6 - Configurar SQLite, Drizzle, migraciones y repositorios

### Objetivo

Persistir perfiles, auditoria, mensajes archivados, filtros y settings en SQLite local. La base de datos debe estar versionada, migrar de forma reproducible y quedar aislada del renderer.

### Que hare

- Configurar `better-sqlite3` en el proceso main.
- Configurar Drizzle ORM y migraciones SQL.
- Crear tablas:
  - `connection_profiles`
  - `audit_entries`
  - `archived_messages`
  - `saved_filters`
  - `settings`
- Activar WAL.
- Crear repositorios por agregado: `ConnectionProfileRepository`, `AuditRepository`, `ArchivedMessageRepository`, `SavedFilterRepository`, `SettingsRepository`.

### Como lo hare

- La conexion a SQLite se inicializara durante bootstrap del main.
- Las migraciones correran al iniciar la app antes de registrar handlers IPC que dependan de DB.
- Los repositorios recibiran una instancia de DB y no importaran Electron directamente.
- `audit_entries` sera append-only a nivel de codigo. No se implementaran metodos publicos de update/delete para auditoria.
- `archived_messages` guardara payload y headers antes de editar o purgar.

### Que usare

- `better-sqlite3`.
- Drizzle ORM.
- `app.getPath('userData')`.
- Vitest para pruebas de repositorios con DB temporal.

### Entregables

- Schema Drizzle.
- Migracion inicial.
- Repositorios.
- Tests de persistencia.

### Validacion del paso

1. Ejecutare tests unitarios contra una base SQLite temporal creada en un directorio de test. La prueba pasa si las migraciones crean todas las tablas esperadas.
2. Insertare un perfil de conexion de prueba, lo leere por ID y validare que `broker_type`, `read_only` y timestamps se conservan.
3. Insertare una entrada de auditoria y verificare que el repositorio no expone operaciones de modificacion o borrado.
4. Reiniciare la conexion SQLite dentro del test para confirmar que los datos persisten despues de cerrar y abrir DB.
5. Ejecutare una consulta `PRAGMA journal_mode` y confirmare que WAL esta activo.
6. Criterio de aprobacion: la app puede arrancar con DB nueva, migrar, guardar datos y volver a abrirlos sin exponer operaciones peligrosas.

---

## Paso 7 - Implementar manejo seguro de secretos

### Objetivo

Guardar credenciales de broker cifradas usando el mecanismo del sistema operativo. La app nunca debe escribir connection strings o tokens en texto plano dentro de SQLite, logs o estado del renderer.

### Que hare

- Crear `src/main/secrets/SafeStorageSecretStore.ts`.
- Implementar `encryptConfig`, `decryptConfig` y `assertEncryptionAvailable`.
- Integrar el secret store con `ConnectionProfileRepository`.
- Sanitizar logs para que no impriman credenciales.
- Definir error especifico cuando `safeStorage.isEncryptionAvailable()` sea false.

### Como lo hare

- Antes de guardar un perfil, main validara la config con Zod y la cifrara con `safeStorage.encryptString`.
- SQLite almacenara `encrypted_config` como BLOB o texto base64, segun convenga para Drizzle.
- Al listar perfiles para la UI, main devolvera metadata segura: ID, nombre, broker, read-only y estado. No devolvera config descifrada.
- Solo handlers operativos del main podran descifrar config para conectar a brokers.
- `electron-log` recibira objetos ya sanitizados.

### Que usare

- `safeStorage` de Electron.
- Zod para configs por broker.
- Tests unitarios con wrapper mockeable de safeStorage.
- Busqueda con `rg` para evitar fugas accidentales.

### Entregables

- Secret store.
- Integracion con perfiles.
- Tests de cifrado y sanitizacion.
- Mensaje UI para cifrado no disponible.

### Validacion del paso

1. Ejecutare un test que guarde una config con un valor marcador como `Endpoint=sb://secret-test`. Luego leere el archivo SQLite como bytes/texto y verificare que el marcador no aparece.
2. Ejecutare un test de roundtrip: config original -> cifrado -> persistencia -> descifrado en main. La prueba pasa si el objeto recuperado coincide exactamente con el original.
3. Simulare `safeStorage.isEncryptionAvailable() === false`. La prueba pasa si guardar una conexion falla con error controlado y la UI muestra una advertencia accionable.
4. Ejecutare `rg "connectionString|password|secret|accessKey" logs tests src` revisando que no haya logs con valores sensibles de fixtures.
5. Criterio de aprobacion: las credenciales solo existen descifradas en memoria del main durante operaciones necesarias y no cruzan el boundary hacia renderer.

---

## Paso 8 - Crear logging, errores de dominio y auditoria base

### Objetivo

Tener observabilidad local suficiente para diagnosticar fallos sin filtrar secretos. Tambien preparar la auditoria append-only que sera obligatoria para operaciones con impacto.

### Que hare

- Configurar `electron-log` con rotacion local.
- Crear tipos de error: `BrokerConnectionError`, `BrokerCapabilityError`, `ValidationError`, `OperationCancelledError`, `SecretStorageUnavailableError`.
- Crear `AuditWriter`.
- Definir hash de payload antes y despues de operaciones.
- Definir correlacion por `operationId` y `jobId`.

### Como lo hare

- Main asignara `operationId` a cada accion solicitada por IPC.
- Los logs incluiran contexto no sensible: broker, profileId, sourceId, jobId, cantidad, duracion y resultado.
- `AuditWriter` persistira entradas al final de cada operacion relevante y tambien operaciones fallidas cuando el intento sea importante.
- Los payloads completos no iran a auditoria salvo snapshot explicito en `archived_messages`.
- Los errores enviados al renderer tendran codigo, mensaje seguro y detalle accionable.

### Que usare

- `electron-log`.
- `crypto` de Node para hashes SHA-256.
- Repositorios SQLite.
- Tests unitarios de sanitizacion y auditoria.

### Entregables

- Logger configurado.
- Error mapper para IPC.
- AuditWriter.
- Hashing helper.

### Validacion del paso

1. Ejecutare un test que dispare un error con una connection string de fixture. La prueba pasa si el mensaje mostrado al renderer no contiene el secreto.
2. Ejecutare un test de `AuditWriter` para una operacion `requeue`. La prueba pasa si crea una entrada con timestamp, profileId, accion, source, cantidad, hash y filtro usado.
3. Verificare que `payload_hash_before` cambia cuando cambia el payload y se mantiene igual para payload identico.
4. Revisare manualmente el archivo de log generado durante una prueba local. La evidencia esperada es que aparecen jobId y operationId, pero no passwords, tokens ni connection strings.
5. Criterio de aprobacion: al fallar una operacion, el operador entiende que paso y el developer tiene trazas utiles sin comprometer secretos.

---

## Paso 9 - Levantar laboratorio local con brokers y fixtures

### Objetivo

Crear un entorno reproducible para probar adapters contra brokers reales o emulados. Esto evita que el MVP avance con codigo que solo funciona contra mocks.

### Que hare

- Crear `docker/docker-compose.dev.yml`.
- Incluir RabbitMQ con management UI.
- Incluir Redpanda para Kafka.
- Incluir LocalStack para SQS.
- Incluir emulador o alternativa documentada para Azure Service Bus cuando sea viable.
- Crear scripts de seed para generar mensajes muertos por broker.
- Crear README de desarrollo local.

### Como lo hare

- RabbitMQ tendra exchange, cola principal, DLX y DLQ configuradas.
- El seed de Rabbit publicara un mensaje que el consumidor de prueba rechaza para enviarlo a DLQ.
- Redpanda tendra topic original y DLT por convencion.
- LocalStack tendra cola principal y DLQ asociada.
- Azure Service Bus se dividira en dos modos si hace falta: emulador local para smoke tests y namespace real de desarrollo para pruebas que el emulador no cubra.

### Que usare

- Docker Compose.
- Scripts TypeScript ejecutados con `tsx`.
- RabbitMQ management.
- Redpanda.
- LocalStack.
- Testcontainers para CI.

### Entregables

- Compose local.
- Scripts `seed:rabbit`, `seed:kafka`, `seed:sqs` y, si aplica, `seed:asb`.
- Documentacion de puertos, credenciales locales y comandos.

### Validacion del paso

1. Ejecutare `docker compose -f docker/docker-compose.dev.yml up -d`.
2. Ejecutare `docker compose ps` y verificare que los servicios estan `healthy` o listos.
3. Ejecutare el seed de Rabbit y validare con RabbitMQ management o script CLI que la DLQ contiene al menos un mensaje.
4. Ejecutare el seed de Kafka y validare que el DLT contiene mensajes con headers esperados.
5. Ejecutare el seed de SQS contra LocalStack y validare que la DLQ recibe mensajes.
6. Documentare cualquier prueba de Azure que requiera recurso cloud real y separare su ejecucion con variable de entorno como `ASB_TEST_CONNECTION_STRING`.
7. Criterio de aprobacion: un developer puede levantar el laboratorio, poblar mensajes muertos y apagarlo sin configuracion manual oculta.

---

## Paso 10 - Implementar framework de BrokerAdapter

### Objetivo

Definir una interfaz comun para que main pueda descubrir, inspeccionar y operar mensajes sin conocer detalles internos de cada SDK. La interfaz debe permitir diferencias semanticas sin mentirle al dominio.

### Que hare

- Crear `src/main/brokers/adapter.ts`.
- Definir metodos base:
  - `testConnection(config)`
  - `discoverSources(config)`
  - `peekMessages(request)`
  - `requeue(request)`
  - `purge(request)`
  - `archive(request)` si aplica localmente
  - `getDepth(source)`
- Definir `BrokerAdapterRegistry`.
- Definir errores normalizados por adapter.
- Agregar tests con un adapter fake.

### Como lo hare

- Cada adapter declarara `brokerType` y `capabilities`.
- Los metodos que no apliquen devolveran `BrokerCapabilityError` y no una respuesta vacia ambigua.
- `peekMessages` sera no destructivo cuando el broker lo permita. Si un broker no ofrece peek real, la capability lo debe reflejar.
- `requeue` devolvera resultado con conteos: seleccionados, reenviados, omitidos, fallidos y razon de fallo por mensaje cuando sea posible.
- El registry resolvera adapter por `broker_type` del perfil.

### Que usare

- TypeScript interfaces.
- Zod para requests y responses.
- Vitest para contrato del adapter.

### Entregables

- Interfaz `BrokerAdapter`.
- Registry.
- Adapter fake para tests.
- Pruebas de capabilities.

### Validacion del paso

1. Ejecutare tests de contrato contra `FakeBrokerAdapter`. La prueba pasa si `testConnection`, `discoverSources`, `peekMessages` y `requeue` devuelven shapes validados.
2. Ejecutare un test donde se solicita `purge` a un adapter sin `canPurge`. La prueba pasa si devuelve `BrokerCapabilityError` y no ejecuta ningun efecto.
3. Ejecutare `pnpm typecheck` para confirmar que un adapter real no puede registrarse sin implementar metodos obligatorios.
4. Revisare que main no importe SDKs de brokers directamente fuera de `src/main/brokers/**`.
5. Criterio de aprobacion: la capa de aplicacion habla con adapters mediante contrato estable y no mediante condicionales dispersos por broker.

---

## Paso 11 - Implementar RabbitMQ para MVP

### Objetivo

Soportar el primer broker del MVP con flujo completo: test connection, descubrir DLQs configuradas, inspeccionar mensajes, leer metadata `x-death`, reenviar al exchange/routing-key original y auditar.

### Que hare

- Instalar y configurar `amqplib`.
- Crear `src/main/brokers/rabbitmq/RabbitMqAdapter.ts`.
- Implementar parsing de connection config.
- Implementar discovery de colas candidatas a DLQ.
- Implementar peek no destructivo o una estrategia segura documentada.
- Implementar requeue usando metadata `x-death`.
- Implementar tests de integracion con RabbitMQ Docker.

### Como lo hare

- `testConnection` abrira conexion, canal, ejecutara una operacion inocua y cerrara recursos.
- `discoverSources` usara configuration conocida del perfil o management API si se decide soportarla. Si no se usa management API en MVP, el usuario podra declarar colas DLQ manualmente.
- `peekMessages` debe evitar consumir destructivamente. En RabbitMQ, `basic.get` con `nack(requeue: true)` puede alterar orden y delivery count; si se usa, la UI debe indicar limitacion. Alternativa: operar con una cola DLQ donde peek sea "preview by controlled get+nack" con limite bajo. Esta decision debe quedar documentada.
- `requeue` tomara mensaje de DLQ, extraera exchange y routing-key desde `x-death`, publicara al origen con propiedades preservadas y hara `ack` solo despues de publish confirmado.
- Si no existe metadata original, el operador debera escoger destino manualmente.

### Que usare

- `amqplib`.
- RabbitMQ Docker.
- Testcontainers.
- Fixtures con `x-death`.
- AuditWriter.

### Entregables

- RabbitMQ adapter.
- Config schema Rabbit.
- Tests de integracion.
- Documentacion de limitaciones de peek.

### Validacion del paso

1. Levantare RabbitMQ con Docker Compose.
2. Ejecutare seed para crear exchange principal, cola principal, DLX y DLQ.
3. Publicare un mensaje que el consumidor de prueba rechaza hasta enviarlo a DLQ.
4. Ejecutare `testConnection` desde un test de integracion y validare resultado `ok`.
5. Ejecutare `discoverSources` y verificare que aparece la DLQ esperada.
6. Ejecutare `peekMessages` con page size pequeno. Validare que el mensaje se muestra con payload, headers y death reason normalizada, y que sigue disponible en DLQ despues del peek segun la estrategia definida.
7. Ejecutare `requeue` con throttle bajo. Validare que el mensaje aparece en la cola origen y que la DLQ queda sin ese mensaje solo despues de publish exitoso.
8. Simulare fallo de publish al origen. La prueba pasa si el mensaje no se pierde y no se hace `ack` destructivo.
9. Verificare que se escribe auditoria con accion `requeue`, count `1`, source Rabbit y hash de payload.
10. Criterio de aprobacion: RabbitMQ soporta el flujo MVP completo sin perdida silenciosa de mensajes.

---

## Paso 12 - Implementar Azure Service Bus para MVP

### Objetivo

Soportar Azure Service Bus con inspeccion de dead-letter subqueues y reenvio a la cola original. Debe respetar lock, completion y reglas de deduplicacion.

### Que hare

- Instalar `@azure/service-bus`.
- Crear `src/main/brokers/azure-service-bus/AzureServiceBusAdapter.ts`.
- Definir config schema para namespace, connection string o credenciales soportadas.
- Implementar test connection.
- Implementar discovery de colas y dead-letter subqueues.
- Implementar peek de DLQ.
- Implementar requeue: receive de dead-letter subqueue, send a cola original y complete.

### Como lo hare

- `testConnection` creara cliente y ejecutara una operacion real de lectura de metadata o receiver seguro.
- `peekMessages` usara APIs de peek cuando sea posible para evitar lock destructivo.
- `requeue` recibira mensajes de `{queue}/$DeadLetterQueue`, construira un mensaje nuevo preservando body y application properties, enviara a la cola original y completara el mensaje muerto.
- Si la cola original usa deduplicacion por `MessageId`, el adapter regenerara ID o pedira confirmacion segun capability/config para evitar que Azure descarte el reenvio.
- Los errores de lock perdido, session requerida o permisos insuficientes se mapearan a mensajes accionables.

### Que usare

- `@azure/service-bus`.
- Azure Service Bus emulator si cubre el flujo necesario.
- Namespace real de desarrollo para pruebas no cubiertas por emulador.
- Testcontainers o pruebas condicionadas por env vars.

### Entregables

- Azure Service Bus adapter.
- Config schema Azure.
- Tests de integracion documentados.
- Matriz emulador vs cloud real.

### Validacion del paso

1. Ejecutare pruebas de config invalida: connection string vacia, namespace mal formado o credenciales faltantes. La prueba pasa si Zod devuelve errores claros antes de llamar al SDK.
2. Ejecutare `testConnection` contra el entorno disponible. La prueba pasa si se abre y cierra cliente sin fugas de recursos.
3. Creare una cola con DLQ y enviare un mensaje que termine en dead-letter con reason conocida.
4. Ejecutare `peekMessages` y validare que el body, properties, sequence number, enqueued time y dead-letter reason se normalizan correctamente.
5. Ejecutare `requeue` y validare que el mensaje aparece en la cola original y que el mensaje de DLQ se completa.
6. Probare un caso con permisos insuficientes. La prueba pasa si la UI recibe error accionable, no stack trace crudo.
7. Probare caso de deduplicacion si el entorno lo permite. La prueba pasa si el reenvio no se descarta silenciosamente y la decision sobre `MessageId` queda registrada.
8. Criterio de aprobacion: Azure Service Bus permite inspeccionar y reenviar mensajes muertos sin perder locks ni ocultar limitaciones de configuracion.

---

## Paso 13 - Construir UI de conexiones y perfiles

### Objetivo

Permitir que el operador cree, pruebe, edite y marque perfiles como read-only. La UI debe tratar credenciales como informacion sensible y nunca mostrarlas despues de guardarlas.

### Que hare

- Crear feature `renderer/features/connections`.
- Crear formularios por broker con validacion.
- Implementar lista de perfiles guardados.
- Implementar `Test connection`.
- Guardar perfil cifrado solo despues de test exitoso o confirmacion explicita.
- Activar `read_only` por defecto.

### Como lo hare

- Los formularios usaran schemas compartidos o equivalentes derivados de Zod.
- TanStack Query consumira `connections:list` y mutaciones para `connections:test`, `connections:create`, `connections:update`.
- La UI mostrara estado de test: idle, running, success, failed.
- Despues de guardar, la UI mostrara metadata segura, no secretos.
- Si `safeStorage` no esta disponible, el boton guardar quedara bloqueado y mostrara explicacion.

### Que usare

- React.
- TanStack Query.
- Zod.
- Tailwind CSS.
- Componentes UI locales.
- IPC tipado.

### Entregables

- Pantalla de conexiones.
- Formularios por broker MVP.
- Mutaciones IPC integradas.
- Tests de renderer.

### Validacion del paso

1. Ejecutare test unitario de formulario: config invalida muestra errores por campo y no llama a IPC.
2. Ejecutare E2E donde el operador abre "Agregar conexion", selecciona RabbitMQ, completa credenciales locales y presiona `Test connection`. La prueba pasa si aparece estado exitoso.
3. Guardare el perfil y refrescare la app. La prueba pasa si el perfil aparece en la lista con `read-only` activo por defecto.
4. Inspeccionare la respuesta IPC de `connections:list`. La prueba pasa si no contiene connection string, password ni token.
5. Simulare fallo de conexion. La prueba pasa si el mensaje explica causa probable, por ejemplo host inaccesible o credenciales invalidas.
6. Criterio de aprobacion: el operador puede crear un perfil usable sin que la UI exponga secretos ni habilite escritura por accidente.

---

## Paso 14 - Construir dashboard y pollers de profundidad

### Objetivo

Mostrar al operador que DLQs/DLTs tienen mensajes muertos, cuantos hay, desde cuando y si el problema sigue activo. El dashboard debe actualizarse sin que el renderer conecte directamente a brokers.

### Que hare

- Crear `src/main/polling/QueueDepthPoller.ts`.
- Crear eventos `events:queueDepths`.
- Crear pantalla `renderer/features/dashboard`.
- Mostrar tarjetas o filas por source con profundidad, edad del mensaje mas viejo, tasa estimada y estado de conexion.
- Actualizar badge de tray con total de mensajes muertos.

### Como lo hare

- Main ejecutara pollers por perfil activo cada N segundos configurable.
- Cada poller usara el adapter correspondiente para obtener profundidad.
- Los eventos se enviaran a renderer mediante `webContents.send` y se validaran con Zod.
- Renderer actualizara cache de TanStack Query o store local para pintar cambios en vivo.
- Los pollers tendran backoff ante errores para no saturar brokers ni logs.

### Que usare

- `p-queue` o scheduler interno con control de concurrencia.
- Electron tray.
- TanStack Query.
- Zod event schemas.
- Tests con fake adapter.

### Entregables

- Poller en main.
- Eventos de profundidad.
- Dashboard funcional.
- Badge de tray.

### Validacion del paso

1. Ejecutare test unitario de poller con fake adapter que devuelve profundidad variable. La prueba pasa si emite eventos con el shape correcto.
2. Ejecutare test de backoff donde el adapter falla tres veces. La prueba pasa si el poller reduce frecuencia o evita spam de logs.
3. Ejecutare E2E con RabbitMQ local y un mensaje en DLQ. La prueba pasa si el dashboard muestra la DLQ con profundidad `1`.
4. Agregare otro mensaje durante la app abierta. La prueba pasa si el dashboard actualiza el conteo sin refrescar la ventana.
5. Verificare que el badge de tray suma mensajes de sources visibles.
6. Criterio de aprobacion: el operador puede abrir la app y detectar rapidamente donde hay mensajes muertos y si el volumen esta cambiando.

---

## Paso 15 - Construir inspector con tabla virtualizada y detalle de mensaje

### Objetivo

Permitir inspeccionar muchos mensajes sin bloquear la UI. El operador debe ver metadata, headers, payload decodificado, reason normalizada y raw metadata cuando necesite diagnostico profundo.

### Que hare

- Crear `renderer/features/inspector`.
- Implementar tabla con TanStack Table y TanStack Virtual.
- Implementar paginacion via `messages:peek`.
- Crear panel de detalle.
- Agregar payload viewer con JSON pretty, texto y hex fallback.
- Preparar integracion posterior con Monaco para diff.

### Como lo hare

- La tabla renderizara solo filas visibles para soportar listas grandes.
- `messages:peek` recibira `profileId`, `sourceId`, `cursor`, `limit` y filtros basicos.
- El adapter devolvera `PeekPage` con `items`, `nextCursor` y `snapshotInfo` si aplica.
- El panel de detalle mostrara payload, headers y metadata normalizada.
- El renderer no guardara payloads sensibles en logs.

### Que usare

- TanStack Table.
- TanStack Virtual.
- TanStack Query.
- Zod.
- Utilidades de decoding en `src/shared` o `src/main` segun sensibilidad.

### Entregables

- Inspector funcional.
- Tabla virtualizada.
- Panel de detalle.
- Tests de rendering y E2E.

### Validacion del paso

1. Ejecutare test de renderer con 100000 filas simuladas y verificare que el DOM solo contiene un numero pequeno de filas renderizadas.
2. Ejecutare E2E con RabbitMQ local: abrir dashboard, entrar a una DLQ, esperar tabla y seleccionar el mensaje.
3. Validare que el detalle muestra payload, headers y reason normalizada.
4. Probare payload JSON valido. La prueba pasa si se muestra formateado y sin romper caracteres.
5. Probare payload binario o texto no JSON. La prueba pasa si se muestra fallback hex/texto sin romper la UI.
6. Medire interaccion basica: scroll de tabla, seleccion y cambio de pagina sin freeze visible.
7. Criterio de aprobacion: el operador puede inspeccionar mensajes grandes o numerosos con UI responsiva y sin consumirlos destructivamente.

---

## Paso 16 - Implementar filtros guardables y seleccion para operaciones bulk

### Objetivo

Permitir que el operador reduzca el conjunto de mensajes por tiempo, texto, reason y headers. Los filtros deben alimentar operaciones masivas con trazabilidad exacta.

### Que hare

- Definir `MessageFilter` en dominio compartido.
- Agregar UI de filtros.
- Persistir filtros guardados en SQLite.
- Integrar filtros con `messages:peek`.
- Permitir seleccion individual y seleccion por filtro para operaciones bulk.

### Como lo hare

- El filtro tendra campos versionados para poder migrarlo en el futuro.
- Cada adapter decidira que parte del filtro puede ejecutar en broker y que parte debe aplicar localmente despues de leer una ventana de mensajes.
- La UI mostrara cuando un filtro es parcial o aproximado por limitacion del broker.
- Las operaciones bulk guardaran `filter_json` en auditoria.

### Que usare

- Zod para `MessageFilterSchema`.
- TanStack Query para invalidacion de peek.
- Repositorio `SavedFilterRepository`.
- Tests unitarios de serializacion.

### Entregables

- UI de filtros.
- Persistencia de filtros.
- Integracion con peek.
- Seleccion bulk.

### Validacion del paso

1. Ejecutare tests unitarios para serializar y deserializar filtros con version.
2. Creare fixtures con distintas reasons y headers. La prueba pasa si el filtro por reason devuelve solo mensajes esperados.
3. Ejecutare E2E: guardar filtro, cerrar app, abrir app y verificar que el filtro sigue disponible.
4. Ejecutare una operacion dry-run o preview usando filtro. La prueba pasa si la auditoria registra exactamente el `filter_json` aplicado.
5. Probare un filtro no soportado completamente por RabbitMQ. La prueba pasa si la UI comunica la limitacion y no promete precision falsa.
6. Criterio de aprobacion: los filtros son reutilizables, auditables y no esconden diferencias de soporte por broker.

---

## Paso 17 - Implementar JobRunner con throttle, progreso y cancelacion

### Objetivo

Ejecutar operaciones potencialmente largas sin bloquear la UI. Requeue, purge, archive y redrive deben reportar progreso, respetar throttle y permitir cancelacion segura.

### Que hare

- Crear `src/main/jobs/JobRunner.ts`.
- Modelar estados: `queued`, `running`, `cancelling`, `cancelled`, `completed`, `failed`.
- Implementar eventos `events:jobProgress`.
- Implementar throttle configurable por job.
- Implementar cancelacion cooperativa.
- Persistir resumen final en auditoria.

### Como lo hare

- Cada job tendra `jobId`, `operationId`, `profileId`, `sourceId`, `kind`, `createdAt`, `startedAt`, `finishedAt`.
- `p-queue` controlara concurrencia global y por broker si hace falta.
- El throttle limitara mensajes por segundo, no solo concurrencia.
- Los adapters recibiran un `AbortSignal` o token de cancelacion.
- El renderer consultara `jobs:get` y se suscribira a `events:jobProgress`.

### Que usare

- `p-queue`.
- Timers controlados.
- Event emitter interno.
- IPC events.
- Vitest con fake timers.

### Entregables

- JobRunner.
- Progress events.
- Cancelacion.
- Tests de throttle.

### Validacion del paso

1. Ejecutare test con fake timers para un job de 100 mensajes a 10 msg/s. La prueba pasa si el runner no procesa mas de 10 mensajes por segundo simulado.
2. Ejecutare test de progreso. La prueba pasa si emite conteos `processed`, `succeeded`, `failed`, `skipped` y porcentaje calculable.
3. Ejecutare test de cancelacion a mitad del job. La prueba pasa si el runner deja de tomar mensajes nuevos, termina el mensaje en curso de forma segura y marca estado `cancelled`.
4. Ejecutare E2E de UI: iniciar job fake, ver progreso, cancelar y confirmar estado final.
5. Revisare logs para confirmar que cada job tiene `jobId` y `operationId`.
6. Criterio de aprobacion: ninguna operacion masiva bloquea la ventana y todas tienen progreso confiable y cancelacion predecible.

---

## Paso 18 - Implementar requeue individual y masivo para MVP

### Objetivo

Permitir reenviar mensajes muertos al origen de forma controlada. Esta es la capacidad central del MVP y debe ser segura, auditada y consciente de cada broker.

### Que hare

- Crear handlers `ops:requeue` y `jobs:get`.
- Crear modal de confirmacion para requeue.
- Implementar requeue individual desde detalle de mensaje.
- Implementar requeue masivo desde seleccion o filtro.
- Integrar throttle configurable.
- Bloquear requeue si el perfil esta en read-only.

### Como lo hare

- La UI pedira confirmacion mostrando source, cantidad estimada, destino, throttle y modo read/write.
- Main validara de nuevo permisos, capabilities y read-only antes de iniciar job. La UI no sera la unica barrera.
- El job llamara al adapter con lotes pequenos.
- El adapter confirmara eliminacion/completion del mensaje muerto solo despues de publicar al destino cuando la semantica lo permita.
- `AuditWriter` registrara resultado final y hashes.

### Que usare

- JobRunner.
- BrokerAdapter RabbitMQ y Azure.
- AuditWriter.
- TanStack Query para invalidar dashboard e inspector despues del job.

### Entregables

- Requeue UI.
- Handler IPC.
- Integracion con JobRunner.
- Auditoria de requeue.
- Tests de integracion por broker MVP.

### Validacion del paso

1. Ejecutare E2E con perfil read-only. Intentare requeue. La prueba pasa si la UI bloquea la accion y main tambien rechaza una invocacion directa por IPC.
2. Ejecutare requeue individual en RabbitMQ con un mensaje. La prueba pasa si el mensaje aparece en cola origen, desaparece de DLQ segun semantica y se crea auditoria.
3. Ejecutare requeue masivo con 20 mensajes y throttle 5 msg/s. La prueba pasa si la duracion minima observada respeta aproximadamente el throttle y el progreso no salta de 0 a 100 sin eventos intermedios.
4. Simulare fallo parcial. La prueba pasa si el resumen muestra exitosos y fallidos, y la auditoria refleja ambos conteos.
5. Ejecutare requeue en Azure Service Bus y validare completion solo despues del send.
6. Criterio de aprobacion: el operador puede reenviar mensajes con control de tasa, confirmacion previa, bloqueo read-only y evidencia auditable del resultado.

---

## Paso 19 - Construir auditoria visible y archivo previo de mensajes

### Objetivo

Dar trazabilidad util para entornos donde operar DLQs puede tener impacto financiero o regulatorio. La auditoria debe responder quien hizo que, cuando, sobre que source, cuantos mensajes y con que resultado.

### Que hare

- Crear pantalla `renderer/features/audit`.
- Mostrar tabla de auditoria con filtros por perfil, broker, source, accion, fecha y resultado.
- Implementar detalle de auditoria.
- Implementar archivo previo para operaciones que modifican payload o purgan.
- Agregar exportacion basica CSV o JSON si el alcance lo permite.

### Como lo hare

- `audit_entries` seguira append-only.
- `archived_messages` almacenara snapshot antes de editar o purgar.
- La UI no mostrara payload archivado por defecto si puede contener datos sensibles; exigira accion explicita.
- Cada entrada de auditoria enlazara con `jobId` y `operationId`.

### Que usare

- SQLite repos.
- TanStack Table.
- IPC `audit:list`, `audit:get`, `archive:get`.
- Hash SHA-256.

### Entregables

- Pantalla de auditoria.
- Filtros de auditoria.
- Snapshot previo para operaciones destructivas.
- Tests de audit trail.

### Validacion del paso

1. Ejecutare una operacion requeue y verificare que aparece en la tabla de auditoria sin refrescar manualmente o despues de invalidacion controlada.
2. Consultare la entrada y validare campos obligatorios: timestamp, profileId, broker, source, action, messageCount, result, jobId, operationId y hashes.
3. Ejecutare una operacion que archive payload antes de modificarlo. La prueba pasa si `archived_messages` contiene snapshot antes de la mutacion.
4. Intentare modificar una entrada de auditoria usando repositorio publico. La prueba pasa si no existe API de update/delete.
5. Verificare que payloads sensibles no aparecen automaticamente en la vista de tabla.
6. Criterio de aprobacion: despues de una operacion, la app permite reconstruir que se intento, que ocurrio y que mensajes fueron afectados sin revisar logs crudos.

---

## Paso 20 - Cerrar MVP con pruebas E2E, CI e instaladores

### Objetivo

Entregar un MVP instalable que cubra RabbitMQ y Azure Service Bus con conexiones cifradas, dashboard, inspector, filtros, requeue con throttle y auditoria.

### Que hare

- Crear pipeline `.github/workflows/ci.yml`.
- Ejecutar typecheck, lint, unit tests, integration tests y E2E.
- Configurar `electron-builder`.
- Generar instaladores para Windows, macOS y Linux sin firma inicialmente.
- Documentar limitaciones de firma y SmartScreen/Gatekeeper.
- Crear README con flujo completo de desarrollo local y uso basico.

### Como lo hare

- CI separara pruebas rapidas de pruebas con Docker.
- Los tests de Azure contra cloud real correran solo si existen secrets configurados.
- `electron-builder.yml` definira appId, productName, files incluidos, unpack de modulos nativos y targets.
- Se probara empaquetado temprano por `better-sqlite3` y futuros modulos nativos de Kafka.
- README mostrara comandos de desarrollo, pruebas y empaquetado.

### Que usare

- GitHub Actions.
- electron-builder.
- Playwright.
- Docker Compose/Testcontainers.
- electron-rebuild si algun modulo nativo lo requiere.

### Entregables

- CI funcional.
- Config de release inicial.
- Instaladores locales.
- README MVP.

### Validacion del paso

1. Ejecutare localmente `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration` y `pnpm test:e2e`.
2. Ejecutare workflow de CI en branch o PR. La prueba pasa si todos los jobs requeridos terminan en verde.
3. Ejecutare `pnpm build` y `pnpm package`. La prueba pasa si electron-builder genera artefactos sin errores.
4. Instalare el build generado en Windows local. La prueba pasa si la app abre, crea DB en `userData`, no requiere dependencias de desarrollo y puede conectarse a RabbitMQ local.
5. Ejecutare smoke test empaquetado: crear perfil, ver dashboard, inspeccionar mensaje, hacer requeue y revisar auditoria.
6. Revisare que README documenta que builds iniciales no estan firmados y que mensajes de OS son esperados.
7. Criterio de aprobacion: el MVP puede instalarse y demostrar el flujo completo sin depender de `pnpm dev`.

---

## Paso 21 - Implementar editar-y-reenviar con Monaco Diff

### Objetivo

Permitir corregir payloads antes de reenviarlos cuando el broker y el perfil lo permitan. Esta operacion es riesgosa, por lo que debe archivar el original, mostrar diff y exigir confirmacion.

### Que hare

- Instalar Monaco Editor.
- Crear editor de payload con validacion JSON cuando aplique.
- Crear vista diff original vs editado.
- Implementar handler `ops:editAndResend`.
- Archivar mensaje original antes de reenviar version editada.
- Registrar hashes before/after.

### Como lo hare

- La UI abrira editor desde detalle de mensaje.
- El operador vera diff obligatorio antes de confirmar.
- Main validara que `canEditAndResend` es true y que el perfil no esta read-only.
- Antes de publicar el mensaje editado, main guardara snapshot original en `archived_messages`.
- El adapter reenviara mensaje editado al destino correcto y completara/eliminara el mensaje muerto segun broker.

### Que usare

- Monaco Editor.
- JobRunner para operacion async.
- ArchivedMessageRepository.
- AuditWriter.
- Zod para validar payload editado si es JSON.

### Entregables

- UI de edicion y diff.
- Handler edit-and-resend.
- Archivo previo.
- Auditoria con hashes before/after.

### Validacion del paso

1. Ejecutare test de UI: abrir mensaje JSON, editar campo, ver diff y confirmar. La prueba pasa si el diff muestra exactamente el cambio.
2. Intentare confirmar JSON invalido cuando el modo JSON este activo. La prueba pasa si la UI bloquea confirmacion o exige cambio a modo texto/binario segun regla definida.
3. Ejecutare operacion contra RabbitMQ o Azure. La prueba pasa si la cola origen recibe payload editado y la DLQ deja de contener el original segun semantica.
4. Verificare en SQLite que `archived_messages` contiene el payload original antes de la operacion.
5. Verificare auditoria con `payload_hash_before` distinto de `payload_hash_after`.
6. Criterio de aprobacion: editar-y-reenviar no puede ejecutarse sin diff, sin archivo previo, sin permiso de escritura o sin auditoria.

---

## Paso 22 - Implementar purge con dry-run por defecto

### Objetivo

Permitir limpiar DLQs cuando el broker lo soporte, evitando borrados accidentales. Toda purga masiva debe comenzar como preview y requerir confirmacion explicita.

### Que hare

- Crear handler `ops:purge`.
- Crear UI de purge con dry-run por defecto.
- Mostrar cantidad estimada y muestra de mensajes afectados.
- Archivar mensajes si la politica del usuario lo exige.
- Registrar auditoria de preview y ejecucion real.

### Como lo hare

- Main verificara `canPurge` o `canDelete`.
- Dry-run calculara afectados sin eliminar.
- La UI exigira confirmacion con source, filtro y cantidad.
- La ejecucion real se hara como job con cancelacion y progreso.
- Kafka no recibira purge destructivo porque un DLT es un log; si se implementa avance de offset, se nombrara como tal.

### Que usare

- JobRunner.
- Broker capabilities.
- ArchivedMessageRepository.
- AuditWriter.
- UI modal de confirmacion.

### Entregables

- Purge dry-run.
- Purge execution por brokers compatibles.
- Auditoria.
- Tests de bloqueo por capabilities.

### Validacion del paso

1. Ejecutare purge en modo dry-run sobre una DLQ con 10 mensajes. La prueba pasa si no cambia la profundidad y la UI muestra cantidad estimada.
2. Confirmare purge real con throttle. La prueba pasa si la profundidad baja y el job reporta progreso.
3. Ejecutare purge sobre Kafka. La prueba pasa si la UI no ofrece "borrar" y explica la alternativa semantica si existe.
4. Ejecutare purge con perfil read-only. La prueba pasa si UI y main bloquean la accion.
5. Verificare auditoria de dry-run y de ejecucion real, diferenciando `preview` de `executed`.
6. Criterio de aprobacion: no existe camino de UI o IPC que purgue mensajes sin dry-run previo o confirmacion explicita.

---

## Paso 23 - Implementar Kafka DLT y Schema Registry

### Objetivo

Soportar Kafka respetando que no existe DLQ nativa ni borrado por mensaje. DLQCommander debe tratar DLTs como topics por convencion y manejar offset del consumer group de la herramienta.

### Que hare

- Instalar `@confluentinc/kafka-javascript`.
- Instalar cliente de Schema Registry para Avro/Protobuf si se confirma paquete final.
- Crear `src/main/brokers/kafka/KafkaAdapter.ts`.
- Definir config para brokers, auth, TLS, schema registry y naming convention de DLT.
- Implementar discovery por convencion o configuracion manual.
- Implementar peek/consume controlado por consumer group de herramienta.
- Implementar requeue como produce al topic original y commit offset.

### Como lo hare

- La UI explicara que "delete" no aplica en Kafka.
- El adapter tendra capability `canDelete: false`.
- `peekMessages` leera desde DLT usando un consumer group propio y no modificara offsets de consumidores productivos.
- Requeue producira al topic original con key, headers y payload preservados o decodificados/recodificados cuando aplique.
- Schema Registry decodificara Avro/Protobuf para inspeccion y edicion futura.
- El commit offset ocurrira despues de producir exitosamente al topic original.

### Que usare

- `@confluentinc/kafka-javascript`.
- Schema Registry client.
- Redpanda en Docker.
- Testcontainers.
- Fixtures Avro/Protobuf/JSON.

### Entregables

- Kafka adapter.
- Config UI Kafka.
- Decoder Schema Registry.
- Tests de DLT.

### Validacion del paso

1. Levantare Redpanda y creare topic original mas DLT.
2. Publicare mensajes en DLT con headers que indiquen origen.
3. Ejecutare discovery y validare que el DLT aparece con capability sin delete.
4. Ejecutare peek y validare que payload, key, headers, partition y offset se muestran correctamente.
5. Ejecutare requeue. La prueba pasa si el mensaje se produce al topic original y luego se confirma offset del consumer group de DLQCommander.
6. Verificare que no se modifica ningun consumer group productivo.
7. Probare payload Avro con Schema Registry. La prueba pasa si el inspector muestra objeto decodificado y conserva fallback raw.
8. Criterio de aprobacion: Kafka funciona como log con offsets y no como cola mutable disfrazada.

---

## Paso 24 - Implementar auto-update

### Objetivo

Permitir que la app instalada reciba actualizaciones desde GitHub Releases cuando el proyecto este listo para distribuir versiones frecuentes.

### Que hare

- Configurar `electron-updater`.
- Agregar workflow `release.yml`.
- Generar artefactos y metadata `latest.yml` o equivalente por plataforma.
- Crear UI o notificacion de update disponible.
- Documentar limitaciones cuando builds no esten firmados.

### Como lo hare

- La app buscara updates solo en builds empaquetados, no en dev.
- Main gestionara check, download y apply.
- Renderer solo mostrara estado seguro: disponible, descargando, listo para reiniciar, error.
- La release se disparara por tag.

### Que usare

- electron-updater.
- GitHub Releases.
- electron-builder.
- GitHub Actions.

### Entregables

- Update flow.
- Release workflow.
- Documentacion de versionado.
- Tests manuales de update con canal prerelease si aplica.

### Validacion del paso

1. Generare version `0.1.0` e instalare la app.
2. Publicare version `0.1.1` en GitHub Releases con metadata de update.
3. Abrire la app instalada y ejecutare check de update.
4. La prueba pasa si la app detecta version nueva, descarga update, solicita reinicio o aplica flujo definido.
5. Verificare logs de updater sin secretos y con errores accionables si GitHub no responde.
6. Probare escenario sin internet. La prueba pasa si la app no se rompe y reporta estado offline.
7. Criterio de aprobacion: una version instalada puede actualizarse a otra sin reinstalacion manual y sin afectar datos locales.

---

## Paso 25 - Implementar AWS SQS manual redrive y redrive nativo

### Objetivo

Soportar SQS con dos modos: reenvio manual con posibilidad de editar payload y redrive nativo con `StartMessageMoveTask` cuando se quiera mover volumen grande sin editar.

### Que hare

- Instalar `@aws-sdk/client-sqs`.
- Crear `src/main/brokers/sqs/SqsAdapter.ts`.
- Definir config para region, credenciales, endpoint local y queue URLs.
- Implementar test connection.
- Implementar discovery manual o por tags/config.
- Implementar receive en DLQ, send a origen y delete en modo manual.
- Implementar `StartMessageMoveTask` para redrive nativo.

### Como lo hare

- El adapter declarara `canNativeRedrive: true` cuando la cola y permisos lo permitan.
- La UI diferenciara "reenviar manual" de "redrive nativo".
- Modo manual permitira editar payload en fases donde `canEditAndResend` aplique.
- Modo nativo no permitira editar payload, porque AWS mueve mensajes como servicio administrado.
- Delete de DLQ ocurrira despues de send exitoso en modo manual.

### Que usare

- AWS SDK v3 para SQS.
- LocalStack para pruebas locales.
- Credenciales AWS reales opcionales para pruebas de redrive nativo si LocalStack no cubre todo.
- JobRunner.
- AuditWriter.

### Entregables

- SQS adapter.
- UI config SQS.
- Manual requeue.
- Native redrive.
- Tests locales y matriz cloud real.

### Validacion del paso

1. Levantare LocalStack con cola origen y DLQ.
2. Enviare mensaje a DLQ y ejecutare `peekMessages`. La prueba pasa si body, attributes y message attributes se normalizan.
3. Ejecutare requeue manual. La prueba pasa si el mensaje aparece en cola origen y se elimina de DLQ despues de send exitoso.
4. Simulare fallo de send. La prueba pasa si no se ejecuta delete del mensaje en DLQ.
5. Ejecutare redrive nativo en entorno que lo soporte. La prueba pasa si se crea move task, se consulta progreso y la UI muestra estado.
6. Intentare editar payload con redrive nativo. La prueba pasa si la UI lo bloquea y explica que esa operacion no permite edicion.
7. Criterio de aprobacion: SQS ofrece ambos caminos sin confundir capacidades ni poner en riesgo mensajes por delete prematuro.

---

## Paso 26 - Agregar alertas, agrupacion por causa y firma de codigo

### Objetivo

Completar capacidades enterprise posteriores al MVP: alertas operativas, agrupacion de errores y distribucion mas confiable mediante firma.

### Que hare

- Agregar reglas de alerta por profundidad, edad maxima y tasa de entrada.
- Integrar webhooks y, si se decide, Slack.
- Agrupar mensajes por reason normalizada, exception type, header o hash de stack trace.
- Configurar firma de macOS y Windows cuando existan certificados.
- Documentar proceso de release firmado.

### Como lo hare

- Main evaluara reglas de alerta desde pollers.
- Las alertas tendran cooldown para evitar ruido.
- La agrupacion se calculara desde metadata normalizada y filtros.
- Firma se incorporara al pipeline de release con secrets protegidos.
- La app mostrara estado de firma/version en pantalla About.

### Que usare

- Pollers existentes.
- SettingsRepository.
- Webhook HTTP desde main.
- electron-builder signing config.
- GitHub Actions secrets.

### Entregables

- Motor de alertas.
- Agrupacion por causa.
- Release firmado.
- Documentacion operativa.

### Validacion del paso

1. Configurare una alerta de profundidad `>= 1` sobre RabbitMQ local. La prueba pasa si al insertar un mensaje muerto se dispara una notificacion una sola vez dentro del cooldown.
2. Configurare webhook de prueba con servidor local. La prueba pasa si recibe payload sin secretos y con profile/source/action esperados.
3. Creare mensajes con la misma reason y distinto payload. La prueba pasa si aparecen agrupados por causa.
4. Ejecutare build firmado en entorno con certificados. La prueba pasa si macOS notariza o Windows firma el ejecutable segun configuracion.
5. Instalare build firmado y verificare que el sistema operativo reduce advertencias comparado con build sin firma.
6. Criterio de aprobacion: la app ayuda a detectar problemas recurrentes y puede distribuirse con postura mas aceptable para usuarios enterprise.

---

## Paso 27 - Documentar modelo de seguridad, operaciones y limites reales

### Objetivo

Dejar la aplicacion lista para evaluacion tecnica seria. Un equipo enterprise debe poder entender que datos se guardan, donde viven los secretos, que operaciones son destructivas y como auditar cambios.

### Que hare

- Crear `docs/security-model.md`.
- Crear `docs/broker-semantics.md`.
- Crear `docs/operations-runbook.md`.
- Crear `docs/testing-matrix.md`.
- Actualizar README con quickstart y limites.

### Como lo hare

- `security-model.md` explicara main/preload/renderer, safeStorage, DB local, logs, redaccion de secretos y limites de Electron.
- `broker-semantics.md` comparara Azure, RabbitMQ, Kafka y SQS por capabilities.
- `operations-runbook.md` explicara como hacer requeue, purge, edit-and-resend y rollback operativo con archived messages.
- `testing-matrix.md` distinguira pruebas unitarias, integracion local, emuladores y pruebas cloud reales.
- README priorizara ejecucion local y flujo MVP antes que marketing.

### Que usare

- Markdown.
- ADRs existentes.
- Resultados reales de pruebas.
- Capturas o GIF del flujo cuando exista UI estable.

### Entregables

- Documentacion de seguridad.
- Documentacion de semantica por broker.
- Runbook operativo.
- Matriz de pruebas.
- README actualizado.

### Validacion del paso

1. Revisare que cada documento tenga objetivo, actor, alcance y limites.
2. Verificare que `docs/broker-semantics.md` menciona explicitamente que Kafka no borra mensajes individuales y que SQS native redrive no permite editar payload.
3. Verificare que `docs/security-model.md` indica que credenciales no cruzan al renderer y que `safeStorage` depende del OS.
4. Ejecutare una prueba de onboarding con un developer que no participo en la implementacion o simulare ese recorrido siguiendo solo README. La prueba pasa si puede levantar entorno, correr app y ejecutar flujo RabbitMQ MVP.
5. Comparare `testing-matrix.md` contra CI. La prueba pasa si cada tipo de prueba documentado tiene comando o razon clara para ejecucion manual.
6. Criterio de aprobacion: el proyecto puede ser revisado, instalado y operado sin depender de conocimiento tribal.

---

## Validacion transversal por tipo de prueba

### Typecheck

Comando esperado:

```bash
pnpm typecheck
```

Debe compilar main, preload, renderer y shared. Cualquier cambio de contrato IPC, dominio o adapter debe romper compilacion si un consumidor no se actualiza.

### Lint

Comando esperado:

```bash
pnpm lint
```

Debe detectar imports prohibidos, especialmente Electron o Node dentro del renderer, y errores de estilo que oculten problemas reales.

### Unit tests

Comando esperado:

```bash
pnpm test
```

Deben cubrir dominio, validators Zod, mapper de errores, secret store mockeado, repositorios con DB temporal, JobRunner con fake timers y reducers/hooks de UI.

### Integration tests

Comando esperado:

```bash
pnpm test:integration
```

Deben levantar brokers mediante Testcontainers o Docker Compose, publicar mensajes muertos, probar adapters y verificar efectos reales en origen y DLQ/DLT.

### E2E

Comando esperado:

```bash
pnpm test:e2e
```

Debe abrir Electron con Playwright y validar el flujo visible: crear conexion, dashboard, inspector, requeue, progreso y auditoria.

### Packaging smoke test

Comando esperado:

```bash
pnpm build
pnpm package
```

Luego se instala el artefacto y se ejecuta el flujo MVP contra RabbitMQ local. Esta prueba detecta fallos que no aparecen en dev server, como rutas mal empaquetadas, modulos nativos no reconstruidos o DB en ubicacion incorrecta.

## Criterios de aceptacion del MVP

- El operador puede crear un perfil RabbitMQ y Azure Service Bus con credenciales cifradas.
- El perfil queda read-only por defecto.
- El dashboard muestra DLQs con profundidad y actualizacion en vivo.
- El inspector muestra mensajes muertos sin consumo destructivo no documentado.
- El operador puede filtrar mensajes.
- El operador puede hacer requeue individual y masivo con throttle.
- El sistema bloquea requeue si el perfil esta read-only.
- Cada requeue crea auditoria con conteos, source, timestamp, hashes y resultado.
- La app empaquetada abre y ejecuta el flujo RabbitMQ MVP sin servidor de desarrollo.
- La documentacion explica limites reales por broker.

## Preguntas abiertas antes de implementar

1. Confirmar si el MVP debe soportar discovery automatico de DLQs en RabbitMQ mediante management API o si basta configuracion manual de DLQs por perfil.
2. Confirmar estrategia exacta de Azure Service Bus en local: emulador, namespace cloud de desarrollo o ambos.
3. Confirmar si el equipo quiere `pnpm` como gestor oficial.
4. Confirmar politica de archivado: archivar siempre antes de purge/edit o permitir configuracion por perfil.
5. Confirmar si auditoria requiere usuario local del OS, usuario interno de la app o ambos.
6. Confirmar si los payloads archivados deben cifrarse tambien en SQLite. Recomendacion: si pueden contener datos sensibles, cifrar snapshots igual que credenciales o cifrar a nivel de campo.
