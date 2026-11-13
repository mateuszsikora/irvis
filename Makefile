# Build targets. What each one does: docs/guides/development.md#build-targets
PYTHON ?= python3
NPM ?= npm
BASE ?=
ARGS ?=

.PHONY: help docs-check decisions-index test js-test lint typecheck build

help:
	@echo "make docs-check [BASE=ref] [ARGS=-v]  check that every change carries its documentation"
	@echo "make decisions-index                  regenerate docs/decisions/README.md"
	@echo "make test                             run the Python test suite (documentation check)"
	@echo "make js-test                          run the TypeScript tests (Vitest)"
	@echo "make lint                             run ESLint and the Prettier check"
	@echo "make typecheck                        type-check every TypeScript project"
	@echo "make build                            build every workspace (apps/web into apps/web/dist)"

docs-check:
	@$(PYTHON) scripts/check-docs.py $(if $(BASE),--base $(BASE)) $(ARGS)

decisions-index:
	@$(PYTHON) scripts/decisions-index.py

test:
	$(PYTHON) -m unittest discover -s tests -v

js-test:
	$(NPM) test

lint:
	$(NPM) run lint
	$(NPM) run format:check

typecheck:
	$(NPM) run typecheck

build:
	$(NPM) run build
