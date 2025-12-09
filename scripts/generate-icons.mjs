/**
 * Generate app icons from SVG
 * Creates PNG files in various sizes and platform-specific formats
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const iconsDir = path.join(rootDir, 'assets', 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');

// Required sizes for different platforms
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

async function generatePNGs() {
  console.log('Generating PNG icons...');

  const svgBuffer = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outputPath = path.join(iconsDir, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`  Created: icon-${size}.png`);
  }

  // Create main icon.png (512x512)
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon.png'));
  console.log('  Created: icon.png (512x512)');
}

async function generateICNS() {
  console.log('Generating macOS .icns...');

  const iconsetDir = path.join(iconsDir, 'icon.iconset');

  // Create iconset directory
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir);
  }

  const svgBuffer = fs.readFileSync(svgPath);

  // macOS iconset sizes
  const macSizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const { name, size } of macSizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsetDir, name));
  }

  // Convert to .icns using iconutil
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(iconsDir, 'icon.icns')}"`);
    console.log('  Created: icon.icns');

    // Cleanup iconset
    fs.rmSync(iconsetDir, { recursive: true });
  } catch (err) {
    console.log('  Warning: Could not create .icns (iconutil not available)');
  }
}

async function generateICO() {
  console.log('Generating Windows .ico...');

  // For ICO, we need png-to-ico or similar
  // Using sharp to create multi-resolution PNG, then manually create ICO
  const svgBuffer = fs.readFileSync(svgPath);

  // Create 256x256 PNG for Windows (electron-builder will use this)
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(path.join(iconsDir, 'icon-256.png'));

  // Try to create ICO using png-to-ico if available
  try {
    // Simple ICO creation - just use 256x256 PNG as base
    // electron-builder will handle conversion
    console.log('  Note: Using icon.png for Windows (electron-builder will convert)');
  } catch (err) {
    console.log('  Warning: Could not create .ico');
  }
}

async function main() {
  console.log('=== Generating App Icons ===\n');

  await generatePNGs();
  await generateICNS();
  await generateICO();

  console.log('\n=== Done ===');
  console.log('Icons generated in:', iconsDir);
}

main().catch(console.error);
