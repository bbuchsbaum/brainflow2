#!/bin/bash

# Fix remaining patterns in all Rust files

# Fix 1: Remove generic parameter from NeuroSpaceImpl
find core -name "*.rs" -type f -exec sed -i '' 's/NeuroSpaceImpl::<[0-9]>/NeuroSpaceImpl/g' {} +
find core -name "*.rs" -type f -exec sed -i '' 's/NeuroSpaceImpl<[0-9]>/NeuroSpaceImpl/g' {} +

# Fix 2: Add missing is_mask: false to LayerInfo
find core -name "*.rs" -type f -exec sed -i '' '/visible: true,$/{ 
    N
    s/visible: true,\n[[:space:]]*}/visible: true,\n            is_mask: false,\n        }/
}' {} +

# Fix 3: Fix .ok_or_else on Result types to .map_err
find core -name "*.rs" -type f -exec sed -i '' 's/\.ok_or_else(/\.map_err(/g' {} +

# Fix 4: Add NeuroSpaceExt import after NeuroSpaceImpl imports  
find core -name "*.rs" -type f -exec awk '
/use volmath::.*NeuroSpaceImpl/ && !found {
    print
    print "use volmath::NeuroSpaceExt;"
    found = 1
    next
}
{print}
' {} > {}.tmp && mv {}.tmp {} \;

echo "Fixes applied."