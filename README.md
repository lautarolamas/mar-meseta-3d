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
