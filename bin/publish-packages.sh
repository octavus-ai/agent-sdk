#!/bin/bash

# Publish @octavus packages to npm
# Usage: ./bin/publish-packages.sh [--dry-run]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check for dry run flag
DRY_RUN=""
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo -e "${YELLOW}🧪 DRY RUN MODE - No packages will be published${NC}\n"
fi

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${BLUE}📦 Octavus Package Publisher${NC}"
echo "================================"
echo ""

# Step 1: Check npm login
echo -e "${BLUE}Step 1: Checking npm login...${NC}"
if ! npm whoami &> /dev/null; then
  echo -e "${RED}❌ Not logged in to npm${NC}"
  echo ""
  echo "Please run: npm login"
  exit 1
fi
NPM_USER=$(npm whoami)
echo -e "${GREEN}✓ Logged in as: ${NPM_USER}${NC}"
echo ""

# Step 2: Build all packages
echo -e "${BLUE}Step 2: Building all packages...${NC}"
pnpm build
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Step 3: Publish packages in order
echo -e "${BLUE}Step 3: Publishing packages...${NC}"
echo ""

# Package order matters: core must be first since others depend on it
PACKAGES=(
  "packages/core"
  "packages/client-sdk"
  "packages/react"
  "packages/server-sdk"
  "packages/computer"
  "packages/cli"
  "packages/docs"
)

for pkg in "${PACKAGES[@]}"; do
  PKG_NAME=$(node -p "require('./${pkg}/package.json').name")
  PKG_VERSION=$(node -p "require('./${pkg}/package.json').version")
  
  echo -e "${YELLOW}Publishing ${PKG_NAME}@${PKG_VERSION}...${NC}"
  
  cd "$ROOT_DIR/$pkg"
  
  if pnpm publish --access public $DRY_RUN --no-git-checks; then
    echo -e "${GREEN}✓ Published ${PKG_NAME}@${PKG_VERSION}${NC}"
  else
    echo -e "${RED}❌ Failed to publish ${PKG_NAME}${NC}"
    exit 1
  fi
  
  echo ""
  cd "$ROOT_DIR"
done

# Done
echo "================================"
if [[ -n "$DRY_RUN" ]]; then
  echo -e "${YELLOW}🧪 Dry run complete - no packages were published${NC}"
  echo ""
  echo "To publish for real, run:"
  echo "  ./bin/publish-packages.sh"
else
  echo -e "${GREEN}🎉 All packages published successfully!${NC}"
  echo ""
  echo "View your packages:"
  echo "  https://www.npmjs.com/package/@octavus/core"
  echo "  https://www.npmjs.com/package/@octavus/client-sdk"
  echo "  https://www.npmjs.com/package/@octavus/react"
  echo "  https://www.npmjs.com/package/@octavus/server-sdk"
  echo "  https://www.npmjs.com/package/@octavus/computer"
  echo "  https://www.npmjs.com/package/@octavus/cli"
  echo "  https://www.npmjs.com/package/@octavus/docs"
fi

