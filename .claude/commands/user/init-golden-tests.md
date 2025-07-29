---
name: init-golden-tests
description: Initialize comprehensive golden test infrastructure for a source repository that will be ported to other languages
---

I'll help you set up the complete golden tests ecosystem for your source repository. This creates a turnkey system that port implementers can easily sync and use.

## Understanding Golden Tests

Golden tests ensure semantic equivalence across language implementations by:
- **Semantic focus**: WHAT code should do, not HOW
- **Numeric validation**: Matrix dimensions, values, statistical properties  
- **Language agnosticism**: Behavior descriptions, not implementation details
- **Multi-repository workflow**: Reference repo syncs to port repos

## Step 1: Create Golden Tests Infrastructure

```bash
# Create comprehensive directory structure
mkdir -p golden_tests/tools
mkdir -p golden_tests/specs/core
mkdir -p golden_tests/specs/edge_cases  
mkdir -p golden_tests/specs/integration
mkdir -p golden_tests/schema
mkdir -p golden_tests/validators

echo "✓ Created golden tests directory structure"
```

## Step 2: Install Complete Documentation and Tools

```bash
# Copy comprehensive documentation from canonical source
if [ -f ~/code/translation/golden/GOLDEN_TESTS.md ]; then
    cp ~/code/translation/golden/GOLDEN_TESTS.md golden_tests/
    echo "✓ Copied canonical documentation from ~/code/translation/golden/"
elif [ -f ~/code/fmrihrf/golden_tests/GOLDEN_TESTS.md ]; then
    cp ~/code/fmrihrf/golden_tests/GOLDEN_TESTS.md golden_tests/
    echo "✓ Copied documentation from fmrihrf reference"
else
    echo "⚠️  Creating minimal documentation - copy complete version from canonical source"
    cat > golden_tests/GOLDEN_TESTS.md << 'EOF'
# Golden Tests: Complete Setup and Usage Guide

⚠️  This is a minimal template. For complete documentation, copy from:
~/code/translation/golden/GOLDEN_TESTS.md (canonical source)

## Critical Requirements

**MANDATORY**: All XML files MUST use canonical namespace:
```xml
<golden_test xmlns="http://golden-tests.org/schema">
```

**NEVER use deprecated format:**
```xml
<golden_test xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
             xsi:noNamespaceSchemaLocation="...">
```

## Quick Setup
1. Copy all tools from reference repository tools/ directory
2. Use validate_golden_tests.py for schema validation
3. Use golden_test_runner.py/R for test execution
4. Generate dashboards with enhanced_dashboard_generator.py

For complete instructions, get the full GOLDEN_TESTS.md file from canonical source.
EOF
fi

echo "✓ Documentation installed"
```

## Step 3: Install Complete Tool Suite

```bash
# Install all golden test tools with schema validation
TOOLS_SOURCE=""

# Try to find tools from known locations (prioritize fmrihrf reference)
if [ -d ~/code/fmrihrf/golden_tests/tools ]; then
    TOOLS_SOURCE=~/code/fmrihrf/golden_tests/tools
elif [ -d ~/code/translation/golden/tools ]; then
    TOOLS_SOURCE=~/code/translation/golden/tools
elif [ -d ~/code/neuroim2/golden_tests/tools ]; then
    TOOLS_SOURCE=~/code/neuroim2/golden_tests/tools
fi

if [ -n "$TOOLS_SOURCE" ] && [ -d "$TOOLS_SOURCE" ]; then
    echo "Copying tools from $TOOLS_SOURCE"
    cp "$TOOLS_SOURCE"/*.py golden_tests/tools/ 2>/dev/null
    cp "$TOOLS_SOURCE"/*.R golden_tests/tools/ 2>/dev/null  
    cp "$TOOLS_SOURCE"/*.yaml golden_tests/tools/ 2>/dev/null
    chmod +x golden_tests/tools/*.py golden_tests/tools/*.R
    echo "✓ Installed complete tool suite"
    
    # Verify essential tools are present
    if [ -f golden_tests/tools/validate_golden_tests.py ]; then
        echo "✓ Schema validation tool installed"
    else
        echo "⚠️  Schema validation tool missing - critical for preventing schema fragmentation"
    fi
else
    echo "⚠️  Tools source not found. Creating essential tool templates..."
    
    # Create schema validator (essential for prevention)
    cat > golden_tests/tools/validate_golden_tests.py << 'EOF'
#!/usr/bin/env python3
"""
Golden Tests Schema Validator - Essential Template
CRITICAL: Copy the complete version from reference repository at:
~/code/fmrihrf/golden_tests/tools/validate_golden_tests.py

This tool is ESSENTIAL for preventing schema fragmentation.
"""
import sys
print("❌ CRITICAL: Schema validator template only")
print("Copy complete validator from ~/code/fmrihrf/golden_tests/tools/validate_golden_tests.py")
print("Schema validation is MANDATORY to prevent test discovery issues")
sys.exit(1)
EOF

    # Create test runner template
    cat > golden_tests/tools/golden_test_runner.py << 'EOF'
#!/usr/bin/env python3
"""
Golden Test Runner - Template
Copy the complete version from reference repository at:
~/code/fmrihrf/golden_tests/tools/improved_test_runner.py
"""
print("Template - please copy complete tools from reference repository")
EOF

    chmod +x golden_tests/tools/*.py
    echo "⚠️  Created essential templates - MUST copy complete tools from reference repo"
fi
```

