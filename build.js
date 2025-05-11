#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { glob } from 'glob';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Get all TypeScript files
async function getEntryPoints() {
  return await glob('src/**/*.ts');
}

// Make sure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

async function build() {
  console.log('🔨 Build with esbuild for Node.js, Deno and browsers compatibility...');
  
  const entryPoints = await getEntryPoints();
  console.log(`Found ${entryPoints.length} TypeScript files to build.`);
  
  try {
    // Build with esbuild for Node.js (with .js extensions in imports)
    console.log('📦 Building...');
    
    const result = await esbuild.build({
      entryPoints,
      outdir: 'dist',
      bundle: false, // We want to preserve the file structure
      sourcemap: true,
      platform: 'neutral',
      format: 'esm',
      target: 'es2017',
      outExtension: { '.js': '.js' },
      treeShaking: true
    });
    
    console.log('✅ Build completed successfully.');
    
    // Fix imports in the output files to use .js extension
    console.log('🔧 Adding .js extensions to imports for Node.js compatibility...');
    const jsFiles = await glob('dist/**/*.js');
    for (const file of jsFiles) {
      let content = await fs.promises.readFile(file, 'utf8');
      // Replace imports that have .ts extensions with .js extensions
      content = content.replace(/from ['"]([\.\/][^"']+)\.ts['"]/g, 'from "$1.js"');
      // Replace imports without extension to add .js
      content = content.replace(/from ['"]([\.\/][^"']+)(?<!\.js)['"];/g, 'from "$1.js";');
      await fs.promises.writeFile(file, content);
    }
    
    // Generate TypeScript declaration files using tsc with allowImportingTsExtensions
    console.log('📝 Generating TypeScript declarations...');
    execSync('npx tsc --declaration --emitDeclarationOnly --outDir dist', { stdio: 'inherit' });
    
    console.log('🎉 Build and post-processing completed successfully.');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build(); 