
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

// Build configuration
const baseConfig = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: 'es2020',
  format: 'iife',
  platform: 'browser',
  charset: 'utf8',
  external: [],
  define: {
    'global': 'globalThis'
  }
};

// Build background script (service worker)
esbuild.build({
  ...baseConfig,
  entryPoints: ['src/background.ts'],
  outfile: 'dist/background.js',
  globalName: 'BackgroundScript'
}).catch((err) => {
  console.error('Background build failed:', err);
  process.exit(1);
});

// Build content script
esbuild.build({
  ...baseConfig,
  entryPoints: ['src/content.ts'],
  outfile: 'dist/content.js',
  globalName: 'ContentScript'
}).catch((err) => {
  console.error('Content build failed:', err);
  process.exit(1);
});

// Build popup script
esbuild.build({
  ...baseConfig,
  entryPoints: ['src/popup.ts'],
  outfile: 'dist/popup.js',
  globalName: 'PopupScript'
}).catch((err) => {
  console.error('Popup build failed:', err);
  process.exit(1);
});

// Build utils as standalone (it gets imported by content script)
esbuild.build({
  ...baseConfig,
  entryPoints: ['src/utils.ts'],
  outfile: 'dist/utils.js',
  globalName: 'Utils'
}).catch((err) => {
  console.error('Utils build failed:', err);
  process.exit(1);
});

console.log('Build completed successfully!');