## Step 4: Install Schema Prevention Measures

```bash
# Install pre-commit hooks for schema validation
cat > golden_tests/.pre-commit-config.yaml << 'EOF'
repos:
  - repo: local
    hooks:
      - id: validate-golden-tests-schema
        name: Validate Golden Tests Schema
        entry: python tools/validate_golden_tests.py --project .
        language: system
        files: '^golden_tests/specs/.*\.xml$'
        pass_filenames: false
        always_run: false
        
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: check-xml
        files: '^golden_tests/specs/.*\.xml$'
      - id: trailing-whitespace
      - id: end-of-file-fixer
EOF

# Install CI/CD validation
mkdir -p golden_tests/.github/workflows
cat > golden_tests/.github/workflows/validate-schema.yml << 'EOF'
name: Validate Golden Tests Schema

on:
  push:
    paths:
      - 'golden_tests/specs/**/*.xml'
  pull_request:
    paths:
      - 'golden_tests/specs/**/*.xml'

jobs:
  validate-schema:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.9'
    
    - name: Validate XML Schema Compliance
      run: |
        cd golden_tests
        python tools/validate_golden_tests.py --project .
        
    - name: Fail on Schema Violations
      run: |
        cd golden_tests
        python tools/validate_golden_tests.py --project . || exit 1
EOF

# Create Makefile for standardized commands
cat > golden_tests/Makefile << 'EOF'
.PHONY: validate test-all new-test clean help

help:
	@echo "Golden Tests Commands:"
	@echo "  validate      - Validate all XML files against canonical schema"
	@echo "  test-all      - Run all tests with validation"
	@echo "  new-test      - Create new test template (requires ID and DESC)"
	@echo "  clean         - Clean generated files"

validate:
	python tools/validate_golden_tests.py --project .

test-all: validate
	# Add language-specific test commands here

new-test:
	@if [ -z "$(ID)" ] || [ -z "$(DESC)" ]; then \
		echo "❌ Error: ID and DESC are required"; \
		echo "Usage: make new-test ID=my_test DESC=\"Test description\""; \
		exit 1; \
	fi
	python scripts/new_test_template.py --id $(ID) --description "$(DESC)"

clean:
	rm -f golden_test_results_*.json
	rm -rf dashboard_html/
EOF

echo "✓ Schema prevention measures installed"
echo "  - Pre-commit hooks for validation"
echo "  - CI/CD integration for GitHub"
echo "  - Makefile for standardized commands"
```

## Step 5: Detect Project Language and Structure

```bash
# Detect project characteristics
echo "Analyzing project for golden test setup..."

# Detect language
if [ -f pyproject.toml ] || [ -f setup.py ] || find . -name "*.py" -type f | head -1 | grep -q .; then
    PROJECT_LANG="Python"
    echo "✓ Detected Python project"
elif [ -f Cargo.toml ] || find . -name "*.rs" -type f | head -1 | grep -q .; then
    PROJECT_LANG="Rust"
    echo "✓ Detected Rust project"
elif [ -f DESCRIPTION ] || find . -name "*.R" -type f | head -1 | grep -q .; then
    PROJECT_LANG="R"
    echo "✓ Detected R project"
elif [ -f Project.toml ] || find . -name "*.jl" -type f | head -1 | grep -q .; then
    PROJECT_LANG="Julia"
    echo "✓ Detected Julia project"
elif [ -f package.json ] || find . -name "*.js" -type f | head -1 | grep -q .; then
    PROJECT_LANG="JavaScript"
    echo "✓ Detected JavaScript project"
else
    PROJECT_LANG="Unknown"
    echo "⚠️  Could not detect project language"
fi

# Analyze for test candidates
echo ""
echo "Analyzing project for golden test candidates..."
case $PROJECT_LANG in
    "Python")
        echo "Python modules (excluding tests):"
        find . -name "*.py" -type f | grep -v __pycache__ | grep -v test | grep -v setup | head -10
        echo ""
        echo "Key functions and classes:"
        grep -r "^def \|^class " --include="*.py" . | grep -v test | grep -v __init__ | head -10
        ;;
    "R")
        echo "R source files:"
        find . -name "*.R" -type f | grep -v test | head -10
        echo ""
        echo "Exported functions:"
        grep -r "^[a-zA-Z_][a-zA-Z0-9_]*.*<-.*function\|^#' @export" --include="*.R" . | head -10
        ;;
    "Rust")
        echo "Rust source files:"
        find . -name "*.rs" -type f | grep -v test | head -10
        echo ""
        echo "Public functions:"
        grep -r "^pub fn " --include="*.rs" . | head -10
        ;;
    *)
        echo "Source files in project:"
        find . -type f \( -name "*.py" -o -name "*.rs" -o -name "*.R" -o -name "*.jl" -o -name "*.js" \) | grep -v test | head -15
        ;;
esac
```

