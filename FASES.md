# ALZA · Fases de desarrollo

Plan para llegar a la demo completa. La spec (`docs/ALZA_PRODUCT_SPEC.md`) sigue mandando; este archivo solo ordena el trabajo.

- Marca `[x]` cada tarea al terminarla y cambia el estado de la fase.
- Una fase está lista cuando cumple su «Listo cuando».
- Estados: ⬜ por empezar · 🟨 en curso · ✅ lista

| Fase | Nombre | Estado |
|---|---|---|
| 0 | Cimientos | ✅ |
| 1 | Reglas del negocio | ✅ |
| 2 | Lectura de capturas y audios | 🟨 |
| 3 | Recepción y libro de registros | ⬜ |
| 4 | Alta y mensajes de excepción | ⬜ |
| 5 | Cierre del día | ⬜ |
| 6 | Puntos y tareas programadas | ⬜ |
| 7 | Web de la usuaria | ⬜ |
| 8 | Chat, reporte y panel interno | ⬜ |
| 9 | Landing | ✅ |
| 10 | WhatsApp real (Meta) | ⬜ |
| 11 | Demo | ⬜ |

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

## Fase 2 · Lectura de capturas y audios 🟨

**Objetivo:** convertir capturas, audios y textos en operaciones, sin inventar montos.

- [ ] Hoja de respuestas correctas (`datasets/answers.csv`) para las 8 capturas y los 3 audios.
- [ ] 30 textos y 20 respuestas al cierre de prueba, con sus respuestas correctas.
- [ ] Casos difíciles generados desde las capturas: recorte, desenfoque, modo oscuro, foto de pantalla, reenvío.
- [ ] OCR local con tesseract.js (español, datos incluidos en el servidor).
- [ ] Lectores por diseño: Yape recibido y enviado, BBVA (transferencia y Plin), Bancom, Luqea.
- [ ] Clasificación de imágenes: constancia, lista, comprobante, otra financiera, no financiera (RF-EX-01).
- [ ] Capa de IA intercambiable (8.3) con Groq y Gemini, cambio automático y salidas validadas con Zod.
- [ ] Transcripción: Whisper en Groq y Gemini de respaldo (D34).
- [ ] Interpretación de textos: intención y operaciones (RF-EX-04, RF-EX-05).
- [ ] Interpretación de la respuesta al cierre (10.3).
- [ ] Controles fijos después de leer: máximo 2 decimales, fecha no futura, número de operación con formato válido.
- [ ] Script de evaluación que produce la tabla de 17.2 y guarda cada corrida.

**Listo cuando:** la evaluación corre sobre todo el dataset con 0 montos inventados.

## Fase 3 · Recepción y libro de registros ⬜

**Objetivo:** un mensaje entra, se procesa una sola vez y queda en el libro con su etiqueta o su duda.

- [ ] Interfaz de canal con el adaptador simulado (el de Meta llega en la Fase 10).
- [ ] Webhook con el formato de Meta (10.1): guardar, responder 200 en menos de 2 segundos y encolar (RF-IN-01).
- [ ] Idempotencia por `wa_message_id` (RF-IN-02).
- [ ] Marcar como leído (simulado) (RF-IN-03).
- [ ] Archivos cifrados con su SHA-256 (RF-IN-04).
- [ ] Nada se procesa sin consentimiento (RF-ON-02).
- [ ] Worker: clasificar, leer, interpretar, aplicar reglas, crear dudas.
- [ ] Reintentos (3, con espera creciente) y estado de error (RF-IN-05).
- [ ] Correcciones («eso no, eran 52») y anulaciones con trazabilidad (RF-LB-01, RF-LB-02).
- [ ] Simulador de WhatsApp en `/dev/simulador`: mandar textos, capturas del dataset y audios, y ver los mensajes salientes.

**Listo cuando:** 100 mensajes repetidos no crean duplicados y un día de mensajes deja el libro correcto.

## Fase 4 · Alta y mensajes de excepción ⬜

**Objetivo:** una usuaria nueva se registra y ALZA solo habla cuando debe.

