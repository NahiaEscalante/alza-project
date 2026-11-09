# ALZA · Insumos, accesos y dependencias

Lista de todo lo que hay que **conseguir** (no decidir) para construir, probar y demostrar el MVP. Marca `[x]` cuando esté listo y anota el responsable de cada sección. Las decisiones de producto viven en `ALZA_PRODUCT_SPEC.md`; el plan de desarrollo, en `FASES.md`.

- **Prioridad:** P0 = bloquea el MVP o la demo · P1 = necesario para la calidad · P2 = deseable o posterior a la hackathon
- **Última actualización:** 8 de noviembre de 2026 (inicio del desarrollo, spec v1.6)

---

## Bloqueantes (P0) de un vistazo

- [ ] Número de prueba de WhatsApp funcionando con webhook (sección 1). Se conecta al final del desarrollo (D46).
- [x] Stack definido en Claude Code (sección 8): D45.
- [ ] Modelo gratuito con visión y transcripción de audio funcionando (sección 5). Ya elegidos: Gemini y Groq (D33 a D35); falta que funcionen y pasen la evaluación.
- [ ] Dataset de capturas de Yape y Plin con respuestas correctas (sección 2)
- [ ] Dataset de audios y textos con respuestas correctas (sección 3)
- [ ] Texto de consentimiento y aviso de privacidad (sección 6)
- [ ] Textos de los mensajes de WhatsApp (sección 10)
- [ ] Plantilla de la imagen de resumen diario, en coordinación con la línea gráfica (sección 9)
- [ ] Catálogo de premios de ejemplo para la demo (sección 11)

---

## 1. WhatsApp (Meta)

**Decidido:** número de prueba de la Cloud API, creado con una cuenta personal de Facebook (D24). Gratis, hasta 5 destinatarios verificados.
**Cuándo:** se conecta al final del desarrollo (D46, Fase 10 de `FASES.md`). Hasta entonces se usa un canal simulado con el mismo formato de mensajes y los mismos límites de Meta.
**Responsable de la sección:** ___

- [ ] **P0** Cuenta personal de Facebook del responsable técnico, con verificación en dos pasos.
- [ ] **P0** Registro en Meta for Developers y app tipo *Business* con el producto WhatsApp.
  - Listo cuando: aparece el número de prueba en *WhatsApp > API Setup*.
- [ ] **P0** Lista de hasta 5 números destinatarios verificados con código.
  - Propuesta: 3 del equipo, 1 teléfono de demo para el jurado y 1 de respaldo.
- [ ] **P0** Token de acceso permanente (usuario del sistema). El temporal vence cada 24 horas.
- [ ] **P0** URL pública con HTTPS para el webhook, token de verificación y validación de firma con el secreto de la app.
- [ ] **P1** Prueba de recepción de imagen, audio y texto.
- [ ] **P1** Prueba de "marcar como leído" (doble check azul).
- [ ] **P1** Prueba del mensaje único de cierre: imagen por su ID, con el texto como pie (hasta 1.024 caracteres) y el enlace dentro del texto (D37). El botón con enlace queda descartado: solo acepta una imagen por URL pública.
- [ ] **P1** Prueba de subida de una imagen a WhatsApp y envío por su ID, sin URL pública.
- [ ] **P1** Confirmar que las descargas de medios (imágenes y audios) funcionan apenas llega el mensaje, porque los enlaces de Meta caducan.
- [ ] **P2** Revisar los términos de WhatsApp Business (actualizados el 15 de enero de 2026) sobre proveedores de IA y dejar por escrito por qué ALZA no es un asistente de propósito general.
- [ ] **P2** Para producción: número real, verificación del negocio, método de pago en Billing Hub, costeo con la tarifa de Perú y, si hicieran falta, plantillas aprobadas.

---

## 2. Dataset de capturas (Yape y Plin)

**Para qué:** construir la extracción y medir su exactitud. Cada captura necesita su respuesta correcta (formato al final).
**Cómo conseguirlas sin datos de terceros:** el equipo se envía montos pequeños (por ejemplo S/1) entre sus propias cuentas, desde distintos bancos, y captura cada pantalla. El dinero solo circula dentro del equipo y, al ser datos propios, pueden usarse con modelos gratuitos.
**Carpeta:** `datasets/` (`yape-imgs/`, `plin-imgs/`, `bancon-imgs/`, `luqea-imgs/`).
**Estado:** dataset inicial con 2 Yape (1 recibido, 1 enviado), 6 Plin y transferencias (BBVA 3, Bancom 2, Luqea 1) y 3 audios (sección 3). Son datos fabricados por el equipo, así que pueden usarse con modelos gratuitos. Falta la hoja de respuestas correctas.
**Responsable de la sección:** ___