## Step 6: Create XML Schema

```bash
# Create standard golden test XML schema
cat > golden_tests/schema/golden_test.xsd << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" 
           targetNamespace="http://golden-tests.org/schema"
           xmlns="http://golden-tests.org/schema"
           elementFormDefault="qualified">
           
  <xs:element name="golden_test">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="metadata" type="MetadataType"/>
        <xs:element name="semantic_description" type="SemanticDescriptionType"/>
        <xs:element name="inputs" type="InputsType" minOccurs="0"/>
        <xs:element name="expected_outputs" type="ExpectedOutputsType"/>
        <xs:element name="implementations" type="ImplementationsType"/>
        <xs:element name="propagation_status" type="PropagationStatusType"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  
  <xs:complexType name="MetadataType">
    <xs:sequence>
      <xs:element name="id" type="xs:string"/>
      <xs:element name="version" type="xs:string"/>
      <xs:element name="description" type="xs:string"/>
      <xs:element name="tags" type="TagsType"/>
    </xs:sequence>
  </xs:complexType>
  
  <xs:complexType name="TagsType">
    <xs:sequence>
      <xs:element name="tag" type="xs:string" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>
  
  <xs:complexType name="SemanticDescriptionType">
    <xs:sequence>
      <xs:element name="purpose" type="xs:string"/>
      <xs:element name="algorithm" type="xs:string"/>
      <xs:element name="mathematical_properties" type="xs:string" minOccurs="0"/>
      <xs:element name="edge_cases" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
  
  <xs:complexType name="InputsType">
    <xs:sequence>
      <xs:element name="input" maxOccurs="unbounded">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="description" type="xs:string"/>
            <xs:element name="value" type="xs:string"/>
          </xs:sequence>
          <xs:attribute name="name" type="xs:string" use="required"/>
          <xs:attribute name="type" type="xs:string" use="required"/>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
  
  <xs:complexType name="ExpectedOutputsType">
    <xs:sequence>
      <xs:element name="numeric_checks">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="check" maxOccurs="unbounded">
              <xs:complexType>
                <xs:sequence>
                  <xs:element name="type" type="xs:string"/>
                  <xs:element name="location" type="xs:string"/>
                  <xs:element name="expected" type="xs:string" minOccurs="0"/>
                  <xs:element name="tolerance" type="xs:string" minOccurs="0"/>
                  <xs:element name="min" type="xs:string" minOccurs="0"/>
                  <xs:element name="max" type="xs:string" minOccurs="0"/>
                  <xs:element name="property" type="xs:string" minOccurs="0"/>
                </xs:sequence>
              </xs:complexType>
            </xs:element>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
  
  <xs:complexType name="ImplementationsType">
    <xs:sequence>
      <xs:element name="R" type="xs:string" minOccurs="0"/>
      <xs:element name="Python" type="xs:string" minOccurs="0"/>
      <xs:element name="Rust" type="xs:string" minOccurs="0"/>
      <xs:element name="Julia" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
  
  <xs:complexType name="PropagationStatusType">
    <xs:sequence>
      <xs:element name="implementation" maxOccurs="unbounded">
        <xs:complexType>
          <xs:attribute name="lang" type="xs:string" use="required"/>
          <xs:attribute name="status" type="xs:string" use="required"/>
          <xs:attribute name="date" type="xs:string"/>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
  
</xs:schema>
EOF

echo "✓ Created XML schema"
```

## Step 7: Create Template Generator and Starter Test

