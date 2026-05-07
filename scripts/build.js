#!/usr/bin/env node
/**
 * Build script for Foundry plugin.
 * 
 * Transforms src/ structure into dist/ with the .opencode convention:
 * - src/plugin/foundry.js → dist/.opencode/plugins/foundry.js
 * - src/plugin/tools/*.js → dist/.opencode/plugins/foundry-tools/*.js
 * - src/skills/ → dist/skills/
 * - src/scripts/ → dist/scripts/
 * 
 * Also rewrites imports to account for the new paths.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');
const distDir = path.join(projectRoot, 'dist');

/**
 * Recursively copy directory contents
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Rewrite import paths in a JavaScript file.
 * Adjusts relative imports to account for the new directory structure.
 */
async function rewriteImports(filePath, fromDir, toDir) {
  const content = await fs.readFile(filePath, 'utf-8');
  
  // Calculate depth difference between old and new location
  // For foundry.js: src/plugin → dist/.opencode/plugins (need ../../.. to reach package root)
  // For tool files: src/plugin/tools → dist/.opencode/plugins/foundry-tools (need ../../../.. to reach package root)
  
  // Rewrite imports that reference scripts or other package-local files
  const rewritten = content
    // Rewrite ../../scripts/ style imports to account for new depth
    .replace(/from ['"](\.\.\/)+(scripts\/[^'"]+)['"]/g, (match, dots, scriptPath) => {
      // From dist/.opencode/plugins, we need ../../../scripts/
      // From dist/.opencode/plugins/foundry-tools, we need ../../../../scripts/
      const depth = toDir.split(path.sep).length - distDir.split(path.sep).length;
      const prefix = '../'.repeat(depth);
      return `from '${prefix}${scriptPath}'`;
    })
    // Rewrite ./tools/ to ./foundry-tools/ (tools become sibling to foundry.js)
    .replace(/from ['"]\.\/tools\/([^'"]+)['"]/g, (match, toolFile) => {
      return `from './foundry-tools/${toolFile}'`;
    });

  await fs.writeFile(filePath, rewritten, 'utf-8');
}

/**
 * Main build process
 */
async function build() {
  console.log('🔨 Building Foundry plugin...\n');

  // Clean dist directory
  console.log('🧹 Cleaning dist/...');
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  // Create .opencode/plugins structure
  const pluginsDir = path.join(distDir, '.opencode', 'plugins');
  const toolsDir = path.join(pluginsDir, 'foundry-tools');
  await fs.mkdir(toolsDir, { recursive: true });

  // Copy plugin entry point
  console.log('📦 Copying plugin files...');
  const pluginSrc = path.join(srcDir, 'plugin', 'foundry.js');
  const pluginDest = path.join(pluginsDir, 'foundry.js');
  await fs.copyFile(pluginSrc, pluginDest);
  
  // Rewrite imports in main plugin file
  await rewriteImports(
    pluginDest,
    path.join(srcDir, 'plugin'),
    pluginsDir
  );

  // Copy tool files
  console.log('🔧 Copying tool files...');
  const toolsSrc = path.join(srcDir, 'plugin', 'tools');
  const toolsEntries = await fs.readdir(toolsSrc);
  
  for (const file of toolsEntries) {
    const srcPath = path.join(toolsSrc, file);
    const destPath = path.join(toolsDir, file);
    await fs.copyFile(srcPath, destPath);
    
    // Rewrite imports in each tool file
    await rewriteImports(
      destPath,
      toolsSrc,
      toolsDir
    );
  }

  // Copy skills
  console.log('📚 Copying skills...');
  const skillsSrc = path.join(srcDir, 'skills');
  const skillsDest = path.join(distDir, 'skills');
  await copyDir(skillsSrc, skillsDest);

  // Copy scripts
  console.log('📜 Copying scripts...');
  const scriptsSrc = path.join(srcDir, 'scripts');
  const scriptsDest = path.join(distDir, 'scripts');
  await copyDir(scriptsSrc, scriptsDest);

  // Copy docs (keep at root level for npm)
  console.log('📖 Copying docs...');
  const docsSrc = path.join(projectRoot, 'docs');
  const docsDest = path.join(distDir, 'docs');
  await copyDir(docsSrc, docsDest);

  // Copy root files
  console.log('📄 Copying root files...');
  const rootFiles = ['README.md', 'LICENSE', 'CHANGELOG.md'];
  for (const file of rootFiles) {
    const srcPath = path.join(projectRoot, file);
    try {
      const destPath = path.join(distDir, file);
      await fs.copyFile(srcPath, destPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      console.log(`  ⚠️  ${file} not found, skipping`);
    }
  }

  console.log('\n✅ Build complete! Output in dist/');
  console.log('\nStructure:');
  console.log('  dist/.opencode/plugins/foundry.js');
  console.log('  dist/.opencode/plugins/foundry-tools/*.js');
  console.log('  dist/skills/');
  console.log('  dist/scripts/');
  console.log('  dist/docs/');
}

// Run build
build().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
