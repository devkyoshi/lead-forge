.PHONY: help dev setup install env infra infra-down migrate seed api worker web stop test typecheck build logs db-reset psql

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-12s %s\n", $$1, $$2}'

# ---- One-command dev ----------------------------------------------------------------------

dev: setup ## Start everything: Postgres + Redis, migrate, seed, then API + worker + web together
	@echo Web: http://localhost:3000 - login admin@leadforge.local / changeme123
	@echo API: http://localhost:4000 - docs at /docs
	@echo Stop with Ctrl+C, then run make infra-down to stop the databases.
	@trap 'kill 0' INT TERM EXIT; pnpm dev:api & pnpm dev:worker & pnpm dev:web & wait

setup: install env infra migrate seed ## First-time/idempotent setup without starting the apps

install: ## Install dependencies
	pnpm install

env: ## Create .env from .env.example if it is missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

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

test: ## Run unit tests
	pnpm test

typecheck: ## Typecheck all packages
	pnpm typecheck

build: ## Production build of the web app
	pnpm --filter @leadforge/web build

# ---- Utilities ----------------------------------------------------------------------------

stop: ## Kill anything listening on the API (4000) and web (3000) ports (Windows)
	-powershell -NoProfile -Command "foreach($$p in 4000,3000){Get-NetTCPConnection -LocalPort $$p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $$_.OwningProcess -Force }}"

logs: ## Tail Postgres and Redis container logs
	docker compose logs -f postgres redis

psql: ## Open a psql shell in the Postgres container
	docker compose exec postgres psql -U leadforge -d leadforge

db-reset: ## DANGER: drop all data, re-apply migrations and reseed
	docker compose exec postgres psql -U leadforge -d postgres -c "DROP DATABASE IF EXISTS leadforge WITH (FORCE);" -c "CREATE DATABASE leadforge;"
	$(MAKE) migrate seed
