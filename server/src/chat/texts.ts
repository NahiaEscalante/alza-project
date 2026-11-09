/**
 * What the web chat says on its own, without the model (Spanish, Anexo A). The model's replies
 * go through `guards.ts`; these are the fixed texts it falls back to. Never «ganancia».
 */

/** PR06: user messages per business day (4:00–3:59). */
export const CHAT_DAILY_LIMIT = 30;
export const CHAT_MAX_MESSAGE_CHARS = 500;

export const CHAT_TEXTS = {
  /** RF-CH-02, HU-13: no promise, no eligibility; her history is hers to show. */
  credit:
    'No puedo decirte si te darán un préstamo: ALZA no evalúa créditos y esa decisión la toma ' +
    'cada entidad. Lo que sí puedes hacer es descargar tu historial en Movimientos, con «Descargar ' +
    'mi historial», y mostrarlo: ahí está todo lo que registraste y de dónde viene cada dato.',
  /** PR06. */
  limit:
    'Por hoy ya llegamos a los 30 mensajes del chat. Mañana puedes seguir preguntándome. ' +
    'Tus números siguen en Inicio y Movimientos.',
  /** Every route failed or none is configured. */
  unavailable: 'No pude responder ahora. Intenta de nuevo en un momento.',
  busy: 'Todavía estoy respondiendo tu mensaje anterior. Espera un momento.',
  /** The reply that goes with a proposal card when the model's own text claims it changed data. */
  proposal:
    'Revisa el cambio y, si está bien, toca «Confirmar». No cambio nada hasta que lo confirmes.',
  /** The model claimed a change without a proposal: nothing changed, ever. */
  noChange:
    'No cambié nada. Si quieres cambiar un registro, dime cuál y te muestro el cambio para que ' +
    'lo confirmes.',
  cancelled: 'Listo, no cambié nada.',
  stale:
    'Este cambio ya no se puede hacer: el registro cambió o pasó mucho tiempo. Pídemelo otra vez ' +
    'si todavía lo necesitas.',
  notFound: 'No encontramos ese cambio.',
} as const;

/** Chips under an empty chat (12.2). */
export const CHAT_SUGGESTIONS = [
  '¿Cuánto vendí esta semana?',
  '¿Cuántos puntos tengo?',
  '¿Cuánto vendí ayer?',
  '¿Qué es un comodín?',
] as const;

/**
 * `explain(topic)` (10.5): ALZA's rules in plain language, from Anexo A, 11.3, 13.1–13.3 and 14.
 * The model quotes these instead of making rules up.
 */
export const EXPLAIN_TOPICS = {
  came_in: '«Entró»: lo que te pagaron por ventas, por Yape, Plin o en efectivo.',
  went_out: '«Salió»: lo que pagaste: mercadería, gastos del negocio y plata para la casa.',
  left: '«Te quedó»: entró menos salió.',
  with_screenshot: '«Con captura»: lo sabemos por tu captura de Yape o Plin.',
  self_reported: '«Lo contaste tú»: lo sabemos porque nos lo dijiste o lo cambiaste tú.',
  cash_unreviewed: '«Caja sin revisar»: no confirmaste si tu efectivo cuadra.',
  pending_to_confirm: '«Por confirmar»: tenemos una duda; todavía no lo sumamos.',
  pending_items:
    '«Pendientes»: cosas que faltan revisar. Las respondes con un toque en la web, en Inicio.',
  complete_close: '«Cierre completo»: respondiste todo y tu caja cuadra.',
  partial_close: '«Cierre a medias»: respondiste una parte.',
  daily_close:
    'El cierre del día: a tu hora de cierre te mando un solo mensaje por WhatsApp con lo que ' +
    'entró y salió, tus dudas numeradas y la pregunta de la caja. Me respondes todo en un solo ' +
    'mensaje o audio. Si ese día no me escribiste, no te mando nada. También puedes escribir ' +
    '«cierre» cuando quieras.',
  business_day:
    'Tu día del negocio va de 4:00 a. m. a 3:59 a. m.: lo que vendes de madrugada cuenta en el ' +
    'día anterior. Las semanas van de lunes a domingo.',
  streak: '«Racha»: días seguidos cerrando tu día.',
  freeze:
    '«Comodín»: un día libre que no rompe tu racha. Tienes 2 por semana. El día con comodín no ' +
    'suma puntos ni días a la racha, solo evita que se rompa.',
  points:
    'Puntos: cierre completo, 10; cierre a medias, 4 (se suman a las 12:00 del día siguiente). ' +
    'Cada 7 días de racha, +20; cada 30 días, +50; semana con 5 o más cierres completos, +15 ' +
    '(el lunes a las 12:00); tu primera racha de 7 días, +30 una sola vez. Si pasan 6 meses sin ' +
    'ningún cierre, los puntos vencen.',
  rewards:
    'Premios: la barra tiene hitos de 50, 100, 200 y 400 puntos, y una meta grande de 2 500. ' +
    'Canjeas con tu PIN y los puntos se descuentan. Los premios grandes piden 8 semanas activas ' +
    '(cada una con al menos 3 cierres). Por ahora los premios son de ejemplo para la demo.',
  categories:
    'Tipos de registro: venta (suma en lo que entró); otro ingreso, como un préstamo (no suma en ' +
    'ventas); mercadería, gasto del negocio y para la casa (suman en lo que salió); por clasificar ' +
    '(todavía no sabemos qué fue, suma en lo que salió); personal y movimiento interno (no suman).',
  personal:
    '«Personal (no cuenta)»: plata que no es del negocio, por ejemplo de tu familia. No suma en ' +
    'lo que entró ni en lo que salió.',
  internal:
    '«Movimiento interno»: pasaste plata entre tus cuentas o cambiaste Yape por efectivo. No suma.',
  corrections:
    'Corregir: puedes cambiar el monto o el tipo, quitar un registro o agregar algo que faltó en ' +
    'un día pasado. Nada se borra: el registro anterior queda guardado y el nuevo queda como «Lo ' +
    'contaste tú». Para cambiar algo te pido tu PIN.',
  pin:
    'Tu PIN tiene 6 números y lo pides para cambiar datos, descargar y canjear premios. Después ' +
    'de escribirlo no te lo pido por 10 minutos. Con 5 intentos fallidos se bloquea 15 minutos. ' +
    'Si lo olvidaste, escribe «olvidé mi PIN» en WhatsApp.',
  how_to_record:
    'Cómo registrar: durante el día mándame por WhatsApp una captura por cada cobro de Yape o ' +
    'Plin, y cuéntame tus ventas en efectivo por texto o audio («vendí 5 soles de pan»). Yo anoto ' +
    'en silencio y al cierre te mando tu resumen.',
  duplicates:
    'Si me mandas la misma captura dos veces, no la cuento dos veces. Si dos pagos se parecen ' +
    'mucho, te pregunto en el cierre.',
  history_download:
    'Descargar mi historial: en Movimientos puedes bajar un PDF y un Excel de 4 semanas, 12 ' +
    'semanas o todo, con de dónde viene cada dato. Tus clientes aparecen solo con sus iniciales. ' +
    'Te pido tu PIN y tú decides con quién compartirlo.',
  privacy:
    'Tus capturas y audios originales se borran a los 30 días; quedan solo los datos que anoté. ' +
    'Si escribes «borra mis datos» en WhatsApp, borro todo en 48 horas o menos.',
} as const;

export type ExplainTopic = keyof typeof EXPLAIN_TOPICS;
export const EXPLAIN_TOPIC_KEYS = Object.keys(EXPLAIN_TOPICS) as ExplainTopic[];
