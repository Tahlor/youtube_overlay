import { appPath } from './basePath';
import { socket } from './socket';

interface DirectorClaimResponse {
  ok?: boolean;
  user?: string;
  error?: string;
}

/**
 * Bind the current public Socket.IO connection to the Webapps/SSO identity on
 * the authenticated HTTP request. No reusable Director secret is exposed to JS.
 */
export async function claimDirectorSocket(): Promise<string> {
  if (!socket.connected || !socket.id) throw new Error('Director connection is offline. Reconnect and try again.');
  const socketId = socket.id;
  const response = await fetch(appPath('api/director/claim'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ socketId }),
  });
  let data: DirectorClaimResponse = {};
  try { data = await response.json() as DirectorClaimResponse; } catch { /* nginx may return a non-JSON auth error */ }
  if (!response.ok || !data.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Webapps sign-in is required for Director access.');
    throw new Error(data.error || 'Director access could not be confirmed. Reconnect and try again.');
  }
  if (socket.id !== socketId) throw new Error('Director connection changed while signing in. Reconnect and try again.');
  return data.user || 'Director';
}
