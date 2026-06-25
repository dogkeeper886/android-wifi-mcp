.PHONY: up down restart logs psql migrate migrate-down test test-unit build clean \
        doctor adb devices udev serve serve-stop serve-restart serve-all serve-all-stop \
        setup readme-diagram help

COMPOSE ?= docker compose
PSQL_USER ?= mcp
PSQL_DB ?= android_wifi_mcp
PORT ?= 3000
UDEV_RULE ?= /etc/udev/rules.d/51-android-wifi-mcp.rules

# Ports for the remote stack (make serve-all). Both bind 0.0.0.0.
PW_PORT ?= 8931
CDP_PORT ?= 9222
SERVE_ALL_LOG ?= /tmp/android-wifi-mcp
# mobile-next is single-session SSE over the network (#102), so instead of a
# separate port we proxy it as a stdio upstream of android-wifi — its tools
# surface via android-wifi's :$(PORT) (Streamable HTTP), reachable by mcp-remote
# with no 409. (Reuses the upstream-proxy, #14.)
MOBILE_UPSTREAM ?= mobile-next=npx -y @mobilenext/mobile-mcp@latest --stdio

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
	@echo "  make serve-all     serve the stack over HTTP for remote QA: android-wifi :$(PORT)"
	@echo "                     (+ mobile-next proxied in), android-playwright :$(PW_PORT), + CDP bridge"
	@echo "  make serve-all-stop  stop the remote stack"
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

# Serve the QA stack over HTTP from this (USB-connected) host so a remote client
# can reach it — everything runs next to the phone (#98). android-wifi serves on
# :$(PORT) with mobile-next proxied in as a stdio upstream (#102, reuses #14), and
# android-playwright on :$(PW_PORT). Backends are detached (setsid) + logged under
# $(SERVE_ALL_LOG); stop with serve-all-stop.
# Both bind 0.0.0.0 with NO auth, and playwright's host-check is disabled
# (--allowed-hosts "*") so it answers a remote IP — reachability grants full phone
# control. Exposure/auth stance: #100.
serve-all: build
	@command -v adb >/dev/null 2>&1 || { echo "adb not found -> make adb"; exit 1; }
	@mkdir -p $(SERVE_ALL_LOG)
	@for p in $(PORT) $(PW_PORT); do command -v lsof >/dev/null 2>&1 && lsof -ti:$$p >/dev/null 2>&1 && echo "  warning: :$$p already in use — run 'make serve-all-stop' first if this is a stale bundle" || true; done
	@echo "CDP bridge : adb forward tcp:$(CDP_PORT) -> chrome_devtools_remote"
	@adb forward tcp:$(CDP_PORT) localabstract:chrome_devtools_remote >/dev/null 2>&1 \
	  || echo "  warning: CDP forward failed (no device?) — android-playwright can't reach the browser; the others still start"
	@echo "android-wifi        :$(PORT)   (+ mobile-next proxied as a stdio upstream)"
	@PORT=$(PORT) UPSTREAM_MCP='$(MOBILE_UPSTREAM)' setsid sh -c 'exec npm start' >$(SERVE_ALL_LOG)/android-wifi.log 2>&1 &
	@echo "android-playwright  :$(PW_PORT)   (log: $(SERVE_ALL_LOG)/android-playwright.log)"
	@setsid sh -c 'exec npx -y @playwright/mcp@latest --host 0.0.0.0 --port $(PW_PORT) --allowed-hosts "*" --cdp-endpoint http://localhost:$(CDP_PORT)' >$(SERVE_ALL_LOG)/android-playwright.log 2>&1 &
	@sleep 2
	@echo ""
	@echo "Bundle starting. android-wifi(+mobile-next) :$(PORT)  ·  android-playwright :$(PW_PORT)"
	@echo "Stop with: make serve-all-stop"

serve-all-stop:
	-@PORT=$(PORT) npm run stop >/dev/null 2>&1 || true
	@for p in $(PW_PORT); do \
	  pids=$$(lsof -ti:$$p 2>/dev/null); \
	  if [ -n "$$pids" ]; then echo "$$pids" | xargs -r kill -TERM 2>/dev/null; echo "stopped :$$p"; else echo "nothing on :$$p"; fi; \
	done
	-@adb forward --remove tcp:$(CDP_PORT) >/dev/null 2>&1 || true
	@echo "removed CDP forward (tcp:$(CDP_PORT))"
	@echo "(mobile-next runs as an android-wifi child — it stops with the :$(PORT) server)"

# Render the README architecture diagram: SVG (source of truth) -> PNG (embedded).
# Needs rsvg-convert (Fedora: sudo dnf install librsvg2-tools).
readme-diagram:
	@command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert not found -> sudo dnf install librsvg2-tools"; exit 1; }
	rsvg-convert --zoom 2 docs/images/architecture.svg -o docs/images/architecture.png
	@echo "rendered docs/images/architecture.png"

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
