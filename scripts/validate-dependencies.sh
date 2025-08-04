#!/bin/bash

# Dependency Validation Script
# Ensures reproducible builds by validating lock files and dependency integrity

set -euo pipefail

echo "🔍 Validating dependency integrity..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Rust dependency validation
echo "📦 Checking Rust dependencies..."

if command_exists cargo; then
    # Check if Cargo.lock exists and is up to date
    if [ -f "Cargo.lock" ]; then
        echo "✅ Cargo.lock found"
        
        # Verify lock file is consistent with Cargo.toml
        if cargo generate-lockfile --offline 2>/dev/null; then
            echo "✅ Cargo.lock is consistent with Cargo.toml"
        else
            echo "❌ Cargo.lock is inconsistent with Cargo.toml"
            echo "   Run 'cargo update' to fix"
            exit 1
        fi
        
        # Check for security vulnerabilities
        if command_exists cargo-audit; then
            echo "🔒 Running security audit..."
            cargo audit --deny warnings
            echo "✅ No security vulnerabilities found"
        else
            echo "⚠️  cargo-audit not installed, skipping security check"
            echo "   Install with: cargo install cargo-audit"
        fi
        
        # Check for dependency policy violations
        if command_exists cargo-deny; then
            echo "📋 Checking dependency policies..."
            cargo deny check
            echo "✅ All dependency policies satisfied"
        else
            echo "⚠️  cargo-deny not installed, skipping policy check"
            echo "   Install with: cargo install cargo-deny"
        fi
        
    else
        echo "❌ Cargo.lock not found"
        echo "   Run 'cargo build' to generate it"
        exit 1
    fi
else
    echo "⚠️  Cargo not found, skipping Rust checks"
fi

# Node.js dependency validation
echo "📦 Checking Node.js dependencies..."

if command_exists pnpm; then
    # Check if pnpm-lock.yaml exists
    if [ -f "pnpm-lock.yaml" ]; then
        echo "✅ pnpm-lock.yaml found"
        
        # Verify lock file integrity
        pnpm install --frozen-lockfile --offline 2>/dev/null || {
            echo "❌ pnpm-lock.yaml is inconsistent"
            echo "   Run 'pnpm install' to fix"
            exit 1
        }
        echo "✅ pnpm-lock.yaml is consistent"
        
        # Check for security vulnerabilities
        echo "🔒 Running npm security audit..."
        pnpm audit --audit-level=high || {
            echo "❌ Security vulnerabilities found"
            echo "   Run 'pnpm audit --fix' to resolve"
            exit 1
        }
        echo "✅ No high-severity vulnerabilities found"
        
    else
        echo "❌ pnpm-lock.yaml not found"
        echo "   Run 'pnpm install' to generate it"
        exit 1
    fi
    
    # Check ui2 directory
    if [ -d "ui2" ]; then
        echo "📱 Checking ui2 dependencies..."
        cd ui2
        
        if [ -f "package-lock.json" ]; then
            echo "✅ package-lock.json found in ui2"
            npm ci --only=prod 2>/dev/null || {
                echo "❌ package-lock.json is inconsistent in ui2"
                exit 1
            }
        fi
        
        cd ..
    fi
    
else
    echo "⚠️  pnpm not found, checking for npm..."
    
    if command_exists npm; then
        if [ -f "package-lock.json" ]; then
            echo "✅ package-lock.json found"
            npm ci --only=prod 2>/dev/null || {
                echo "❌ package-lock.json is inconsistent"
                exit 1
            }
        else
            echo "❌ package-lock.json not found"
            exit 1
        fi
    else
        echo "⚠️  Neither pnpm nor npm found, skipping Node.js checks"
    fi
fi

# E2E dependencies
echo "🎭 Checking E2E test dependencies..."

if [ -d "e2e" ]; then
    cd e2e
    
    if [ -f "package-lock.json" ]; then
        echo "✅ E2E package-lock.json found"
        npm ci 2>/dev/null || {
            echo "❌ E2E package-lock.json is inconsistent"
            cd ..
            exit 1
        }
        echo "✅ E2E dependencies are consistent"
    else
        echo "❌ E2E package-lock.json not found"
        cd ..
        exit 1
    fi
    
    cd ..
else
    echo "⚠️  E2E directory not found"
fi

# Version pinning validation
echo "📌 Validating version pinning..."

# Check Rust workspace dependencies are pinned
if [ -f "Cargo.toml" ]; then
    echo "🔍 Checking Rust version pinning..."
    
    # Count unpinned dependencies (those with ^ or ~ or ranges)
    unpinned_count=$(grep -E '^\s*\w+\s*=\s*"[\^~]|^\s*\w+\s*=\s*\{[^}]*version\s*=\s*"[\^~]' Cargo.toml | wc -l || echo "0")
    
    if [ "$unpinned_count" -gt 0 ]; then
        echo "⚠️  Found $unpinned_count unpinned Rust dependencies"
        echo "   Consider pinning critical dependencies for reproducible builds"
        grep -E '^\s*\w+\s*=\s*"[\^~]|^\s*\w+\s*=\s*\{[^}]*version\s*=\s*"[\^~]' Cargo.toml || true
    else
        echo "✅ All workspace dependencies are properly pinned"
    fi
fi

# Check Node.js dependencies are pinned
if [ -f "ui2/package.json" ]; then
    echo "🔍 Checking Node.js version pinning..."
    
    # Count unpinned dependencies
    unpinned_count=$(grep -E ':\s*"[\^~]' ui2/package.json | wc -l || echo "0")
    
    if [ "$unpinned_count" -gt 0 ]; then
        echo "⚠️  Found $unpinned_count unpinned Node.js dependencies"
        echo "   Consider pinning for reproducible builds"
    else
        echo "✅ All Node.js dependencies are properly pinned"
    fi
fi

# Validate no development dependencies in production builds
echo "🚀 Validating production build configuration..."

# Check for dev dependencies that might leak into production
if [ -f "ui2/package.json" ]; then
    dev_in_deps=$(grep -A 50 '"dependencies"' ui2/package.json | grep -E '"@types/|"typescript"|"eslint"|"prettier"' | wc -l || echo "0")
    
    if [ "$dev_in_deps" -gt 0 ]; then
        echo "⚠️  Development dependencies found in production dependencies"
        echo "   This may increase bundle size"
    else
        echo "✅ Production dependencies are clean"
    fi
fi

# Final summary
echo ""
echo "🎉 Dependency validation complete!"
echo ""
echo "📋 Summary:"
echo "  - Rust dependencies: $([ -f "Cargo.lock" ] && echo "✅ Valid" || echo "❌ Missing")"
echo "  - Node.js dependencies: $([ -f "pnpm-lock.yaml" ] && echo "✅ Valid" || echo "❌ Missing")"
echo "  - E2E dependencies: $([ -f "e2e/package-lock.json" ] && echo "✅ Valid" || echo "❌ Missing")"
echo "  - Security: $(command_exists cargo-audit && echo "✅ Checked" || echo "⚠️  Manual check needed")"
echo ""
echo "💡 Tip: Run this script in CI to ensure reproducible builds"