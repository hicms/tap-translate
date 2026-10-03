.PHONY: all build build-extension dev-extension dev-extension-firefox check-artifacts check-npm-audit lint-extension package clean test test-extension test-e2e test-e2e-perf probe

all: build

build: build-extension

dev-extension:
	chmod +x ./scripts/dev-extension.sh
	./scripts/dev-extension.sh chrome

dev-extension-firefox:
	chmod +x ./scripts/dev-extension.sh
	./scripts/dev-extension.sh firefox

build-extension:
	chmod +x ./scripts/build-extension.sh
	./scripts/build-extension.sh

check-artifacts:
	chmod +x ./scripts/check-extension-artifacts.sh
	./scripts/check-extension-artifacts.sh

check-npm-audit:
	chmod +x ./scripts/check-npm-audit.sh
	./scripts/check-npm-audit.sh

lint-extension:
	cd extension && npm run lint

package: build
	@echo "Packaging complete. Output directory:"
	@node extension/tools/artifact-paths.mjs extension

clean:
	node extension/tools/clean-artifacts.mjs

test: test-extension

test-extension:
	cd extension && npm run compile && npm run lint && npm test

test-e2e:
	cd extension && npm run build && npm run build:firefox && npx playwright install --with-deps chromium firefox && npm run e2e

test-e2e-perf:
	cd extension && npm run build && npx playwright install --with-deps chromium && npm run e2e:perf

# Real-website collector regression: detects duplicate/overlapping translation
# units across a set of live sites (no API key needed). Pass URLS="a b" to override.
probe:
	cd extension && npm run probe $(URLS)