- [ ] **P0** Datos para armar la matriz de envíos: quién del equipo tiene Yape, quién tiene Plin y en qué bancos.
- [ ] **P1** ¿Alguna bodeguera aportaría capturas o audios reales con consentimiento por escrito? No se procesan con modelos gratuitos; sirven para revisar a mano que las capturas del equipo se parezcan a las reales y para el piloto con Sonnet.

- [ ] **P0** Yape: comprobante de cobro recibido · meta ≥ 10
- [ ] **P0** Yape: comprobante de pago enviado (simula pago a proveedor) · meta ≥ 5
- [ ] **P0** Plin: comprobantes recibidos desde al menos 3 apps bancarias distintas · meta ≥ 9
- [ ] **P1** Yape y Plin: lista de movimientos del día, incluidas capturas con scroll que se solapan · meta ≥ 6
- [ ] **P1** Notificación de cobro en la barra del celular · meta ≥ 3
- [ ] **P1** Casos difíciles · meta ≥ 10
  - [ ] Borrosa o movida
  - [ ] Recortada, sin el monto visible
  - [ ] Foto de la pantalla de otro celular
  - [ ] Modo oscuro
  - [ ] Montos con céntimos (S/3,50)
  - [ ] Captura de un día anterior
  - [ ] La misma captura enviada dos veces
  - [ ] Dos cobros iguales del mismo cliente con minutos de diferencia
  - [ ] Imagen que no es un pago (meme, foto de producto)
- [ ] **P1** Si se usan capturas de bodegueras reales: consentimiento por escrito y datos de terceros tapados. **Nunca** con modelos gratuitos (ver sección 5).
- [ ] **P0** Hoja de respuestas correctas completa para todo el dataset.

---

## 3. Dataset de audios y textos

**Para qué:** probar la interpretación de ventas en efectivo, gastos, correcciones y respuestas al cierre.
**Carpeta:** `datasets/audios/` (3 audios por ahora). La carpeta de textos está por crear.
**Responsable de la sección:** ___

- [ ] **P0** ≥ 30 audios de 3 a 20 segundos, con al menos 4 voces distintas y ruido real de bodega (televisión, calle, clientes).
- [ ] **P0** ≥ 30 textos escritos como los escribiría una bodeguera (abreviaturas, faltas, sin tildes).
- [ ] **P0** Cubrir estos casos en ambos formatos:
  - [ ] Una venta en efectivo («vendí 3.50 de pan»)
  - [ ] Varias ventas en un solo mensaje
  - [ ] Total del día («hoy vendí 150»), con y sin medio
  - [ ] Compra a proveedor, gasto del negocio, plata para la casa
  - [ ] Corrección («eso no, eran 52»)
  - [ ] Mensaje sin monto
  - [ ] Monto ambiguo («tres cincuenta»: ¿S/3,50 o S/350?)
  - [ ] Expresiones locales («una luca», «sencillo», «me yapearon», «le fié»)
  - [ ] Pedidos fuera del registro («web», «olvidé mi PIN», «borra mis datos», «cierre»)
- [ ] **P0** ≥ 20 respuestas al mensaje de cierre, en texto y en audio:
  - [ ] Respuesta completa en orden («1 son 12, 2 solo efectivo, 3 sí»)
  - [ ] Respuesta desordenada o con palabras («la de las 11 era de 12 soles…»)
  - [ ] Respuesta a medias (falta un número)
  - [ ] Caja que no cuadra con explicación («3 no, saqué 40 para la casa»)
  - [ ] «No sé» sobre la caja
- [ ] **P0** Hoja de respuestas correctas.

### 3.1 Evaluación

- [ ] **P0** Script que pasa todo el dataset por el modelo, lo compara con la hoja de respuestas correctas y produce la tabla de umbrales (sección 17.2 de la especificación).
- [ ] **P0** Correr la evaluación con 2 o 3 modelos gratuitos candidatos. Gana el que tenga menos montos inventados, no el que acierte más en promedio.
- [ ] **P1** Guardar el resultado de cada corrida (modelo, versión del prompt, fecha y métricas) para comparar y para el pitch.

