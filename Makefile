# Build targets. What each one does: docs/guides/development.md#build-targets
PYTHON ?= python3
BASE ?=
ARGS ?=

.PHONY: help docs-check decisions-index test

help:
	@echo "make docs-check [BASE=ref] [ARGS=-v]  check that every change carries its documentation"
	@echo "make decisions-index                  regenerate docs/decisions/README.md"
	@echo "make test                             run the test suite"

docs-check:
	@$(PYTHON) scripts/check-docs.py $(if $(BASE),--base $(BASE)) $(ARGS)

decisions-index:
	@$(PYTHON) scripts/decisions-index.py

test:
	$(PYTHON) -m unittest discover -s tests -v
