#!/bin/bash

EXTENSION_NAME="safeway-coupon-clipper"
BUILD_DIR="temp-build"
BUILDS_DIR="builds"
ZIP_FILE="${EXTENSION_NAME}-v$(grep '"version"' manifest.json | cut -d'"' -f4).zip"

echo "Cleaning up previous build..."
rm -rf "$BUILD_DIR"

echo "Creating build directories..."
mkdir -p "$BUILD_DIR"
mkdir -p "$BUILDS_DIR"

echo "Copying extension files..."
cp manifest.json "$BUILD_DIR/"
cp content.js "$BUILD_DIR/"
cp background.js "$BUILD_DIR/"

if [ -f "icon16.png" ]; then
    cp icon16.png "$BUILD_DIR/"
fi
if [ -f "icon48.png" ]; then
    cp icon48.png "$BUILD_DIR/"
fi
if [ -f "icon128.png" ]; then
    cp icon128.png "$BUILD_DIR/"
fi

echo "Creating zip file: $BUILDS_DIR/$ZIP_FILE"
cd "$BUILD_DIR"
zip -r "../$BUILDS_DIR/$ZIP_FILE" .
cd ..

rm -rf "$BUILD_DIR"

echo "✅ Build complete: $BUILDS_DIR/$ZIP_FILE"
echo "📦 Ready for Chrome Web Store upload!"

if command -v du >/dev/null 2>&1; then
    SIZE=$(du -h "$BUILDS_DIR/$ZIP_FILE" | cut -f1)
    echo "📏 File size: $SIZE"
fi

echo "📋 Package contents:"
unzip -l "$BUILDS_DIR/$ZIP_FILE" 