---

## 4. Días completos de prueba

**Para qué:** pruebas de punta a punta y base del guion de la demo.
**Responsable de la sección:** ___

- [ ] **P1** 5 guiones de "día tipo", cada uno con su secuencia de mensajes, su mensaje de cierre esperado, la respuesta y el resultado esperado (nivel y puntos):
  - [ ] Día normal, cierre completo
  - [ ] Día con duplicados y una captura ilegible
  - [ ] Día en que la caja no cuadra y ella explica
  - [ ] Día sin respuesta (sin cierre, usa comodín)
  - [ ] Día con un mensaje que llega después del cierre (ajuste silencioso, PR03)
  - [ ] Día con un total en efectivo mayor a lo anotado (PR09)
  - [ ] Noche con ventas después de medianoche (corte a las 4:00 a. m., D12)
- [ ] **P1** Una semana completa de datos ficticios para precargar la demo (la web debe verse con historia).

---

## 5. Inteligencia artificial

**Decidido:** modelos gratuitos para la demo; Claude Sonnet (`claude-sonnet-5-5`) en producción (D25). En la demo, OCR local primero (D33), y Groq y Gemini con cambio automático (D34, D35).
**Descartado:** Cerebras, porque no tiene capa gratuita (D35).
**Responsable de la sección:** ___

- [x] **P0** Elegir el modelo gratuito con visión para leer capturas: Gemini y Groq, como respaldo del OCR local (D33). Cada modelo entra a la rotación solo si pasa la evaluación (3.1).
- [x] **P0** Elegir el servicio gratuito de transcripción de audio: Whisper en Groq, con Gemini de respaldo (D34).
- [ ] **P0** Revisar si los servicios gratuitos usan los datos enviados para entrenar. Si es así, **solo datos del equipo o ficticios**, nunca de bodegueras reales.
- [x] **P0** Llaves de API guardadas como secretos (no en el código): en `.env`, fuera del repositorio. 3 llaves de Gemini (proyectos de Google distintos) y 1 de Groq.
- [ ] **P1** Capa de IA intercambiable: cambiar de modelo gratuito a Sonnet debe ser un cambio de configuración.
- [ ] **P1** Medir con los datasets: exactitud de monto, dirección y fecha; ilegibles bien detectados; tiempo por mensaje.
- [ ] **P2** Para el piloto con usuarias reales: cuenta en la API de Anthropic, límite de gasto y revisión de las condiciones de datos.
- [x] **P2** Verificar si Sonnet acepta audio directamente o si se mantiene un servicio de transcripción aparte: Claude acepta texto e imagen, pero no audio. En producción se mantiene un servicio de transcripción aparte (spec 8.3).
- [ ] **P2** Comparar Sonnet contra el modelo gratuito con el mismo dataset, para el argumento de producción.

---

## 6. Privacidad y legal (Ley 29733 y D.S. 016-2024-JUS)

**Responsable de la sección:** ___

- [ ] **P0** Texto de consentimiento para WhatsApp, corto, con enlace a la política completa.
- [ ] **P0** Política de privacidad: qué datos se tratan, para qué, quién los procesa, transferencia internacional (IA y nube) y por cuánto tiempo.
- [ ] **P1** Línea de consentimiento para la lista de espera de la landing, junto al formulario (D52).
- [ ] **P1** Implementar la retención decidida: borrar imágenes y audios originales a los 30 días (PR07).
- [ ] **P1** Procedimiento para que la usuaria pida acceso, corrección o borrado de sus datos.
- [x] **P1** Criterio para nombres de clientes en reportes: solo iniciales (PR04).
- [ ] **P1** Reglas del programa de puntos por escrito (cómo se ganan, comodines, canje, premios grandes y vencimiento tras 6 meses sin cierres, D29).
- [ ] **P2** Revisión por un mentor o asesor legal.
- [ ] **P2** Para producción: verificar obligaciones ante la autoridad de protección de datos.

---

## 7. Evidencia de usuarias

**Responsable de la sección:** ___

