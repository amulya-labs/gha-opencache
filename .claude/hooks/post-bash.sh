#!/bin/bash
# Claude Code PostToolUse hook for Bash commands
# Logs ASK command outcomes (approved)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/bash-patterns.toml"
LOG_DIR="/tmp/claude-hook-logs"

# Create log directory with restrictive permissions
OLD_UMASK=$(umask)
umask 077
mkdir -p "$LOG_DIR" 2>/dev/null
umask "$OLD_UMASK"

# Verify log directory is safe (not a symlink, owned by us)
if [[ -L "$LOG_DIR" ]] || [[ ! -d "$LOG_DIR" ]] || [[ ! -O "$LOG_DIR" ]]; then
    # Unsafe log directory; skip logging
    exit 0
fi

# Capture stdin
INPUT=$(cat)

# Parse input with Python
PARSED=$(echo "$INPUT" | python3 -c "
import sys, json, os
try:
    data = json.load(sys.stdin)
    cwd = data.get('cwd', '')
    project = os.path.basename(cwd) if cwd else 'unknown'
    command = data.get('tool_input', {}).get('command', '').replace('\n', '\\\\n')
    print(project)
    print(command)
except:
    print('unknown')
    print('')
" 2>/dev/null)

PROJECT=$(echo "$PARSED" | sed -n '1p')
COMMAND=$(echo "$PARSED" | sed -n '2p')

[[ -z "$COMMAND" ]] && exit 0

LOG_FILE="$LOG_DIR/$(LC_ALL=C date '+%Y-%m-%d-%a')-${PROJECT}.log"

# Check if this was an ASK pattern
DECISION=$(echo "$INPUT" | python3 "$SCRIPT_DIR/validate-bash.py" "$CONFIG_FILE" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('hookSpecificOutput', {}).get('permissionDecision', ''))
except:
    print('')
" 2>/dev/null)

# Log ASK commands that were approved
if [[ "$DECISION" == "ask" ]]; then
    {
        echo "========================================"
        echo "TIME:   $(LC_ALL=C date '+%Y-%m-%d %H:%M:%S')"
        echo "ACTION: ASK -> APPROVED"
        echo "CMD:    $COMMAND"
        echo "========================================"
    } >> "$LOG_FILE"
fi

exit 0
