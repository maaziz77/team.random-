#!/usr/bin/env bash
#
# Runs on the production server, installed at /usr/local/bin/cse312-deploy.
# The GitHub Actions deploy key can only run this command, and it sends
# "<target> <commit>" as its only input.
#
# Each target has its own directory, Compose project, database volume and port:
#   main    ~/team.random-  port 8080  the actual product
#   test-1  ~/test-1        port 8081  teammate testing
#   test-2  ~/test-2        port 8082  teammate testing
#
# Compose files must publish the app with ${APP_PORT:-8080} and must not set
# container_name, or the targets will collide with each other.

set -euo pipefail

read -r TARGET SHA EXTRA <<<"${SSH_ORIGINAL_COMMAND:-}"

case "$TARGET" in
  main)   DIR="$HOME/team.random-"; APP_PORT=8080 ;;
  test-1) DIR="$HOME/test-1";       APP_PORT=8081 ;;
  test-2) DIR="$HOME/test-2";       APP_PORT=8082 ;;
  *)
    echo "Expected a target of main, test-1 or test-2." >&2
    echo "If your branch has no target option on the Deploy button, merge main into it first." >&2
    exit 2
    ;;
esac
export APP_PORT

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]] || [ -n "$EXTRA" ]; then
  echo "Expected a target and a full commit hash." >&2
  exit 2
fi

# Stop two deploys from running at the same time, on any target.
exec 9>/tmp/cse312-deploy.lock
if ! flock -n 9; then
  echo "Another deploy is running. Try again shortly." >&2
  exit 1
fi

cd "$DIR"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The server has manual file changes in $DIR, so the deploy stopped:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

git fetch --quiet --prune origin
git checkout --quiet --detach "$SHA"
echo "Deploying to $TARGET on port $APP_PORT: $(git log -1 --format='%h %s')"

for file in docker-compose.yml docker-compose.prod.yml; do
  if [ ! -f "$file" ]; then
    echo "This commit has no $file, so there is nothing to start." >&2
    exit 1
  fi
done

COMPOSE=(docker compose -p "cse312-$TARGET" -f docker-compose.yml -f docker-compose.prod.yml)

# A deploy counts as activity, so an idle test copy isn't stopped right after it.
mkdir -p .deploy
touch .deploy/last-deploy

# Also removes containers for services deleted from Compose.
"${COMPOSE[@]}" up -d --build --remove-orphans
"${COMPOSE[@]}" ps

# Clears old unused images. Volumes, including the databases, are not touched.
docker image prune -f >/dev/null || echo "Warning: could not remove old images." >&2
