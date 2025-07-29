---
name: code-audit
description: Perform comprehensive code audit using 7 specialized sub-agents coordinated by an architect
---

I'll perform a comprehensive code audit of your project using a multi-agent approach. As the architect, I'll:

1. Analyze your codebase structure
2. Assign 7 specialized sub-agents to audit related file groups
3. Collect and synthesize their findings
4. Present a consolidated report and improvement plan

## Step 1: Codebase Analysis

Let me first understand the project structure:

```bash
# Get project overview
find . -type f -name "*.py" -o -name "*.rs" -o -name "*.jl" -o -name "*.ts" -o -name "*.js" | grep -v -E "(\.git|node_modules|__pycache__|build|dist)" | head -20
```

```bash
# Count files by type
echo "File distribution:"
find . -type f -name "*.py" | grep -v __pycache__ | wc -l | xargs echo "Python files:"
find . -type f -name "*.rs" | wc -l | xargs echo "Rust files:"
find . -type f -name "*.js" -o -name "*.ts" | grep -v node_modules | wc -l | xargs echo "JS/TS files:"
```

## Step 2: Agent Assignment

Based on the codebase structure, I'll create 7 specialized audit agents:

### Agent 1: Core Architecture Auditor
**Focus**: Main modules, interfaces, design patterns
**Criteria**: Architecture clarity, coupling, cohesion, SOLID principles

### Agent 2: Data Flow Auditor  
**Focus**: Data structures, I/O operations, serialization
**Criteria**: Data integrity, validation, efficiency, error handling

### Agent 3: Algorithm & Performance Auditor
**Focus**: Core algorithms, computational methods, hot paths
**Criteria**: Time/space complexity, optimization opportunities, bottlenecks

### Agent 4: Error Handling & Robustness Auditor
**Focus**: Exception handling, edge cases, defensive programming
**Criteria**: Error coverage, recovery strategies, logging, fault tolerance

### Agent 5: Testing & Quality Auditor
**Focus**: Test coverage, test quality, documentation
**Criteria**: Test completeness, assertion quality, edge case coverage

### Agent 6: API & Interface Auditor
**Focus**: Public APIs, function signatures, contracts
**Criteria**: API design, consistency, versioning, backwards compatibility

### Agent 7: Security & Safety Auditor
**Focus**: Input validation, dependencies, unsafe operations
**Criteria**: Security vulnerabilities, unsafe patterns, dependency risks

## Step 3: Parallel Audit Execution

I'll now dispatch the agents to audit their assigned areas. Each agent will examine:
- Code quality and style consistency
- Potential bugs and logic errors
- Performance implications
- Maintainability concerns
- Best practice adherence

@agent 1: Analyzing core architecture...
@agent 2: Examining data flow patterns...
@agent 3: Evaluating algorithms and performance...
@agent 4: Checking error handling robustness...
@agent 5: Assessing test coverage and quality...
@agent 6: Reviewing API design and interfaces...
@agent 7: Scanning for security concerns...

## Step 4: Findings Synthesis

After collecting reports from all agents, I'll compile findings organized by priority:

### Priority Levels:
1. **🔴 CRITICAL** - Security vulnerabilities, data corruption risks, crashes
2. **🟠 HIGH** - Significant bugs, performance issues, API breaking changes
3. **🟡 MEDIUM** - Code quality issues, missing tests, documentation gaps
4. **🟢 LOW** - Style inconsistencies, minor optimizations, nice-to-haves
5. **💙 COMMENDATIONS** - Well-implemented features, good patterns to replicate

## Step 5: Improvement Plan (Plan Mode with Deep Thinking)

After presenting the prioritized findings, I'll enter plan mode to:

1. **Deep Analysis**: Use extended thinking to understand root causes and interdependencies
2. **Solution Design**: Develop comprehensive solutions considering:
   - Minimal disruption to existing functionality
   - Backwards compatibility requirements
   - Performance implications
   - Testing requirements
   - Implementation complexity

3. **Implementation Roadmap**: Create a phased approach:
   - Phase 1: Critical fixes (immediate)
   - Phase 2: High priority issues (this sprint)
   - Phase 3: Medium priority (next sprint)
   - Phase 4: Low priority (backlog)

4. **Risk Assessment**: Identify potential risks in proposed changes

The plan will be presented for your approval before any implementation begins.

## Note on Perfect Code

If the audit finds no significant issues, I'll:
- Highlight the excellent practices observed
- Suggest areas for potential future enhancement
- Confirm that no immediate action is required

The goal is actionable improvement, not criticism for its own sake.