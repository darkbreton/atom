const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

interface DriveAuthArgs {
  token: string;
  apiKey: string;
}

interface DriveFetchOptions extends DriveAuthArgs {
  accept?: string;
}

let gisPromise: Promise<GoogleNamespace> | null = null;

export const loadGoogleIdentityServices = (): Promise<GoogleNamespace> => {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Drive integration needs a browser.'));
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve(window.google);
      return;
    }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    const onLoad = () => {
      if (window.google) resolve(window.google);
      else reject(new Error('Google Identity Services loaded but window.google is missing.'));
    };
    const onError = () => reject(new Error('Could not load Google Identity Services.'));
    if (existing) {
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', onError);
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    document.head.appendChild(script);
  });
  return gisPromise;
};

export const requestAccessToken = async ({ clientId }: { clientId: string }): Promise<string> => {
  const google = await loadGoogleIdentityServices();
  return new Promise<string>((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'No access token returned.'));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err?.message || 'Sign-in was cancelled.'));
      },
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
};

export const revokeAccessToken = async (token: string): Promise<void> => {
  const google = await loadGoogleIdentityServices();
  return new Promise<void>((resolve) => {
    google.accounts.oauth2.revoke(token, () => resolve());
  });
};

class DriveUnauthenticatedError extends Error {
  code: 'UNAUTHENTICATED' = 'UNAUTHENTICATED';
  constructor(message: string) {
    super(message);
  }
}

const driveFetch = async (
  url: string,
  { token, apiKey, accept }: DriveFetchOptions,
): Promise<Response> => {
  const sep = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${sep}key=${encodeURIComponent(apiKey)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(accept ? { Accept: accept } : {}),
    },
  });
  if (response.status === 401) {
    throw new DriveUnauthenticatedError('Drive session expired. Sign in again.');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Drive API ${response.status}: ${text || response.statusText}`);
  }
  return response;
};

interface ListFitFilesArgs extends DriveAuthArgs {
  folderId: string;
  orderBy?: string;
  onPage?: (files: DriveFileMeta[]) => void;
}

interface DriveListResponse {
  files?: DriveFileMeta[];
  nextPageToken?: string;
}

export const listFitFiles = async ({
  token,
  apiKey,
  folderId,
  orderBy = 'name desc',
  onPage,
}: ListFitFilesArgs): Promise<DriveFileMeta[]> => {
  const q = [`'${folderId}' in parents`, 'trashed = false', "name contains '.fit'"].join(' and ');
  const all: DriveFileMeta[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name,modifiedTime,size)',
      orderBy,
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveFetch(`${DRIVE_API}?${params}`, { token, apiKey });
    const data = (await response.json()) as DriveListResponse;
    const filtered = (data.files || []).filter((file) => file.name.toLowerCase().endsWith('.fit'));
    all.push(...filtered);
    if (onPage) onPage(all.slice());
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return all;
};

interface DownloadFileArgs extends DriveAuthArgs {
  fileId: string;
}

export const downloadFile = async ({
  token,
  apiKey,
  fileId,
}: DownloadFileArgs): Promise<ArrayBuffer> => {
  const response = await driveFetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`, {
    token,
    apiKey,
  });
  return response.arrayBuffer();
};

export const isUnauthenticated = (err: unknown): boolean =>
  err instanceof DriveUnauthenticatedError ||
  (err instanceof Error && (err as { code?: string }).code === 'UNAUTHENTICATED');
