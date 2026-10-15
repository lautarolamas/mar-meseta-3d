# Mar y Meseta 3D

Modelo 3D editable (alturas por bloque), con edición compartida y exportación de vistas en PNG.

## Publicar en Vercel
1. En vercel.com: Add New > Project > importar este repo > Deploy.
2. En el proyecto: Storage > Create/Connect > Upstash (Redis) > conectar al proyecto.
3. Deployments > Redeploy (para que tome las variables).

Todos los que abran la URL ven y editan las mismas alturas (se actualiza cada ~2 s).

## Pestañas
- **Mapa 1** y **Mapa 2**: planos ya procesados.
- **Mapa 3 · Cargar plano** (`cargar.html`): se sube una imagen de un plano con zonas de colores planos; el navegador detecta los colores, separa los bloques (`plano.js`) y arma el mismo modelo 3D con altura independiente por bloque. La ciudad cargada se comparte con quien abra el link (clave `ciudad-c` en Redis).

## Render con IA
Panel "Render con IA" en las tres pestañas. Manda la vista elegida (y opcionalmente la planta como referencia) a `api/render.js`, que prueba varios proveedores gratuitos en orden y cuenta los usos por día en Redis (se renueva a medianoche, hora de Argentina). Si uno falla o se queda sin cupo, pasa al siguiente.

Se configura en Vercel > Settings > Environment Variables (todas opcionales; se usan los proveedores que tengan clave), y después Redeploy:

| Variable | Para qué |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio (aistudio.google.com > Get API key). `GEMINI_MODEL` cambia el modelo (por defecto `gemini-2.5-flash-image`). |
| `CF_ACCOUNT_ID` + `CF_API_TOKEN` | Cloudflare Workers AI (tiene una cuota diaria gratis). `CF_MODEL` cambia el modelo. |
| `STABILITY_API_KEY` | Stability AI (créditos de bienvenida, no se renuevan solos). |
| `RENDER_CODE` | **Recomendado.** Código que el grupo escribe en el panel; sin él cualquiera con el link puede gastar los créditos. |
| `RENDER_CAP_GEMINI` / `RENDER_CAP_CF` / `RENDER_CAP_STABILITY` | Tope diario por proveedor (20 / 40 / 3 por defecto). |
| `RENDER_CAP_TOTAL` / `RENDER_CAP_IP` | Tope diario del grupo (30) y por conexión (8). |
| `RENDER_ORDER` | Orden de prueba, por defecto `gemini,stability,cf`. |

Las cuotas gratuitas de cada proveedor cambian: conviene mirar sus páginas antes de depender de ellas.
