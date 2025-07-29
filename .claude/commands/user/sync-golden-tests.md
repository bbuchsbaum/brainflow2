---
name: sync-golden-tests
description: Sync and execute golden tests from source repository with complete validation workflow and schema prevention
---

I'll help you sync golden tests from a source repository and run the complete validation workflow with schema prevention measures. This command provides turnkey setup for any language port project.

**Usage**: `/sync-golden-tests [reference_repo_path]`

**Examples**: 
- `/sync-golden-tests ~/code/fmrihrf/golden_tests`
- `/sync-golden-tests` (will auto-detect or prompt for path)

I'll now sync golden tests from the source repository. Let me start by determining the source path and setting up the complete workflow.

## Step 1: Determine Source Repository Path

I'll check if a path was provided in the arguments ($ARGUMENTS) or auto-detect from common locations.

Let me determine the source repository path:

<function_calls>
<invoke name="Bash">
<parameter name="command">
# Check if arguments were provided
if [ -n "$ARGUMENTS" ]; then
    SOURCE_REPO="$ARGUMENTS"
    echo "Using provided path: $SOURCE_REPO"
else
    echo "No path provided - auto-detecting source repository..."
    # Try common locations
    if [ -d ~/code/fmrihrf/golden_tests ]; then
        SOURCE_REPO=~/code/fmrihrf/golden_tests
        echo "✓ Auto-detected: $SOURCE_REPO"
    elif [ -d ~/code/translation/golden ]; then
        SOURCE_REPO=~/code/translation/golden
        echo "✓ Auto-detected: $SOURCE_REPO"
    else
        echo "❌ Could not auto-detect source repository"
        echo "Please provide path as argument: /sync-golden-tests ~/code/fmrihrf/golden_tests"
        exit 1
    fi
fi

# Validate source repository exists
if [ ! -d "$SOURCE_REPO" ]; then
    echo "❌ Source repository not found: $SOURCE_REPO"
    exit 1
fi

echo "✅ Source repository validated: $SOURCE_REPO"
</parameter>
<parameter name="description">Determine and validate source repository path</parameter>
</invoke>

## Step 2: Check Project Structure and Language

<function_calls>
<invoke name="Bash">
<parameter name="command">
# Check if we're in the right directory
if [ -d "golden_tests" ]; then
    cd golden_tests
    echo "✓ Found golden_tests directory"
elif [ -f "specs" ] || [ -f "tools" ]; then
    echo "✓ Already in golden_tests directory"
else
    echo "⚠️  No golden_tests directory found"
    echo "Creating golden_tests directory..."
    mkdir -p golden_tests
    cd golden_tests
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
</parameter>
<parameter name="description">Check project directory structure and detect language</parameter>
</invoke>

## Step 3: Install Required Tools from Source Repository

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "Installing golden test tools from source repository..."

# Create tools directory if it doesn't exist
mkdir -p tools

# Essential tools to copy
ESSENTIAL_TOOLS=(
    "validate_golden_tests.py"
    "golden_test_runner.py"
    "golden_test_runner.R"
    "enhanced_dashboard_generator.py"
    "comparison_dashboard_generator.py"
    "enhanced_sync_workflow.py"
    "golden_tests_config.yaml"
)

# Copy tools from source repository
if [ -d "$SOURCE_REPO/tools" ]; then
    TOOLS_SOURCE="$SOURCE_REPO/tools"
    echo "Copying tools from: $TOOLS_SOURCE"
    
    for tool in "${ESSENTIAL_TOOLS[@]}"; do
        if [ -f "$TOOLS_SOURCE/$tool" ]; then
            cp "$TOOLS_SOURCE/$tool" tools/
            chmod +x "tools/$tool"
            echo "✓ Copied: $tool"
        else
            echo "⚠️  Missing: $tool"
        fi
    done
else
    echo "❌ Tools directory not found in source repository"
    exit 1
fi

