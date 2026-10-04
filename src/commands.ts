import type { CommandAck } from './shared/types';
import { socket } from './socket';

export function sendCommand(event: string, payload?: unknown): Promise<void> {
  if (!socket.connected) return Promise.reject(new Error('Disconnected. Reconnect, then press the control again.'));
  return new Promise((resolve,reject) => {
    const done = (error: Error | null, result: CommandAck) => {
      if (error) {
        socket.emit('program:get-state');
        reject(new Error('No confirmation received. Check Program before trying again.'));
      } else if (!result?.ok) reject(new Error(result?.error ?? 'Command failed.'));
      else resolve();
    };
    // Commands expire and are never buffered for a later reconnection.
    if (payload === undefined) socket.timeout(4000).volatile.emit(event, done);
    else socket.timeout(4000).volatile.emit(event, payload, done);
  });
}
