# CLAUDE.md · ALZA

## Qué es ALZA

ALZA es un asistente de registro financiero por WhatsApp para bodegueras peruanas que cobran con Yape, Plin y efectivo.

- **Durante el día:** ella manda una captura por cada cobro digital y cuenta sus ventas en efectivo por texto o audio. ALZA registra en silencio.
- **Al cierre del día:** ALZA le manda un solo mensaje con su resumen, sus dudas y el cuadre de caja.
- **En la web (con PIN):** ve sus puntos, su historial y un chat.

Es un MVP para la hackathon del Reto 2 (CIX/BCP). Lo que es de ejemplo (catálogo de premios, recomendaciones de Yape y Mibanco) se dice en pantalla.

## Fuente de verdad

- `docs/ALZA_PRODUCT_SPEC.md` manda sobre este archivo y sobre el código.
- `docs/ALZA_INSUMOS_PENDIENTES.md`: lo que falta conseguir (datasets, accesos, textos, línea gráfica, stack).
- `docs/alza-flujos.html`: diagramas de los flujos.
- Si algo no está en la spec, no inventes reglas de negocio: pregunta.
- Cita por identificador: decisiones D01–D32, propuestas confirmadas PR01–PR18, requisitos RF-xx, historias HU-xx, casos límite de la sección 11.12.
- Toda decisión nueva se registra en la spec (sección 2.2 y registro de cambios).

## Reglas que nunca se rompen

### Montos y libro de registros
- Montos en céntimos enteros.
- Nunca inventar un monto: si no se lee con seguridad, se crea una duda.
- Nada se borra. Corregir crea un registro nuevo y el anterior queda reemplazado o anulado.
- Cada mensaje de WhatsApp se procesa una sola vez (`wa_message_id`).
- El día del negocio va de 4:00 a. m. a 3:59 a. m., hora de Lima.

### Mensajes y textos
- ALZA no envía mensajes fuera del catálogo de la sección 12.1: el silencio es parte del producto y cada mensaje cuesta.
- La palabra «ganancia» no existe en la app.

### IA
- La imagen de resumen y el PDF se generan con plantillas y código, sin IA.
- La IA solo se usa a través de la capa intercambiable (sección 8.3).
- El chat de la web solo propone cambios; nunca los ejecuta.
- Datos reales de usuarias nunca van a modelos gratuitos.

### Seguridad y alcance
- Secretos fuera del código.
- Los registros del sistema no guardan contenido de mensajes ni montos junto a nombres.
- Nada de lo que la spec deja fuera del MVP (sección 3.3).

## Idioma

- **Código en inglés:** tablas, campos, variables, funciones, JSON, rutas y commits (D32).
- **Usuaria en español:** todo lo que ve en WhatsApp, la web y el PDF, usando los textos de la sección 12 y el glosario del Anexo A.
- La spec escribe el modelo de datos y los contratos en español para que se lean fácil. En el código se usan los nombres de la tabla de vocabulario.

## Cómo trabajar

- La spec trae un orden sugerido por hitos (sección 16) y criterios de aceptación (sección 7). Son una guía, no una receta.
- Antes de construir algo, lee su sección en la spec. Al terminar, pruébalo contra sus criterios y casos límite.
- Si encuentras un vacío o una contradicción, detente y pregunta.
- Al cerrar cada parte, actualiza «Estado actual».

## Por completar

### Stack (D45)

- **Lenguaje:** TypeScript (ESM) en Node 24, monorepo con npm workspaces: `server/` y `web/`.
- **Servidor:** Hono (`@hono/node-server`), zod, pino. En producción también sirve `web/dist`.
- **Base de datos:** Postgres 16 con Drizzle ORM (`pg`) y migraciones de drizzle-kit. En local, Docker Compose (puerto 5433, bases `alza` y `alza_test`).
- **Almacenamiento:** interfaz `BlobStorage`; por ahora, archivos cifrados (AES-256-GCM) en la tabla `storage_objects`.
- **Cola y tareas programadas:** pg-boss sobre el mismo Postgres, siempre en `America/Lima`.
- **Web:** Vite, React 19, Tailwind v4, wouter, Inter (`@fontsource-variable/inter`).
- **Herramientas:** Vitest, Biome (lint y formato), `tsc` (TypeScript 7) para tipos.
- **Hosting:** Railway (por configurar).

### Comandos

Primero: `cp .env.example .env` y completar `ENCRYPTION_KEY` (`openssl rand -base64 32`).