# Copy documentation
if [ -f "$SOURCE_REPO/GOLDEN_TESTS.md" ]; then
    cp "$SOURCE_REPO/GOLDEN_TESTS.md" .
    echo "✓ Copied documentation"
fi

if [ -f "$SOURCE_REPO/SCHEMA_PREVENTION.md" ]; then
    cp "$SOURCE_REPO/SCHEMA_PREVENTION.md" .
    echo "✓ Copied schema prevention guide"
fi

echo "✅ Tools installation complete"
</parameter>
<parameter name="description">Install required tools from source repository</parameter>
</invoke>

## Step 4: Run Schema Validation on Source Repository

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "Running schema validation on source repository..."

if [ -f "tools/validate_golden_tests.py" ]; then
    echo "Validating source repository schemas..."
    python tools/validate_golden_tests.py --project "$SOURCE_REPO" --verbose
    
    if [ $? -eq 0 ]; then
        echo "✅ Source repository schema validation passed"
    else
        echo "❌ Source repository has schema violations"
        echo "Fix schema issues in source before syncing"
        exit 1
    fi
else
    echo "⚠️  Schema validator not found - skipping validation"
fi
</parameter>
<parameter name="description">Run schema validation on source repository</parameter>
</invoke>

## Step 5: Execute Enhanced Sync Workflow

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "Executing enhanced sync workflow..."

# Create directory structure
mkdir -p specs/core specs/edge_cases specs/integration
mkdir -p schema validators

