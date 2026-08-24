import { saveAs } from 'file-saver';
import { openProject } from './project';
import { redo, undo } from '../store';

// Tauri desktop integration. Everything here is safe to call in a plain
// browser: isNative() is false there and each helper falls back to the web
// behavior (file-saver download / <input type=file>).

export function isNative(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

function filterForFilename(filename: string): FileFilter[] {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return [];
  const names: Record<string, string> = {
    slapchop: 'Slapchop Project',
    mp4: 'MP4 Video',
    webm: 'WebM Video',
    mov: 'QuickTime Movie',
    gif: 'Animated GIF',
    zip: 'ZIP Archive',
    png: 'PNG Image'
  };
  return [{ name: names[ext] ?? ext.toUpperCase(), extensions: [ext] }];
}

/**
 * Save a blob to disk: native save dialog in the desktop app, file-saver
 * download in the browser. Returns false if the user cancelled the dialog.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  if (!isNative()) {
    saveAs(blob, filename);
    return true;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({
    defaultPath: filename,
    filters: filterForFilename(filename)
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

/** Ask for a destination path without writing anything yet (ProRes export). */
export async function pickSavePath(filename: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({ defaultPath: filename, filters: filterForFilename(filename) });
}

async function fileFromPath(path: string): Promise<File> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(path);
  const name = path.split('/').pop() ?? path;
  return new File([new Uint8Array(bytes)], name);
}

export async function openProjectFromPath(path: string): Promise<void> {
  try {
    await openProject(await fileFromPath(path));
  } catch (err) {
    console.error('Failed to open project:', err);
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(err instanceof Error ? err.message : 'Failed to open project file.', {
      title: 'Could not open project',
      kind: 'error'
    });
  }
}

/** Native Open Project… dialog. No-op outside the desktop app. */
export async function openProjectViaDialog(): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Slapchop Project', extensions: ['slapchop'] }]
  });
  if (typeof path === 'string') await openProjectFromPath(path);
}

const IMAGE_EXTENSIONS = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp']);

function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Resolve dropped Finder paths to image Files. Directories are expanded one
 * level deep, so a folder of GIFs can be dropped straight onto the canvas.
 */
export async function imageFilesFromPaths(paths: string[]): Promise<File[]> {
  const { readDir, stat } = await import('@tauri-apps/plugin-fs');
  const imagePaths: string[] = [];
  for (const path of paths) {
    if (extensionOf(path) === 'slapchop') continue; // handled by the project loader
    const info = await stat(path);
    if (info.isDirectory) {
      const entries = await readDir(path);
      for (const entry of entries) {
        if (entry.isFile && IMAGE_EXTENSIONS.has(extensionOf(entry.name))) {
          imagePaths.push(`${path}/${entry.name}`);
        }
      }
    } else if (IMAGE_EXTENSIONS.has(extensionOf(path))) {
      imagePaths.push(path);
    }
  }
  imagePaths.sort();
  return Promise.all(imagePaths.map(fileFromPath));
}

/** Pick one folder and return its top-level GIF files in stable name order. */
export async function pickGifFolder(): Promise<File[] | null> {
  if (!isNative()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: true });
  if (typeof path !== 'string') return null;
  const files = await imageFilesFromPaths([path]);
  return files.filter(file => file.name.toLowerCase().endsWith('.gif'));
}

/** Pick one folder and return its top-level supported image files in name order. */
export async function pickImageFolder(): Promise<File[] | null> {
  if (!isNative()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: true });
  if (typeof path !== 'string') return null;
  return imageFilesFromPaths([path]);
}

function isEditingText(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement
    ? el.type === 'text' || el.type === 'number'
    : el instanceof HTMLTextAreaElement;
}

async function setupMenu(): Promise<void> {
  const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');
  const { saveProject } = await import('./project');

  const separator = () => PredefinedMenuItem.new({ item: 'Separator' });

  const appMenu = await Submenu.new({
    text: 'Slapchop',
    items: [
      await PredefinedMenuItem.new({ item: { About: { name: 'Slapchop' } } }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Hide', text: 'Hide Slapchop' }),
      await PredefinedMenuItem.new({ item: 'HideOthers' }),
      await PredefinedMenuItem.new({ item: 'ShowAll' }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Quit', text: 'Quit Slapchop' })
    ]
  });

  const fileMenu = await Submenu.new({
    text: 'File',
    items: [
      await MenuItem.new({
        id: 'open-project',
        text: 'Open Project…',
        accelerator: 'CmdOrCtrl+O',
        action: () => void openProjectViaDialog()
      }),
      await MenuItem.new({
        id: 'save-project',
        text: 'Save Project…',
        accelerator: 'CmdOrCtrl+S',
        action: () => void saveProject()
      }),
      await separator(),
      await MenuItem.new({
        id: 'export-animation',
        text: 'Export Animation…',
        accelerator: 'CmdOrCtrl+E',
        action: () => window.dispatchEvent(new CustomEvent('slapchop:show-export'))
      }),
      await MenuItem.new({
        id: 'export-png',
        text: 'Export PNG Frame',
        accelerator: 'Shift+CmdOrCtrl+E',
        action: () => window.dispatchEvent(new CustomEvent('slapchop:export-png'))
      })
    ]
  });

  const editMenu = await Submenu.new({
    text: 'Edit',
    items: [
      // Custom undo/redo drive the document history; while a text field is
      // focused they forward to the webview's own editing undo stack.
      await MenuItem.new({
        id: 'undo',
        text: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        action: () => (isEditingText() ? document.execCommand('undo') : undo())
      }),
      await MenuItem.new({
        id: 'redo',
        text: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        action: () => (isEditingText() ? document.execCommand('redo') : redo())
      }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Cut' }),
      await PredefinedMenuItem.new({ item: 'Copy' }),
      await PredefinedMenuItem.new({ item: 'Paste' }),
      await PredefinedMenuItem.new({ item: 'SelectAll' })
    ]
  });

  const windowMenu = await Submenu.new({
    text: 'Window',
    items: [
      await PredefinedMenuItem.new({ item: 'Minimize' }),
      await PredefinedMenuItem.new({ item: 'Maximize', text: 'Zoom' }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Fullscreen' }),
      await PredefinedMenuItem.new({ item: 'CloseWindow' })
    ]
  });

  const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, windowMenu] });
  await menu.setAsAppMenu();
}

async function drainPendingFiles(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const paths = await invoke<string[]>('take_pending_files');
  for (const path of paths) {
    await openProjectFromPath(path);
  }
}

/**
 * One-time desktop wiring: the native menu bar, plus .slapchop files opened
 * from Finder (queued in Rust until the frontend drains them here).
 */
export async function initNative(): Promise<void> {
  if (!isNative()) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen('slapchop://files-opened', () => void drainPendingFiles());
  await Promise.all([setupMenu(), drainPendingFiles()]);
}
