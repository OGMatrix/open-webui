#!/usr/bin/env bash
#
# Bring the `live` branch up to date with open-webui/open-webui `dev`.
#
# `live` carries our own features on top of upstream. This merges rather than
# rebases, because `live` is pushed and deployed from: rebasing would rewrite
# published history and force every clone to reset.
#
# Usage:
#   ./scripts/sync-upstream.sh          # merge, then report what to verify
#   ./scripts/sync-upstream.sh --check  # only report how far behind we are
#
set -euo pipefail

BRANCH="live"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="dev"
UPSTREAM_URL="https://github.com/open-webui/open-webui.git"

cd "$(dirname "$0")/.."

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
	echo "adding '$UPSTREAM_REMOTE' remote -> $UPSTREAM_URL"
	git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

echo "fetching $UPSTREAM_REMOTE ..."
git fetch "$UPSTREAM_REMOTE" --quiet

BEHIND=$(git rev-list --count "$BRANCH..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
AHEAD=$(git rev-list --count "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH..$BRANCH")
echo "$BRANCH is $BEHIND commit(s) behind and $AHEAD ahead of $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"

if [ "${1:-}" = "--check" ]; then
	if [ "$BEHIND" -gt 0 ]; then
		echo
		echo "new upstream commits:"
		git log --oneline "$BRANCH..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | head -20
	fi
	exit 0
fi

if [ "$BEHIND" -eq 0 ]; then
	echo "already up to date, nothing to do"
	exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "working tree is dirty; commit or stash first" >&2
	exit 1
fi

git checkout "$BRANCH"

echo
echo "upstream commits touching files we changed (conflict candidates):"
OURS=$(git diff --name-only "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH...$BRANCH")
if [ -n "$OURS" ]; then
	# shellcheck disable=SC2086
	git log --oneline "$BRANCH..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" -- $OURS | head -20 || true
fi

echo
if git merge --no-edit "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
	echo
	echo "merged cleanly. now verify before pushing:"
else
	echo
	echo "merge stopped on conflicts. resolve them, then:" >&2
	echo "  git add <files> && git commit" >&2
	echo
	echo "afterwards verify:" >&2
fi

cat <<'EOF'
  npx vitest run
  npx svelte-check --tsconfig ./tsconfig.json
  NODE_OPTIONS=--max-old-space-size=8192 npx vite build
  (cd backend && ./.venv/Scripts/python.exe -c "import open_webui.config")

then:
  git push origin live
EOF
