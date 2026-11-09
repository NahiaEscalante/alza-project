# ALZA · Fases de desarrollo

Plan para llegar a la demo completa. La spec (`docs/ALZA_PRODUCT_SPEC.md`) sigue mandando; este archivo solo ordena el trabajo.

- Marca `[x]` cada tarea al terminarla y cambia el estado de la fase.
- Una fase está lista cuando cumple su «Listo cuando».
- Estados: ⬜ por empezar · 🟨 en curso · ✅ lista

| Fase | Nombre | Estado |
|---|---|---|
| 0 | Cimientos | ✅ |
| 1 | Reglas del negocio | ✅ |
| 2 | Lectura de capturas y audios | ✅ |
| 3 | Recepción y libro de registros | ✅ |
| 4 | Alta y mensajes de excepción | 🟨 |
| 5 | Cierre del día | 🟨 |
| 6 | Puntos y tareas programadas | ✅ |
| 7 | Web de la usuaria | ✅ |
| 8 | Chat, reporte y panel interno | 🟨 |
| 9 | Landing | ✅ |
| 10 | WhatsApp real (Meta) | ⬜ |
| 11 | Demo | ⬜ |

## En curso ahora

🔄 marca las tareas que un agente está haciendo en este momento.

- **Fase 4:** alta por WhatsApp y mensajes de excepción («web», «olvidé mi PIN», «borra mis datos», peligro, «sin imagen»).
- **Fase 5:** cierre del día completo (mensaje único, respuesta, aclaraciones, nivel y confirmación).

**Siguiente:** conectar todo en el arranque del servidor, panel interno (Fase 8), Fase 10 (Meta y Railway) y Fase 11 (demo).

## Orden

```
F0 ─┬─ F1 ─┬─ F3 ─ F4 ─ F5 ─ F6 ─┬─ F10 ─ F11
    │      └─ F7 ─ F8 ────────────┤
    ├─ F2 ─── F3                  │
    └─ F9 (en cualquier momento) ─┘
```

- F1 (reglas) y F2 (lectura) van en paralelo: no dependen una de otra.
- Meta queda para el final (F10). Hasta entonces se usa un **canal simulado** con el mismo formato de mensajes y los mismos límites de Meta (1.024 caracteres por texto con imagen, 3 botones, 20 caracteres por botón), para que el cambio sea mecánico.

---

## Decisiones tomadas para poder desarrollar

D33–D52 ya están en la spec v1.6. D53 en adelante se registran en la spec al cerrar la ronda en curso.