```bash
# Create template generator script
mkdir -p golden_tests/scripts
cat > golden_tests/scripts/new_test_template.py << 'EOF'
#!/usr/bin/env python3
"""
Golden Test Template Generator - Creates tests with canonical schema format
Prevents manual creation of invalid XML files.
"""

import argparse
from pathlib import Path
from datetime import datetime

def create_golden_test_template(test_id: str, description: str, output_dir: str = "specs/core"):
    template = f'''<?xml version="1.0" encoding="UTF-8"?>
<golden_test xmlns="http://golden-tests.org/schema">
  <metadata>
    <id>{test_id}</id>
    <version>1.0</version>
    <description>{description}</description>
    <tags>
      <tag>core</tag>
      <tag>TODO-add-tags</tag>
    </tags>
  </metadata>
  
  <semantic_description>
    <purpose>TODO: Describe functionality being tested</purpose>
    <algorithm>
      TODO: Step-by-step mathematical description
    </algorithm>
  </semantic_description>
  
  <inputs>
    <input name="test_input" type="numeric_vector">
      <description>TODO: Input description</description>
      <value>c(1, 2, 3, 4, 5)</value>
    </input>
  </inputs>
  
  <expected_outputs>
    <numeric_checks>
      <check>
        <type>approximate</type>
        <location>TODO: R expression</location>
        <expected>TODO: expected_value</expected>
        <tolerance>1e-10</tolerance>
      </check>
    </numeric_checks>
  </expected_outputs>
  
  <implementations>
    <R><![CDATA[
      # TODO: R implementation
    ]]></R>
    <Python><![CDATA[
      # TODO: Python implementation
    ]]></Python>
  </implementations>
  
  <propagation_status>
    <implementation lang="R" status="pending"/>
    <implementation lang="Python" status="pending"/>
  </propagation_status>
</golden_test>'''
    
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    file_path = output_path / f"{test_id}.xml"
    if file_path.exists():
        raise FileExistsError(f"Test file already exists: {file_path}")
    
    with open(file_path, 'w') as f:
        f.write(template)
    
    print(f"Created: {file_path}")
    print("Next steps:")
    print("1. Edit file to replace TODO items")
    print("2. Run: make validate")
    print("3. Test with your implementation")
    
    return file_path

def main():
    parser = argparse.ArgumentParser(description='Create golden test template')
    parser.add_argument('--id', required=True, help='Test ID')
    parser.add_argument('--description', required=True, help='Test description')
    parser.add_argument('--output-dir', default='specs/core', help='Output directory')
    
    args = parser.parse_args()
    create_golden_test_template(args.id, args.description, args.output_dir)

if __name__ == '__main__':
    main()
EOF

chmod +x golden_tests/scripts/new_test_template.py

# Create starter template using canonical schema
cat > golden_tests/specs/core/starter_template.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<golden_test xmlns="http://golden-tests.org/schema">
  <metadata>
    <id>starter_function_test</id>
    <version>1.0</version>
    <description>Template for your first golden test - replace with actual function</description>
    <tags>
      <tag>core</tag>
      <tag>template</tag>
      <tag>starter</tag>
    </tags>
  </metadata>
  
  <semantic_description>
    <purpose>Test core functionality of [YOUR_FUNCTION_NAME] - replace with actual purpose</purpose>
    <algorithm>
      Replace with step-by-step algorithm description:
      1. Input validation and preprocessing
      2. Core computational steps
      3. Output formatting and validation
      4. Expected mathematical properties
    </algorithm>
    <mathematical_properties>
      Document key mathematical properties:
      - Input/output dimensions and types
      - Invariants and constraints  
      - Expected value ranges
      - Special cases and edge conditions
    </mathematical_properties>
    <edge_cases>
      Document edge cases and boundary conditions:
      - Empty inputs
      - Boundary values
      - Error conditions
      - Special mathematical cases
    </edge_cases>
  </semantic_description>
  
  <inputs>
    <input name="basic_input" type="numeric_vector">
      <description>Basic test input - replace with actual input description</description>
      <value>[1, 2, 3, 4, 5]</value>
    </input>
    <input name="edge_case_input" type="numeric_vector">
      <description>Edge case input - add more inputs as needed</description>
      <value>[]</value>
    </input>
  </inputs>
  
  <expected_outputs>
    <numeric_checks>
      <!-- Dimensional checks -->
      <check>
        <type>exact_value</type>
        <location>length(output)</location>
        <expected>5</expected>
        <tolerance>0</tolerance>
      </check>
      
      <!-- Value checks -->
      <check>
        <type>approximate</type>
        <location>sum(output)</location>
        <expected>15</expected>
        <tolerance>1e-10</tolerance>
      </check>
      
      <!-- Statistical checks -->
      <check>
        <type>statistical</type>
        <property>mean</property>
        <location>output</location>
        <expected>3.0</expected>
        <tolerance>1e-10</tolerance>
      </check>
      
      <!-- Range checks -->
      <check>
        <type>range</type>
        <location>max(output)</location>
        <min>4.9</min>
        <max>5.1</max>
      </check>
      
      <!-- Add more checks as needed -->
    </numeric_checks>
  </expected_outputs>
  
  <implementations>
    <R><![CDATA[
      # R reference implementation
      # Replace with actual R code that implements the function
      # Focus on clear, readable implementation that demonstrates semantic behavior
      
      # Example template:
      your_function <- function(input_data) {
        # Input validation
        if (length(input_data) == 0) return(numeric(0))
        
        # Core implementation
        result <- input_data  # Replace with actual logic
        
        return(result)
      }
      
      # Test execution
      basic_input <- c(1, 2, 3, 4, 5)
      output <- your_function(basic_input)
    ]]></R>
    
    <Python><![CDATA[
      # Python implementation - will be added by port implementers
      # Following semantic specification above
      # Should produce numerically equivalent results to R implementation
      
      import numpy as np
      
      def your_function(input_data):
        """
        Python implementation of the function.
        
        Args:
            input_data: Input following semantic specification
            
        Returns:
            Result following semantic specification
        """
        # Input validation
        if len(input_data) == 0:
            return np.array([])
        
        # Core implementation following semantic spec
        result = np.array(input_data)  # Replace with actual logic
        
        return result
      
      # Test execution
      basic_input = [1, 2, 3, 4, 5]
      output = your_function(basic_input)
    ]]></Python>
    
    <Rust><![CDATA[
      // Rust implementation - will be added by port implementers
      // Following semantic specification above
      
      pub fn your_function(input_data: &[f64]) -> Vec<f64> {
          // Input validation
          if input_data.is_empty() {
              return Vec::new();
          }
          
          // Core implementation following semantic spec
          let result = input_data.to_vec();  // Replace with actual logic
          
          result
      }
      
      // Test execution
      let basic_input = vec![1.0, 2.0, 3.0, 4.0, 5.0];
      let output = your_function(&basic_input);
    ]]></Rust>
  </implementations>
  
  <propagation_status>
    <implementation lang="R" status="pending" date=""/>
    <implementation lang="Python" status="pending" date=""/>
    <implementation lang="Rust" status="pending" date=""/>
  </propagation_status>
</golden_test>
EOF

echo "✓ Created comprehensive starter template"
```

