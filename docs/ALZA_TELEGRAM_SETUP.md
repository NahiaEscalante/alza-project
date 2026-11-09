# Telegram · canal de la demo pública

Elegido por el equipo como canal de la demo (D71): la cuenta de prueba de Meta está bloqueada (`131031`) y el sandbox de 360dialog solo admite un destinatario y no maneja archivos. Bot: **@alzaagentbot** («alza-agent»). Cualquier persona escanea el QR de la landing, toca «Iniciar» y habla con ALZA.

WhatsApp sigue siendo la visión del producto. Meta, 360dialog y el simulador conservan su implementación; el canal se elige solo con variables, así que desplegar este código sin las variables nuevas no cambia nada.

## Qué hace

- **Mismos flujos y catálogo.** Texto, botones (teclado en línea cuyo `callback_data` es el id del botón del catálogo), imagen de resumen (`sendPhoto` con el texto como pie de hasta 1.024 caracteres) y descarga de capturas y audios (`getFile`, con límites de tamaño y SHA-256). Se mantienen los límites de Meta: 3 botones, 20 caracteres por botón, 4.096 por texto. Sin `parse_mode` y sin vista previa de enlaces: Telegram no visita los enlaces con token.
- **Recibido silencioso.** En lugar del doble check azul, ALZA reacciona con 👍 a cada mensaje (`setMessageReaction`); un toque de botón se responde con `answerCallbackQuery`. Como máximo un mensaje por segundo por chat.
- **Identidad (D72).** La cuenta sigue siendo el número de celular. Un chat desconocido recibe **WA-23** con el botón nativo «Compartir mi número». Solo se acepta su propio contacto (`contact.user_id = from.id`); se normaliza a E.164, se busca o crea la cuenta por número y se guarda `users.telegram_chat_id`. **WA-24** retira el teclado y sigue el alta normal (WA-01). Antes de vincular, nada de lo que manda se procesa ni se guarda. Borrar la cuenta desvincula el chat.
- **Textos (D73).** WA-01 y WA-06 tienen variante para Telegram (👍 en lugar del doble check). La web y los textos del sistema dicen «en el chat de ALZA».
- **Privacidad y cuota (D74).** WA-01 en Telegram agrega «Es una demo: usa capturas y datos de prueba, no los reales de tu negocio» con la versión de consentimiento `wa-01-v2-demo`: quien aceptó la versión anterior (por WhatsApp) la vuelve a aceptar y conserva su configuración. Las capturas se leen solo con OCR local, salvo `AI_VISION_FALLBACK=true`: lo que el OCR no reconoce queda como duda «ilegible». Tope de 150 mensajes entrantes por usuaria y día del negocio: los que pasan se ignoran en silencio y en los registros solo quedan ids. Los límites de los modelos de IA siguen con los reintentos de la cola.

## Configurar en Railway

Orden: **desplegar → migrar → configurar variables → registrar el webhook**.

1. **Desplegar** este código. Railway ejecuta `npm run db:migrate:dist -w server` antes de `npm start`: la migración `0004_telegram_chat` solo agrega la columna `users.telegram_chat_id` (nula y única). Sin las variables nuevas, el servicio sigue igual que antes.
2. **Generar el secreto del webhook** en local (`openssl rand -hex 32`) y guardarlo en el `.env` local como `TELEGRAM_WEBHOOK_SECRET`. En el `.env` local, el token está hoy con el nombre `telegram-api`: renombrarlo a `TELEGRAM_BOT_TOKEN`.
3. **Agregar variables** en el servicio `alza-project` (mantener las de Postgres, cifrado, IA y `APP_BASE_URL`):

   ```env
   CHANNEL_PROVIDER=telegram
   TELEGRAM_BOT_TOKEN=<token de @BotFather>
   TELEGRAM_WEBHOOK_SECRET=<el mismo valor del .env local>
   # Opcionales:
   # TELEGRAM_DAILY_INBOUND_CAP=150
   # AI_VISION_FALLBACK=false
   ```

   Para el QR de la landing (variable de **build** de la web), opcional: `VITE_ALZA_TELEGRAM_BOT=alzaagentbot`. Sin ella se usa `alzaagentbot`.

   `CHANNEL_PROVIDER` manda sobre `SIMULATOR_ENABLED` y `WHATSAPP_PROVIDER`. Con Telegram, `/webhook/whatsapp` responde 503 y el simulador no se monta. No configurar `TELEGRAM_POLLING` en Railway: en producción impide el arranque.