| ID | Decisión |
|---|---|
| D33 | Capturas: OCR local (tesseract.js) más lectores por diseño (Yape, BBVA, Bancom, Luqea). Si el diseño no se reconoce, se usa un modelo con visión; si tampoco se lee, duda «ilegible». |
| D34 | Audio: Whisper en Groq; si falla, Gemini, que acepta audio. |
| D35 | Texto e interpretación: Groq y Gemini con cambio automático ante límite o error. Cada modelo entra a la rotación solo si pasa la evaluación (17.2). Cerebras queda fuera: no tiene capa gratuita. |
| D36 | Dirección en Yape por el encabezado: «¡Te Yapearon!» entra, «¡Yapeaste!» sale. El titular se compara solo cuando la pantalla lo muestra (cambia 11.2). |
| D37 | Cierre (WA-10): imagen subida a WhatsApp por su ID, con el texto como pie y el enlace dentro del texto. Entran las dudas que quepan en 1.024 caracteres; el resto va a Pendientes en la web. Con «solo texto», va como mensaje de texto. |
| D38 | Resumen del domingo: suma los montos de lunes a domingo y cuenta los cierres de lunes a sábado (los que ya son finales). PR02 compara con esos conteos. |
| D39 | Si escribe «cierre» y el día no tiene registros ni dudas, recibe un mensaje nuevo (WA-21): «Hoy todavía no tengo nada anotado. Cuando me mandes tus capturas o ventas, te armo tu cierre». |
| D40 | El aviso «Faltan S/X en capturas» (11.5) es una línea informativa del cierre, fuera de las 5 dudas. |
| D41 | WA-07 dice el tipo y el medio reales («venta por Plin», «pago por Yape»). Si la primera captura no se lee, se confirma la primera que sí se lea. |
| D42 | El consejo por capturas ilegibles aplica en las primeras 2 semanas (corrige el caso límite 28). |
| D43 | Landing pública en la raíz de la web, con lista de espera (con consentimiento) y QR a WhatsApp para el teléfono de la demo. Logos de CIX (destacado), UTEC Ventures y Credicorp. |
| D44 | Los logos de Yape y Mibanco están autorizados (cierra la condición de PR05). |
| D45 | Stack: TypeScript (Node 24), Hono, pg-boss, Postgres con Drizzle, Vite con React y Tailwind, hosting en Railway. Al inicio, los archivos se guardan cifrados (AES-256-GCM) en Postgres, detrás de una interfaz de almacenamiento. |
| D46 | WhatsApp real (Meta) se conecta al final; hasta entonces, canal simulado. |
| D47 | La web usa los textos de la spec («Con captura», «Lo contaste tú») y el diseño de `docs/alza_mvp.html` como guía, incluido el botón para ocultar montos. |
| D53 | Duda de fecha: una captura sin fecha legible, o con fecha futura, va al día de llegada y crea una duda «fecha» («¿Es de hoy?»). Textos y audios nunca crean esa duda. |
| D54 | Detalles de reglas: tope de S/ 99 999,99 por registro; las 12:00:00 ya están fuera de plazo; un total en efectivo menor a lo anotado crea una duda de total ambiguo; «cierre» sobre un cierre ya respondido también recibe WA-22; el PIN rechaza secuencias que dan la vuelta (890123). |
| D55 | Una salida sin tipo claro se confirma como «por clasificar» con una duda de baja prioridad (PR15 manda sobre HU-03). |
| D56 | Acceso web: el PIN se guarda con scrypt (algoritmo lento equivalente a Argon2id/bcrypt; no hay librería de Argon2 instalada). El enlace de activación se gasta al crear el PIN; uno nuevo anula los anteriores. Una sesión existe solo tras un PIN correcto en ese celular, y cada PIN correcto renueva los 30 días. Un PIN incorrecto responde 422 para no confundirlo con una sesión perdida. |
| D57 | Libro y cuenta: una corrección desde la web siempre queda como «Lo contaste tú»; resolver una duda sin cambiar el monto conserva la etiqueta. Las dudas guardan su contexto en `clarifications.detail`. El borrado de cuenta es inmediato y deja solo una fila anónima; también borra su registro de la lista de espera. |
| D58 | Lectura: un monto de OCR exige tres lecturas que coinciden y los controles fijos; uno de visión se acepta con confianza ≥ 0,9 (≥ 0,7 si coincide con lo que vio el OCR); si OCR y visión no coinciden, la captura es ilegible. `holder_role` describe a la dueña de la pantalla. Una venta por texto sin medio es efectivo; un total sin medio queda «desconocido». «Le fié» no se registra (D09). |
| D59 | Regla «personal» por contraparte (PR14): rechazarla o apagarla deja la regla inactiva; la oferta vuelve solo tras 3 marcas nuevas. Aceptarla solo afecta los pagos que llegan después; el pasado no cambia. |
| D60 | Imagen y reporte: Yape y Plin y Efectivo siempre se muestran (en gris si son S/ 0); «sin detalle» y «por clasificar» solo si hay monto. El bloque del domingo puede decir «Te quedó S/X más/menos que la semana pasada» (solo si aplica PR02). «4 semanas» y «12 semanas» son semanas completas de lunes a domingo hasta hoy. En el reporte, clientes y proveedores van con hasta dos iniciales. La hoja «Ajustes» lista correcciones, anulaciones, agregados después del cierre (PR03), agregados en días pasados y diferencias de PR09. |
| D61 | Recepción: un mensaje se procesa de a uno por usuaria; todo lo que escribe en el libro va en una sola transacción con su estado final. Una duda de fecha (D53) deja el registro pendiente; una de categoría (D55) lo confirma. Una contraparte con nombre de distribuidora, mayorista o proveedor se toma como mercadería (HU-03). Los comprobantes de proveedor no se registran (la spec no tiene regla). Una captura anula una mención por texto que coincide. Para botones, se guarda el id del botón. |
| D62 | Tareas programadas: cada día desde su primera actividad (nunca antes del consentimiento) tiene un cierre final, para poder reintentar sin duplicar. Un cierre enviado y no respondido queda con cuadre «sin respuesta». Con una alerta de titular repetido abierta, el día se cierra y la racha avanza, pero no suma puntos ni se pagan después. Un original borrado a los 30 días queda marcado en `storage_key` como `deleted/…`. Antifraude [PROP]: respuestas en menos de 15 s, al menos 5 veces, siempre «sí»; salto de actividad = más del triple del promedio de hasta 4 semanas anteriores. |
| D63 | Descarga del historial: los archivos duran 7 días (después, «ya no está disponible»; se borran los archivos y queda la fila para métricas); máximo 5 reportes por hora; el periodo por defecto es 12 semanas; los logos de Yape y Mibanco enlazan a sus sitios oficiales y se marcan «Ejemplo para la demo» (3.2). |
| D64 | Chat: herramienta extra `list_pending` (no está en 10.5). El modelo señala registros con referencias del turno, nunca con ids de la base. Solo propone cambios si ella lo pide. Las preguntas de crédito reciben un texto fijo aprobado, sin llamar al modelo. Respuestas que prometen crédito, dicen que ya cambiaron algo o usan «ganancia» se reemplazan. Una sola propuesta abierta a la vez, que vence a las 24 h. |

