/**
 * Saving the map: File System Access API (Chromium) writes both checked-in
 * copies in place once the user has picked the repo root; other browsers get
 * a download + a note to run sync_map.py.
 */
import { BoardMap } from '../engine/board-canvas';

// Minimal typings — the File System Access API isn't in the default TS lib set.
interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
  name: string;
}
interface FileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

const MAP_PATHS = [
  ['infrastructure', 'lambda', 'map.json'],
  ['public', 'data', 'undercity-map.json'],
];

export function fsAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

/** Ask for the repo root. Returns null if unsupported or the user cancels. */
export async function pickRepoRoot(): Promise<DirHandle | null> {
  if (!fsAccessSupported()) return null;
  try {
    const root = (await (
      window as unknown as {
        showDirectoryPicker(o: { mode: string }): Promise<DirHandle>;
      }
    ).showDirectoryPicker({ mode: 'readwrite' })) as DirHandle;
    // Sanity check that this really is the repo: both target files must exist.
    for (const parts of MAP_PATHS) {
      await resolveFile(root, parts);
    }
    return root;
  } catch {
    return null; // cancelled, or the folder isn't the repo root
  }
}

async function resolveFile(root: DirHandle, parts: string[]): Promise<FileHandle> {
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return dir.getFileHandle(parts[parts.length - 1]);
}

export function serializeMap(doc: BoardMap): string {
  return JSON.stringify(doc, null, 1);
}

/** Write both checked-in copies (identical bytes — the pytest checks). */
export async function saveMap(root: DirHandle, doc: BoardMap): Promise<void> {
  const json = serializeMap(doc);
  for (const parts of MAP_PATHS) {
    const fh = await resolveFile(root, parts);
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
  }
}

/** Fallback: download map.json; drop it in infrastructure/lambda/ + sync_map.py. */
export function downloadMap(doc: BoardMap): void {
  const blob = new Blob([serializeMap(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'map.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Every image under public/undercity/, as app-relative paths for decals. */
export async function listUndercityImages(root: DirHandle): Promise<string[]> {
  const out: string[] = [];
  const pub = await root.getDirectoryHandle('public');
  const base = await pub.getDirectoryHandle('undercity');
  await walk(base, 'undercity', out);
  return out.sort();
}

async function walk(dir: DirHandle, prefix: string, out: string[]): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      await walk(await dir.getDirectoryHandle(entry.name), `${prefix}/${entry.name}`, out);
    } else if (/\.(png|webp|jpg|jpeg)$/i.test(entry.name)) {
      out.push(`${prefix}/${entry.name}`);
    }
  }
}