| Para | Comando |
|---|---|
| Instalar | `npm install` |
| Levantar Postgres | `npm run db:up` (`db:down` lo apaga) |
| Migrar | `npm run db:migrate` |
| Nueva migración | cambiar `server/src/db/schema.ts` → `npm run db:generate` → revisar el SQL en `server/drizzle/` |
| Desarrollo | `npm run dev` (server en :3000 y web en :5173, con proxy de `/api`) |
| Pruebas | `npm test` (borra y migra `alza_test` en cada corrida) |
| Tipos | `npm run typecheck` |
| Lint / formato | `npm run lint` / `npm run format` |
| Build | `npm run build` (`web/dist` y `server/dist`) |
| Producción | `npm start` (sirve web, `/api` y `/health` en `PORT`); migrar con `npm run db:migrate:dist -w server` |
| Evaluar la IA | `npm run eval -w server`: todo el dataset por el pipeline real, tabla de 17.2 y corrida en `datasets/eval-runs/` (opciones: `--only=images,generated,audios,texts,close`, `--route=<función>=<ruta>` para probar un modelo, `--delay-ms`). Casos difíciles: `npm run eval:generate -w server`. Modelos disponibles: `npx tsx src/scripts/eval-list-models.ts` (en `server/`) |
| Desplegar | _por definir_ (Railway) |

### Estructura del repositorio

```
server/
  drizzle/        migraciones SQL generadas (no se editan a mano)
  test/           setup de Vitest y ayudas para la base de pruebas
  src/
    index.ts      arranque: HTTP + pg-boss, apagado ordenado
    config.ts     variables de entorno validadas con zod
    paths.ts      rutas absolutas y carga de .env
    lib/          utilidades transversales (logger con datos ocultos)
    db/           schema.ts (modelo 9.1 completo), client.ts, migrate.ts
    storage/      BlobStorage y su versión cifrada en Postgres
    queue/        pg-boss: inicio, parada, scheduleInLima
    http/         app Hono, /health y routers de /api
    domain/       [Fase 1] reglas de negocio como funciones puras (11, 13.1, 14.3)
    ai/           [Fase 2] capa de IA intercambiable (8.3): Groq y Gemini
    ocr/          [Fase 2] tesseract.js y lectores por diseño de captura
    channel/      [Fase 3] interfaz de canal: simulado; Meta en la Fase 10
    pipeline/     [Fase 3] worker: clasificar, leer, interpretar, registrar, dudas
    messages/     [Fase 4–5] catálogo 12.1 como plantillas: única forma de enviar
    flows/        [Fase 4–5] alta, excepciones, cierre y su respuesta
    jobs/         [Fase 6] tareas programadas de 8.4
    render/       [Fase 5/8] imagen de resumen (Satori + resvg), PDF y Excel
    scripts/      comandos sueltos (migrate; luego datos de demo y evaluación de IA)
web/
  public/         favicon
  src/
    main.tsx      entrada; App.tsx con las rutas / (landing) y /app/* (carga diferida)
    components/   piezas reutilizables (AlzaLogo)
    routes/       pantallas
    index.css     tokens de docs/alza_mvp.html como tema de Tailwind
docker/postgres/init/   crea alza_test al iniciar el volumen
```

### Convenciones de código

- Código en inglés con el vocabulario de abajo; todo texto para la usuaria, en español (sección 12 y Anexo A).
- Montos: enteros en céntimos (`amountCents`, columnas `*_cents`). Se formatean solo al mostrar.
- Día del negocio: `date` `YYYY-MM-DD` calculado en `domain/`, nunca en SQL ni con la zona del servidor.
- Valores cerrados: arrays `as const` y sus tipos en `db/schema.ts`; en la base, `text` con `CHECK`. Cambiar un valor exige migración.
- `domain/` es puro: sin base de datos, red, archivos ni `Date.now()`; el reloj entra como parámetro.
- Dependencias por parámetro (`db`, `logger`, `storage`, `boss`). Sin singletons, salvo `getConfig()`.
- ESM NodeNext: imports relativos con `.js`. `schema.ts` no importa archivos propios (drizzle-kit no los resuelve).
- Pruebas junto al código (`*.test.ts`). Las que usan la base van con `describe.skipIf(!hasTestDb)` y datos únicos por prueba.
- Logs: solo identificadores (`userId`, `waMessageId`, `jobId`). Nunca textos, montos, nombres, teléfonos ni tokens; los errores pasan por `serializeError`.
- Libro de registros: solo se agregan filas; corregir = fila nueva con `replacesEntryId` y la anterior `superseded` o `voided`.
- Tareas programadas solo con `scheduleInLima`.
- Formato de Biome (comillas simples, 100 columnas). `npm run lint`, `npm run typecheck` y `npm test` pasan antes de cerrar una tarea.