---

## Fase 0 · Cimientos ✅

**Objetivo:** proyecto creado, base de datos lista y una versión vacía funcionando en Railway.

- [x] Registrar D33–D47 en la spec (v1.6) y corregir HU-14 (quitar [PROP], ya es PR04).
- [x] Completar «Por completar» en `CLAUDE.md`: stack, comandos, estructura y convenciones.
- [x] Monorepo con npm workspaces: `server/` (Node + Hono) y `web/` (Vite + React + Tailwind).
- [x] `.env.example` y carga de configuración validada (llaves con nombres estándar: `GEMINI_API_KEY_1` a `GEMINI_API_KEY_3`, `GROQ_API_KEY`).
- [x] Postgres local con Docker Compose.
- [x] Esquema completo de la sección 9.1 con Drizzle (nombres en inglés, vocabulario de `CLAUDE.md`) y migraciones.
- [x] pg-boss instalado (cola y tareas programadas en zona `America/Lima`).
- [x] Vitest, linter y formateador.
- [x] Registros del sistema con pino, ocultando datos sensibles (RNF-09).
- [x] ~~Proyecto en Railway~~ → pasa a la Fase 10 (necesita iniciar sesión en la cuenta de Railway).

**Listo cuando:** `npm test` pasa y la app corre en local y responde `/health`. (Resultado: 48 pruebas, typecheck, lint y build limpios.)

## Fase 1 · Reglas del negocio ✅

**Objetivo:** toda la lógica de la sección 11 y 13.1 como funciones puras, probadas sin WhatsApp ni IA.

- [x] Montos en céntimos y formato «S/ 1 234,50» (RNF-11).
- [x] Día del negocio de 4:00 a 3:59 y semana de lunes a domingo (D12, 11.1), con reloj simulado.
- [x] Normalización de nombres y `coincide()` (11.2).
- [x] Dirección del pago, con la regla de Yape (11.2, D36).
- [x] Duplicados (11.4).
- [x] Totales declarados, incluido PR09 (11.5).
- [x] Indicadores: entró, salió, te quedó, por confirmar (11.6).
- [x] Cuadre de caja (11.7).
- [x] Dudas: prioridad, orden y selección que cabe en el mensaje (11.8, D37).
- [x] Niveles del cierre (11.9).
- [x] Conciliación de la lista de movimientos (11.10).
- [x] Resumen semanal y comparación (11.11, PR02, D38).
- [x] Puntos, racha, comodines, bonos y vencimiento (13.1, D29).
- [x] Reglas del PIN (14.3).
- [x] Una prueba por cada caso límite de 11.12 que no dependa de la IA.