## Step 8: Create Language-Specific Validator

```bash
# Create validator for the source language
mkdir -p "golden_tests/validators/$PROJECT_LANG"

case $PROJECT_LANG in
    "Python")
        cat > "golden_tests/validators/$PROJECT_LANG/validate_golden_tests.py" << 'EOF'
#!/usr/bin/env python3
"""
Golden test validator for Python implementations.
Based on the comprehensive golden tests methodology.

This is a starter template. For a complete validator, copy from:
~/code/fmrihrf/golden_tests/validators/R/validate_golden_tests.R
and adapt for Python.
"""

import xml.etree.ElementTree as ET
import numpy as np
from typing import Dict, Any, List, Union
import sys
import os

class GoldenTestValidator:
    def __init__(self, tolerance_override=None):
        self.tolerance_override = tolerance_override
        self.namespace = {'gt': 'http://golden-tests.org/schema'}
        
    def validate_golden_test(self, xml_path: str, implementation_result: Any, 
                           tolerance_override: float = None) -> bool:
        """
        Validate a golden test against an implementation result.
        
        Args:
            xml_path: Path to the golden test XML file
            implementation_result: Result from the implementation to validate
            tolerance_override: Override for all tolerance values (optional)
            
        Returns:
            bool: Whether all checks passed
        """
        test_data = self.parse_golden_test(xml_path)
        
        # Run all numeric checks
        checks = test_data.get('expected_outputs', {}).get('numeric_checks', [])
        all_passed = True
        
        for check in checks:
            result = self.perform_numeric_check(implementation_result, check, tolerance_override)
            if not result:
                print(f"FAILED: {check.get('type')} check at {check.get('location')}")
                print(f"  Expected: {check.get('expected')} Tolerance: {check.get('tolerance')}")
                all_passed = False
            else:
                print(f"PASSED: {check.get('type')} check at {check.get('location')}")
        
        if all_passed:
            print("All golden test checks PASSED")
        else:
            print("Some golden test checks FAILED")
        
        return all_passed
        
    def parse_golden_test(self, xml_path: str) -> Dict[str, Any]:
        """Parse a golden test XML file."""
        tree = ET.parse(xml_path)
        root = tree.getroot()
        
        # Basic parsing - extend as needed
        test_data = {
            'metadata': self._extract_text_elements(root, ['id', 'version', 'description']),
            'expected_outputs': self._extract_expected_outputs(root)
        }
        
        return test_data
    
    def perform_numeric_check(self, data: Any, check: Dict[str, Any], 
                            tolerance_override: float = None) -> bool:
        """Perform a single numeric check."""
        # TODO: Implement complete numeric checking logic
        # This is a basic template - see GOLDEN_TESTS.md for full implementation guidance
        
        check_type = check.get('type')
        expected = check.get('expected')
        tolerance = tolerance_override or float(check.get('tolerance', 1e-10))
        
        # Basic example - extend for your specific data structures
        if check_type == 'exact_value':
            if check.get('location') == 'length(output)':
                return len(data) == int(expected)
        elif check_type == 'approximate':
            if check.get('location') == 'sum(output)':
                return abs(sum(data) - float(expected)) < tolerance
                
        # TODO: Implement range checks, statistical checks, etc.
        return False
    
    def _extract_text_elements(self, root, elements):
        """Extract text content from specified elements."""
        result = {}
        for elem in elements:
            node = root.find(f'.//gt:{elem}', self.namespace)
            if node is not None:
                result[elem] = node.text
        return result
    
    def _extract_expected_outputs(self, root):
        """Extract expected outputs from XML."""
        checks = []
        check_nodes = root.findall('.//gt:check', self.namespace)
        
        for check_node in check_nodes:
            check = {}
            for field in ['type', 'location', 'expected', 'tolerance', 'min', 'max', 'property']:
                elem = check_node.find(f'gt:{field}', self.namespace)
                if elem is not None:
                    check[field] = elem.text
            checks.append(check)
            
        return {'numeric_checks': checks}

# Helper function for null coalescing  
def null_coalesce(x, y):
    return y if x is None else x

if __name__ == "__main__":
    print("Golden test validator template for Python")
    print("Implement your specific validation logic following GOLDEN_TESTS.md")
    print("Example usage:")
    print("  validator = GoldenTestValidator()")
    print("  result = your_implementation()")
    print("  success = validator.validate_golden_test('test.xml', result)")
EOF
        chmod +x "golden_tests/validators/$PROJECT_LANG/validate_golden_tests.py"
        echo "✓ Created Python validator template"
        ;;
        
    "R")
        cat > "golden_tests/validators/$PROJECT_LANG/validate_golden_tests.R" << 'EOF'
# Golden test validator for R implementations
# Based on the comprehensive golden tests methodology
#
# This is a starter template. For a complete validator, copy from:
# ~/code/fmrihrf/golden_tests/validators/R/validate_golden_tests.R

library(xml2)

#' Validate a golden test against an R implementation
#'
#' @param xml_path Path to the golden test XML file
#' @param implementation_result Result from the R implementation to validate
#' @param tolerance_override Override for all tolerance values (optional)
#' @return Logical indicating whether all checks passed
validate_golden_test <- function(xml_path, implementation_result, tolerance_override = NULL) {
  # Parse the XML file
  test_data <- parse_golden_test(xml_path)
  
  # Run all numeric checks
  checks <- test_data$expected_outputs$numeric_checks
  all_passed <- TRUE
  
  for (check in checks) {
    result <- perform_numeric_check(implementation_result, check, tolerance_override)
    if (!result) {
      cat("FAILED:", check$type, "check at", check$location, "\n")
      cat("  Expected:", check$expected, "Tolerance:", check$tolerance, "\n")
      all_passed <- FALSE
    } else {
      cat("PASSED:", check$type, "check at", check$location, "\n")
    }
  }
  
  if (all_passed) {
    cat("All golden test checks PASSED\n")
  } else {
    cat("Some golden test checks FAILED\n")
  }
  
  return(all_passed)
}

#' Parse a golden test XML file
#'
#' @param xml_path Path to the XML file
#' @return List containing parsed test data
parse_golden_test <- function(xml_path) {
  doc <- xml2::read_xml(xml_path)
  
  # Extract basic metadata
  metadata <- list(
    id = xml2::xml_text(xml2::xml_find_first(doc, ".//id")),
    version = xml2::xml_text(xml2::xml_find_first(doc, ".//version")),
    description = xml2::xml_text(xml2::xml_find_first(doc, ".//description"))
  )
  
  # Extract expected outputs and checks
  check_nodes <- xml2::xml_find_all(doc, ".//numeric_checks/check")
  checks <- lapply(check_nodes, function(node) {
    check <- list(
      type = xml2::xml_text(xml2::xml_find_first(node, "type")),
      location = xml2::xml_text(xml2::xml_find_first(node, "location"))
    )
    
    # Optional fields
    optional_fields <- c("expected", "tolerance", "min", "max", "property")
    for (field in optional_fields) {
      field_node <- xml2::xml_find_first(node, field)
      if (!is.na(field_node)) {
        if (field %in% c("expected", "tolerance", "min", "max")) {
          check[[field]] <- as.numeric(xml2::xml_text(field_node))
        } else {
          check[[field]] <- xml2::xml_text(field_node)
        }
      }
    }
    
    return(check)
  })
  
  return(list(
    metadata = metadata,
    expected_outputs = list(numeric_checks = checks)
  ))
}

#' Perform a single numeric check
#'
#' @param data The implementation result data
#' @param check The check specification
#' @param tolerance_override Override tolerance value
#' @return Logical indicating whether the check passed
perform_numeric_check <- function(data, check, tolerance_override = NULL) {
  # TODO: Implement complete checking logic
  # This is a basic template - see GOLDEN_TESTS.md for full implementation
  
  # Use override tolerance if provided
  tolerance <- if (!is.null(tolerance_override)) {
    tolerance_override
  } else {
    check$tolerance %||% 1e-10
  }
  
  # Basic examples - extend for your specific data structures
  if (check$type == "exact_value" && check$location == "length(output)") {
    return(length(data) == check$expected)
  } else if (check$type == "approximate" && check$location == "sum(output)") {
    return(abs(sum(data) - check$expected) < tolerance)
  }
  
  # TODO: Implement range checks, statistical checks, etc.
  warning(paste("Check type not implemented:", check$type))
  return(FALSE)
}

# Helper function for null coalescing
`%||%` <- function(x, y) if (is.null(x)) y else x

# Example usage:
# result <- your_function(test_input)
# validate_golden_test("specs/core/starter_template.xml", result)
EOF
        echo "✓ Created R validator template"
        ;;
        
    *)
        echo "⚠️  No validator template for $PROJECT_LANG - create manually"
        echo "  See GOLDEN_TESTS.md for guidance on validator implementation"
        ;;
esac
```

