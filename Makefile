.PHONY: install install-backend install-frontend dev dev-backend dev-frontend \
	lint lint-backend lint-frontend format format-backend format-frontend \
	format-check typecheck typecheck-backend typecheck-frontend test \
	test-backend test-frontend build build-backend build-frontend check \
	docker-build docker-up docker-down

BACKEND_ENV_FILE := $(if $(wildcard .env),--env-file .env,)

install: install-backend install-frontend

install-backend:
	uv sync --project apps/backend

install-frontend:
	npm --prefix apps/frontend install

dev:
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	uv run --project apps/backend uvicorn suaraai.main:app --app-dir apps/backend/src --reload --host 0.0.0.0 --port 8000 $(BACKEND_ENV_FILE)

dev-frontend:
	npm --prefix apps/frontend run dev

lint: lint-backend lint-frontend

lint-backend:
	cd apps/backend && uv run ruff check .

lint-frontend:
	npm --prefix apps/frontend run lint

format: format-backend format-frontend

format-backend:
	cd apps/backend && uv run ruff format .

format-frontend:
	npm --prefix apps/frontend run format

format-check:
	cd apps/backend && uv run ruff format --check .
	npm --prefix apps/frontend run format:check

typecheck: typecheck-backend typecheck-frontend

typecheck-backend:
	cd apps/backend && uv run mypy src tests

typecheck-frontend:
	npm --prefix apps/frontend run typecheck

test: test-backend test-frontend

test-backend:
	cd apps/backend && uv run pytest

test-frontend:
	npm --prefix apps/frontend run test

build: build-backend build-frontend

build-backend:
	cd apps/backend && uv build

build-frontend:
	npm --prefix apps/frontend run build

check: lint format-check typecheck test build

docker-build:
	sudo docker compose build

docker-up:
	sudo docker compose up --build

docker-down:
	sudo docker compose down
