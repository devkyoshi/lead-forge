# LeadForge

Local-business lead generation and outreach platform (monorepo: `apps/api`, `apps/web`, `packages/shared`).
Full docs and architecture diagram arrive in Phase 6.

## Run locally (Phase 1)

```bash
pnpm install
cp .env.example .env            # defaults work with mock providers
docker compose up -d postgres redis
pnpm --filter @leadforge/api db:generate
pnpm db:migrate                 # applies migrations
pnpm db:seed                    # demo login: admin@leadforge.local / changeme123
pnpm dev:api                    # http://localhost:4000  (docs at /docs)
pnpm dev:web                    # http://localhost:3000
```
