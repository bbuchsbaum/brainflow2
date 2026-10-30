import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';

export interface FileNode {
  id: string;
  name: string;
  isDir: boolean;
  parentIdx: number | null;
  iconId: number;
  /** File size in bytes; null for directories or when unknown. */
  size?: number | null;
  /** Last modification time, ms since the Unix epoch, when known. */
  modifiedMs?: number | null;
}

export class FilesystemService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async listDirectory(path: string, maxDepth = 1): Promise<FileNode[]> {
    const result = await this.transport.invoke<{ nodes: FileNode[] }>(
      'fs_list_directory',
      { path, maxDepth }
    );
    return result.nodes;
  }
}

let instance: FilesystemService | null = null;

export function getFilesystemService(): FilesystemService {
  if (!instance) {
    instance = new FilesystemService();
  }
  return instance;
}

export function resetFilesystemService(): void {
  instance = null;
}
