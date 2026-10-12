# Recipes avoid shell-specific syntax (no test/cp/trap/&) so they work from PowerShell, cmd and bash.
# Anything non-trivial lives in scripts/*.mjs and runs on Node.

.PHONY: help dev setup install env infra infra-down migrate seed api worker web stop test test-int typecheck build logs db-reset psql

help: ## Show this help
	node scripts/help.mjs

# ---- One-command dev ----------------------------------------------------------------------

dev: setup ## Start everything: Postgres + Redis, migrate, seed, then API + worker + web together
	node scripts/run-all.mjs

setup: install env infra migrate seed ## First-time/idempotent setup without starting the apps

install: ## Install dependencies
	pnpm install

env: ## Create .env from .env.example if it is missing
	node scripts/ensure-env.mjs

infra: ## Start Postgres and Redis in Docker and wait until healthy
	docker compose up -d --wait postgres redis

infra-down: ## Stop Postgres and Redis (data is kept)
	docker compose stop postgres redis

migrate: ## Apply database migrations
	pnpm --filter @leadforge/api db:generate
	pnpm --filter @leadforge/api db:deploy

seed: ## Seed the demo workspace, user, leads and default templates
	pnpm db:seed

# ---- Individual processes -----------------------------------------------------------------

api: ## Run the API with reload (http://localhost:4000)
	pnpm dev:api

worker: ## Run the queue worker: campaign runs + email dispatcher
	pnpm dev:worker

web: ## Run the Next.js app (http://localhost:3000)
	pnpm dev:web

# ---- Checks -------------------------------------------------------------------------------

test: ## Run unit tests (no services needed)
	pnpm test

test-int: infra ## Run integration tests against a throwaway test database (starts Postgres + Redis)
	pnpm --filter @leadforge/api test:int

typecheck: ## Typecheck all packages
	pnpm typecheck

build: ## Production build of the web app
	pnpm --filter @leadforge/web build

# ---- Utilities ----------------------------------------------------------------------------

stop: ## Free the API (4000) and web (3000) ports
	node scripts/stop.mjs

logs: ## Tail Postgres and Redis container logs
	docker compose logs -f postgres redis

psql: ## Open a psql shell in the Postgres container
	docker compose exec postgres psql -U leadforge -d leadforge

db-reset: ## DANGER: drop all data, re-apply migrations and reseed
	docker compose exec postgres psql -U leadforge -d postgres -c "DROP DATABASE IF EXISTS leadforge WITH (FORCE);" -c "CREATE DATABASE leadforge;"
	$(MAKE) migrate
	$(MAKE) seed
