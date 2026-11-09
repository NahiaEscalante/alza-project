# 360dialog Sandbox · conexión de prueba

Elegido por la dueña del proyecto tras el bloqueo de la cuenta de Meta (D69). Este canal es opcional; Meta y el simulador conservan su implementación. Las reglas de registro y el catálogo no cambian.

## Configurar después de desplegar el código

En Railway, servicio `alza-project`, mantener las variables existentes de Postgres, cifrado, IA y la URL pública. Agregar:

```env
WHATSAPP_PROVIDER=dialog360
SIMULATOR_ENABLED=false
DIALOG360_API_KEY=<clave recibida al enviar START>
DIALOG360_WEBHOOK_TOKEN=<copiar el valor generado en el .env local>
```

El secreto de webhook es distinto de la API key y de la configuración anterior de Meta; no publicarlo en capturas ni en Git. En producción, omitir `SIMULATOR_ENABLED` también lo desactiva si `NODE_ENV=production`.

Una vez terminado el despliegue, desde la raíz del repositorio local, con la misma API key y secreto de webhook guardados en `.env`:

```sh
npm run dialog360:setup -w server -- --base-url=https://alza-project-production.up.railway.app
```

El script comprueba primero el receptor con un evento vacío y después registra el callback mediante `/v1/configs/webhook`. Solo imprime el código HTTP. No ejecutarlo antes de desplegar el receptor: necesita `/webhook/dialog360/:token`.

Después enviar «Hola» desde el mismo celular que envió START al número de sandbox de 360dialog. Revisar Railway: los estados de entrega muestran `waMessageId`, estado y códigos de error; nunca el contenido, teléfono ni secreto. El registro de un webhook no acredita la entrega ni el soporte de botones. Si falla, conservar el código de error y no repetir envíos innecesariamente.

## Límites de esta implementación

- Cuota documentada: 25 solicitudes a la API de mensajes, incluidos rechazos. HTTP 429 significa cuota agotada y no activa reintentos.
- La clave está vinculada a un solo destinatario. Esta implementación necesita una cuenta de sandbox identificada por teléfono; rechaza eventos que solo traen un BSUID sin inventar un teléfono.
- Texto y botones usan el formato de WhatsApp. Los botones conservan los IDs del catálogo; falta comprobar que el sandbox concreto los acepte. No se sustituyen silenciosamente por opciones de texto ni por plantillas con contenido ajeno a ALZA.
- No se llama a endpoints de archivos ni de recibos de lectura. El cierre conserva el fallback a texto existente; capturas y audios no pueden procesarse por este sandbox con la implementación actual.
- Los errores del proveedor se sanitizan. El webhook usa un secreto independiente en la ruta porque el sandbox no documenta una firma de Meta. Los logs de la aplicación registran la ruta con `:token`, no el secreto. Tratar la URL completa como una credencial.
- El adaptador se probó con HTTP simulado: 943 pruebas de ALZA pasan con Postgres. No se realizaron llamadas al proveedor ni se enviaron mensajes reales durante la implementación.

[Documentación oficial del sandbox](https://docs.360dialog.com/docs/get-started/sandbox.md).
