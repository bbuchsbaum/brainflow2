---
name: run-golden-tests
description: Execute golden tests with comprehensive validation, results analysis, and dashboard generation
---

I'll help you run golden tests with complete schema validation, execution, and results analysis. This command provides a turnkey solution for executing tests in any golden tests repository.

**Usage**: `/run-golden-tests [test_pattern]`

**Examples**: 
- `/run-golden-tests` (run all tests)
- `/run-golden-tests core` (run tests matching "core" pattern)
- `/run-golden-tests hrf_*` (run tests matching specific pattern)

I'll now execute the golden tests with the specified pattern: `$ARGUMENTS` (or all tests if no pattern provided).

Let me run the complete golden tests execution workflow:

## Step 1: Prerequisites Check and Setup

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "in_progress", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "pending", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "pending", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "pending", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "pending", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "pending", "priority": "low"}]</parameter>
</invoke>

<function_calls>
<invoke name="Bash">
<parameter name="command">
# Process test pattern argument
if [ -n "$ARGUMENTS" ]; then
    TEST_PATTERN="$ARGUMENTS"
    echo "Using test pattern: $TEST_PATTERN"
else
    TEST_PATTERN=""
    echo "Running all tests"
fi

# Check if this is a golden tests directory
if [ -d "golden_tests" ]; then
    cd golden_tests
    echo "✓ Found golden_tests directory"
elif [ -f "validate_golden_tests.py" ] || [ -d "specs" ]; then
    echo "✓ Already in golden tests directory"
else
    echo "❌ No golden_tests directory found"
    echo "This command works from:"
    echo "  1. Root of repository with golden_tests/ subdirectory"
    echo "  2. Inside the golden_tests/ directory itself"
    echo "Run 'sync-golden-tests' or 'init-golden-tests' first"
    exit 1
fi

# Detect project language
echo "Detecting project language..."
if [ -f ../pyproject.toml ] || [ -f ../setup.py ] || find .. -name "*.py" -type f | head -1 | grep -q .; then
    PROJECT_LANG="Python"
    echo "✓ Detected Python project"
elif [ -f ../Cargo.toml ] || find .. -name "*.rs" -type f | head -1 | grep -q .; then
    PROJECT_LANG="Rust"
    echo "✓ Detected Rust project"
elif [ -f ../DESCRIPTION ] || find .. -name "*.R" -type f | head -1 | grep -q .; then
    PROJECT_LANG="R"
    echo "✓ Detected R project"
elif [ -f ../Project.toml ] || find .. -name "*.jl" -type f | head -1 | grep -q .; then
    PROJECT_LANG="Julia"
    echo "✓ Detected Julia project"
else
    PROJECT_LANG="Unknown"
    echo "⚠️  Could not detect project language"
fi

echo "Project language: $PROJECT_LANG"
echo "Test pattern: ${TEST_PATTERN:-'All tests'}"
</parameter>
<parameter name="description">Check directory structure and detect project language</parameter>
</invoke>

## Step 2: Critical Schema Validation

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "completed", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "in_progress", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "pending", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "pending", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "pending", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "pending", "priority": "low"}]</parameter>
</invoke>

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "🔒 CRITICAL SCHEMA VALIDATION"
echo "================================================"

# Check for schema validator
if [ ! -f validate_golden_tests.py ] && [ ! -f tools/validate_golden_tests.py ]; then
    echo "❌ Schema validator not found - attempting installation..."
    
    # Try to find validator from known locations
    if [ -f ~/code/fmrihrf/golden_tests/tools/validate_golden_tests.py ]; then
        cp ~/code/fmrihrf/golden_tests/tools/validate_golden_tests.py .
        chmod +x validate_golden_tests.py
        echo "✓ Schema validator installed from fmrihrf"
    elif [ -f ~/code/translation/golden/tools/validate_golden_tests.py ]; then
        cp ~/code/translation/golden/tools/validate_golden_tests.py .
        chmod +x validate_golden_tests.py
        echo "✓ Schema validator installed from translation"
    else
        echo "❌ Schema validator not found - tests may fail due to schema issues"
        echo "Install manually or run 'sync-golden-tests' first"
        exit 1
    fi