4. **Registrar el webhook**, una vez desplegadas las variables, desde la raíz del repositorio local:

   ```sh
   npm run telegram:setup -w server -- --base-url=https://alza-project-production.up.railway.app
   ```

   El script hace `getMe` (muestra `@alzaagentbot`), prueba `POST /webhook/telegram` con el secreto (debe responder 200) y después ejecuta `setWebhook` con el secreto y `allowed_updates` = `message`, `callback_query`. Solo imprime códigos y el nombre del bot, nunca el token ni el secreto.
5. **Comprobar**: `npm run telegram:status -w server` muestra el host del webhook, los mensajes pendientes y el último error. Después, desde un celular: escanear el QR de la landing (`https://t.me/alzaagentbot?start=landing`), tocar «Iniciar», compartir el número, aceptar y terminar el alta. Revisar en Railway que los registros muestren solo ids.

## Volver atrás

1. Quitar `CHANNEL_PROVIDER` en Railway (o cambiarlo a `meta`, `dialog360` o `simulator`) y volver a desplegar: se aplican de nuevo `SIMULATOR_ENABLED` y `WHATSAPP_PROVIDER`, como antes.
2. Opcional: `npm run telegram:setup -w server -- --delete-webhook` para que Telegram deje de enviar mensajes al servidor. Si no se borra, Telegram recibe 404 y guarda los mensajes pendientes hasta 24 horas.

La columna `telegram_chat_id` puede quedarse: es nula para las cuentas de WhatsApp. Las cuentas creadas por Telegram aceptaron `wa-01-v2-demo`; si vuelven por WhatsApp, se les pide aceptar el aviso vigente otra vez.

## Desarrollo local con long polling

Sin URL pública, el servidor puede leer los mensajes con `getUpdates`:

```env
CHANNEL_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_POLLING=true
```

`npm run dev` y escribirle al bot. El sondeo **no arranca si el bot tiene un webhook registrado**, porque borrarlo dejaría sin mensajes al bot desplegado. Lo recomendable es crear un segundo bot con @BotFather para desarrollo. Para usar el mismo bot a propósito, primero `npm run telegram:setup -w server -- --delete-webhook` y, al terminar, volver a registrar el webhook de Railway con `telegram:setup`. Un bot no puede tener a la vez webhook y sondeo.

## Límites y riesgos

- La foto de Telegram llega comprimida. Si el OCR no lee bien una captura, se le puede pedir que la envíe como archivo («sin comprimir»): también se acepta.
- El chat de Telegram es un identificador personal: no se registra en los logs (solo `userId`, `updateId` y la clave `tg:<chat>:<mensaje>` del mensaje, equivalente al `wamid`).
- Los textos de la web sobre la galería de imágenes siguen describiendo WhatsApp (D27).
- Con Telegram activo, las cuentas que solo tienen WhatsApp no reciben mensajes: un envío pendiente para ellas termina con `channel_rejected`.
- Pruebas: adaptador, webhook, sondeo e integración completa (de `/start` a WA-06, contacto propio, fotos, audios, botones, tope diario e idempotencia) con la Bot API simulada por HTTP. Antes de la demo falta el recorrido real desde un celular.

## Referencias

- [Telegram Bot API](https://core.telegram.org/bots/api): `setWebhook` (`secret_token`), `getUpdates`, `sendMessage`, `sendPhoto`, `setMessageReaction`, `answerCallbackQuery`, `getFile`, `KeyboardButton.request_contact`.
- [Enlaces profundos `?start=`](https://core.telegram.org/bots/features#deep-linking).
