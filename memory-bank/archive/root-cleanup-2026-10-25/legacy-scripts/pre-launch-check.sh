#!/bin/bash

echo "🔍 Pre-launch verification for Brainflow..."
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track if we have any errors
has_errors=0

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a file exists
file_exists() {
    [ -f "$1" ]
}

# Function to check if a directory exists
dir_exists() {
    [ -d "$1" ]
}

echo "1️⃣  Checking prerequisites..."

# Check Rust
if command_exists cargo; then
    echo -e "${GREEN}✓${NC} Rust/Cargo installed"
    cargo --version
else
    echo -e "${RED}✗${NC} Rust/Cargo not found"
    has_errors=1
fi

# Check Node.js
if command_exists node; then
    echo -e "${GREEN}✓${NC} Node.js installed"
    node --version
else
    echo -e "${RED}✗${NC} Node.js not found"
    has_errors=1
fi

# Check pnpm
if command_exists pnpm; then
    echo -e "${GREEN}✓${NC} pnpm installed"
    pnpm --version
else
    echo -e "${RED}✗${NC} pnpm not found"
    has_errors=1
fi

echo
echo "2️⃣  Checking file structure..."

# Check critical files
if file_exists "Cargo.toml"; then
    echo -e "${GREEN}✓${NC} Root Cargo.toml exists"
else
    echo -e "${RED}✗${NC} Root Cargo.toml missing"
    has_errors=1
fi

if file_exists "package.json"; then
    echo -e "${GREEN}✓${NC} Root package.json exists"
else
    echo -e "${RED}✗${NC} Root package.json missing"
    has_errors=1
fi

if file_exists "src-tauri/tauri.conf.json"; then
    echo -e "${GREEN}✓${NC} Tauri config exists"
    
    # Check for hardcoded paths
    if grep -q "/Users/bbuchsbaum" src-tauri/tauri.conf.json; then
        echo -e "${RED}✗${NC} Hardcoded paths found in tauri.conf.json!"
        has_errors=1
    else
        echo -e "${GREEN}✓${NC} No hardcoded paths in tauri.conf.json"
    fi
else
    echo -e "${RED}✗${NC} Tauri config missing"
    has_errors=1
fi

echo
echo "3️⃣  Checking build artifacts..."

# Check if API package is built
if dir_exists "packages/api/dist"; then
    echo -e "${GREEN}✓${NC} API package built"
else
    echo -e "${YELLOW}⚠${NC} API package not built - will build during launch"
fi

# Check if UI is built
if dir_exists "ui/build"; then
    echo -e "${GREEN}✓${NC} UI built"
else
    echo -e "${YELLOW}⚠${NC} UI not built - will build during launch"
fi

# Check if Rust target directory exists
if dir_exists "target"; then
    echo -e "${GREEN}✓${NC} Rust build directory exists"
else
    echo -e "${YELLOW}⚠${NC} Rust not built yet - will build during launch"
fi

echo
echo "4️⃣  Checking dependencies..."

# Check if node_modules exists
if dir_exists "node_modules"; then
    echo -e "${GREEN}✓${NC} Root node_modules exists"
else
    echo -e "${YELLOW}⚠${NC} Dependencies not installed - run: pnpm install"
fi

if dir_exists "ui/node_modules"; then
    echo -e "${GREEN}✓${NC} UI node_modules exists"
else
    echo -e "${YELLOW}⚠${NC} UI dependencies not installed"
fi

echo
echo "5️⃣  Checking GPU support..."

# Basic GPU check (platform specific)
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if system_profiler SPDisplaysDataType | grep -q "Metal"; then
        echo -e "${GREEN}✓${NC} Metal GPU support detected (macOS)"
    else
        echo -e "${YELLOW}⚠${NC} Could not verify GPU support"
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command_exists glxinfo; then
        if glxinfo | grep -q "OpenGL renderer"; then
            echo -e "${GREEN}✓${NC} OpenGL support detected"
        else
            echo -e "${YELLOW}⚠${NC} Could not verify GPU support"
        fi
    else
        echo -e "${YELLOW}⚠${NC} glxinfo not found - can't check GPU"
    fi
else
    echo -e "${YELLOW}⚠${NC} GPU check not implemented for this platform"
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $has_errors -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed!${NC}"
    echo
    echo "You can now run:"
    echo "  cargo tauri dev    # For development"
    echo "  cargo tauri build  # For production"
else
    echo -e "${RED}❌ Some checks failed!${NC}"
    echo
    echo "Please fix the issues above before launching."
    exit 1
fi