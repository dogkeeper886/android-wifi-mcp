.PHONY: up down restart logs psql migrate migrate-down test test-unit build clean \
        doctor adb devices udev serve serve-stop serve-restart setup help

COMPOSE ?= docker compose
PSQL_USER ?= mcp
PSQL_DB ?= android_wifi_mcp
PORT ?= 3000
UDEV_RULE ?= /etc/udev/rules.d/51-android-wifi-mcp.rules

# Bare `make` prints help rather than starting the Postgres stack.
.DEFAULT_GOAL := help

help:
	@echo "Host setup / server lifecycle:"
	@echo "  make doctor        preflight: node, adb, device, build, server"
	@echo "  make adb           install adb (Fedora/dnf: android-tools)"
	@echo "  make udev          install udev rule for non-root adb access (Linux)"
	@echo "  make devices       list connected adb devices"
	@echo "  make serve         start the MCP backend (foreground, :$(PORT))"
	@echo "  make serve-stop    stop the running backend"
	@echo "  make serve-restart restart the backend"
	@echo "  make setup         ensure adb + build, then run doctor"
	@echo ""
	@echo "Logging stack (Postgres):"
	@echo "  make up / down / restart / logs / psql / migrate"
	@echo ""
	@echo "Build / test:"
	@echo "  make build / test / test-unit / clean"

# ---- Host setup & server lifecycle -----------------------------------------

doctor:
	@echo "android-wifi-mcp host preflight"
	@echo "-------------------------------"
	@printf "node          : "; command -v node >/dev/null 2>&1 && node -v || echo "MISSING"
	@printf "npm           : "; command -v npm  >/dev/null 2>&1 && npm -v  || echo "MISSING"
	@printf "adb           : "; command -v adb  >/dev/null 2>&1 && (adb version | head -1) || echo "MISSING        -> make adb"
	@printf "node_modules  : "; [ -d node_modules ] && echo "present" || echo "MISSING        -> npm install"
	@printf "dist build    : "; [ -f dist/index.js ] && echo "present" || echo "MISSING        -> make build"
	@printf "device        : "; if command -v adb >/dev/null 2>&1; then \
		d=$$(adb devices | awk 'NR>1 && NF>=2'); \
		ready=$$(printf '%s\n' "$$d" | awk '$$2=="device"' | grep -c .); \
		if [ -z "$$d" ]; then echo "none connected -> plug in phone, enable USB debugging"; \
		elif [ "$$ready" -gt 0 ]; then echo "$$ready ready"; \
		elif printf '%s\n' "$$d" | grep -q "no permissions"; then echo "NO PERMISSIONS -> make udev (install Android udev rule)"; \
		elif printf '%s\n' "$$d" | grep -q unauthorized; then echo "UNAUTHORIZED   -> tap Allow on the phone RSA prompt"; \
		else echo "attached but not ready ($$(printf '%s\n' "$$d" | awk '{print $$2}' | sort -u | tr '\n' ' ')) -> check cable/USB mode"; fi; \
	else echo "skipped (no adb)"; fi
	@printf "server :$(PORT)   : "; curl -fsS http://localhost:$(PORT)/health >/dev/null 2>&1 && echo "up" || echo "down           -> make serve"

adb:
	@command -v dnf >/dev/null 2>&1 || { echo "make adb targets dnf (Fedora). On other distros install Android platform-tools manually and put adb on PATH."; exit 1; }
	sudo dnf install -y android-tools
	@adb version | head -1

udev:
	@command -v udevadm >/dev/null 2>&1 || { echo "udevadm not found — this target is Linux-only (udev). On other OSes adb permissions are handled differently."; exit 1; }
	sudo install -m 0644 setup/udev/51-android-wifi-mcp.rules $(UDEV_RULE)
	sudo udevadm control --reload-rules
	sudo udevadm trigger --subsystem-match=usb --action=add
	@echo "Installed $(UDEV_RULE). Re-applied to currently attached devices."
	@command -v adb >/dev/null 2>&1 && { adb kill-server >/dev/null 2>&1 || true; adb start-server >/dev/null 2>&1 || true; } || true
	@$(MAKE) --no-print-directory doctor | grep '^device' || true

devices:
	@command -v adb >/dev/null 2>&1 || { echo "adb not found -> make adb"; exit 1; }
	adb devices

serve:
	@command -v adb >/dev/null 2>&1 || echo "warning: adb not on PATH — server will start but device tools will fail (make adb)"
	PORT=$(PORT) npm start

serve-stop:
	PORT=$(PORT) npm run stop

serve-restart:
	PORT=$(PORT) npm run restart

setup:
	@command -v adb >/dev/null 2>&1 || $(MAKE) adb
	$(MAKE) build
	@$(MAKE) doctor
	@echo ""
	@echo "Next: make serve   (then reconnect the MCP client)"

# ---- Logging stack (Postgres) ----------------------------------------------

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