## Step 9: Create Supporting Documentation

```bash
# Create README for golden tests
cat > golden_tests/README.md << 'EOF'
# Golden Tests for Cross-Language Semantic Equivalence

This directory contains the complete golden tests ecosystem for validating semantic equivalence across language implementations.

## Quick Start

1. **Read the complete guide**: `GOLDEN_TESTS.md`
2. **Replace the template**: Edit `specs/core/starter_template.xml` with your actual function
3. **Test your implementation**: Use the validator in `validators/` directory
4. **Port to other languages**: Share this repository structure with port implementers

## Tool Suite

- `tools/golden_test_runner.py` - Python test execution
- `tools/golden_test_runner.R` - R test execution  
- `tools/enhanced_sync_workflow.py` - Complete sync workflow
- `tools/enhanced_dashboard_generator.py` - Results visualization
- `tools/comparison_dashboard_generator.py` - Multi-language comparison

## Port Repository Setup

Port implementers should:

1. Copy all tools from `tools/` directory to their repository
2. Use `enhanced_sync_workflow.py` for turnkey sync and validation
3. Follow language-specific patterns while maintaining semantic equivalence

## Directory Structure

```
golden_tests/
├── GOLDEN_TESTS.md              # Complete documentation and setup guide
├── README.md                    # This file
├── tools/                       # Complete tool suite for port repos
│   ├── golden_test_runner.py    # Python test execution
│   ├── golden_test_runner.R     # R test execution
│   ├── enhanced_sync_workflow.py # Complete workflow
│   ├── enhanced_dashboard_generator.py # Dashboards
│   └── comparison_dashboard_generator.py # Comparisons
├── specs/                       # Test specifications
│   ├── core/                    # Core functionality tests
│   ├── edge_cases/             # Boundary condition tests
│   └── integration/            # Multi-component tests
├── schema/                      # XML schema definitions
└── validators/                  # Language-specific validators
```

## Cross-Language Considerations

- **Semantic equivalence**: Focus on mathematical behavior, not implementation details
- **Numerical precision**: Use appropriate tolerances for floating-point comparisons
- **Language idioms**: Use natural patterns for each language while maintaining equivalence
- **Memory layout**: Handle differences in array storage and indexing

For complete methodology and best practices, see `GOLDEN_TESTS.md`.
EOF

echo "✓ Created comprehensive README"
```

