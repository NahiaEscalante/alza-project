# Conexión de Meta · ALZA

## Implementado

El adaptador `server/src/channel/meta.ts` implementa la interfaz de canal existente: texto, botones, imagen por ID, subida de la imagen de resumen, marcar como leído y descarga autenticada de imágenes y audios. Los envíos aceptados por Meta guardan solo sus identificadores y el tipo de catálogo en `outbound_messages`.

La descarga pide una URL nueva en cada intento, limita el tamaño y verifica SHA-256 antes de entregar los bytes al almacenamiento cifrado del pipeline. Los errores de red, cuotas y fallos transitorios usan los reintentos del pipeline; credenciales inválidas o peticiones rechazadas pasan a error sin repetir una petición inválida. Los errores no conservan respuestas de Meta, tokens ni URLs privadas.

`createChannelRuntime` selecciona el canal junto con su secreto de firma. Con el simulador activo se usa su secreto de desarrollo; con Meta activo se usa el secreto de la app. La verificación del webhook ya está implementada en `/webhook/whatsapp`.

## Verificación

- 80 archivos y 927 pruebas aprobadas con Postgres; tipos, lint y build aprobados.
- Consulta de solo lectura a Meta con el token y el Phone Number ID guardados: HTTP 200 y coincidencia del identificador. No valida envíos, recepción, secreto de firma ni token permanente.
- Pendiente: prueba completa desde el celular con el webhook público.

## Variables para Railway

```env
NODE_ENV=production
SIMULATOR_ENABLED=false
WHATSAPP_API_VERSION=v25.0
WHATSAPP_PHONE_NUMBER_ID=<id del número de Meta>
WHATSAPP_ACCESS_TOKEN=<token guardado de forma privada>
WHATSAPP_APP_SECRET=<secreto de la app>
WHATSAPP_VERIFY_TOKEN=<cadena de verificación guardada de forma privada>
APP_BASE_URL=https://<dominio público de ALZA>
DATABASE_URL=<conexión de Postgres de Railway>
ENCRYPTION_KEY=<clave de cifrado de 32 bytes en base64>
```

Agregar también las llaves de IA. No copiar la conexión local de Postgres a producción. `PORT` se obtiene del entorno de Railway. La API usa v25.0, que coincide con el ejemplo de configuración de la app del equipo; la versión puede cambiar mediante `WHATSAPP_API_VERSION`.

En desarrollo `SIMULATOR_ENABLED=true` conserva el simulador aunque las credenciales reales estén completas. Para probar Meta hay que desactivarlo; `/dev/simulador` deja de estar montado. No arrancar dos procesos sobre la misma cola con canales distintos.

## Pendiente de completar con la cuenta de Railway y Meta

1. Crear el proyecto de Railway con Postgres y desplegar el repositorio. Construir con `npm run build`; ejecutar migraciones con `npm run db:migrate:dist -w server` antes de iniciar con `npm start`.
2. Configurar las variables y obtener el dominio público. Confirmar que `/health` responde correctamente.
3. En Meta, configurar la URL `https://<dominio>/webhook/whatsapp` y usar el valor privado de `WHATSAPP_VERIFY_TOKEN`. Suscribir el campo `messages`.
4. Verificar el celular destinatario de prueba. Desde ese celular iniciar la conversación con ALZA y completar el consentimiento.
5. Probar imagen, audio, texto, cierre, respuesta al cierre y acceso a la web. Esta prueba sigue pendiente; las pruebas con HTTP simulado no la sustituyen.
6. Antes del piloto, configurar el token permanente con usuario del sistema y repetir el recorrido.

No se han enviado mensajes reales durante la implementación del adaptador.

## Referencias de la API

- [Colección oficial de Meta: enviar texto](https://www.postman.com/meta/whatsapp-business-platform/request/8gvd47s/send-text-message)
- [Colección oficial de Meta: obtener URL de un archivo](https://www.postman.com/meta/whatsapp-business-platform/request/ptjyi84/retrieve-media-url)
- [Formato de botones en el SDK oficial archivado](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/)
