#!/bin/bash
#
# Staggered Publish Script for the optical-artifact-transport monorepo
#
# Publishes every non-private @johnhenry/oat-* package to npm in
# dependency order with delays to avoid rate limiting. examples/file-transfer
# is a private demo and is never published.
#
# The batch order itself is NOT hardcoded here -- it's derived at runtime
# from the real workspace dependency graph by
# scripts/derive-publish-order.mjs (a topological sort over each package's
# own `dependencies`). A hardcoded batch list silently rots when a package
# is added or its internal dependencies change; deriving it means this
# script self-corrects instead. (Same failure mode math-plus hit in its
# own hand-rolled JSR-publish loop -- see issue #47 there.)
#
# Usage:
#   ./scripts/staggered-publish.sh           # Full publish
#   ./scripts/staggered-publish.sh --dry-run # Dry run (no actual publish)
#
# Configuration:
#   DELAY_BETWEEN_PACKAGES - seconds between each package (default: 5)
#   DELAY_BETWEEN_BATCHES  - seconds between batches (default: 15)
#

set -e

# Configuration
DELAY_BETWEEN_PACKAGES=${DELAY_BETWEEN_PACKAGES:-5}
DELAY_BETWEEN_BATCHES=${DELAY_BETWEEN_BATCHES:-15}
DRY_RUN=false

# Parse arguments
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN MODE - No packages will be published"
  echo ""
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
SUCCESS=0
SKIPPED=0
FAILED=0
FAILED_PACKAGES=()

publish_package() {
  local pkg=$1
  TOTAL=$((TOTAL + 1))

  echo -e "${BLUE}[$TOTAL/$TOTAL_PACKAGES]${NC} Publishing ${YELLOW}$pkg${NC}..."

  if $DRY_RUN; then
    npm publish --workspace="$pkg" --access public --provenance --dry-run
    SUCCESS=$((SUCCESS + 1))
  else
    local output
    if output=$(npm publish --workspace="$pkg" --access public --provenance 2>&1); then
      echo "$output"
      echo -e "  ${GREEN}Published successfully${NC}"
      SUCCESS=$((SUCCESS + 1))
    elif echo "$output" | grep -q "cannot publish over the previously published"; then
      # Version already on the registry — package unchanged this release
      echo -e "  ${YELLOW}Skipped (version already published)${NC}"
      SKIPPED=$((SKIPPED + 1))
    else
      echo "$output"
      echo -e "  ${RED}Failed to publish${NC}"
      FAILED=$((FAILED + 1))
      FAILED_PACKAGES+=("$pkg")
    fi
  fi
}

wait_between() {
  local seconds=$1
  if ! $DRY_RUN && [ "$seconds" -gt 0 ]; then
    echo -e "  ${BLUE}Waiting ${seconds}s...${NC}"
    sleep "$seconds"
  fi
}

publish_batch() {
  local batch_name=$1
  shift
  local packages=("$@")

  echo ""
  echo -e "${GREEN}=== Batch: $batch_name ===${NC}"
  echo ""

  for pkg in "${packages[@]}"; do
    publish_package "$pkg"
    wait_between "$DELAY_BETWEEN_PACKAGES"
  done
}

if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: Must run from repository root${NC}"
  exit 1
fi

# ============================================================================
# Derive the batch order from the real workspace dependency graph instead
# of a hardcoded list (see header comment above).
# ============================================================================
BATCH_OUTPUT=$(node scripts/derive-publish-order.mjs) || {
  echo -e "${RED}Error: failed to derive a publish order (see error above, e.g. a dependency cycle)${NC}"
  exit 1
}

# `mapfile`/`readarray` isn't available on bash 3.2 (macOS's default
# /bin/bash), so build the array with a portable read loop instead.
BATCHES=()
while IFS= read -r line; do
  [ -n "$line" ] && BATCHES+=("$line")
done <<< "$BATCH_OUTPUT"

if [ ${#BATCHES[@]} -eq 0 ]; then
  echo -e "${RED}Error: derive-publish-order.mjs found no publishable packages${NC}"
  exit 1
fi

TOTAL_PACKAGES=0
for batch_line in "${BATCHES[@]}"; do
  read -ra pkgs <<< "$batch_line"
  TOTAL_PACKAGES=$((TOTAL_PACKAGES + ${#pkgs[@]}))
done

echo ""
echo "optical-artifact-transport staggered publish"
echo "Publishing $TOTAL_PACKAGES packages in dependency order across ${#BATCHES[@]} batch(es)"
echo "Delay between packages: ${DELAY_BETWEEN_PACKAGES}s, between batches: ${DELAY_BETWEEN_BATCHES}s"

echo ""
echo -e "${YELLOW}Building all packages...${NC}"
if ! $DRY_RUN; then
  npm run build
fi
echo -e "${GREEN}Build complete!${NC}"

batch_num=0
for batch_line in "${BATCHES[@]}"; do
  batch_num=$((batch_num + 1))
  read -ra pkgs <<< "$batch_line"

  if [ "$batch_num" -gt 1 ]; then
    wait_between "$DELAY_BETWEEN_BATCHES"
  fi

  publish_batch "Batch $batch_num/${#BATCHES[@]}" "${pkgs[@]}"
done

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=== PUBLISH COMPLETE ==="
echo ""
echo -e "  Total packages: ${BLUE}$TOTAL${NC}"
echo -e "  Successful:     ${GREEN}$SUCCESS${NC}"
echo -e "  Skipped:        ${YELLOW}$SKIPPED${NC} (already published)"
echo -e "  Failed:         ${RED}$FAILED${NC}"

if [ ${#FAILED_PACKAGES[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed packages:${NC}"
  for pkg in "${FAILED_PACKAGES[@]}"; do
    echo "  - $pkg"
  done
  echo ""
  echo "To retry failed packages:"
  for pkg in "${FAILED_PACKAGES[@]}"; do
    echo "  npm publish --workspace=$pkg --access public --provenance"
  done
  exit 1
fi

echo ""
echo -e "${GREEN}All packages published successfully!${NC}"
