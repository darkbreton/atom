import { useEffect, useRef, useState } from 'react';
import {
  requestAccessToken,
  revokeAccessToken,
  listFitFiles,
  downloadFile,
  isUnauthenticated,
} from './drive';
import type { DriveFileMeta } from './drive';

export type DriveStatus = 'idle' | 'signing-in' | 'listing' | 'ready';

interface UseDriveConfig {
  clientId?: string;
  apiKey?: string;
  folderId?: string;
  onFileBytes: (bytes: ArrayBuffer, fileName: string) => void | Promise<void>;
}

export interface UseDriveResult {
  configured: boolean;
  token: string | null;
  files: DriveFileMeta[];
  status: DriveStatus;
  error: string;
  loadingId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  loadFile: (file: DriveFileMeta) => Promise<void>;
}

export const useDrive = ({
  clientId,
  apiKey,
  folderId,
  onFileBytes,
}: UseDriveConfig): UseDriveResult => {
  const configured = Boolean(clientId && apiKey && folderId);

  const [token, setToken] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFileMeta[]>([]);
  const [status, setStatus] = useState<DriveStatus>('idle');
  const [error, setError] = useState<string>('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const autoLoadedRef = useRef<boolean>(false);
  const onFileBytesRef = useRef(onFileBytes);
  onFileBytesRef.current = onFileBytes;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const loadFile = async (file: DriveFileMeta): Promise<void> => {
    const activeToken = tokenRef.current;
    if (!activeToken || !apiKey) return;
    setError('');
    setLoadingId(file.id);
    try {
      const bytes = await downloadFile({ token: activeToken, apiKey, fileId: file.id });
      await onFileBytesRef.current(bytes, file.name);
    } catch (err) {
      if (isUnauthenticated(err)) {
        setToken(null);
        setFiles([]);
        setStatus('idle');
      }
      setError(err instanceof Error ? err.message : 'Could not load the file.');
    } finally {
      setLoadingId(null);
    }
  };

  const signIn = async (): Promise<void> => {
    if (!clientId || !apiKey || !folderId) return;
    setError('');
    setStatus('signing-in');
    try {
      const nextToken = await requestAccessToken({ clientId });
      setToken(nextToken);
      autoLoadedRef.current = false;
      setFiles([]);
      setStatus('listing');
      const list = await listFitFiles({
        token: nextToken,
        apiKey,
        folderId,
        onPage: (accum) => setFiles(accum),
      });
      setFiles(list);
      setStatus('ready');
    } catch (err) {
      setStatus('idle');
      setToken(null);
      setFiles([]);
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const signOut = async (): Promise<void> => {
    if (token) {
      try {
        await revokeAccessToken(token);
      } catch {
        /* ignore */
      }
    }
    setToken(null);
    setFiles([]);
    setStatus('idle');
    setError('');
    autoLoadedRef.current = false;
  };

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!files.length) return;
    autoLoadedRef.current = true;
    void loadFile(files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  return { configured, token, files, status, error, loadingId, signIn, signOut, loadFile };
};
