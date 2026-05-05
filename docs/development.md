# Desarrollo local

## Requisitos

- Node 20+ (probado con 25)
- npm 11+
- Una cuenta de Supabase (free tier alcanza)

## Setup inicial

```bash
git clone <repo>
cd HitFactor
npm install
cp .env.example .env.local
# editar .env.local con tus credenciales de Supabase
```

Variables esperadas en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

## Levantar la DB

Aplicar el schema en Supabase:

1. Abrir el SQL Editor del proyecto
2. Pegar el contenido de [`supabase/migrations/0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql)
3. Ejecutar

Para desarrollo se recomienda **deshabilitar la confirmación por email** en
Supabase → *Authentication → Sign In / Providers → Email* — así podés crear
cuentas de prueba sin tener que confirmar.

## Comandos

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # build de producción
npm test             # corre tests una vez
npm run test:watch   # tests en watch mode
```

## Estructura del proyecto

Ver [`architecture.md`](./architecture.md).
