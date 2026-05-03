.PHONY: up down restart logs psql migrate migrate-down test test-unit build clean

COMPOSE ?= docker compose
PSQL_USER ?= mcp
PSQL_DB ?= android_wifi_mcp

up:
	$(COMPOSE) up -d
	@echo "Waiting for Postgres to be healthy..."
	@until [ "$$($(COMPOSE) ps --format json postgres | grep -o '\"Health\":\"healthy\"')" ]; do sleep 1; done
	@echo "Postgres ready on localhost:$${POSTGRES_PORT:-5433}"

down:
	$(COMPOSE) down

restart: down up

logs:
	$(COMPOSE) logs -f postgres

psql:
	$(COMPOSE) exec postgres psql -U $(PSQL_USER) -d $(PSQL_DB)

migrate:
	npx node-pg-migrate up

migrate-down:
	npx node-pg-migrate down

build:
	npm run build

test-unit:
	npm run test:unit

test: build
	cd cicd/tests && npm test

clean:
	$(COMPOSE) down -v
