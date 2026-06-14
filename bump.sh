#!/usr/bin/env bash
# Usage: ./bump.sh [patch|minor|major] ["optional commit message"]
set -e

TYPE=${1:-patch}
MSG=${2:-""}

SIDEBAR="components/Sidebar.tsx"

# Extract current version
CURRENT=$(grep -oP 'v\K[0-9]+\.[0-9]+\.[0-9]+' "$SIDEBAR" | head -1)
if [ -z "$CURRENT" ]; then
  echo "❌ Version not found in $SIDEBAR"
  exit 1
fi

MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)

case "$TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *)
    echo "❌ Unknown type: $TYPE (use patch, minor or major)"
    exit 1
    ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"

# Update version in Sidebar
sed -i "s/v$CURRENT/v$NEW/g" "$SIDEBAR"
echo "✓ $CURRENT → $NEW"

# Commit + push
COMMIT_MSG="chore: bump version to v$NEW"
[ -n "$MSG" ] && COMMIT_MSG="$COMMIT_MSG — $MSG"

git add "$SIDEBAR"
git commit -m "$COMMIT_MSG"
git push origin main

echo "🚀 v$NEW pushed to main"
