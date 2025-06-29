#!/bin/bash

# Check if input file exists
if [ ! -f "repomix-output.txt" ]; then
    echo "Error: repomix-output.txt not found in current directory"
    exit 1
fi

# Get total number of lines
total_lines=$(wc -l < repomix-output.txt)
lines_per_file=$((total_lines / 3))

# Calculate line numbers for splitting
end1=$lines_per_file
end2=$((lines_per_file * 2))

# Split the file into three parts
head -n $end1 repomix-output.txt > repomix-output-part1.txt
sed -n "$((end1 + 1)),$end2 p" repomix-output.txt > repomix-output-part2.txt
tail -n +$((end2 + 1)) repomix-output.txt > repomix-output-part3.txt

echo "Split complete:"
echo "  repomix-output-part1.txt: $(wc -l < repomix-output-part1.txt) lines"
echo "  repomix-output-part2.txt: $(wc -l < repomix-output-part2.txt) lines"
echo "  repomix-output-part3.txt: $(wc -l < repomix-output-part3.txt) lines"