#!/usr/bin/env python3
"""Inventory UI discipline signals in a frontend repository.

This script is intentionally dependency-free. It does not modify source files.
It writes a Markdown and JSON report under `.ui-discipline/`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Any

EXCLUDE_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", ".nuxt", ".svelte-kit",
    "coverage", ".turbo", ".cache", "out", "vendor", "target", ".venv", "venv",
}

TEXT_EXTS = {
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".css", ".scss", ".sass", ".less", ".html", ".vue", ".svelte", ".md", ".mdx",
}

CODE_EXTS = {
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".sass", ".less", ".vue", ".svelte",
}

HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
CSS_VAR_DEF_RE = re.compile(r"(--[A-Za-z0-9_-]+)\s*:")
CSS_VAR_USE_RE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
INLINE_STYLE_RE = re.compile(r"\bstyle\s*=\s*\{\s*\{")
ARBITRARY_TW_RE = re.compile(r"\b(?:m|mt|mr|mb|ml|mx|my|p|pt|pr|pb|pl|px|py|gap|w|h|min-w|min-h|max-w|max-h|rounded|text|bg|border|shadow|top|right|bottom|left|z)-\[[^\]]+\]")
CLASSNAME_RE = re.compile(r"\bclassName\s*=\s*(?:[\"']([^\"']+)[\"']|\{[\"']([^\"']+)[\"']\})")
COMPONENT_EXPORT_RE = re.compile(r"\b(?:export\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\b|export\s+\{([^}]+)\}")

TOKEN_FILE_HINTS = ("token", "theme", "tailwind.config", "style-dictionary", "design-system")

@dataclass
class Finding:
    path: str
    count: int
    examples: list[str]


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def iter_files(root: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        base = Path(dirpath)
        for filename in filenames:
            path = base / filename
            if path.suffix.lower() in TEXT_EXTS or filename in {"package.json", "tailwind.config.js", "tailwind.config.ts"}:
                yield path


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="latin-1")
        except Exception:
            return ""
    except Exception:
        return ""


def first_examples(matches: Iterable[str], limit: int = 8) -> list[str]:
    seen: list[str] = []
    for match in matches:
        if match not in seen:
            seen.append(match)
        if len(seen) >= limit:
            break
    return seen


def detect_package_manager(root: Path) -> str | None:
    lockfiles = [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ]
    for filename, manager in lockfiles:
        if (root / filename).exists():
            return manager
    return None


def load_package_json(root: Path) -> dict[str, Any]:
    pkg = root / "package.json"
    if not pkg.exists():
        return {}
    try:
        return json.loads(pkg.read_text(encoding="utf-8"))
    except Exception:
        return {}


def detect_frameworks(pkg: dict[str, Any], root: Path) -> list[str]:
    deps = {}
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        deps.update(pkg.get(key, {}) or {})
    frameworks = []
    checks = [
        ("next", "Next.js"),
        ("@remix-run/react", "Remix"),
        ("react", "React"),
        ("vue", "Vue"),
        ("svelte", "Svelte"),
        ("@angular/core", "Angular"),
        ("astro", "Astro"),
        ("tailwindcss", "Tailwind CSS"),
        ("styled-components", "styled-components"),
        ("@emotion/react", "Emotion"),
        ("@vanilla-extract/css", "vanilla-extract"),
        ("@radix-ui/react-dialog", "Radix UI"),
        ("@headlessui/react", "Headless UI"),
        ("@storybook/react", "Storybook React"),
        ("storybook", "Storybook"),
    ]
    for dep, label in checks:
        if dep in deps and label not in frameworks:
            frameworks.append(label)
    config_checks = [
        ("next.config.js", "Next.js"), ("next.config.mjs", "Next.js"), ("next.config.ts", "Next.js"),
        ("vite.config.js", "Vite"), ("vite.config.ts", "Vite"),
        ("astro.config.mjs", "Astro"), ("svelte.config.js", "Svelte"), ("angular.json", "Angular"),
    ]
    for filename, label in config_checks:
        if (root / filename).exists() and label not in frameworks:
            frameworks.append(label)
    return frameworks


def find_paths(root: Path, patterns: list[str]) -> list[str]:
    results = []
    for pattern in patterns:
        for path in root.glob(pattern):
            if any(part in EXCLUDE_DIRS for part in path.parts):
                continue
            results.append(rel(path, root))
    return sorted(set(results))


def scan(root: Path) -> dict[str, Any]:
    pkg = load_package_json(root)
    scripts = pkg.get("scripts", {}) if pkg else {}
    package_manager = detect_package_manager(root)
    frameworks = detect_frameworks(pkg, root)

    token_paths = find_paths(root, [
        "**/*token*.*", "**/*theme*.*", "**/tailwind.config.*", "**/style-dictionary.config.*",
        "**/globals.css", "**/index.css", "**/styles/**/*.*",
    ])
    component_dirs = find_paths(root, [
        "src/components/ui", "components/ui", "src/ui", "packages/ui", "libs/ui", "shared/ui", "app/components/ui",
    ])
    storybook_paths = find_paths(root, [".storybook", "**/*.stories.*", "**/*.story.*", "**/*.mdx"])
    docs_paths = find_paths(root, [
        "docs/design-system/**", "docs/**/*style*", "docs/**/*brand*", "docs/**/*ui*", "docs/**/*design*",
        "**/design*.md", "**/style-guide*.md", "**/brand*.md",
    ])
    lint_paths = find_paths(root, [
        ".eslintrc*", "eslint.config.*", ".stylelintrc*", "stylelint.config.*", ".prettierrc*", "prettier.config.*",
        ".github/workflows/*", ".husky/*", "lefthook.yml", ".lintstagedrc*",
    ])

    raw_hex: list[Finding] = []
    inline_styles: list[Finding] = []
    arbitrary_tw: list[Finding] = []
    css_var_defs: Counter[str] = Counter()
    css_var_uses: Counter[str] = Counter()
    component_names: Counter[str] = Counter()
    button_like: list[Finding] = []

    for path in iter_files(root):
        text = read_text(path)
        if not text:
            continue
        r = rel(path, root)
        lower = r.lower()
        is_token_file = any(hint in lower for hint in TOKEN_FILE_HINTS)

        for var in CSS_VAR_DEF_RE.findall(text):
            css_var_defs[var] += 1
        for var in CSS_VAR_USE_RE.findall(text):
            css_var_uses[var] += 1

        if path.suffix.lower() in CODE_EXTS:
            if not is_token_file:
                hexes = HEX_RE.findall(text)
                if hexes:
                    raw_hex.append(Finding(r, len(hexes), first_examples(hexes)))
            styles = INLINE_STYLE_RE.findall(text)
            if styles:
                inline_styles.append(Finding(r, len(styles), ["style={{ ... }}"]))
            arbitrary = ARBITRARY_TW_RE.findall(text)
            if arbitrary:
                arbitrary_tw.append(Finding(r, len(arbitrary), first_examples(arbitrary)))

            # Component name inventory.
            for match in COMPONENT_EXPORT_RE.finditer(text):
                name = match.group(1)
                export_group = match.group(2)
                if name:
                    component_names[name] += 1
                if export_group:
                    for part in export_group.split(','):
                        exported = part.strip().split(' as ')[-1].strip()
                        if exported and exported[:1].isupper():
                            component_names[exported] += 1

            # Very rough button-like signal.
            if "<button" in text or "role=\"button\"" in text or "role='button'" in text:
                classes = []
                for c1, c2 in CLASSNAME_RE.findall(text):
                    cls = c1 or c2
                    if any(term in cls for term in ("rounded", "px-", "py-", "bg-", "border", "hover:")):
                        classes.append(cls[:140])
                if classes:
                    button_like.append(Finding(r, len(classes), first_examples(classes, 4)))

    # Derive rough maturity.
    score = 0
    if css_var_defs or token_paths:
        score += 1
    if component_dirs or any(name in component_names for name in ("Button", "IconButton", "Input", "Card")):
        score += 1
    if storybook_paths:
        score += 1
    if docs_paths:
        score += 1
    if lint_paths:
        score += 1
    if raw_hex or inline_styles or arbitrary_tw:
        score -= 1

    if score <= 0 and not (frameworks or token_paths or component_dirs):
        maturity = "no UI or not detected"
    elif score <= 1:
        maturity = "ad hoc"
    elif score <= 3:
        maturity = "emerging"
    else:
        maturity = "mature or near-mature"

    report = {
        "root": root.as_posix(),
        "package_manager": package_manager,
        "frameworks": frameworks,
        "scripts": scripts,
        "paths": {
            "tokens_theme": token_paths[:80],
            "component_dirs": component_dirs,
            "storybook": storybook_paths[:80],
            "docs": docs_paths[:80],
            "lint_ci": lint_paths[:80],
        },
        "signals": {
            "css_variable_definitions_top": css_var_defs.most_common(50),
            "css_variable_uses_top": css_var_uses.most_common(50),
            "component_names_top": component_names.most_common(80),
            "raw_hex_files": [asdict(f) for f in raw_hex[:80]],
            "inline_style_files": [asdict(f) for f in inline_styles[:80]],
            "arbitrary_tailwind_files": [asdict(f) for f in arbitrary_tw[:80]],
            "button_like_files": [asdict(f) for f in button_like[:80]],
        },
        "counts": {
            "raw_hex_files": len(raw_hex),
            "raw_hex_occurrences": sum(f.count for f in raw_hex),
            "inline_style_files": len(inline_styles),
            "inline_style_occurrences": sum(f.count for f in inline_styles),
            "arbitrary_tailwind_files": len(arbitrary_tw),
            "arbitrary_tailwind_occurrences": sum(f.count for f in arbitrary_tw),
            "css_variable_definitions": sum(css_var_defs.values()),
            "unique_css_variables_defined": len(css_var_defs),
            "storybook_files": len(storybook_paths),
            "docs_files": len(docs_paths),
        },
        "maturity_estimate": maturity,
    }
    return report


def md_list(items: list[str], empty: str = "Not detected") -> str:
    if not items:
        return f"- {empty}\n"
    return "".join(f"- `{item}`\n" for item in items)


def finding_table(findings: list[dict[str, Any]], limit: int = 20) -> str:
    if not findings:
        return "No findings detected.\n"
    lines = ["| File | Count | Examples |", "|---|---:|---|"]
    for f in findings[:limit]:
        examples = ", ".join(f.get("examples", []))
        examples = examples.replace("|", "\\|")
        lines.append(f"| `{f['path']}` | {f['count']} | `{examples}` |")
    if len(findings) > limit:
        lines.append(f"| ... | ... | {len(findings) - limit} more files omitted |")
    return "\n".join(lines) + "\n"


def render_markdown(report: dict[str, Any]) -> str:
    paths = report["paths"]
    signals = report["signals"]
    counts = report["counts"]
    scripts = report.get("scripts", {})

    lines = []
    lines.append("# UI discipline audit report\n")
    lines.append(f"Root: `{report['root']}`\n")
    lines.append("## Summary\n")
    lines.append(f"- Package manager: `{report.get('package_manager') or 'not detected'}`")
    lines.append(f"- Frameworks/tools: {', '.join(report.get('frameworks') or ['not detected'])}")
    lines.append(f"- Maturity estimate: **{report['maturity_estimate']}**")
    lines.append(f"- Raw hex files: {counts['raw_hex_files']} ({counts['raw_hex_occurrences']} occurrences)")
    lines.append(f"- Inline style files: {counts['inline_style_files']} ({counts['inline_style_occurrences']} occurrences)")
    lines.append(f"- Arbitrary Tailwind files: {counts['arbitrary_tailwind_files']} ({counts['arbitrary_tailwind_occurrences']} occurrences)")
    lines.append(f"- CSS variables defined: {counts['unique_css_variables_defined']} unique ({counts['css_variable_definitions']} definitions)")
    lines.append(f"- Storybook files: {counts['storybook_files']}")
    lines.append(f"- Design/doc files: {counts['docs_files']}\n")

    lines.append("## UI authority map candidates\n")
    lines.append("### Tokens/theme\n")
    lines.append(md_list(paths["tokens_theme"][:30]))
    lines.append("### Shared component directories\n")
    lines.append(md_list(paths["component_dirs"][:30]))
    lines.append("### Storybook/examples\n")
    lines.append(md_list(paths["storybook"][:30]))
    lines.append("### Docs\n")
    lines.append(md_list(paths["docs"][:30]))
    lines.append("### Lint/CI\n")
    lines.append(md_list(paths["lint_ci"][:30]))

    lines.append("## Package scripts\n")
    if scripts:
        for name, command in scripts.items():
            lines.append(f"- `{name}`: `{command}`")
    else:
        lines.append("- No package scripts detected")
    lines.append("")

    lines.append("## Top component-like exports\n")
    comps = signals.get("component_names_top", [])[:40]
    if comps:
        lines.append("| Name | Count |")
        lines.append("|---|---:|")
        for name, count in comps:
            lines.append(f"| `{name}` | {count} |")
    else:
        lines.append("No component-like exports detected.")
    lines.append("")

    lines.append("## Raw hex color findings\n")
    lines.append(finding_table(signals["raw_hex_files"]))
    lines.append("## Inline style findings\n")
    lines.append(finding_table(signals["inline_style_files"]))
    lines.append("## Arbitrary Tailwind findings\n")
    lines.append(finding_table(signals["arbitrary_tailwind_files"]))
    lines.append("## Button-like local markup signals\n")
    lines.append(finding_table(signals["button_like_files"]))

    lines.append("## Suggested next step\n")
    maturity = report["maturity_estimate"]
    if "no UI" in maturity:
        lines.append("Use the style questionnaire, then create `docs/design-system/ui-contract.md` and starter tokens.")
    elif maturity == "ad hoc":
        lines.append("Create a UI contract, tokenize repeated values, extract the highest-churn shared components, and add warning-only guardrails.")
    elif maturity == "emerging":
        lines.append("Stabilize the existing system: document the authority map, consolidate repeated patterns, improve Storybook coverage, then add lint guardrails.")
    else:
        lines.append("Follow the existing UI contract. Add narrow docs/stories/guardrails for any new variants or repeated patterns.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory UI design-system discipline signals.")
    parser.add_argument("--root", default=".", help="Repository root to scan")
    parser.add_argument("--out", default=".ui-discipline", help="Output directory relative to root")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out_dir = (root / args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    report = scan(root)
    json_path = out_dir / "audit-report.json"
    md_path = out_dir / "audit-report.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")

    print(f"Wrote {md_path}")
    print(f"Wrote {json_path}")
    print(f"Maturity estimate: {report['maturity_estimate']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
