#!/bin/bash
# Claude Code PreToolUse hook for Bash command validation
# Validates commands against patterns defined in bash-patterns.toml
# Handles command combinations (pipes, chains, subshells)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/bash-patterns.toml"

# Logging setup (only logs ask/deny decisions to reduce disk I/O)
LOG_DIR="/tmp/claude-hook-logs"
LOG_RETENTION_DAYS=15
CLEANUP_STATE_FILE="$LOG_DIR/.last_cleanup"
CLEANUP_INTERVAL_SECONDS=$((24 * 60 * 60))

# Create log directory with restrictive permissions
OLD_UMASK=$(umask)
umask 077
mkdir -p "$LOG_DIR" 2>/dev/null
umask "$OLD_UMASK"

# Verify log directory is safe (not a symlink, owned by us)
if [[ -L "$LOG_DIR" ]] || [[ ! -d "$LOG_DIR" ]] || [[ ! -O "$LOG_DIR" ]]; then
    # Unsafe log directory; disable logging but continue validation
    LOG_DIR=""
fi

cleanup_old_logs() {
    [[ -z "$LOG_DIR" ]] && return 0
    local now last_run
    now=$(date +%s)
    if [[ -f "$CLEANUP_STATE_FILE" ]]; then
        last_run=$(cat "$CLEANUP_STATE_FILE" 2>/dev/null || echo 0)
    else
        last_run=0
    fi
    # Skip if cleanup ran recently
    if (( now - last_run < CLEANUP_INTERVAL_SECONDS )); then
        return 0
    fi
    find "$LOG_DIR" -name "*.log" -type f -mtime +$LOG_RETENTION_DAYS -delete 2>/dev/null || true
    echo "$now" > "$CLEANUP_STATE_FILE" 2>/dev/null || true
}

# Throttled cleanup (runs synchronously but only once per day)
cleanup_old_logs

# Check config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    # Use fallback log file for config errors
    if [[ -n "$LOG_DIR" ]]; then
        LOG_FILE="$LOG_DIR/$(LC_ALL=C date '+%Y-%m-%d')-error.log"
        {
            echo "========================================"
            echo "TIME:   $(LC_ALL=C date '+%Y-%m-%d %H:%M:%S')"
            echo "ERROR:  Configuration file not found"
            echo "PATH:   $CONFIG_FILE"
            echo "========================================"
        } >> "$LOG_FILE"
    fi
    echo "Error: Configuration file not found: $CONFIG_FILE" >&2
    exit 1
fi

# Capture stdin
INPUT=$(cat)

# Extract project name from cwd for log filename
PROJECT=$(echo "$INPUT" | python3 -c "
import sys, json, os
try:
    data = json.load(sys.stdin)
    cwd = data.get('cwd', '')
    print(os.path.basename(cwd) if cwd else 'unknown')
except:
    print('unknown')
" 2>/dev/null)

# Log filename: YYYY-MM-DD-Day-project.log (sorts chronologically)
# Use LC_ALL=C for consistent locale-independent day abbreviations
if [[ -n "$LOG_DIR" ]]; then
    LOG_FILE="$LOG_DIR/$(LC_ALL=C date '+%Y-%m-%d-%a')-${PROJECT}.log"
else
    LOG_FILE=""
fi

# Helper to sanitize strings for logging (escape newlines and control chars)
sanitize_for_log() {
    printf '%s' "$1" | tr '\n\r\t' ' ' | tr -d '\000-\011\013-\037'
}

# Use Python for TOML parsing and validation
# Capture stderr separately to avoid mixing with JSON output
STDERR_FILE=$(mktemp)
OUTPUT=$(echo "$INPUT" | python3 "$SCRIPT_DIR/validate-bash.py" "$CONFIG_FILE" 2>"$STDERR_FILE") || {
    COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command','<unknown>'))" 2>/dev/null || echo "<parse error>")
    COMMAND=$(sanitize_for_log "$COMMAND")
    STDERR_CONTENT=$(cat "$STDERR_FILE" 2>/dev/null || true)
    rm -f "$STDERR_FILE"
    if [[ -n "$LOG_FILE" ]]; then
        {
            echo "========================================"
            echo "TIME:   $(LC_ALL=C date '+%Y-%m-%d %H:%M:%S')"
            echo "ERROR:  Python script failed"
            echo "CMD:    $COMMAND"
            echo "STDOUT: $OUTPUT"
            echo "STDERR: $STDERR_CONTENT"
            echo "========================================"
        } >> "$LOG_FILE"
    fi
    exit 1
}
rm -f "$STDERR_FILE"

# Only log ask/deny decisions (not allow) to reduce disk I/O
if [[ -n "$LOG_FILE" ]]; then
    if echo "$OUTPUT" | grep -q '"permissionDecision": *"deny"'; then
        COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
        REASON=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hookSpecificOutput',{}).get('permissionDecisionReason',''))" 2>/dev/null)
        COMMAND=$(sanitize_for_log "$COMMAND")
        REASON=$(sanitize_for_log "$REASON")
        {
            echo "========================================"
            echo "TIME:   $(LC_ALL=C date '+%Y-%m-%d %H:%M:%S')"
            echo "ACTION: DENY"
            echo "REASON: $REASON"
            echo "CMD:    $COMMAND"
            echo "========================================"
        } >> "$LOG_FILE"
    elif echo "$OUTPUT" | grep -q '"permissionDecision": *"ask"'; then
        COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
        REASON=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hookSpecificOutput',{}).get('permissionDecisionReason',''))" 2>/dev/null)
        COMMAND=$(sanitize_for_log "$COMMAND")
        REASON=$(sanitize_for_log "$REASON")
        {
            echo "========================================"
            echo "TIME:   $(LC_ALL=C date '+%Y-%m-%d %H:%M:%S')"
            echo "ACTION: ASK"
            echo "REASON: $REASON"
            echo "CMD:    $COMMAND"
            echo "========================================"
        } >> "$LOG_FILE"
    fi
fi

# Only output if non-empty (avoid spurious newlines)
if [[ -n "$OUTPUT" ]]; then
    printf '%s' "$OUTPUT"
fi