- [ ] Catálogo de mensajes de 12.1 como plantillas (incluido WA-21): única forma de enviar.
- [ ] Alta: consentimiento con versión, negocio, titular (o captura), hora de cierre y retomar a medias (5.1).
- [ ] Enlace de activación de 1 hora (D13).
- [ ] Confirmación de la primera captura (PR01, D41).
- [ ] Excepciones: «web», «olvidé mi PIN», «borra mis datos» (con botones), peligro (WA-20), consejo por ilegibles (WA-19), «sin imagen» y «con imagen».
- [ ] Borrado de cuenta (RF-PV-01).

**Listo cuando:** HU-01 y HU-15 pasan en el simulador.

## Fase 5 · Cierre del día ⬜

**Objetivo:** el mensaje único de cierre sale, se responde en un solo mensaje y el día queda con su nivel.

- [ ] Composición del cierre: resumen, hasta 5 dudas que quepan, cuadre al final, líneas informativas, bloque del domingo y enlace de 7 días (WA-10, D37).
- [ ] Imagen de resumen con plantilla y código (Satori y resvg): 4 variantes, menos de 150 KB, comparación visual automática (8.6).
- [ ] Envío a la hora de cada usuaria (cada 5 minutos) o al escribir «cierre».
- [ ] Interpretación y aplicación de la respuesta; hasta 2 aclaraciones (WA-11).
- [ ] Nivel del cierre y confirmación con puntos (WA-12).
- [ ] Respuestas fuera de plazo (WA-18) y ajustes después del cierre (PR03).
- [ ] Los 7 días tipo de los insumos (sección 4) como pruebas de punta a punta.

**Listo cuando:** los días tipo pasan en el simulador (HU-06, HU-07).

## Fase 6 · Puntos y tareas programadas ⬜

**Objetivo:** el sistema cierra los días, da los puntos y limpia solo.

- [ ] 12:00: cierres finales, puntos, racha, comodines y bonos; dudas a la web (8.4).
- [ ] Lunes 12:00: bono semanal y consolidación.
- [ ] 03:00: borrar originales con más de 30 días (PR07) y enlaces vencidos.
- [ ] 04:00: vencimiento de puntos tras 6 meses sin cierres (D29).
- [ ] Antifraude: titular repetido, misma captura en cuentas distintas, alertas (13.4).
- [ ] Borrar registros de la lista de espera con más de 6 meses (D52).
- [ ] Simulación de una semana completa con reloj simulado.

**Listo cuando:** HU-08 pasa con la semana simulada.

## Fase 7 · Web de la usuaria ⬜

**Objetivo:** ella entra con su enlace y su PIN, ve sus números, corrige y canjea.

- [ ] Acceso: activación, crear PIN, enlace de 7 días, celular recordado, PIN válido por 10 minutos, bloqueos y salir de todos (14.3).
- [ ] Inicio: barra de puntos con hitos, semana (entró, salió, te quedó), gráfico por día y aviso de pendientes.
- [ ] Movimientos: días con nivel, registros con etiqueta, corregir, quitar y agregar en días pasados (D16).
- [ ] Pendientes resolubles con toques.
- [ ] Premios: catálogo de ejemplo por hitos, canje con PIN y código `DEMO-XXXX` (13.3).
- [ ] Ajustes: solo texto, titulares adicionales, ocultar montos, borrar cuenta.
- [ ] Diseño basado en `docs/alza_mvp.html`.
- [ ] Primera carga de menos de 300 KB (RNF-06) y accesibilidad (RNF-07).

**Listo cuando:** HU-09 a HU-12 pasan.

## Fase 8 · Chat, reporte y panel interno ⬜

**Objetivo:** completar lo que queda de la web y dar herramientas al equipo.

- [ ] Chat que responde, con herramientas de solo lectura (10.5) y límite de 30 mensajes al día.
- [ ] Chat que propone cambios con «antes y después» y confirmación con PIN.
- [ ] Reporte PDF y Excel con anexo de trazabilidad y clientes con iniciales (5.10).
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
