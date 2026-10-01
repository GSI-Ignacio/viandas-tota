# Base de datos local

La app en la compu (http://127.0.0.1:5500) usa una base Supabase local, en Docker, si existe
`js/config.local.js`. En Netlify siempre usa producción. Cuando está en la base local, arriba se ve
la etiqueta amarilla **BASE LOCAL** y el título dice `[LOCAL]`.

## Prender y apagar

```bash
supabase start -x studio,logflare,vector,imgproxy,edge-runtime,storage-api,realtime,postgres-meta,mailpit
supabase stop
```

Para tener también el panel web (Studio, en http://127.0.0.1:54323), usá `supabase start` sin `-x`. Baja más imágenes.

## Crear la base desde cero

```bash
for f in schema.sql migracion-v2.sql migracion-v3.sql migracion-v4.sql migracion-v5.sql migracion-v6.sql migracion-v7.sql migracion-v8.sql; do
  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f $f
done
```

El usuario de prueba está en `supabase/usuarios-locales.txt`, que no se sube a git.

## Usar producción desde la compu

Borrá o renombrá `js/config.local.js` y recargá la página.

## Probar con datos reales

En la app publicada: menú de la cuenta → Copia de seguridad → Exportar. En la app local: Copia de seguridad → Restaurar.
