const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let gisPromise = null;

export const loadGoogleIdentityServices = () => {
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
    const onLoad = () => resolve(window.google);
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

export const requestAccessToken = async ({ clientId }) => {
  const google = await loadGoogleIdentityServices();
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
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

export const revokeAccessToken = async (token) => {
  const google = await loadGoogleIdentityServices();
  return new Promise((resolve) => {
    google.accounts.oauth2.revoke(token, resolve);
  });
};

const driveFetch = async (url, { token, apiKey, accept }) => {
  const sep = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${sep}key=${encodeURIComponent(apiKey)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(accept ? { Accept: accept } : {}),
    },
  });
  if (response.status === 401) {
    throw Object.assign(new Error('Drive session expired. Sign in again.'), { code: 'UNAUTHENTICATED' });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Drive API ${response.status}: ${text || response.statusText}`);
  }
  return response;
};

export const listFitFiles = async ({ token, apiKey, folderId }) => {
  const q = [
    `'${folderId}' in parents`,
    "trashed = false",
    "name contains '.fit'",
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
  });
  const response = await driveFetch(`${DRIVE_API}?${params}`, { token, apiKey });
  const data = await response.json();
  return (data.files || []).filter((file) => file.name.toLowerCase().endsWith('.fit'));
};

export const downloadFile = async ({ token, apiKey, fileId }) => {
  const response = await driveFetch(
    `${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`,
    { token, apiKey },
  );
  return response.arrayBuffer();
};
