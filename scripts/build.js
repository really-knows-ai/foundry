#!/usr/bin/env node
/**
 * Build script for Foundry plugin.
 * 
 * Transforms src/ structure into dist/ with the .opencode convention:
 * - src/plugin/foundry.js → dist/.opencode/plugins/foundry.js
 * - src/plugin/tools/*.js → dist/.opencode/plugins/foundry-tools/*.js
 * - src/skills/ → dist/skills/
 * - src/agents/ → dist/agents/
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
  
  // Calculate depth: how many ../ to go from the destination directory
  // back to the package root (dist/ directory)
  const distDirSegments = distDir.split(path.sep).length;
  const toDirSegments = toDir.split(path.sep).length;
  const depth = toDirSegments - distDirSegments;
  const prefix = '../'.repeat(depth);
  
  let rewritten = content;
  
  // Rewrite static imports: from '../../scripts/...' → depth-adjusted path
  rewritten = rewritten.replace(
    /from ['"](\.\.\/)+(scripts\/[^'"]+)['"]/g,
    (_match, _dots, scriptPath) => `from '${prefix}${scriptPath}'`
  );
  // Rewrite dynamic imports: import('../../scripts/...') → depth-adjusted path
  rewritten = rewritten.replace(
    /import\(['"](\.\.\/)+(scripts\/[^'"]+)['"]\)/g,
    (_match, _dots, scriptPath) => `import('${prefix}${scriptPath}')`
  );
  // Rewrite ./tools/ to ./foundry-tools/ (tools become sibling to foundry.js)
  rewritten = rewritten.replace(
    /from ['"]\.\/tools\/([^'"]+)['"]/g,
    (match, toolFile) => `from './foundry-tools/${toolFile}'`
  );

  await fs.writeFile(filePath, rewritten, 'utf-8');
}

/**
 * Main build process
 */
async function cleanDist() {
  console.log('🧹 Cleaning dist/...');
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyPluginEntryPoint(pluginsDir) {
  console.log('📦 Copying plugin files...');
  const pluginSrc = path.join(srcDir, 'plugin', 'foundry.js');
  const pluginDest = path.join(pluginsDir, 'foundry.js');
  await fs.copyFile(pluginSrc, pluginDest);
  await rewriteImports(pluginDest, path.join(srcDir, 'plugin'), pluginsDir);
}

async function copyToolFiles(toolsDir) {
  console.log('🔧 Copying tool files...');
  const toolsSrc = path.join(srcDir, 'plugin', 'tools');
  const toolsEntries = await fs.readdir(toolsSrc);

  for (const file of toolsEntries) {
    const srcPath = path.join(toolsSrc, file);
    const destPath = path.join(toolsDir, file);
    await fs.copyFile(srcPath, destPath);
    await rewriteImports(destPath, toolsSrc, toolsDir);
  }
}

async function copyTopLevelTrees() {
  console.log('📚 Copying skills...');
  await copyDir(path.join(srcDir, 'skills'), path.join(distDir, 'skills'));

  console.log('🤖 Copying agents...');
  await copyDir(path.join(srcDir, 'agents'), path.join(distDir, 'agents'));

  console.log('📜 Copying scripts...');
  await copyDir(path.join(srcDir, 'scripts'), path.join(distDir, 'scripts'));

  console.log('📖 Copying docs...');
  await copyDir(path.join(projectRoot, 'docs'), path.join(distDir, 'docs'));
}

async function copyRootFile(file) {
  const srcPath = path.join(projectRoot, file);
  try {
    await fs.copyFile(srcPath, path.join(distDir, file));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.log(`  ⚠️  ${file} not found, skipping`);
  }
}

async function copyRootFiles() {
  console.log('📄 Copying root files...');
  const rootFiles = ['README.md', 'LICENSE', 'CHANGELOG.md'];
  for (const file of rootFiles) {
    await copyRootFile(file);
  }
}

function printSummary() {
  console.log('\n✅ Build complete! Output in dist/');
  console.log('\nStructure:');
  console.log('  dist/.opencode/plugins/foundry.js');
  console.log('  dist/.opencode/plugins/foundry-tools/*.js');
  console.log('  dist/skills/');
  console.log('  dist/agents/');
  console.log('  dist/scripts/');
  console.log('  dist/docs/');
}

async function build() {
  console.log('🔨 Building Foundry plugin...\n');

  await cleanDist();

  const pluginsDir = path.join(distDir, '.opencode', 'plugins');
  const toolsDir = path.join(pluginsDir, 'foundry-tools');
  await fs.mkdir(toolsDir, { recursive: true });

  await copyPluginEntryPoint(pluginsDir);
  await copyToolFiles(toolsDir);
  await copyTopLevelTrees();
  await copyRootFiles();

  printSummary();
}

// Run build
build().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