- [ ] **P0** Respuestas de entrevistas a estas preguntas:
  - [ ] ¿La caja del negocio está separada del dinero de la casa?
  - [ ] ¿Cuántos cobros digitales reciben al día?
  - [ ] ¿Ya hacen capturas de algo?
  - [ ] ¿Qué tan frecuente es el fiado?
  - [ ] ¿Quién más usa el celular o el Yape del negocio?
  - [ ] ¿A qué hora cierran? ¿Alguna cierra después de medianoche?
  - [ ] ¿Prefieren escribir o mandar audios?
  - [ ] ¿Prefieren leer o escuchar su resumen? Si piden escuchar, el resumen hablado es la primera mejora después del MVP (D30).
  - [ ] ¿Qué premios les motivarían de verdad?
- [ ] **P1** Prueba del hábito con 3 a 5 bodegueras durante 2 o 3 días (puede hacerse con una persona del equipo respondiendo a mano). Medir: capturas enviadas ÷ cobros en su lista de movimientos, y cierres respondidos.
- [ ] **P1** Prueba de la web con 3 bodegueras: ¿encuentran cuánto les quedó en la semana en menos de 30 segundos?
- [ ] **P2** Testimonios con consentimiento para el pitch.

---

## 8. Infraestructura

**Decidido (D45):** TypeScript (Node 24), Hono, pg-boss, Postgres con Drizzle, Vite con React y Tailwind, hosting en Railway. Detalle en la sección 8.2 de la especificación.
**Responsable de la sección:** ___

- [x] **P0** Definir el stack en Claude Code: lenguaje, base de datos, almacenamiento, cola y hosting (D45).
- [ ] **P1** Completar en `CLAUDE.md` la sección «Por completar» (stack, comandos, estructura del repositorio y convenciones) cuando se definan.

- [ ] **P0** Servidor con HTTPS para el webhook, la API y la web (Railway).
- [ ] **P0** Base de datos (Postgres en Railway).
- [ ] **P0** Almacenamiento cifrado de archivos (al inicio, AES-256-GCM dentro de Postgres).
- [ ] **P0** Cola de trabajos para procesar mensajes (pg-boss).
- [ ] **P0** Tareas programadas: cierre a la hora de cada usuaria, vencimiento a las 12:00, inicio de semana, limpieza de archivos (pg-boss).
- [ ] **P1** Generación de la imagen de resumen con plantilla y código, sin IA (D26): menos de 150 KB, fuentes incluidas y menos de 1 segundo por imagen.
- [ ] **P1** Generación del reporte PDF y del Excel en el servidor.
- [ ] **P1** URL de la web y enlaces de acceso.
- [ ] **P1** Registro de errores sin datos sensibles.

---

## 9. Línea gráfica (equipo de diseño)

**Para qué:** que lo que construimos encaje con la identidad que se diseña aparte. La especificación define contenido y comportamiento; esta sección define cómo se ve.
**Estado:** se trabaja aparte y se integra poco a poco al pasar a Claude Code.
**Responsable de la sección:** ___

- [ ] **P0** Datos de partida del equipo de diseño: logo de ALZA, paleta y tono, si ya existen.

### 9.1 Imagen de resumen diario (P0)

Va dentro del mensaje de cierre; es lo primero que ella ve cada noche.

- [ ] Plantilla con:
  - día y nombre del negocio;
  - **entró**, separado en Yape y Plin, y efectivo;
  - **salió**, separado en mercadería, gastos y casa;
  - **te quedó**;
  - línea aparte «S/X por confirmar», si hay montos con dudas;
  - saldo de puntos con la barra de hitos;
  - los domingos, un bloque con la semana.
- [ ] Sin las dudas (van en el texto), sin la palabra «ganancia» y sin nombres de clientes.
- [ ] Vertical, legible a 360 px de ancho, menos de 150 KB y una sola versión de colores (una imagen no cambia con el modo oscuro).
- [ ] Entregarla como maqueta con medidas, fuentes y colores, para implementarla en código (HTML o SVG). El sistema la genera con datos variables (montos de S/0 a S/99 999), sin IA (D26).
- [ ] Variantes: día normal, domingo, día sin efectivo y día con montos por confirmar.

### 9.2 Barra de puntos con hitos (P1)

- [ ] Versión pequeña (dentro de la imagen) y versión grande (Inicio y Premios en la web).
- [ ] Estados: 0 puntos, entre dos hitos, justo en un hito, más de 400 y después de un canje (la barra baja).
- [ ] Hitos 50, 100, 200 y 400, cada uno con lo que se puede canjear. Meta grande de 2.500 aparte.
- [ ] Texto que siempre la acompaña: «Te faltan X para {premio}».