fi

# Run schema validation
VALIDATOR_PATH=""
if [ -f validate_golden_tests.py ]; then
    VALIDATOR_PATH="validate_golden_tests.py"
elif [ -f tools/validate_golden_tests.py ]; then
    VALIDATOR_PATH="tools/validate_golden_tests.py"
fi

if [ -n "$VALIDATOR_PATH" ]; then
    echo "Running comprehensive schema validation..."
    python "$VALIDATOR_PATH" --project . --verbose
    SCHEMA_RESULT=$?
    
    if [ $SCHEMA_RESULT -eq 0 ]; then
        echo "✅ All XML files pass canonical schema validation"
        echo "🔒 Schema Prevention: All tests use xmlns=\"http://golden-tests.org/schema\""
    else
        echo "❌ Schema validation failed - tests may not be discovered properly"
        echo "Common schema fixes:"
        echo "  1. Use canonical namespace: xmlns=\"http://golden-tests.org/schema\""
        echo "  2. Remove deprecated xsi:noNamespaceSchemaLocation attributes"
        echo "  3. Validate XML structure and required elements"
        exit 1
    fi
else
    echo "⚠️  Skipping schema validation (validator not available)"
fi
</parameter>
<parameter name="description">Run critical schema validation</parameter>
</invoke>

## Step 3: Test Discovery and Validation

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "completed", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "completed", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "in_progress", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "pending", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "pending", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "pending", "priority": "low"}]</parameter>
</invoke>

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "🔍 TEST DISCOVERY"
echo "================================================"

# Count total test specifications
TOTAL_SPECS=$(find specs -name "*.xml" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TOTAL_SPECS" -eq 0 ]; then
    echo "❌ No test specifications found in specs/ directory"
    echo "Ensure you're in the correct directory or run 'sync-golden-tests' first"
    exit 1
fi

echo "📋 Total test specifications found: $TOTAL_SPECS"

# Apply test pattern filtering if specified
if [ -n "$TEST_PATTERN" ]; then
    FILTERED_SPECS=$(find specs -name "*.xml" | grep "$TEST_PATTERN" | wc -l | tr -d ' ')
    echo "🔍 Tests matching pattern '$TEST_PATTERN': $FILTERED_SPECS"
    if [ "$FILTERED_SPECS" -eq 0 ]; then
        echo "❌ No tests match the specified pattern"
        exit 1
    fi
fi

# Verify test runner availability
echo "Checking test runner availability..."
RUNNER_FOUND=false

case $PROJECT_LANG in
    "Python")
        if [ -f tools/golden_test_runner.py ]; then
            echo "✓ Python test runner found: tools/golden_test_runner.py"
            RUNNER_FOUND=true
        elif [ -f golden_test_runner.py ]; then
            echo "✓ Python test runner found: golden_test_runner.py"
            RUNNER_FOUND=true
        elif [ -f tools/improved_test_runner.py ]; then
            echo "✓ Python test runner found: tools/improved_test_runner.py"
            RUNNER_FOUND=true
        fi
        ;;
    "R")
        if [ -f tools/golden_test_runner.R ]; then
            echo "✓ R test runner found: tools/golden_test_runner.R"
            RUNNER_FOUND=true
        elif [ -f golden_test_runner.R ]; then
            echo "✓ R test runner found: golden_test_runner.R"
            RUNNER_FOUND=true
        fi
        ;;
    *)
        echo "⚠️  Unknown language - will attempt generic test execution"
        ;;
esac

