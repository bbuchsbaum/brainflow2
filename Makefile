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

APP_BUNDLE_DIR := src-tauri/target/release/bundle

.PHONY: help
help:
	@echo "Make targets:"
	@echo "  mac:build          Build universal macOS app (dmg/app)."
	@echo "  mac:sign           Codesign the .app (requires SIGN_IDENTITY)."
	@echo "  mac:notarize       Notarize the .dmg (requires APPLE_ID/TEAM_ID/APP_PWD)."
	@echo "  mac:staple         Staple notarization ticket onto .dmg."
	@echo "  linux:appimage     Build AppImage bundle."

.PHONY: mac:build
mac:build:
	TAURI_BUNDLE_UNIVERSAL=1 $(PNPM) -r build
	TAURI_BUNDLE_UNIVERSAL=1 $(CARGO) tauri build

.PHONY: mac:sign
mac:sign:
	@if [ -z "$$SIGN_IDENTITY" ]; then echo "SIGN_IDENTITY not set"; exit 1; fi
	@APP_PATH=$$(find $(APP_BUNDLE_DIR)/macos -name "*.app" -maxdepth 1 | head -n1); \
	if [ -z "$$APP_PATH" ]; then echo "No .app found under $(APP_BUNDLE_DIR)/macos"; exit 1; fi; \
	echo "Signing $$APP_PATH with $$SIGN_IDENTITY"; \
	codesign --deep --force --options runtime --sign "$$SIGN_IDENTITY" "$$APP_PATH"

.PHONY: mac:notarize
mac:notarize:
	@if [ -z "$$APPLE_ID" ] || [ -z "$$TEAM_ID" ] || [ -z "$$APP_PWD" ]; then echo "APPLE_ID/TEAM_ID/APP_PWD not set"; exit 1; fi
	@DMG=$$(find $(APP_BUNDLE_DIR)/dmg -name "*.dmg" -maxdepth 1 | head -n1); \
	if [ -z "$$DMG" ]; then echo "No .dmg found under $(APP_BUNDLE_DIR)/dmg"; exit 1; fi; \
	echo "Submitting $$DMG for notarization"; \
	xcrun notarytool submit "$$DMG" --apple-id "$$APPLE_ID" --team-id "$$TEAM_ID" --password "$$APP_PWD" --wait

.PHONY: mac:staple
mac:staple:
	@DMG=$$(find $(APP_BUNDLE_DIR)/dmg -name "*.dmg" -maxdepth 1 | head -n1); \
	if [ -z "$$DMG" ]; then echo "No .dmg found under $(APP_BUNDLE_DIR)/dmg"; exit 1; fi; \
	echo "Stapling $$DMG"; \
	xcrun stapler staple "$$DMG"

.PHONY: linux:appimage
linux:appimage:
	$(PNPM) -r build
	$(CARGO) tauri build --bundles appimage