## Step 10: Verification and Next Steps

```bash
echo ""
echo "============================================"
echo "Golden Tests Initialization Complete!"
echo "============================================"
echo ""
echo "✓ Directory structure created"
echo "✓ Complete tool suite installed"
echo "✓ Documentation and templates ready"
echo "✓ XML schema and validator created"
echo "✓ Schema prevention measures installed"
echo "✓ Project language: $PROJECT_LANG"
echo ""

# Verify installation
echo "Verifying installation..."
echo ""

# Check essential tools
if [ -f golden_tests/tools/validate_golden_tests.py ]; then
    echo "✓ Schema validation tool installed (CRITICAL)"
else
    echo "❌ Schema validation tool MISSING - CRITICAL for preventing schema fragmentation"
fi

if [ -f golden_tests/tools/golden_test_runner.py ]; then
    echo "✓ Python test runner installed"
else
    echo "⚠️  Python test runner needs manual installation"
fi

if [ -f golden_tests/scripts/new_test_template.py ]; then
    echo "✓ Template generator installed"
else
    echo "⚠️  Template generator missing"
fi

# Check prevention measures
if [ -f golden_tests/.pre-commit-config.yaml ]; then
    echo "✓ Pre-commit hooks configured"
else
    echo "⚠️  Pre-commit hooks missing"
fi

if [ -f golden_tests/Makefile ]; then
    echo "✓ Makefile with standardized commands"
else
    echo "⚠️  Makefile missing"
fi

# Check documentation
if [ -s golden_tests/GOLDEN_TESTS.md ]; then
    echo "✓ Complete documentation installed"
else
    echo "⚠️  Documentation needs manual installation"
fi

# Test schema validation if available
if [ -f golden_tests/tools/validate_golden_tests.py ] && [ -f golden_tests/specs/core/starter_template.xml ]; then
    echo ""
    echo "Testing schema validation..."
    cd golden_tests
    python tools/validate_golden_tests.py --project . && echo "✓ Schema validation working" || echo "⚠️  Schema validation failed"
    cd ..
fi

echo ""
echo "Next Steps:"
echo "==========="
echo ""
echo "1. 📖 READ THE COMPLETE GUIDE:"
echo "   open golden_tests/GOLDEN_TESTS.md"
echo ""
echo "2. 🔧 COMPLETE TOOL INSTALLATION (if needed):"
echo "   # Copy complete tools from reference repository"
echo "   cp ~/code/fmrihrf/golden_tests/tools/* golden_tests/tools/"
echo "   cp ~/code/translation/golden/GOLDEN_TESTS.md golden_tests/"
echo ""
echo "3. 📝 CREATE YOUR FIRST TEST:"
echo "   # Use template generator (prevents schema violations)"
echo "   cd golden_tests && make new-test ID=my_test DESC=\"Test description\""
echo ""
echo "4. 🔍 VALIDATE SCHEMA COMPLIANCE:"
echo "   cd golden_tests && make validate"
echo ""
echo "5. 🧪 TEST YOUR IMPLEMENTATION:"
if [ "$PROJECT_LANG" = "Python" ]; then
    echo "   cd golden_tests && python tools/golden_test_runner.py --test my_test"
elif [ "$PROJECT_LANG" = "R" ]; then
    echo "   cd golden_tests && Rscript tools/golden_test_runner.R --test my_test"
else
    echo "   # Use validator in golden_tests/validators/$PROJECT_LANG/"
fi
echo ""
echo "6. 🛡️ ENABLE SCHEMA PREVENTION:"
echo "   # Install pre-commit hooks"
echo "   cd golden_tests && pre-commit install"
echo "   # Copy .github/workflows to your repo root for CI/CD"
echo ""
echo "7. 🚀 PREPARE FOR PORTING:"
echo "   # Share this complete golden_tests/ directory with port implementers"
echo "   # They can use: python tools/enhanced_sync_workflow.py for turnkey setup"
echo ""
echo "🎯 SUCCESS CRITERIA:"
echo "   - Schema validation passes: make validate"
echo "   - Your reference implementation passes all golden tests"
echo "   - Pre-commit hooks prevent schema violations"
echo "   - Port implementers can sync and validate using your specifications"
echo ""
echo "🚨 CRITICAL REMINDERS:"
echo "   - ALWAYS use canonical namespace: xmlns=\"http://golden-tests.org/schema\""
echo "   - NEVER use xsi:noNamespaceSchemaLocation"
echo "   - ALWAYS run 'make validate' before committing XML files"
echo "   - Use template generator to prevent schema violations"
echo ""
echo "For complete instructions and methodology, see golden_tests/GOLDEN_TESTS.md"
```

This comprehensive setup creates a turnkey golden tests ecosystem that port implementers can easily sync and use. The system includes complete tools, documentation, and templates for cross-language semantic validation.