# BenchFlow Queue

Queue, triage, and repair workflow software for small service businesses and community fix days.

BenchFlow is a Vite + React app with a small Node API. It is branded for repair-adjacent teams such as bike shops, electronics counters, appliance repair desks, alteration studios, makerspaces, and neighborhood service hubs.

## Local Development

```bash
npm install
npm run dev
```

- Web app: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787/api`

The local backend stores mutable demo state in `data/runtime-state.json`. Reset from the UI or call:

```bash
curl -X POST http://127.0.0.1:8787/api/reset
```

## API Surface

- `GET /api/state`
- `POST /api/reset`
- `POST /api/events/:slug/tickets`
- `POST /api/tickets/:id/check-in`
- `PATCH /api/tickets/:id/triage`
- `PATCH /api/tickets/:id/status`
- `PATCH /api/tickets/:id/outcome`
- `POST /api/events/:slug/claim-next`
- `GET /api/events/:slug/report.csv`

## Deploy

The project includes a Vercel catch-all API function in `api/[...path].js` and `vercel.json` for Vite output.

```bash
npm run build
vercel deploy
```