**Listo cuando:** pasan las pruebas de reglas de la sección 17.1. (Resultado: 322 pruebas en `server/src/domain`.)

## Fase 2 · Lectura de capturas y audios ✅

**Objetivo:** convertir capturas, audios y textos en operaciones, sin inventar montos.

- [x] Hoja de respuestas correctas (`datasets/answers.csv`) para las 8 capturas y los 3 audios.
- [x] 30 textos y 20 respuestas al cierre de prueba, con sus respuestas correctas.
- [x] Casos difíciles generados desde las capturas: recorte, desenfoque, modo oscuro, foto de pantalla, reenvío.
- [x] OCR local con tesseract.js (español, datos incluidos en el servidor).
- [x] Lectores por diseño: Yape recibido y enviado, BBVA (transferencia y Plin), Bancom, Luqea.
- [x] Clasificación de imágenes: constancia, lista, comprobante, otra financiera, no financiera (RF-EX-01).
- [x] Capa de IA intercambiable (8.3) con Groq y Gemini, cambio automático y salidas validadas con Zod.
- [x] Transcripción: Whisper en Groq y Gemini de respaldo (D34).
- [x] Interpretación de textos: intención y operaciones (RF-EX-04, RF-EX-05).
- [x] Interpretación de la respuesta al cierre (10.3).
- [x] Controles fijos después de leer: máximo 2 decimales, fecha no futura, número de operación con formato válido.
- [x] Script de evaluación que produce la tabla de 17.2 y guarda cada corrida.

**Listo cuando:** la evaluación corre sobre todo el dataset con 0 montos inventados. (Resultado: 0/124 montos inventados; monto, dirección y fecha 100 %; ilegibles 100 %; textos y audios 95,5 %; respuestas al cierre 100 %. Corrida en `datasets/eval-runs/`.)

- [ ] Certificar cada modelo por separado con `--route` antes de dejarlo en la rotación (D35).

## Fase 3 · Recepción y libro de registros ✅

> Pendientes que vienen de la Fase 7a: crear dudas con `createClarification` (y su `detail`); llamar `ensureRewardsCatalog` al arrancar.

**Objetivo:** un mensaje entra, se procesa una sola vez y queda en el libro con su etiqueta o su duda.

- [x] Interfaz de canal con el adaptador simulado (el de Meta llega en la Fase 10).
- [x] Webhook con el formato de Meta (10.1): guardar, responder 200 en menos de 2 segundos y encolar (RF-IN-01).
- [x] Idempotencia por `wa_message_id` (RF-IN-02).
- [x] Marcar como leído (simulado) (RF-IN-03).
- [x] Archivos cifrados con su SHA-256 (RF-IN-04).
- [x] Nada se procesa sin consentimiento (RF-ON-02).
- [x] Worker: clasificar, leer, interpretar, aplicar reglas, crear dudas.
- [x] Reintentos (3, con espera creciente) y estado de error (RF-IN-05).
- [x] Correcciones («eso no, eran 52») y anulaciones con trazabilidad (RF-LB-01, RF-LB-02).
- [x] Simulador de WhatsApp en `/dev/simulador`: mandar textos, capturas del dataset y audios, y ver los mensajes salientes.

**Listo cuando:** 100 mensajes repetidos no crean duplicados y un día de mensajes deja el libro correcto. (Resultado: 128 pruebas en recepción, canal, libro y webhook; prueba real en el simulador con una captura de Yape del dataset.)

- [ ] Ajustar el prompt para «vendí 5 de pan» (hoy lo lee como 5 panes y crea una duda) y sumarlo al dataset.

## Fase 4 · Alta y mensajes de excepción 🟨

> De la Fase 7a: «web» de alguien sin PIN debe recibir un enlace de activación, no el de 7 días.

**Objetivo:** una usuaria nueva se registra y ALZA solo habla cuando debe.

