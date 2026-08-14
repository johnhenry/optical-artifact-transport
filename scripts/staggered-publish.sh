#!/bin/bash
#
# Staggered Publish Script for the optical-artifact-transport monorepo
#
# Publishes all 7 @johnhenry/oat-* packages to npm in dependency order
# with delays to avoid rate limiting. examples/file-transfer is a private
# demo and is never published.
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

  echo -e "${BLUE}[$TOTAL/7]${NC} Publishing ${YELLOW}$pkg${NC}..."

  if $DRY_RUN; then
    npm publish --workspace="$pkg" --access public --dry-run
    SUCCESS=$((SUCCESS + 1))
  else
    local output
    if output=$(npm publish --workspace="$pkg" --access public 2>&1); then
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

echo ""
echo "optical-artifact-transport staggered publish"
echo "Publishing 7 packages in dependency order"
echo "Delay between packages: ${DELAY_BETWEEN_PACKAGES}s, between batches: ${DELAY_BETWEEN_BATCHES}s"

if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: Must run from repository root${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}Building all packages...${NC}"
if ! $DRY_RUN; then
  npm run build
fi
echo -e "${GREEN}Build complete!${NC}"

# ============================================================================
# BATCH 1: no internal @johnhenry/oat-* dependencies
# ============================================================================
publish_batch "Core (no internal deps)" \
  "@johnhenry/oat-protocol" \
  "@johnhenry/oat-qr-fountain"

wait_between "$DELAY_BETWEEN_BATCHES"

# ============================================================================
# BATCH 2: depend on protocol and/or qr-fountain
# ============================================================================
publish_batch "Dependents" \
  "@johnhenry/oat-sim" \
  "@johnhenry/oat-sender" \
  "@johnhenry/oat-receiver" \
  "@johnhenry/oat-ui" \
  "@johnhenry/oat-bootstrap"

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
    echo "  npm publish --workspace=$pkg --access public"
  done
  exit 1
fi

echo ""
echo -e "${GREEN}All packages published successfully!${NC}"
