#!/bin/bash
# Update ticket status in state tracking system

set -e

TICKET_ID=$1
NEW_STATUS=$2
DETAILS=$3

if [ -z "$TICKET_ID" ] || [ -z "$NEW_STATUS" ]; then
    echo "Usage: $0 <ticket-id> <new-status> [details]"
    echo "Status options: not_started, in_progress, code_complete, in_review, completed, blocked"
    exit 1
fi

STATE_DIR="$(dirname "$0")/../STATE"
CURRENT_STATE="$STATE_DIR/CURRENT_STATE.json"
TICKET_FILE="$STATE_DIR/ticket_status/${TICKET_ID}.json"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Create ticket file if it doesn't exist
if [ ! -f "$TICKET_FILE" ]; then
    # Extract ticket info from CURRENT_STATE
    TICKET_INFO=$(jq -r --arg id "$TICKET_ID" '.tickets[$id] // empty' "$CURRENT_STATE")
    
    if [ -z "$TICKET_INFO" ]; then
        echo "Error: Ticket $TICKET_ID not found in CURRENT_STATE.json"
        exit 1
    fi
    
    # Create new ticket file
    echo "$TICKET_INFO" | jq --arg id "$TICKET_ID" --arg ts "$TIMESTAMP" '{
        ticket_id: $id,
        title: .title,
        status: "not_started",
        assignee: .assignee,
        package: .package,
        effort_hours: .effort_hours,
        timeline: [{
            timestamp: $ts,
            event: "created",
            actor: "system"
        }],
        test_requirements: [],
        acceptance_criteria: [],
        pr_info: {
            number: null,
            url: null,
            status: null,
            reviews: []
        }
    }' > "$TICKET_FILE"
fi

# Update ticket file
jq --arg status "$NEW_STATUS" \
   --arg timestamp "$TIMESTAMP" \
   --arg details "$DETAILS" \
   '.status = $status | .timeline += [{
     timestamp: $timestamp,
     event: $status,
     details: $details
   }]' \
   "$TICKET_FILE" > "${TICKET_FILE}.tmp" && mv "${TICKET_FILE}.tmp" "$TICKET_FILE"

# Update master state
jq --arg ticket "$TICKET_ID" \
   --arg status "$NEW_STATUS" \
   --arg timestamp "$TIMESTAMP" \
   '.tickets[$ticket].status = $status | 
    .last_updated = $timestamp |
    .recent_activity += [{
        timestamp: $timestamp,
        type: "ticket_update",
        message: "\($ticket) status changed to \($status)"
    }] |
    .recent_activity = .recent_activity[-10:]' \
   "$CURRENT_STATE" > "${CURRENT_STATE}.tmp" && mv "${CURRENT_STATE}.tmp" "$CURRENT_STATE"

# Update metrics based on status change
case "$NEW_STATUS" in
    "in_progress")
        jq --arg ticket "$TICKET_ID" \
           '.metrics.in_progress_tickets += 1' \
           "$CURRENT_STATE" > "${CURRENT_STATE}.tmp" && mv "${CURRENT_STATE}.tmp" "$CURRENT_STATE"
        ;;
    "completed")
        jq --arg ticket "$TICKET_ID" \
           --arg timestamp "$TIMESTAMP" \
           '.metrics.completed_tickets += 1 |
            .metrics.in_progress_tickets -= 1 |
            .tickets[$ticket].completed = $timestamp' \
           "$CURRENT_STATE" > "${CURRENT_STATE}.tmp" && mv "${CURRENT_STATE}.tmp" "$CURRENT_STATE"
        ;;
    "blocked")
        jq --arg ticket "$TICKET_ID" \
           '.metrics.blocked_tickets += 1 |
            .metrics.in_progress_tickets -= 1' \
           "$CURRENT_STATE" > "${CURRENT_STATE}.tmp" && mv "${CURRENT_STATE}.tmp" "$CURRENT_STATE"
        ;;
esac

echo "✅ Updated $TICKET_ID to status: $NEW_STATUS"

# Show current metrics
echo ""
echo "Current Metrics:"
jq -r '.metrics | "Completed: \(.completed_tickets)/\(.total_tickets) | In Progress: \(.in_progress_tickets) | Blocked: \(.blocked_tickets)"' "$CURRENT_STATE"