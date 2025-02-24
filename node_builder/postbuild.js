import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(__dirname, '..');
const tsconfig = JSON.parse(fs.readFileSync(path.resolve(repoRootDir, 'tsconfig.json'), 'utf8'));
const tempSourceDir = path.join(repoRootDir, tsconfig.compilerOptions.rootDir);
if (tempSourceDir === repoRootDir) {
  throw new Error('The temp source directory (rootDir) is the same as the actual root directory of the repository. This is not allowed.');
}
const srcDir = path.join(repoRootDir, tsconfig.compilerOptions.outDir);

const addJsExtensionToBuild = () => {
  const files = glob.sync(`${srcDir}/**/*.js`);
  files.forEach((filePath) => {
    // Skip if the file is the entry for NPM package.
    // We don't need to mess with it.
    if (path.basename(filePath) === 'nodeEntry.js') {
      return;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    content = content.replace(/from ['"]([\.\/][^"']+)(?<!\.js)['"]/g, (match, p1) => {
      const importWithExtension = `from "${p1}.js"`;
      return importWithExtension;
    });

    fs.writeFileSync(filePath, content);
  });
};

const cleanOutTempSourceDir = async () => {
  if (srcDir === repoRootDir) {
    return;
  }

  try {
    await fs.promises.access(tempSourceDir);
    await fs.promises.rm(tempSourceDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const postbuild = async () => {
  console.log("FINAL STEPS. Adding .js extension to build files because it's required for ES6 modules...");
  addJsExtensionToBuild();
  console.log("Removing the temp build folder...");
  await cleanOutTempSourceDir();

  console.log("🥳 🎉 🍾  JavaScript build is ready to use from: ", srcDir);
};

(async () => {
  await postbuild();
})();