- [ ] 🔄 Catálogo de mensajes de 12.1 como plantillas (incluido WA-21): única forma de enviar.
- [ ] 🔄 Alta: consentimiento con versión, negocio, titular (o captura), hora de cierre y retomar a medias (5.1).
- [ ] 🔄 Enlace de activación de 1 hora (D13).
- [ ] 🔄 Confirmación de la primera captura (PR01, D41).
- [ ] 🔄 Excepciones: «web», «olvidé mi PIN», «borra mis datos» (con botones), peligro (WA-20), consejo por ilegibles (WA-19), «sin imagen» y «con imagen».
- [ ] 🔄 Borrado de cuenta (RF-PV-01).

**Listo cuando:** HU-01 y HU-15 pasan en el simulador.

## Fase 5 · Cierre del día 🟨

> De la Fase 7a: la línea de PR03 no cuenta lo agregado desde la web (`source: web`); el aviso de PIN (D28) se lee con `hasPendingSecurityNotice` y se marca con `markSecurityNoticesShown`.

**Objetivo:** el mensaje único de cierre sale, se responde en un solo mensaje y el día queda con su nivel.

- [ ] 🔄 Composición del cierre: resumen, hasta 5 dudas que quepan, cuadre al final, líneas informativas, bloque del domingo y enlace de 7 días (WA-10, D37).
- [x] Imagen de resumen con plantilla y código (Satori y resvg): 4 variantes, menos de 150 KB, comparación visual automática (8.6). (36–72 KB, ~200 ms; `npm run render:preview -w server`.)
- [ ] 🔄 Envío a la hora de cada usuaria (cada 5 minutos) o al escribir «cierre».
- [ ] 🔄 Interpretación y aplicación de la respuesta; hasta 2 aclaraciones (WA-11).
- [ ] 🔄 Nivel del cierre y confirmación con puntos (WA-12).
- [ ] 🔄 Respuestas fuera de plazo (WA-18) y ajustes después del cierre (PR03).
- [ ] 🔄 Los 7 días tipo de los insumos (sección 4) como pruebas de punta a punta.

**Listo cuando:** los días tipo pasan en el simulador (HU-06, HU-07).

## Fase 6 · Puntos y tareas programadas ✅

**Objetivo:** el sistema cierra los días, da los puntos y limpia solo.

- [x] 12:00: cierres finales, puntos, racha, comodines y bonos; dudas a la web (8.4).
- [x] Lunes 12:00: bono semanal y consolidación.
- [x] 03:00: borrar originales con más de 30 días (PR07) y enlaces vencidos.
- [x] 04:00: vencimiento de puntos tras 6 meses sin cierres (D29).
- [x] Antifraude: titular repetido, misma captura en cuentas distintas, alertas (13.4).
- [x] Borrar registros de la lista de espera con más de 6 meses (D52).
- [x] Simulación de una semana completa con reloj simulado.

**Listo cuando:** HU-08 pasa con la semana simulada. (Resultado: 47 pruebas; semana simulada con bono del lunes y primera racha. Horarios: 03:00 limpieza, 04:00 vencimiento, 05:00 antifraude, 12:00 cierres finales y puntos.)

- [x] Ajustes: días sin actividad se muestran como «Sin movimientos»; chequeo antifraude al agregar titulares en la web; no se salta el día si el servidor se reinicia a las 12:00; los reportes vencidos se borran a las 03:00.

## Fase 7 · Web de la usuaria ✅

**Objetivo:** ella entra con su enlace y su PIN, ve sus números, corrige y canjea.

- [x] (servidor) API de la web, servicio del libro, borrado de cuenta y datos de demo (`npm run seed:demo -w server`).
- [x] (interfaz) Acceso: activación, crear PIN, enlace de 7 días, celular recordado, PIN válido por 10 minutos, bloqueos y salir de todos (14.3).
- [x] Inicio: barra de puntos con hitos, semana (entró, salió, te quedó), gráfico por día y aviso de pendientes.
- [x] Movimientos: días con nivel, registros con etiqueta, corregir, quitar y agregar en días pasados (D16).
- [x] Pendientes resolubles con toques.
- [x] Premios: catálogo de ejemplo por hitos, canje con PIN y código `DEMO-XXXX` (13.3).
- [x] Ajustes: solo texto, titulares adicionales, ocultar montos, borrar cuenta.
- [x] Diseño basado en `docs/alza_mvp.html`.
- [x] Primera carga de menos de 300 KB (RNF-06) y accesibilidad (RNF-07).

