#!/usr/bin/env bash
#
# Runs on the production server every 10 minutes, installed at
# /usr/local/bin/cse312-stop-idle. Stops a test copy that has been idle for
# IDLE_MINUTES. Only test-1 and test-2 are listed: main is never stopped.
#
# A copy counts as active if any of these is true:
#   - it was deployed recently
#   - a browser visited it recently (nginx writes this log, if the copy has a URL)
#   - something is connected to its port right now, such as a WebSocket
#
# Containers are stopped, not removed, so databases and files are kept.
# The next deploy to that copy starts it again.

set -euo pipefail

IDLE_MINUTES="${IDLE_MINUTES:-180}"
LOG_DIR="${LOG_DIR:-/var/log/nginx}"

# Never stop a copy in the middle of a deploy. The next run checks again.
exec 9>/tmp/cse312-deploy.lock
flock -n 9 || exit 0

now=$(date +%s)

check_target() {
  local target=$1 port=$2
  local project="cse312-$target"

  local running
  running=$(docker ps -q --filter "label=com.docker.compose.project=$project")
  [ -n "$running" ] || return 0

  local connections
  connections=$(ss -Htn state established "( sport = :$port or dport = :$port )" | wc -l)
  if [ "$connections" -gt 0 ]; then
    echo "$target: keeping, $connections open connections"
    return 0
  fi

  local last=0 file stamp
  for file in "$HOME/$target/.deploy/last-deploy" "$LOG_DIR/$target.browser.log"; do
    if [ -e "$file" ]; then
      stamp=$(stat -c %Y "$file")
      if [ "$stamp" -gt "$last" ]; then last=$stamp; fi
    fi
  done

  local idle=$(( (now - last) / 60 ))
  if [ "$idle" -lt "$IDLE_MINUTES" ]; then
    echo "$target: keeping, idle for $idle minutes"
    return 0
  fi

  echo "$target: stopping, idle for $idle minutes"
  # shellcheck disable=SC2086 # one container ID per word
  docker stop $running >/dev/null
}

check_target test-1 8081
check_target test-2 8082
