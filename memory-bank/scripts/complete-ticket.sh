#!/bin/bash
# Mark a ticket as complete after verification

set -e

TICKET_ID=$1
PR_INFO=$2

if [ -z "$TICKET_ID" ]; then
    echo "Usage: $0 <ticket-id> [pr-info]"
    exit 1
fi

SCRIPT_DIR="$(dirname "$0")"

# First verify tests are passing
echo "Verifying tests before completion..."
if ! "$SCRIPT_DIR/verify-ticket-tests.sh" "$TICKET_ID"; then
    echo "❌ Cannot complete ticket - tests are failing"
    exit 1
fi

# Update status to completed
"$SCRIPT_DIR/update-ticket-status.sh" "$TICKET_ID" "completed" "$PR_INFO"

# Check for unblocked tickets
STATE_DIR="$SCRIPT_DIR/../STATE"
CURRENT_STATE="$STATE_DIR/CURRENT_STATE.json"

echo ""
echo "Checking for unblocked tickets..."

# Find tickets that were blocked by this one
UNBLOCKED=$(jq -r --arg completed "$TICKET_ID" '
    .tickets | to_entries[] | 
    select(.value.blockers // [] | contains([$completed])) | 
    .key
' "$CURRENT_STATE")

if [ ! -z "$UNBLOCKED" ]; then
    echo "🔓 The following tickets are now unblocked:"
    echo "$UNBLOCKED" | while read ticket; do
        echo "  - $ticket"
        # Remove the blocker
        jq --arg ticket "$ticket" --arg blocker "$TICKET_ID" '
            .tickets[$ticket].blockers = (.tickets[$ticket].blockers // [] | map(select(. != $blocker)))
        ' "$CURRENT_STATE" > "${CURRENT_STATE}.tmp" && mv "${CURRENT_STATE}.tmp" "$CURRENT_STATE"
    done
else
    echo "No tickets were waiting on this one."
fi

# Check chain progress if this was part of a chain
CHAIN=$(jq -r --arg ticket "$TICKET_ID" '
    .chains | to_entries[] | 
    select(.value.tickets | contains([$ticket])) | 
    .key
' "$CURRENT_STATE")

if [ ! -z "$CHAIN" ]; then
    echo ""
    echo "📊 Chain Progress: $CHAIN"
    
    # Count completed tickets in chain
    CHAIN_TICKETS=$(jq -r --arg chain "$CHAIN" '.chains[$chain].tickets[]' "$CURRENT_STATE")
    COMPLETED=0
    TOTAL=0
    
    for ticket in $CHAIN_TICKETS; do
        TOTAL=$((TOTAL + 1))
        STATUS=$(jq -r --arg t "$ticket" '.tickets[$t].status' "$CURRENT_STATE")
        if [ "$STATUS" = "completed" ]; then
            COMPLETED=$((COMPLETED + 1))
        fi
    done
    
    echo "Progress: $COMPLETED/$TOTAL tickets completed"
    
    # Check if we've hit a gate
    case "$CHAIN" in
        "type_generation")
            if [ $COMPLETED -eq 2 ]; then
                echo "🚪 Gate 1 reached! Verify before proceeding to Phase 2"
            elif [ $COMPLETED -eq 5 ]; then
                echo "🚪 Gate 2 reached! Verify before proceeding to Phase 3"
            elif [ $COMPLETED -eq 9 ]; then
                echo "🎉 Chain complete! Type generation is working"
            fi
            ;;
        "shader_pipeline")
            if [ $COMPLETED -eq 3 ]; then
                echo "🚪 Gate 1 reached! Verify shaders compile"
            elif [ $COMPLETED -eq 6 ]; then
                echo "🚪 Gate 2 reached! Verify shaders validate"
            elif [ $COMPLETED -eq 9 ]; then
                echo "🎉 Chain complete! Shader pipeline is working"
            fi
            ;;
        "data_flow")
            if [ $COMPLETED -eq 3 ]; then
                echo "🚪 Gate 1 reached! Verify data loads"
            elif [ $COMPLETED -eq 6 ]; then
                echo "🚪 Gate 2 reached! Verify registry works"
            elif [ $COMPLETED -eq 9 ]; then
                echo "🎉 Chain complete! Data flow is working"
            fi
            ;;
    esac
fi

echo ""
echo "✅ Ticket $TICKET_ID marked as complete!"