if [ "$RUNNER_FOUND" = "false" ]; then
    echo "❌ Test runner not found for $PROJECT_LANG"
    echo "Installing test runners from reference repository..."
    
    # Try to install from known locations
    if [ -d ~/code/fmrihrf/golden_tests/tools ]; then
        mkdir -p tools
        cp ~/code/fmrihrf/golden_tests/tools/golden_test_runner.* tools/ 2>/dev/null
        cp ~/code/fmrihrf/golden_tests/tools/improved_test_runner.py tools/ 2>/dev/null
        chmod +x tools/*.py tools/*.R 2>/dev/null
        echo "✓ Test runners installed from fmrihrf reference"
    else
        echo "❌ Could not install test runners - run 'sync-golden-tests' first"
        exit 1
    fi
fi

echo "✅ Test discovery and validation complete"
</parameter>
<parameter name="description">Discover and validate test specifications</parameter>
</invoke>

## Step 4: Execute Tests Based on Project Language

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "completed", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "completed", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "completed", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "in_progress", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "pending", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "pending", "priority": "low"}]</parameter>
</invoke>

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "🧪 TEST EXECUTION"
echo "================================================"

# Generate timestamp for results
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="results_$TIMESTAMP"
mkdir -p "$RESULTS_DIR"

# Execute tests based on detected language
EXECUTION_SUCCESS=false

case $PROJECT_LANG in
    "Python")
        echo "Running Python tests..."
        RESULTS_FILE="golden_test_results_python_$TIMESTAMP.json"
        
        # Determine which Python runner to use
        if [ -f tools/improved_test_runner.py ]; then
            PYTHON_CMD="python tools/improved_test_runner.py --golden-tests-dir . --output $RESULTS_FILE --verbose"
        elif [ -f tools/golden_test_runner.py ]; then
            PYTHON_CMD="python tools/golden_test_runner.py --output $RESULTS_FILE --verbose"
        elif [ -f golden_test_runner.py ]; then
            PYTHON_CMD="python golden_test_runner.py --output $RESULTS_FILE --verbose"
        else
            echo "❌ No Python test runner available"
            exit 1
        fi
        
        # Add test pattern if specified
        if [ -n "$TEST_PATTERN" ]; then
            PYTHON_CMD="$PYTHON_CMD --pattern $TEST_PATTERN"
        fi
        
        echo "Executing: $PYTHON_CMD"
        eval $PYTHON_CMD
        PYTHON_EXIT_CODE=$?
        
        if [ $PYTHON_EXIT_CODE -eq 0 ] && [ -f "$RESULTS_FILE" ]; then
            echo "✅ Python tests completed successfully"
            mv "$RESULTS_FILE" "$RESULTS_DIR/"
            EXECUTION_SUCCESS=true
            
            # Show summary
            PYTHON_SUMMARY=$(python -c "
import json
with open('$RESULTS_DIR/$RESULTS_FILE') as f: 
    data = json.load(f)
    s = data['summary']
    print(f'📊 Python Results: {s[\"passed_tests\"]}/{s[\"total_tests\"]} passed ({s[\"passed_tests\"]/s[\"total_tests\"]*100:.1f}%), {s[\"failed_tests\"]} failed, {s[\"error_tests\"]} errors')
" 2>/dev/null)
            echo "$PYTHON_SUMMARY"
        else
            echo "❌ Python tests failed or no results generated"
        fi
        ;;
        
    "R")
        echo "Running R tests..."
        RESULTS_FILE="golden_test_results_r_$TIMESTAMP.json"
        
        # Determine which R runner to use
        if [ -f tools/golden_test_runner.R ]; then
            R_CMD="Rscript tools/golden_test_runner.R --output $RESULTS_FILE --verbose"
        elif [ -f golden_test_runner.R ]; then
            R_CMD="Rscript golden_test_runner.R --output $RESULTS_FILE --verbose"
        else
            echo "❌ No R test runner available"
            exit 1
        fi
        
        # Add test pattern if specified
        if [ -n "$TEST_PATTERN" ]; then
            R_CMD="$R_CMD --pattern $TEST_PATTERN"
        fi
        
        echo "Executing: $R_CMD"
        eval $R_CMD
        R_EXIT_CODE=$?
        
        if [ $R_EXIT_CODE -eq 0 ] && [ -f "$RESULTS_FILE" ]; then
            echo "✅ R tests completed successfully"
            mv "$RESULTS_FILE" "$RESULTS_DIR/"
            EXECUTION_SUCCESS=true
            
            # Show summary
            R_SUMMARY=$(Rscript -e "
library(jsonlite)
data <- fromJSON('$RESULTS_DIR/$RESULTS_FILE')
s <- data\$summary
cat(sprintf('📊 R Results: %d/%d passed (%.1f%%), %d failed, %d errors\\n', 
    s\$passed_tests, s\$total_tests, s\$passed_tests/s\$total_tests*100, 
    s\$failed_tests, s\$error_tests))
" 2>/dev/null)
            echo "$R_SUMMARY"
        else
            echo "❌ R tests failed or no results generated"
        fi
        ;;
        
    *)
        echo "⚠️  Unknown language - attempting generic test execution"
        if [ -f tools/golden_test_runner.py ]; then
            echo "Trying Python runner..."
            python tools/golden_test_runner.py --verbose
            [ $? -eq 0 ] && EXECUTION_SUCCESS=true
        elif [ -f tools/golden_test_runner.R ]; then
            echo "Trying R runner..."
            Rscript tools/golden_test_runner.R --verbose
            [ $? -eq 0 ] && EXECUTION_SUCCESS=true
        else
            echo "❌ No test runners available"
        fi
        ;;
esac

if [ "$EXECUTION_SUCCESS" = "false" ]; then
    echo "❌ Test execution failed"
    exit 1
fi

echo "✅ Test execution completed successfully"
</parameter>
<parameter name="description">Execute tests based on project language</parameter>
</invoke>

## Step 5: Generate Results Dashboard

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "completed", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "completed", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "completed", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "completed", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "in_progress", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "pending", "priority": "low"}]</parameter>
</invoke>

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "📊 RESULTS DASHBOARD GENERATION"
echo "================================================"

# Find latest results files
LATEST_RESULTS=$(ls "$RESULTS_DIR"/golden_test_results_*.json 2>/dev/null | tail -1)

if [ -z "$LATEST_RESULTS" ]; then
    echo "⚠️  No results files found - dashboard generation skipped"
else
    echo "Generating interactive dashboard..."
    
    # Check for dashboard generator
    DASHBOARD_GENERATOR=""
    if [ -f tools/enhanced_dashboard_generator.py ]; then
        DASHBOARD_GENERATOR="tools/enhanced_dashboard_generator.py"
    elif [ -f enhanced_dashboard_generator.py ]; then
        DASHBOARD_GENERATOR="enhanced_dashboard_generator.py"
    else
        echo "Installing dashboard generator..."
        if [ -f ~/code/fmrihrf/golden_tests/tools/enhanced_dashboard_generator.py ]; then
            mkdir -p tools
            cp ~/code/fmrihrf/golden_tests/tools/enhanced_dashboard_generator.py tools/
            chmod +x tools/enhanced_dashboard_generator.py
            DASHBOARD_GENERATOR="tools/enhanced_dashboard_generator.py"
            echo "✓ Dashboard generator installed"
        else
            echo "⚠️  Dashboard generator not found - manual installation required"
        fi
    fi
    
    if [ -n "$DASHBOARD_GENERATOR" ]; then
        DASHBOARD_DIR="dashboard_$TIMESTAMP"
        
        echo "Generating dashboard from results: $LATEST_RESULTS"
        python "$DASHBOARD_GENERATOR" \
            --project . \
            --results "$LATEST_RESULTS" \
            --output "$DASHBOARD_DIR"
        
        if [ -f "$DASHBOARD_DIR/index.html" ]; then
            echo "✅ Dashboard generated: $DASHBOARD_DIR/index.html"
        else
            echo "⚠️  Dashboard generation may have failed"
        fi
    fi
fi

echo "✅ Dashboard generation complete"
</parameter>
<parameter name="description">Generate results dashboard</parameter>
</invoke>

## Step 6: Comprehensive Summary

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "completed", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "completed", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "completed", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "completed", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "completed", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "in_progress", "priority": "low"}]</parameter>
</invoke>

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo ""
echo "================================================"
echo "🎯 GOLDEN TESTS EXECUTION SUMMARY"
echo "================================================"
echo ""

echo "📁 Execution Details:"
echo "   Project Language: $PROJECT_LANG"
echo "   Test Pattern: ${TEST_PATTERN:-'All tests'}"
echo "   Execution Time: $(date)"
echo "   Results Directory: $RESULTS_DIR"
echo ""

# Schema Compliance Report
echo "🔒 Schema Compliance:"
if [ -n "$VALIDATOR_PATH" ]; then
    SCHEMA_STATS=$(python "$VALIDATOR_PATH" --project . 2>/dev/null | grep -E "Total files|Valid files" | tr '\n' ' ')
    if [ -n "$SCHEMA_STATS" ]; then
        echo "   $SCHEMA_STATS"
    else
        echo "   ✅ Schema validation completed successfully"
    fi
else
    echo "   ⚠️  Schema validation not performed"
fi
echo ""

# Test Results Summary
echo "🧪 Test Results:"
if [ -n "$LATEST_RESULTS" ]; then
    case $PROJECT_LANG in
        "Python")
            PYTHON_DETAILED=$(python -c "
import json
with open('$LATEST_RESULTS') as f: 
    data = json.load(f)
    s = data['summary']
    print(f'   🐍 Python: {s[\"passed_tests\"]}/{s[\"total_tests\"]} passed ({s[\"passed_tests\"]/s[\"total_tests\"]*100:.1f}%), {s[\"failed_tests\"]} failed, {s[\"error_tests\"]} errors')
" 2>/dev/null)
            echo "$PYTHON_DETAILED"
            ;;
        "R")
            R_DETAILED=$(Rscript -e "
library(jsonlite)
data <- fromJSON('$LATEST_RESULTS')
s <- data\$summary
cat(sprintf('   📊 R: %d/%d passed (%.1f%%), %d failed, %d errors\\n', 
    s\$passed_tests, s\$total_tests, s\$passed_tests/s\$total_tests*100, 
    s\$failed_tests, s\$error_tests))
" 2>/dev/null)
            echo "$R_DETAILED"
            ;;
    esac
else
    echo "   ⚠️  No detailed results available"
fi
echo ""

# Dashboard Information
echo "📊 Generated Artifacts:"
if [ -n "$DASHBOARD_DIR" ] && [ -f "$DASHBOARD_DIR/index.html" ]; then
    echo "   📈 Interactive Dashboard: $DASHBOARD_DIR/index.html"
fi
echo "   📁 Results Directory: $RESULTS_DIR/"
if [ -n "$LATEST_RESULTS" ]; then
    echo "   📄 Results File: $LATEST_RESULTS"
fi
echo ""

# Quick Actions for Next Steps
echo "⚡ Quick Actions:"
echo ""
echo "🔄 Re-run Tests:"
echo "   /run-golden-tests                    # All tests"
if [ -n "$TEST_PATTERN" ]; then
    echo "   /run-golden-tests $TEST_PATTERN      # Same pattern"
fi
echo ""
echo "🔍 View Results:"
if [ -n "$DASHBOARD_DIR" ] && [ -f "$DASHBOARD_DIR/index.html" ]; then
    echo "   open $DASHBOARD_DIR/index.html      # Open dashboard"
fi
if [ -n "$LATEST_RESULTS" ]; then
    echo "   cat $LATEST_RESULTS | jq .          # View JSON results"
fi
echo ""
echo "🔧 Debug Issues:"
if [ -n "$VALIDATOR_PATH" ]; then
    echo "   python $VALIDATOR_PATH --project . --verbose  # Check schema"
fi
echo "   # Check individual test runners with --verbose --debug flags"
echo ""

echo "================================================"
echo "✅ Golden tests execution complete!"
echo ""
echo "Next steps:"
echo "1. Review results in dashboard or JSON files"
echo "2. Fix any failing tests by updating implementations"
echo "3. Re-run tests to validate fixes"
echo "4. Check GOLDEN_TESTS.md for methodology details"
echo "================================================"
</parameter>
<parameter name="description">Provide comprehensive summary</parameter>
</invoke>

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "1", "content": "Check directory structure and detect project language", "status": "completed", "priority": "high"}, {"id": "2", "content": "Run critical schema validation", "status": "completed", "priority": "high"}, {"id": "3", "content": "Discover and validate test specifications", "status": "completed", "priority": "medium"}, {"id": "4", "content": "Execute tests based on project language", "status": "completed", "priority": "high"}, {"id": "5", "content": "Generate results dashboard", "status": "completed", "priority": "medium"}, {"id": "6", "content": "Provide comprehensive summary", "status": "completed", "priority": "low"}]</parameter>
</invoke>