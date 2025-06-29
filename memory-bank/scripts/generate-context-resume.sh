#!/bin/bash
# Generate context resume document from current state

set -e

SCRIPT_DIR="$(dirname "$0")"
STATE_DIR="$SCRIPT_DIR/../STATE"
CURRENT_STATE="$STATE_DIR/CURRENT_STATE.json"
OUTPUT="$SCRIPT_DIR/../CONTEXT_RESUME.md"

if [ ! -f "$CURRENT_STATE" ]; then
    echo "Error: CURRENT_STATE.json not found"
    exit 1
fi

# Extract data from state
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SPRINT=$(jq -r '.sprint.current' "$CURRENT_STATE")
SPRINT_DAY=$(jq -r '.sprint.day' "$CURRENT_STATE")
SPRINT_STATUS=$(jq -r '.sprint.status' "$CURRENT_STATE")
HEALTH_SCORE=$(jq -r '.metrics.health_score' "$CURRENT_STATE")
COMPLETED=$(jq -r '.metrics.completed_tickets' "$CURRENT_STATE")
TOTAL=$(jq -r '.metrics.total_tickets' "$CURRENT_STATE")
IN_PROGRESS=$(jq -r '.metrics.in_progress_tickets' "$CURRENT_STATE")
BLOCKED=$(jq -r '.metrics.blocked_tickets' "$CURRENT_STATE")
COVERAGE=$(jq -r '.test_results.coverage_percent' "$CURRENT_STATE")

# Calculate percentage
if [ $TOTAL -gt 0 ]; then
    PERCENT=$((COMPLETED * 100 / TOTAL))
else
    PERCENT=0
fi

# Generate the document
cat > "$OUTPUT" << EOF
# Quick Context Resume

**Generated:** $TIMESTAMP  
**Sprint:** $SPRINT ($SPRINT_STATUS)  
**Health Score:** $HEALTH_SCORE/10 $([ $(echo "$HEALTH_SCORE < 6" | bc) -eq 1 ] && echo "🟡" || echo "🟢")

## 🎯 Current Status
- **Phase:** Sprint $SPRINT, Day $SPRINT_DAY
- **Progress:** $COMPLETED/$TOTAL tickets ($PERCENT%)
- **Tests:** $COVERAGE% coverage
- **Active Work:** $IN_PROGRESS in progress, $BLOCKED blocked

## 📋 Quick Stats
\`\`\`
$(jq -r '.metrics | "Critical Issues: \(.critical_debt_items) remaining\nHigh Priority: \(.high_debt_items) remaining\nMedium Priority: \(.medium_debt_items) remaining\nLow Priority: \(.low_debt_items) remaining"' "$CURRENT_STATE")
\`\`\`

## 🔄 In Progress Work

### Active Tickets
$(jq -r '.tickets | to_entries[] | select(.value.status == "in_progress") | "- **\(.key)**: \(.value.title) (\(.value.assignee))"' "$CURRENT_STATE" || echo "None currently active")

### Blocked Tickets
$(jq -r '.tickets | to_entries[] | select(.value.status == "blocked") | "- **\(.key)**: \(.value.title) - Blocked by: \(.value.blockers | join(", "))"' "$CURRENT_STATE" || echo "None currently blocked")

### Recently Completed
$(jq -r '.tickets | to_entries[] | select(.value.status == "completed") | "- ✅ **\(.key)**: \(.value.title)"' "$CURRENT_STATE" | tail -5 || echo "None yet")

## 📊 Chain Progress

$(jq -r '.chains | to_entries[] | "### \(.key | gsub("_"; " ") | ascii_upcase)\n- Status: \(.value.status)\n- Phase: \(.value.current_phase)/\(.value.total_phases)\n- Gates Passed: \(.value.gates_passed | length)\n- Assignee: \(.value.assignee)\n"' "$CURRENT_STATE")

## 🚀 Next Actions

### Ready to Start
$(jq -r '.tickets | to_entries[] | select(.value.status == "not_started" and (.value.blockers | length == 0)) | "- \(.key): \(.value.title) (\(.value.effort_hours) hours)"' "$CURRENT_STATE" | head -10)

### Waiting on Dependencies
$(jq -r '.tickets | to_entries[] | select(.value.status == "not_started" and (.value.blockers | length > 0)) | "- \(.key): Waiting on \(.value.blockers | join(", "))"' "$CURRENT_STATE" | head -5)

## 📊 State Check Commands

\`\`\`bash
# View current metrics
cat memory-bank/STATE/CURRENT_STATE.json | jq '.metrics'

# List active work
cat memory-bank/STATE/CURRENT_STATE.json | jq '.tickets | with_entries(select(.value.status == "in_progress"))'

# Check test status
./memory-bank/scripts/verify-ticket-tests.sh <TICKET-ID>

# Update ticket status
./memory-bank/scripts/update-ticket-status.sh <TICKET-ID> <STATUS>
\`\`\`

## 🛠️ Common Operations

### Continue Work on Active Ticket
\`\`\`bash
# See what's in progress
cat memory-bank/STATE/CURRENT_STATE.json | jq -r '.tickets | to_entries[] | select(.value.status == "in_progress") | .key'

# Check ticket details
cat memory-bank/STATE/ticket_status/<TICKET-ID>.json | jq .
\`\`\`

### Start New Work
\`\`\`bash
# Find unblocked tickets
cat memory-bank/STATE/CURRENT_STATE.json | jq -r '.tickets | to_entries[] | select(.value.status == "not_started" and (.value.blockers | length == 0)) | "\(.key): \(.value.title)"'

# Claim a ticket
./memory-bank/scripts/update-ticket-status.sh <TICKET-ID> in_progress "Starting work"
\`\`\`

## 📈 Recent Activity

$(jq -r '.recent_activity[-5:] | reverse | .[] | "- \(.timestamp | split("T")[0]): \(.message)"' "$CURRENT_STATE")

## 🎯 Sprint Goals

$(case $SPRINT in
    0) echo "- Fix critical infrastructure blockers
- Establish type generation pipeline
- Get shaders compiling
- Enable data loading"
    ;;
    1) echo "- Connect data flow to GPU
- Implement rendering pipeline
- Achieve basic visualization"
    ;;
    *) echo "- See Sprint plan for details"
    ;;
esac)

## 💡 Quick Wins Available

$(jq -r '.tickets | to_entries[] | select(.value.status == "not_started" and .value.effort_hours <= 2 and (.value.blockers | length == 0)) | "- \(.key): \(.value.title) (\(.value.effort_hours) hours)"' "$CURRENT_STATE" | head -5)

---

**Next Update:** Run \`./memory-bank/scripts/generate-context-resume.sh\` for latest
EOF

echo "✅ Context resume generated: $OUTPUT"