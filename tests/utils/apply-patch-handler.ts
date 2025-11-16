import * as fs from 'fs';
import * as path from 'path';
import { applyDiff_v4a } from 'aiwrapper';

/**
 * Factory for a test-only apply_patch handler / patch harness.
 *
 * It implements the Editor-like behavior described in OpenAI docs:
 * - create_file: uses V4A diff in "create" mode to generate file content
 * - update_file: applies V4A diff on top of existing content (or empty string)
 * - delete_file: removes the file if it exists
 *
 * The handler returns { status, output } objects that are suitable
 * to be mapped into apply_patch_call_output events.
 */
export function createTestApplyPatchHandler(rootDir: string) {
  return async (args: Record<string, any>): Promise<{ status: string; output: string }> => {
    const { operation } = args;
    if (!operation || !operation.type || !operation.path) {
      return {
        status: 'failed',
        output: 'Invalid operation: missing type or path',
      };
    }

    const filePath = path.join(rootDir, operation.path);

    try {
      // Ensure target directory exists before writing
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      if (operation.type === 'create_file') {
        const content = applyDiff_v4a('', operation.diff, 'create');
        fs.writeFileSync(filePath, content, 'utf-8');
        return {
          status: 'completed',
          output: `Created ${operation.path}`,
        };
      }

      if (operation.type === 'update_file') {
        const current = fs.existsSync(filePath)
          ? fs.readFileSync(filePath, 'utf-8')
          : '';
        const updated = applyDiff_v4a(current, operation.diff);
        fs.writeFileSync(filePath, updated, 'utf-8');
        return {
          status: 'completed',
          output: `Updated ${operation.path}`,
        };
      }

      if (operation.type === 'delete_file') {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return {
          status: 'completed',
          output: `Deleted ${operation.path}`,
        };
      }

      return {
        status: 'failed',
        output: `Unknown operation type: ${operation.type}`,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        output: `Error: ${error.message}`,
      };
    }
  };
}

/**
 * Convenience: full apply_patch tool object for tests.
 *
 * Returns a LangToolWithHandler-compatible object:
 *   { name, description, parameters, handler }
 */
export function createTestApplyPatchTool(rootDir: string) {
  return {
    name: 'apply_patch',
    handler: createTestApplyPatchHandler(rootDir),
  };
}

/**
 * Factory for a test-only read_file handler.
 *
 * It reads a text file relative to rootDir and returns its contents
 * as the output string. Useful for agent / tool tests that need
 * a simple "read_file" tool.
 *
 * Expected args shape:
 *   { path: string }  // relative to rootDir
 */
export function createTestReadFileHandler(rootDir: string) {
  return async (
    args: Record<string, any>,
  ): Promise<{ status: string; output: string }> => {
    const relPath = typeof args.path === 'string' ? args.path : undefined;
    if (!relPath) {
      return {
        status: 'failed',
        output: 'Invalid arguments: "path" must be a non-empty string',
      };
    }

    const filePath = path.join(rootDir, relPath);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        status: 'completed',
        output: content,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        output: `Error reading file "${relPath}": ${error.message}`,
      };
    }
  };
}

/**
 * Convenience: full read_file tool object for tests.
 *
 * Returns a LangToolWithHandler-compatible object:
 *   { name, description, parameters, handler }
 */
export function createTestReadFileTool(rootDir: string) {
  return {
    name: 'read_file',
    description: 'Read a text file and return its contents as a string',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file to read, from the test rootDir',
        },
      },
      required: ['path'],
    },
    handler: createTestReadFileHandler(rootDir),
  };
}


