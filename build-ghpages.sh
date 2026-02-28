#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# build-ghpages.sh
#
# Builds the COG Viewer for GitHub Pages deployment.
#
# What it does:
#   1. Temporarily sets the Vite base path to /<repo-name>/
#   2. Ensures the GeoTIFF is in public/ (symlink or copy)
#   3. Runs `npm run build`
#   4. Restores vite.config.js to its original state
#
# The output in dist/ is ready to deploy to GitHub Pages.
#
# Usage:
#   ./build-ghpages.sh              # auto-detects repo name from git
#   ./build-ghpages.sh my-repo      # explicit repo name
# ──────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Determine the repo name (used as the base path on GitHub Pages)
if [ -n "${1:-}" ]; then
  REPO_NAME="$1"
else
  REPO_NAME=$(basename "$(git remote get-url origin 2>/dev/null | sed 's/\.git$//')" 2>/dev/null || basename "$PWD")
fi

echo "🔧 Building for GitHub Pages with base: /${REPO_NAME}/"

# ── Backup vite.config.js ────────────────────────────────────
cp vite.config.js vite.config.js.bak

# ── Set the base path for GitHub Pages ────────────────────────
cat > vite.config.js <<EOF
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configured for GitHub Pages deployment at /${REPO_NAME}/
export default defineConfig({
  base: '/${REPO_NAME}/',
  plugins: [react()],
})
EOF

echo "   ✔ Set base path to /${REPO_NAME}/"

# ── Ensure the GeoTIFF is available in public/ ────────────────
TIF="DeltaX_Atchafalaya_Terrebonne_channels_vv.tif"
if [ ! -e "public/${TIF}" ] && [ -f "${TIF}" ]; then
  ln -s "$(pwd)/${TIF}" "public/${TIF}"
  echo "   ✔ Symlinked ${TIF} into public/"
else
  echo "   ✔ ${TIF} already in public/"
fi

# ── Build ─────────────────────────────────────────────────────
echo "   ⏳ Running npm run build..."
npm run build

# ── Restore vite.config.js ────────────────────────────────────
mv vite.config.js.bak vite.config.js
echo "   ✔ Restored vite.config.js (base: /)"

echo ""
echo "✅ Build complete! Deploy the dist/ directory to GitHub Pages."
echo ""
echo "   Quick deploy with gh-pages:"
echo "     npx gh-pages -d dist"
echo ""
echo "   Or push dist/ to your repo's gh-pages branch manually."
