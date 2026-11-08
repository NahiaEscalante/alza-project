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

Se define al trabajar en el proyecto.

- **Stack** (lenguaje, base de datos, almacenamiento, cola, hosting): _por definir_
- **Comandos** (instalar, correr, probar, evaluar la IA, desplegar): _por definir_
- **Estructura del repositorio:** _por definir_
- **Convenciones de código:** _por definir_

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

- **Fase de descubrimiento:** cerrada (spec v1.5).
- **Desarrollo:** plan por fases en `FASES.md` (Fase 0 a Fase 11). Marcar ahí cada avance.
- **Fase actual:** 0 · Cimientos.
- **Insumos pendientes:** ver `docs/ALZA_INSUMOS_PENDIENTES.md`.
- **Siguiente paso:** registrar las decisiones D33–D47 en la spec y crear el proyecto.
