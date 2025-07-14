#!/bin/bash
# ABOUTME: Build script that creates a production-ready ZIP package for Chrome Web Store submission
# ABOUTME: Compiles TypeScript, packages necessary files, and creates versioned build archive

set -e

echo "Building Grocery AutoClip for Chrome Web Store..."

# Get the current directory (project root)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Compile TypeScript
echo "Compiling TypeScript..."
npm run build

# Get version from manifest.json
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\([^"]*\)".*/\1/')
echo "Version: $VERSION"

mkdir -p builds
OUTPUT_FILE="builds/grocery-autoclip-v${VERSION}-webstore.zip"

if [ -f "$OUTPUT_FILE" ]; then
    rm "$OUTPUT_FILE"
fi

# Create the ZIP file with compiled JS files from dist directory
zip -r "$OUTPUT_FILE" \
  manifest.json \
  dist/background.js \
  dist/content.js \
  dist/utils.js \
  popup.html \
  popup.css \
  dist/popup.js \
  icon16.png \
  icon48.png \
  icon128.png \
  PRIVACY_POLICY.md \
  -x "*.DS_Store" \
  -x "__MACOSX/*" \
  -x "scripts/*" \
  -x "builds/*" \
  -x ".github/*" \
  -x "README.md" \
  -x "src/*" \
  -x "node_modules/*" \
  -x "tsconfig.json" \
  -x "package.json" \
  -x "package-lock.json"

echo "Build complete: $OUTPUT_FILE"
echo "Package size: $(ls -lh "$OUTPUT_FILE" | awk '{print $5}')"