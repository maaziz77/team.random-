#!/usr/bin/env bash
#
# Runs on the production server, installed at /usr/local/bin/cse312-deploy.
# The GitHub Actions deploy key can only run this command, and it sends the
# commit to deploy as its only input.

set -euo pipefail

SHA="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full commit hash." >&2
  exit 2
fi

# Stop two deploys from running at the same time.
exec 9>/tmp/cse312-deploy.lock
if ! flock -n 9; then
  echo "Another deploy is running. Try again shortly." >&2
  exit 1
fi

cd "$HOME/team.random-"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The server has manual file changes, so the deploy stopped:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

git fetch --quiet --prune origin
git checkout --quiet --detach "$SHA"
echo "Checked out $(git log -1 --format='%h %s')"

for file in docker-compose.yml docker-compose.prod.yml; do
  if [ ! -f "$file" ]; then
    echo "This commit has no $file, so there is nothing to start." >&2
    exit 1
  fi
done

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

# Also removes containers for services deleted from Compose.
"${COMPOSE[@]}" up -d --build --remove-orphans
"${COMPOSE[@]}" ps

# Clears old unused images. Volumes, including the database, are not touched.
docker image prune -f >/dev/null || echo "Warning: could not remove old images." >&2
