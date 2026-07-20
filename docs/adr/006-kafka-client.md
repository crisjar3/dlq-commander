# ADR 006: Cliente Kafka para Electron

## Estado

Aceptado.

## Contexto

El adapter Kafka debe ejecutarse dentro del proceso principal de Electron 43, tanto durante desarrollo como dentro del paquete ASAR. La primera evaluación usó `@confluentinc/kafka-javascript`: el cliente conectó correctamente desde Node.js, pero la carga de su addon nativo bloqueó el arranque del proceso principal de Electron en este entorno.

El adapter necesita PLAINTEXT local, administración de topics, lectura manual sin commits y producción con headers. La interfaz actual no configura transacciones, Schema Registry ni funciones específicas de librdkafka.

## Decisión

Usar `kafkajs` 2.2.x, un cliente JavaScript sin addon nativo, detrás de `KafkaAdapter`. El dominio y la UI dependen de `BrokerAdapter`, no de KafkaJS, y conservan estable el límite IPC.

## Validación

- La prueba de integración conecta a `localhost:9092`, inspecciona la DLT, copia un registro y lo consume del destino.
- La prueba E2E arranca el binario Electron real, guarda el perfil y ejecuta conexión + discovery mediante IPC.
- El packaging debe completar sin reconstruir addons Kafka para el ABI de Electron.

## Consecuencias

- Se evita una dependencia nativa adicional y su matriz de ABI/empaquetado.
- El perfil actual cubre PLAINTEXT; TLS y SASL no están disponibles en la interfaz.
- El contrato del adapter exige conservar identificadores `topic:partition:offset`, ausencia de commits durante inspección y semántica append-only del requeue, con independencia del cliente interno.
