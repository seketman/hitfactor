# Deployment

## Vercel + Supabase (free tier)

### 1. Push to GitHub

```bash
git push origin main
```

### 2. Import the repo into Vercel

- Go to https://vercel.com/new
- Connect the repo
- Vercel detects Next.js automatically

### 3. Environment variables

Under *Settings → Environment Variables*, add the same ones you have in
`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
```

Set `NEXT_PUBLIC_SITE_URL` **per environment** (Production / Preview /
Development) with each one's real domain. It is the source of truth for all
SEO metadata — canonical, sitemap, robots, Open Graph and JSON-LD — so a wrong
value points every preview's canonical URL at the wrong host. See
[`development.md`](./development.md#next_public_site_url).

### 4. Configure Supabase redirects

In the Supabase dashboard → *Authentication → URL Configuration*:

- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: add `https://your-app.vercel.app/auth/callback`

### 5. Deploy

Click *Deploy*. Vercel builds and ships in about a minute.

## Free tier limits

| Resource | Limit | Notes |
|---|---|---|
| Vercel bandwidth | 100 GB/month | Usually enough for personal apps |
| Vercel executions | 100 GB-hours | Server actions count here |
| Supabase DB | 500 MB | Enough for thousands of matches |
| Supabase Auth | 50K MAU | Plenty of headroom |

If the app grows, the usual first step is moving to **Supabase Pro ($25/month)**
— more DB, more Auth, daily backups.
