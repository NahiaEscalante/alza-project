# Integración y verificación · 8 de noviembre de 2026

## Cambios terminados

- `server/src/index.ts` conecta `createOnboardingHooks`, `createCloseHooks`, `registerCloseJobs` y `registerScheduledJobs` al canal, IA, almacenamiento y reloj del servidor.
- La API del panel se monta en `/api/admin`, con cola para reintentos, tareas para las herramientas y emisor de WA-17. El chat recibe la misma capa de IA del worker.
- El consentimiento exige la versión actual del aviso (14.1); mensajes y archivos no se procesan si la versión cambió. El cierre programado también comprueba la versión. Al aceptar de nuevo se conserva la configuración de una cuenta que ya terminó el alta.
- Prompt del chat más corto; hasta 4 mensajes previos de 400 caracteres. La herramienta de proponer cambios solo se ofrece si el mensaje pide un cambio; el control del servidor sigue rechazando propuestas no solicitadas.
- Prompt de registro distingue «vendí 5 de pan» (S/5) de «vendí 5 panes» (cantidad, sin monto). Casos T-042 y T-043 en el dataset. Esto está implementado, pero aún no certificado con los proveedores.
- Evaluación con `--ids=T-042,T-043` y `--no-outage-retries` para diagnosticar casos sin reintentar cuotas agotadas. Los errores de evaluación o una selección vacía devuelven código de salida 1.

## Evidencia

- `npm test`: 80 archivos, **927 pruebas aprobadas**, con Postgres y sin omitir las de base de datos. Incluye todos los casos de seguridad de 17.4: PIN, enlaces, aislamiento, firma e inyección.
- `npm run typecheck`, `npm run lint`, `npm run build`: aprobados.
- Servidor compilado iniciado temporalmente en `localhost:3300`: `/health` correcto, sesión del panel accesible y alta completa probada desde mensajes ficticios al simulador, pasando por el webhook y el worker real de pg-boss. Secuencia recibida: WA-01 → WA-03 → WA-04 → WA-05 → WA-06.
- Consulta de `pgboss.schedule`: cinco tareas con `timezone = America/Lima`: `close-sender` (`*/5 * * * *`), `retention-cleanup` (03:00), `points-expiry` (04:00), `antifraud-scan` (05:00), `close-finalize` (12:00).
- Postgres de esta verificación usa **55433** porque 5433 estaba ocupado. Override temporal en `/tmp/alza-postgres-override.yml`; no se cambiaron las URLs del `.env` del proyecto. Para usar esta base, pasar `DATABASE_URL=postgres://alza:alza@localhost:55433/alza` y `DATABASE_URL_TEST=postgres://alza:alza@localhost:55433/alza_test` al comando correspondiente. Son credenciales locales de desarrollo.

## Bloqueos y pendientes reales

1. **Cuotas de IA:** Groq y Gemini devolvieron `rate_limit`. No se certificó ningún modelo nuevo ni se midió el consumo real del chat. Las corridas fallidas se guardaron en `datasets/eval-runs/2026-11-09T03-46-44-381Z.json` y `2026-11-09T03-47-34-456Z.json` (fecha UTC; 8 de noviembre en Lima). No usar esos resultados como métricas de éxito.
2. **Texto WA-05:** variante aprobada e implementada para una hora fuera de rango (D68); conserva los botones.
3. **Meta y Railway:** app `alza_app` creada, cuatro credenciales guardadas y adaptador de Meta implementado. Siguen pendientes Railway, webhook público, token permanente y prueba desde un celular. El simulador sigue disponible en desarrollo; `SIMULATOR_ENABLED=false` selecciona Meta. Ver `ALZA_META_SETUP.md`.
4. **Demo:** existe `seed:demo` con cinco semanas de datos y pruebas, pero siguen pendientes la métrica visible, el video y los dos ensayos completos.
5. **Logo CIX:** sigue pendiente el archivo oficial de los organizadores.

## Repetir la evaluación cuando haya cuota

```sh
npm run eval -w server -- --only=texts --ids=T-042,T-043 --route=interpret_text=groq: --no-outage-retries
npm run eval -w server -- --only=texts --ids=T-042,T-043 --route=interpret_text=gemini#1: --no-outage-retries
```

Esas dos corridas verifican la regresión; **no** sustituyen la certificación de todo el dataset y de cada función/modelo requerida por D35. Las métricas anteriores del dataset tampoco validan prompts que cambiaron después.
