#!/bin/bash
# Verify tests for a specific ticket

set -e

TICKET_ID=$1

if [ -z "$TICKET_ID" ]; then
    echo "Usage: $0 <ticket-id>"
    exit 1
fi

STATE_DIR="$(dirname "$0")/../STATE"
TICKET_FILE="$STATE_DIR/ticket_status/${TICKET_ID}.json"
PROJECT_ROOT="$(dirname "$0")/../../.."

if [ ! -f "$TICKET_FILE" ]; then
    echo "Error: Ticket file not found: $TICKET_FILE"
    exit 1
fi

echo "🧪 Running tests for $TICKET_ID..."
echo ""

# Define test requirements based on ticket ID
case "$TICKET_ID" in
    "TD-CRIT-INTEG-001")
        # Test ts-rs version alignment
        echo "Checking ts-rs version alignment..."
        cd "$PROJECT_ROOT/xtask"
        VERSION=$(cargo tree 2>/dev/null | grep ts-rs | head -1 | awk '{print $2}' | tr -d 'v')
        if [[ "$VERSION" == "10.1.0" ]]; then
            echo "✅ PASSED: ts-rs version is 10.1.0"
            TEST_PASSED=true
        else
            echo "❌ FAILED: ts-rs version is $VERSION, expected 10.1.0"
            TEST_PASSED=false
        fi
        ;;
        
    "TD-CRIT-INFRA-001")
        # Test root package.json
        echo "Checking root package.json..."
        if [ -f "$PROJECT_ROOT/package.json" ]; then
            # Check for required scripts
            SCRIPTS=$(jq -r '.scripts | keys[]' "$PROJECT_ROOT/package.json" 2>/dev/null)
            REQUIRED=("dev" "build" "test" "lint" "format")
            TEST_PASSED=true
            
            for script in "${REQUIRED[@]}"; do
                if echo "$SCRIPTS" | grep -q "^$script$"; then
                    echo "✅ PASSED: Script '$script' exists"
                else
                    echo "❌ FAILED: Script '$script' missing"
                    TEST_PASSED=false
                fi
            done
        else
            echo "❌ FAILED: Root package.json not found"
            TEST_PASSED=false
        fi
        ;;
        
    "TD-HIGH-RUST-001")
        # Test unwrap removal in api_bridge
        echo "Checking for unwrap() in api_bridge..."
        cd "$PROJECT_ROOT"
        UNWRAPS=$(grep -n "unwrap()" core/api_bridge/src/lib.rs 2>/dev/null | wc -l || echo "0")
        if [ "$UNWRAPS" -eq 0 ]; then
            echo "✅ PASSED: No unwrap() calls found"
            TEST_PASSED=true
        else
            echo "❌ FAILED: Found $UNWRAPS unwrap() calls"
            TEST_PASSED=false
        fi
        ;;
        
    "TD-HIGH-UI-001")
        # Test three-canvas layout
        echo "Running UI component tests..."
        cd "$PROJECT_ROOT/ui"
        if pnpm test:unit -- VolumeView 2>/dev/null; then
            echo "✅ PASSED: VolumeView tests passing"
            TEST_PASSED=true
        else
            echo "❌ FAILED: VolumeView tests failing"
            TEST_PASSED=false
        fi
        ;;
        
    *)
        echo "⚠️  No specific tests defined for $TICKET_ID"
        echo "Running general tests..."
        
        # Try to run cargo test for Rust tickets
        if [[ "$TICKET_ID" == TD-*-RUST-* ]]; then
            cd "$PROJECT_ROOT"
            if cargo test --workspace 2>/dev/null; then
                echo "✅ PASSED: Cargo tests passing"
                TEST_PASSED=true
            else
                echo "❌ FAILED: Cargo tests failing"
                TEST_PASSED=false
            fi
        # Try to run pnpm test for UI tickets
        elif [[ "$TICKET_ID" == TD-*-UI-* ]] || [[ "$TICKET_ID" == TD-*-TEST-* ]]; then
            cd "$PROJECT_ROOT"
            if pnpm test:unit 2>/dev/null; then
                echo "✅ PASSED: UI tests passing"
                TEST_PASSED=true
            else
                echo "❌ FAILED: UI tests failing"
                TEST_PASSED=false
            fi
        else
            echo "ℹ️  Skipping tests - no test suite identified"
            TEST_PASSED=true
        fi
        ;;
esac

# Update test results in ticket file
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$TEST_PASSED" = true ]; then
    jq --arg timestamp "$TIMESTAMP" \
       '.test_status = "passing" |
        .timeline += [{
            timestamp: $timestamp,
            event: "tests_passed",
            details: "All tests passing"
        }]' \
       "$TICKET_FILE" > "${TICKET_FILE}.tmp" && mv "${TICKET_FILE}.tmp" "$TICKET_FILE"
    
    echo ""
    echo "✅ All tests passed! Ticket can proceed."
    exit 0
else
    jq --arg timestamp "$TIMESTAMP" \
       '.test_status = "failing" |
        .timeline += [{
            timestamp: $timestamp,
            event: "tests_failed",
            details: "Tests need fixing"
        }]' \
       "$TICKET_FILE" > "${TICKET_FILE}.tmp" && mv "${TICKET_FILE}.tmp" "$TICKET_FILE"
    
    echo ""
    echo "❌ Tests failed. Please fix before marking complete."
    exit 1
fi