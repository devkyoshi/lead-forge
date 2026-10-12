FROM node:22-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @leadforge/api exec prisma generate
EXPOSE 4000
# Applies migrations, then starts the API (the worker service overrides this command).
CMD ["sh", "-c", "pnpm --filter @leadforge/api exec prisma migrate deploy && pnpm --filter @leadforge/api exec tsx src/server.ts"]
