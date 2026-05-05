# Deployment

## Vercel + Supabase (free tier)

### 1. Push a GitHub

```bash
git push origin main
```

### 2. Importar el repo en Vercel

- Andá a https://vercel.com/new
- Conectá el repo
- Vercel detecta Next.js automáticamente

### 3. Variables de entorno

En *Settings → Environment Variables* agregá las mismas que en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### 4. Configurar redirects de Supabase

En el dashboard de Supabase → *Authentication → URL Configuration*:

- **Site URL**: `https://tu-app.vercel.app`
- **Redirect URLs**: agregar `https://tu-app.vercel.app/auth/callback`

### 5. Deploy

Click en *Deploy*. Vercel buildea y despliega en ~1 min.

## Limitaciones del free tier

| Recurso | Límite | Comentario |
|---|---|---|
| Vercel bandwidth | 100 GB/mes | Suele alcanzar para apps personales |
| Vercel ejecuciones | 100 GB-hours | Server actions cuentan acá |
| Supabase DB | 500 MB | Suficiente para miles de matches |
| Supabase Auth | 50K MAU | Holgado |

Si crece la app, el primer paso suele ser pasar a **Supabase Pro ($25/mes)** —
más DB, más Auth, backups diarios.