## Vocabulario (spec → código)

### Entidades

| Spec (español) | Código (inglés) |
|---|---|
| usuaria | `user` |
| titular (principal y adicionales) | `account_holder` |
| consentimiento | `consent` |
| mensaje entrante / saliente | `inbound_message` / `outbound_message` |
| archivo (imagen o audio) | `media_file` |
| extracción | `extraction` |
| libro de registros | `ledger` |
| movimiento | `ledger_entry` |
| contraparte | `counterparty` |
| regla de contraparte | `counterparty_rule` |
| lista de movimientos | `activity_list` |
| duda | `clarification` |
| cierre | `daily_close` |
| día del negocio | `business_day` |
| cuadre de caja | `cash_check` |
| variación esperada del efectivo | `expected_cash_change` |
| línea informativa del cierre | `close_notice` |
| resumen semanal | `weekly_summary` |
| imagen de resumen | `summary_image` |
| puntos / movimiento de puntos | `points` / `points_entry` |
| racha | `streak` |
| comodín | `streak_freeze` |
| hito / meta grande | `milestone` / `big_goal` |
| premio / canje | `reward` / `redemption` |
| enlace de activación / de acceso | `activation_link` / `access_link` |
| celular recordado | `trusted_device` |
| acción propuesta (chat) | `proposed_action` |
| reporte | `report` |
| panel interno / alerta | `admin_panel` / `alert` |
| usuario del panel / registro de acciones del panel | `admin_user` / `admin_audit_log` |
| lista de espera (landing, D43, D52) | `waitlist_signup` |
| archivo cifrado guardado (D45) | `storage_object` |

### Valores

| Campo | Spec → código |
|---|---|
| dirección | entra → `in` · sale → `out` |
| medio | yape → `yape` · plin → `plin` · efectivo → `cash` · transferencia → `bank_transfer` · desconocido → `unknown` |
| categoría | venta → `sale` · otro_ingreso → `other_income` · mercadería → `inventory` · gasto → `expense` · casa → `household` · por_clasificar → `unclassified` · interno → `internal` · personal → `personal` |
| alcance | operación → `single` · total parcial → `partial_total` · total del día → `day_total` |
| estado del movimiento | confirmado → `confirmed` · pendiente → `pending` · duplicado → `duplicate` · anulado → `voided` · reemplazado → `superseded` |
| etiqueta | con_captura → `screenshot` · lo_contaste → `self_reported` · sin_detalle → `unitemized` |
| nivel del cierre | completo → `complete` · parcial → `partial` · sin_cierre → `no_close` |
| cuadre | cuadra → `balanced` · ajustado → `adjusted` · no_sabe → `unsure` · sin_respuesta → `no_answer` |
| tipo de duda | total_ambiguo → `ambiguous_total` · posible_duplicado → `possible_duplicate` · ilegible → `unreadable` · dirección → `direction` · fecha → `date` · categoría → `category` · faltante_lista → `missing_from_list` |
| intención | registrar → `record` · corregir → `correct` · responder el cierre → `close_reply` · pedir algo → `request` · peligro → `danger` · cerrar → `close_now` · otro → `other` |

## Estado actual

- **Descubrimiento:** cerrado (spec v1.6). Decisiones nuevas D53 en adelante están en `FASES.md` (falta pasarlas a la spec).
- **Avance:** ver `FASES.md`. Listas en `main`: Fases 0–7 y 9; de la 8, chat, descarga y panel interno.
- **Trabajo a medias (sin verificar):** rama `wip/integracion-ia` → integración en `server/src/index.ts` + recorrido completo, y ajuste de IA (consumo del chat, «vendí 5 de pan», certificación D35). Detalle en «En curso ahora» de `FASES.md`.
- **Al retomar:** trabajar en `wip/integracion-ia`; `npm run db:up`, `npm run db:migrate`, `npm run typecheck`, `npm test`; terminar, verificar y unir a `main`.
- **Regla acordada:** detenerse ANTES de la Fase 10 (WhatsApp real / Meta). La dueña configura Meta primero; luego Fase 10 y 11.
- **Pruebas en paralelo:** cada agente usa su propia base (`DATABASE_URL_TEST=postgres://alza:alza@localhost:5433/alza_test_a` … `_e`) porque el setup borra el esquema.
- **`.env` no está en git:** pedir las llaves (Gemini ×3, Groq) por un canal privado; `ENCRYPTION_KEY` se genera con `openssl rand -base64 32`.
