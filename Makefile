# Simple helper targets for building Brainflow2
# - macOS universal build + signing/notarization hooks
# - Linux AppImage build (if desired)

# Set these env vars in your shell or CI before using the macOS targets:
#   SIGN_IDENTITY = "Developer ID Application: Example Name (TEAMID)"
#   APPLE_ID      = "you@example.com"
#   TEAM_ID       = "TEAMID"
#   APP_PWD       = "app-specific-password"  # for notarytool

PNPM ?= pnpm
CARGO ?= cargo

TARGET_DIR ?= $(if $(CARGO_TARGET_DIR),$(CARGO_TARGET_DIR),target)
APP_BUNDLE_DIR := $(TARGET_DIR)/release/bundle
LOCAL_BIN_DIR ?= $(HOME)/bin

.PHONY: help
help:
	@echo "Make targets:"
	@echo "  mac:build          Build universal macOS app (dmg/app)."
	@echo "  mac:sign           Codesign the .app (requires SIGN_IDENTITY)."
	@echo "  mac:notarize       Notarize the .dmg (requires APPLE_ID/TEAM_ID/APP_PWD)."
	@echo "  mac:staple         Staple notarization ticket onto .dmg."
	@echo "  local:install      Install ~/bin/brainflow launcher; build the app bundle later if needed."
	@echo "  local-install      Alias for local:install."
	@echo "  local:deploy       Build the macOS app bundle and install ~/bin/brainflow."
	@echo "  local-deploy       Alias for local:deploy."
	@echo "  linux:appimage     Build AppImage bundle."

.PHONY: mac\:build
mac\:build:
	TAURI_BUNDLE_UNIVERSAL=1 $(PNPM) -r build
	TAURI_BUNDLE_UNIVERSAL=1 $(CARGO) tauri build

.PHONY: mac\:sign
mac\:sign:
	@if [ -z "$$SIGN_IDENTITY" ]; then echo "SIGN_IDENTITY not set"; exit 1; fi
	@APP_PATH=$$(find $(APP_BUNDLE_DIR)/macos -name "*.app" -maxdepth 1 | head -n1); \
	if [ -z "$$APP_PATH" ]; then echo "No .app found under $(APP_BUNDLE_DIR)/macos"; exit 1; fi; \
	echo "Signing $$APP_PATH with $$SIGN_IDENTITY"; \
	codesign --deep --force --options runtime --sign "$$SIGN_IDENTITY" "$$APP_PATH"

.PHONY: mac\:notarize
mac\:notarize:
	@if [ -z "$$APPLE_ID" ] || [ -z "$$TEAM_ID" ] || [ -z "$$APP_PWD" ]; then echo "APPLE_ID/TEAM_ID/APP_PWD not set"; exit 1; fi
	@DMG=$$(find $(APP_BUNDLE_DIR)/dmg -name "*.dmg" -maxdepth 1 | head -n1); \
	if [ -z "$$DMG" ]; then echo "No .dmg found under $(APP_BUNDLE_DIR)/dmg"; exit 1; fi; \
	echo "Submitting $$DMG for notarization"; \
	xcrun notarytool submit "$$DMG" --apple-id "$$APPLE_ID" --team-id "$$TEAM_ID" --password "$$APP_PWD" --wait

.PHONY: mac\:staple
mac\:staple:
	@DMG=$$(find $(APP_BUNDLE_DIR)/dmg -name "*.dmg" -maxdepth 1 | head -n1); \
	if [ -z "$$DMG" ]; then echo "No .dmg found under $(APP_BUNDLE_DIR)/dmg"; exit 1; fi; \
	echo "Stapling $$DMG"; \
	xcrun stapler staple "$$DMG"

.PHONY: linux\:appimage
linux\:appimage:
	$(PNPM) -r build
	$(CARGO) tauri build --bundles appimage

.PHONY: local\:install
local\:install:
	@./scripts/install-local-bin.sh

.PHONY: local-install
local-install:
	@$(MAKE) 'local:install'

.PHONY: local\:deploy
local\:deploy:
	@./scripts/install-local-bin.sh --build

.PHONY: local-deploy
local-deploy:
	@$(MAKE) 'local:deploy'

.PHONY: local-deply
local-deply:
	@$(MAKE) 'local:deploy'
