#!/bin/bash
set -e

echo "🧹 Cleaning previous builds..."
cargo clean
rm -rf ui/build
rm -rf packages/api/dist

echo "📦 Installing dependencies..."
pnpm install

echo "🔧 Building API package..."
cd packages/api
pnpm run build
cd ../..

echo "🎨 Building UI..."
cd ui
pnpm run build
cd ..

echo "🦀 Building Rust code..."
cargo build

echo "✅ Build complete! You can now run: cargo tauri dev"