**Listo cuando:** HU-09 a HU-12 pasan. (Resultado: recorrido completo con `node web/e2e/app-smoke.mjs`; primera carga de `/app` ~127 KB comprimidos. Chat y Descargar dicen «Muy pronto» hasta la Fase 8.)

## Fase 8 · Chat, reporte y panel interno 🟨

**Objetivo:** completar lo que queda de la web y dar herramientas al equipo.

- [x] Chat que responde, con herramientas de solo lectura (10.5) y límite de 30 mensajes al día.
- [x] Chat que propone cambios con «antes y después» y confirmación con PIN.
- [ ] Bajar el consumo del chat (hoy ~8.000 tokens por turno: Groq permite ~1 turno por minuto y las 3 llaves de Gemini se agotaron en las pruebas). Riesgo para la demo.
- [x] Reporte PDF y Excel con anexo de trazabilidad y clientes con iniciales (5.10). (Generación lista; falta conectarla a la pantalla «Descargar mi historial».)
- [x] API y pantalla de descarga del historial, con «Conoce opciones para tu negocio en Yape y Mibanco» y sus logos (PR05).
- [ ] Pantalla de descarga con «Conoce opciones para tu negocio en Yape y Mibanco» y sus logos.
- [ ] Panel interno: mensajes con error y reintento, canjes grandes, alertas, métricas, registro de quién hizo qué.
- [ ] Pruebas de seguridad de 17.4: PIN, enlaces, aislamiento entre usuarias, firma del webhook, inyección en el chat.

**Listo cuando:** HU-13 y HU-14 pasan, junto con las pruebas de seguridad.

## Fase 9 · Landing ✅

**Objetivo:** una página pública que explique ALZA y atraiga a nuevas usuarias.

- [x] Propuesta de valor con un WhatsApp animado mostrando el cierre.
- [x] Cómo funciona en 3 pasos, puntos y premios, privacidad.
- [x] Bloque «Proyecto del Reto 2» con CIX destacado, UTEC Ventures y Credicorp.
- [x] Lista de espera con consentimiento y QR a WhatsApp para la demo.
- [x] Liviana y bien vista en celular.

**Listo cuando:** se ve bien en 360 px y en escritorio, y la lista de espera guarda registros. (Resultado: 98 KB comprimidos en la primera carga; revisada con capturas.)

- [ ] Logo oficial de CIX: no hay uno público; hoy se muestra el nombre en tipografía grande. Pedirlo a los organizadores.

## Fase 10 · WhatsApp real (Meta) ⬜

**Objetivo:** el mismo flujo, desde un celular real.

- [ ] Proyecto en Railway con Postgres y despliegue (requiere `railway login` de la dueña de la cuenta).
- [ ] App de Meta para ALZA, número de prueba y destinatarios verificados.
- [ ] Token permanente con usuario del sistema.
- [ ] Webhook en Railway con validación de firma.
- [ ] `VITE_ALZA_WHATSAPP_NUMBER` en el build de la web para el QR del jurado en la landing.
- [ ] Adaptador de Meta: texto, botones, imagen por ID, marcar como leído y descarga inmediata de archivos.
- [ ] Prueba real: imagen, audio, texto, alta y cierre completo.

**Listo cuando:** el día completo de la demo funciona desde un celular real.

## Fase 11 · Demo ⬜

**Objetivo:** demo de unos 4 minutos que no falla.

- [ ] Semana de datos precargados; lo de ejemplo se dice en pantalla.
- [ ] Métrica real del dataset visible (17.7).
- [ ] Guion de la sección 17.6.
- [ ] Video de respaldo con el mismo guion.
- [ ] Dos ensayos completos sin fallas.

**Listo cuando:** se cumplen los criterios de éxito de 17.7.
