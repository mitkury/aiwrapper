import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function resolveTestAsset(importMetaUrl: string, ...segments: string[]): string {
  const __filename = fileURLToPath(importMetaUrl);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, ...segments);
}

export async function readImageBase64(importMetaUrl: string, ...segments: string[]): Promise<{ base64: string; mimeType: string; absPath: string }>
{
  const absPath = resolveTestAsset(importMetaUrl, ...segments);
  const base64 = (await readFile(absPath)).toString('base64');
  const mimeType = guessMimeTypeFromPath(absPath);
  return { base64, mimeType, absPath };
}

export function toDataUrl(base64: string, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${base64}`;
}

function guessMimeTypeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}


