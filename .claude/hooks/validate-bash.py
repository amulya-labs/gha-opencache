#!/usr/bin/env python3
"""
Bash command validator for Claude Code PreToolUse hook.
Reads patterns from TOML config and validates commands.

Source: https://github.com/amulya-labs/claude-agents
License: MIT (https://opensource.org/licenses/MIT)
"""

import json
import re
import sys
from pathlib import Path

# Python 3.11+ has tomllib built-in
try:
    import tomllib
except ImportError:
    # Fallback for Python < 3.11
    try:
        import tomli as tomllib
    except ImportError:
        print(
            "Error: Python 3.11+ required, or install 'tomli' package for older versions",
            file=sys.stderr,
        )
        sys.exit(1)


def load_config(config_path: str) -> dict:
    """Load and validate TOML configuration."""
    try:
        with open(config_path, "rb") as f:
            return tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        print(f"Error: Invalid TOML in {config_path}: {e}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print(f"Error: Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)


def extract_patterns(config: dict, category: str) -> list[tuple[str, str]]:
    """Extract patterns for a category (deny/ask/allow).

    Returns list of (pattern, section_name) tuples.
    """
    patterns = []
    for section_name, section in config.get(category, {}).items():
        if isinstance(section, dict) and "patterns" in section:
            for pattern in section["patterns"]:
                patterns.append((pattern, f"{category}.{section_name}"))
    return patterns


def strip_env_vars(cmd: str) -> str:
    """Strip environment variable assignments from command start."""
    while True:
        cmd = cmd.lstrip()
        # Match: VAR=value, VAR="value", VAR='value', VAR=$(cmd), VAR=$VAR
        match = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', cmd)
        if not match:
            break

        rest = cmd[match.end():]

        if rest.startswith('$('):
            # Command substitution $(...)
            depth = 1
            i = 2
            while depth > 0 and i < len(rest):
                if rest[i] == '(':
                    depth += 1
                elif rest[i] == ')':
                    depth -= 1
                i += 1
            cmd = rest[i:]
        elif rest.startswith('`'):
            # Backtick substitution
            end = rest.find('`', 1)
            cmd = rest[end + 1:] if end > 0 else ""
        elif rest.startswith('"'):
            # Double-quoted value
            i = 1
            while i < len(rest):
                if rest[i] == '\\' and i + 1 < len(rest):
                    i += 2
                    continue
                if rest[i] == '"':
                    break
                i += 1
            cmd = rest[i + 1:]
        elif rest.startswith("'"):
            # Single-quoted value
            end = rest.find("'", 1)
            cmd = rest[end + 1:] if end > 0 else ""
        elif rest.startswith('$') and len(rest) > 1 and re.match(r'[A-Za-z_]', rest[1]):
            # Variable reference $VAR
            match = re.match(r'^\$[A-Za-z_][A-Za-z0-9_]*', rest)
            cmd = rest[match.end():] if match else rest
        else:
            # Unquoted value - ends at whitespace
            match = re.match(r'^[^\s]*\s*', rest)
            cmd = rest[match.end():] if match else ""

    return cmd.lstrip()


def split_commands(cmd: str) -> list[str]:
    """Split command on &&, ||, ; (respecting quotes)."""
    segments = []
    current = ""
    quote = None
    i = 0

    while i < len(cmd):
        char = cmd[i]

        # Track quotes (ignore escaped by odd number of backslashes)
        if char in ('"', "'"):
            # Count consecutive backslashes before this character
            backslash_count = 0
            j = i - 1
            while j >= 0 and cmd[j] == '\\':
                backslash_count += 1
                j -= 1
            # Only treat as real quote if preceded by even number of backslashes
            if backslash_count % 2 == 0:
                if quote is None:
                    quote = char
                elif quote == char:
                    quote = None

        # Split on && || ; outside quotes
        if quote is None:
            if cmd[i:i+2] in ('&&', '||'):
                if current.strip():
                    segments.append(current)
                current = ""
                i += 2
                continue
            elif char == ';':
                if current.strip():
                    segments.append(current)
                current = ""
                i += 1
                continue

        current += char
        i += 1

    if current.strip():
        segments.append(current)

    return segments


def clean_segment(segment: str) -> str:
    """Clean a command segment: strip whitespace, subshell chars, env vars."""
    segment = segment.strip()

    # Strip leading subshell/grouping: ( {
    while segment and segment[0] in '({':
        segment = segment[1:].lstrip()

    # Strip trailing subshell/grouping: ) }
    while segment and segment[-1] in ')}':
        segment = segment[:-1].rstrip()

    # Strip env vars
    segment = strip_env_vars(segment)

    return segment


def check_patterns(segment: str, patterns: list[tuple[str, str]]) -> tuple[bool, str]:
    """Check if segment matches any pattern. Returns (matched, section_name)."""
    for pattern, section in patterns:
        try:
            if re.search(pattern, segment):
                return True, section
        except re.error as e:
            print(f"Warning: Invalid regex '{pattern}' in {section}: {e}", file=sys.stderr)
    return False, ""


def output_decision(decision: str, reason: str):
    """Output JSON decision for Claude Code hook."""
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason
        }
    }))


def main():
    if len(sys.argv) != 2:
        print("Usage: validate-bash.py <config.toml>", file=sys.stderr)
        sys.exit(1)

    config_path = sys.argv[1]
    config = load_config(config_path)

    # Load patterns
    deny_patterns = extract_patterns(config, "deny")
    ask_patterns = extract_patterns(config, "ask")
    allow_patterns = extract_patterns(config, "allow")

    # Read JSON input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Invalid input, let it pass
        sys.exit(0)

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        sys.exit(0)

    # Split into segments
    segments = split_commands(command)

    final_decision = "allow"
    final_reason = ""
    final_segment = ""

    for segment in segments:
        cleaned = clean_segment(segment)
        if not cleaned:
            continue

        # Check DENY first
        matched, section = check_patterns(cleaned, deny_patterns)
        if matched:
            output_decision("deny", f"Blocked: '{cleaned}' matches {section}")
            sys.exit(0)

        # Check ASK
        matched, section = check_patterns(cleaned, ask_patterns)
        if matched:
            if final_decision != "ask":
                final_decision = "ask"
                final_reason = f"'{cleaned}' matches {section}"
                final_segment = cleaned
            continue

        # Check ALLOW
        matched, _ = check_patterns(cleaned, allow_patterns)
        if matched:
            continue

        # Not in any list - mark as ask
        if final_decision != "ask":
            final_decision = "ask"
            final_reason = f"'{cleaned}' not in auto-approve list"
            final_segment = cleaned

    # Output final decision (always output explicitly)
    if final_decision == "ask":
        output_decision("ask", final_reason)
    else:
        output_decision("allow", "Command matches allow patterns")


if __name__ == "__main__":
    main()
