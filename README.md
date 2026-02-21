# Map Challenge Frontend (Vercel)

## Stack
- React + TypeScript + Vite
- Socket.IO Client
- MapLibre GL

## Local Run
```bash
npm install
npm run dev
```

## Environment Variables
- `VITE_SOCKET_URL`: public backend URL (Render)
  - Example: `https://my-map-backend.onrender.com`

If empty in development, app falls back to same-origin/local behavior.

## Vercel Deploy
1. Import this project (or `web` folder if monorepo) into Vercel.
2. Configure:
   - Framework: `Vite`
   - Build command: `npm run build`
   - Output directory: `dist`
3. Set env var in Vercel:
   - `VITE_SOCKET_URL=https://YOUR_BACKEND.onrender.com`
4. Redeploy.

## Required Pairing With Backend
In Render backend env vars, set:
- `CORS_ORIGIN=https://YOUR_FRONTEND_DOMAIN.vercel.app`

If you use Vercel preview URLs, include them too (comma-separated).