### 9.3 Tono de voz (P1)

- [ ] Validar o ajustar estos principios:
  - tuteo, frases cortas y palabras de todos los días;
  - sin jerga financiera («flujo», «utilidad», «conciliación», «transacción»);
  - cálido pero no infantil, con pocos emojis y solo los que cumplen una función (✅ ⭐ 📒);
  - nunca culpa: se habla del día, no de ella;
  - honesto con lo que no sabe: «ventas registradas», «por confirmar».

  | Sí | No |
  |---|---|
  | «Hoy no hubo cierre» | «No cerraste tu día» |
  | «Te quedó S/232» | «Tu flujo neto fue S/232» |
  | «Tu caja debería tener S/84 más que en la mañana. ¿Cuadra?» | «Concilia tu saldo de efectivo» |

- [ ] Revisar con este tono los borradores de mensajes de la sección 12.1 de la especificación.

### 9.4 Otros entregables

- [ ] **P1** Paleta, tipografía y estilo de componentes para la web (mobile-first).
- [ ] **P1** Sellos para las etiquetas: «Con captura», «Lo contaste tú», «Caja sin revisar», «Por confirmar».
- [ ] **P1** Pantallas: activación y PIN, Inicio, Movimientos, Premios, Chat y descarga del historial.
- [ ] **P1** Estilo del reporte PDF.
- [ ] **P1** Pantalla de descarga con «Conoce opciones para tu negocio en Yape y Mibanco» y espacio para sus logos.
- [ ] **P2** Ilustraciones genéricas para el catálogo de premios.

---

## 10. Textos de mensajes

**Para qué:** los mensajes son la interfaz principal. Deben estar escritos, revisados y probados con usuarias antes de la demo. Borradores en la sección 12 de la especificación.
**Responsable de la sección:** ___

- [ ] **P0** Bienvenida y consentimiento.
- [ ] **P0** Preguntas del alta (negocio, titular, hora de cierre).
- [ ] **P0** Mensaje del hábito con enlace de activación.
- [ ] **P0** Confirmación de la primera captura en el alta (PR01).
- [ ] **P0** Mensaje único de cierre (con y sin dudas, con resumen semanal y con las líneas informativas de diferencia en efectivo y de ajustes después del cierre).
- [ ] **P0** Confirmación del cierre (completo, parcial, con cobros faltantes de la lista).
- [ ] **P1** Aclaración cuando no se entendió la respuesta.
- [ ] **P1** Enlace a pedido, «olvidé mi PIN», borrado de datos, problema técnico.
- [ ] **P1** Línea del alta sobre «sin imagen» y aviso en el cierre cuando cambia a solo texto (D27).
- [ ] **P1** Ayuda en la web: cómo evitar que WhatsApp guarde en la galería las imágenes de este chat, en Android y en iPhone (verificar los pasos en la versión actual).
- [ ] **P1** Respuesta a «cierre» cuando el día no tiene registros ni dudas (WA-21, D39).
- [ ] **P1** Consejo para capturas ilegibles y respuesta ante un mensaje de peligro con el 105 y la Línea 100 (D28). Verificar que ambos números sigan vigentes antes de publicar.
- [ ] **P1** Línea de alerta de seguridad en el cierre cuando alguien falla 5 veces el PIN (D28).
- [ ] **P1** Textos de la web (botones, etiquetas, mensajes de error y pantallas vacías).

---

## 11. Premios y puntos

**Responsable de la sección:** ___

- [ ] **P0** Catálogo de ejemplo para la demo, marcado como «de ejemplo», con premios en cada hito:
  - [ ] 50: descuento en app de comida o transporte
  - [ ] 100: útiles escolares o artículos de limpieza
  - [ ] 200: descuento en proveedor
  - [ ] 400: descuento mayor en proveedor o kit escolar completo
  - [ ] 2.500: electrodoméstico (meta grande)
- [ ] **P1** Imágenes genéricas para el catálogo, sin logos de marcas reales salvo autorización.
- [ ] **P1** Lista de posibles aliados que financiarían premios (proveedores, marcas, ecosistema BCP) y qué gana cada uno.
- [ ] **P2** Verificar requisitos legales si algún premio se entrega por sorteo.

---

## 12. Reporte descargable y recomendaciones