# Copy test specifications
if [ -d "$SOURCE_REPO/specs" ]; then
    echo "Copying test specifications..."
    cp -r "$SOURCE_REPO/specs"/* specs/
    echo "✓ Test specifications copied"
fi

# Copy schema files
if [ -d "$SOURCE_REPO/schema" ]; then
    echo "Copying schema files..."
    cp -r "$SOURCE_REPO/schema"/* schema/
    echo "✓ Schema files copied"
fi

# Create configuration file
cat > .golden_sync.json << EOF
{
  "source_repo": "$SOURCE_REPO",
  "target_language": "$PROJECT_LANG",
  "description": "$PROJECT_LANG port using golden tests methodology",
  "created": "$(date -Iseconds)",
  "auto_execute": true,
  "auto_dashboard": true,
  "schema_validation": true
}
EOF

echo "✓ Configuration file created"

# Run enhanced sync workflow if available
if [ -f "tools/enhanced_sync_workflow.py" ]; then
    echo "Running enhanced sync workflow..."
    python tools/enhanced_sync_workflow.py \
        --source "$SOURCE_REPO" \
        --target . \
        --language "$PROJECT_LANG" \
        --verbose
    
    if [ $? -eq 0 ]; then
        echo "✅ Enhanced sync workflow completed successfully"
    else
        echo "❌ Enhanced sync workflow failed"
        exit 1
    fi
else
    echo "⚠️  Enhanced sync workflow not found - basic sync completed"
fi
</parameter>
<parameter name="description">Execute enhanced sync workflow</parameter>
</invoke>

## Step 6: Run Tests and Generate Dashboard

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo "Running tests and generating dashboard..."

# Count available tests
TOTAL_SPECS=$(find specs -name "*.xml" 2>/dev/null | wc -l | tr -d ' ')
echo "Found $TOTAL_SPECS test specifications"

# Run tests based on project language
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_FILE="golden_test_results_${PROJECT_LANG,,}_$TIMESTAMP.json"

case $PROJECT_LANG in
    "Python")
        if [ -f "tools/golden_test_runner.py" ]; then
            echo "Running Python tests..."
            python tools/golden_test_runner.py --output "$RESULTS_FILE" --verbose
            TEST_RESULT=$?
        else
            echo "⚠️  Python test runner not found"
            TEST_RESULT=1
        fi
        ;;
    "R")
        if [ -f "tools/golden_test_runner.R" ]; then
            echo "Running R tests..."
            Rscript tools/golden_test_runner.R --output "$RESULTS_FILE" --verbose
            TEST_RESULT=$?
        else
            echo "⚠️  R test runner not found"
            TEST_RESULT=1
        fi
        ;;
    *)
        echo "⚠️  No test runner available for $PROJECT_LANG"
        TEST_RESULT=1
        ;;
esac

# Generate dashboard if tests ran
if [ $TEST_RESULT -eq 0 ] && [ -f "$RESULTS_FILE" ]; then
    echo "✅ Tests completed successfully"
    
    # Generate dashboard
    if [ -f "tools/enhanced_dashboard_generator.py" ]; then
        DASHBOARD_DIR="dashboard_$TIMESTAMP"
        echo "Generating dashboard..."
        python tools/enhanced_dashboard_generator.py \
            --project . \
            --results "$RESULTS_FILE" \
            --output "$DASHBOARD_DIR"
        
        if [ -f "$DASHBOARD_DIR/index.html" ]; then
            echo "✅ Dashboard generated: $DASHBOARD_DIR/index.html"
        fi
    fi
else
    echo "❌ Tests failed or no results generated"
fi
</parameter>
<parameter name="description">Run tests and generate dashboard</parameter>
</invoke>

## Step 7: Provide Summary and Next Steps

<function_calls>
<invoke name="Bash">
<parameter name="command">
echo ""
echo "================================================"
echo "🎯 GOLDEN TESTS SYNC SUMMARY"
echo "================================================"
echo ""

echo "📁 Configuration:"
echo "   Source: $SOURCE_REPO"
echo "   Target Language: $PROJECT_LANG"
echo "   Sync Completed: $(date)"
echo ""

# Show test results if available
if [ -f "$RESULTS_FILE" ]; then
    echo "🧪 Test Results:"
    case $PROJECT_LANG in
        "Python")
            SUMMARY=$(python -c "
import json
with open('$RESULTS_FILE') as f: 
    data = json.load(f)
    s = data['summary']
    print(f'   🐍 Python: {s[\"passed_tests\"]}/{s[\"total_tests\"]} passed ({s[\"passed_tests\"]/s[\"total_tests\"]*100:.1f}%), {s[\"failed_tests\"]} failed, {s[\"error_tests\"]} errors')
" 2>/dev/null)
            echo "$SUMMARY"
            ;;
        "R")
            SUMMARY=$(Rscript -e "
library(jsonlite)
data <- fromJSON('$RESULTS_FILE')
s <- data\$summary
cat(sprintf('   📊 R: %d/%d passed (%.1f%%), %d failed, %d errors\n', 
    s\$passed_tests, s\$total_tests, s\$passed_tests/s\$total_tests*100, 
    s\$failed_tests, s\$error_tests))
" 2>/dev/null)
            echo "$SUMMARY"
            ;;
    esac
fi

echo ""
echo "📊 Generated Files:"
echo "   📋 Test Specifications: $TOTAL_SPECS files in specs/"
echo "   📄 Results: $RESULTS_FILE"
if [ -n "$DASHBOARD_DIR" ] && [ -f "$DASHBOARD_DIR/index.html" ]; then
    echo "   📈 Dashboard: $DASHBOARD_DIR/index.html"
fi
echo ""

echo "⚡ Quick Actions:"
echo "   View dashboard: open $DASHBOARD_DIR/index.html"
echo "   Re-run tests: python tools/golden_test_runner.py --verbose"
echo "   Validate schema: python tools/validate_golden_tests.py --project ."
echo "   Re-sync: /sync-golden-tests $SOURCE_REPO"
echo ""

echo "✅ Golden tests sync completed successfully!"
echo "Next steps:"
echo "1. Review test results and fix any failing tests"
echo "2. Implement missing functionality for your $PROJECT_LANG port"
echo "3. Use the dashboard to track progress"
echo "4. See GOLDEN_TESTS.md for detailed methodology"
</parameter>
<parameter name="description">Provide summary and next steps</parameter>
</invoke>