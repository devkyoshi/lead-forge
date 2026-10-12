FROM node:22-slim
RUN corepack enable
WORKDIR /app

# Dependencies first, so source edits do not reinstall everything.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
# The API address is baked into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @leadforge/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@leadforge/web", "start"]