**Responsable de la sección:** ___

- [ ] **P1** Plantilla del reporte PDF: resumen, gráfico simple, etiquetas y anexo de trazabilidad.
- [ ] **P1** Estructura del Excel: hojas de movimientos, cierres, ajustes y trazabilidad.
- [ ] **P1** Texto de recomendación («Conoce opciones para tu negocio en Yape y Mibanco») validado con mentores del BCP.
- [x] **P1** Autorización para usar los logos de Yape y Mibanco en la pantalla de descarga, gestionada con los organizadores: autorizados (D44). También los de CIX, UTEC Ventures y Credicorp para la landing (D43).
- [ ] **P1** Fuente vigente de las condiciones de cada producto recomendado.

---

## 13. Panel interno mínimo

**Para qué:** que alguien del equipo pueda revisar lo que el sistema no resuelve solo.
**Responsable de la sección:** ___

- [ ] **P1** Ver mensajes con error de procesamiento y reintentarlos.
- [ ] **P1** Revisar canjes de premios grandes y patrones marcados como raros.
- [ ] **P1** Ver métricas básicas: altas, cierres por nivel, tasa de respuesta, mensajes enviados.
- [ ] **P2** Para la demo puede ser una vista simple protegida o consultas directas a la base de datos.

---

## 14. Hackathon

**Se verifica en la marcha.**
**Responsable de la sección:** ___

- [ ] **P1** Fecha de entrega y duración.
- [ ] **P1** Integrantes y roles.
- [ ] **P1** Formato de la demo y criterios de evaluación del jurado.
- [ ] **P1** Teléfono de demo con WhatsApp, registrado como destinatario del número de prueba.
- [ ] **P1** Guion de demo ensayado (propuesta en la sección 17 de la especificación).

---

## Formato de la hoja de respuestas correctas

Una fila por captura, audio o texto. Sirve para medir la extracción de forma automática.

| id | archivo | tipo | monto | dirección | medio | fecha y hora | contraparte | n° operación | alcance | notas |
|---|---|---|---|---|---|---|---|---|---|---|
| C-001 | yape_recibido_01.png | constancia | 12.50 | entra | yape | 2026-11-08 10:42 | Ana T. | 00000001 | operación | — |
| A-007 | audio_07.ogg | audio | 150.00 | entra | desconocido | 2026-11-08 | — | — | total del día | ambiguo: ¿incluye Yape? |
| T-012 | texto_12.txt | texto | 40.00 | sale | efectivo | 2026-11-08 | — | — | operación | plata para la casa |
| R-003 | respuesta_03.ogg | respuesta de cierre | — | — | — | — | — | — | — | 1→12.00; 2→solo efectivo; 3→cuadra |

---

## Registro de cambios

- **8 nov 2026:** versión inicial (ronda 3).
- **8 nov 2026:** premios, reporte descargable, mensaje único de cierre e imagen de resumen (ronda de la web).
- **8 nov 2026:** reorganización final de la fase de descubrimiento: decisiones de WhatsApp e IA, línea gráfica, textos de mensajes, panel interno y respuestas al cierre en los datasets.
- **8 nov 2026:** revisión de propuestas PR01 a PR14: logos de Yape y Mibanco, textos nuevos del cierre y casos de prueba.
- **8 nov 2026:** plan del dataset: matriz de envíos, carpetas para Claude Code y evaluación de modelos candidatos.
- **8 nov 2026:** brief de línea gráfica: imagen de resumen, barra de puntos, tono de voz y otros entregables.
- **8 nov 2026:** imagen generada con plantilla y código (D26) y opción «solo texto» (D27).
- **8 nov 2026:** stack como insumo pendiente para Claude Code y `CLAUDE.md` por completar.
- **8 nov 2026:** cierre de preguntas abiertas: textos de excepciones (D28), vencimiento de puntos (D29), pregunta sobre resumen hablado (D30) y caso de prueba después de medianoche (D12).
- **8 nov 2026:** inicio del desarrollo (spec v1.6): stack decidido (D45), modelos gratuitos elegidos (Groq y Gemini; Cerebras descartado), llaves guardadas como secretos, verificado que Claude no acepta audio, logos autorizados (D44), WhatsApp real al final (D46), prueba del cierre según D37, WA-21 en textos, estado del dataset inicial y consentimiento de la lista de espera (D52).
