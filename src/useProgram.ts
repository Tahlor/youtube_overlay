import { useCallback, useEffect, useState } from "react";
import type { ProgramState, OutputPlayback, PlaybackSample } from "./shared/types";
import { socket } from "./socket";
import { DEFAULT_PRESENTATION } from "./shared/presentation";

const initialState: ProgramState = {
  videoId: null,
  mode: "live",
  activeAsset: null,
  revision: 0,
  playback: { status: "playing", position: null, updatedAt: 0, revision: 0 },
  presentation: { ...DEFAULT_PRESENTATION },
};

export function useProgram() {
  const [program, setProgram] = useState<ProgramState>(initialState);
  const [connected, setConnected] = useState(socket.connected);
  const [clockOffset, setClockOffset] = useState(0);
  const [outputPlayback, setOutputPlayback] = useState<OutputPlayback | null>(null);

  useEffect(() => {
    const onState = (next: ProgramState, serverNow?: number) => {
      setProgram(next);
      if (typeof serverNow === 'number') setClockOffset(serverNow - Date.now());
    };
    const onOutput = (sample: OutputPlayback | null) => setOutputPlayback(sample);
    const syncClock = () => {
      if (!socket.connected) return;
      const sent = Date.now();
      socket.timeout(3000).emit('program:clock', (error: Error | null, serverNow: number) => {
        if (!error && Number.isFinite(serverNow)) setClockOffset(serverNow - (sent + Date.now()) / 2);
      });
    };
    const requestState = () => socket.emit("program:get-state");
    const onConnect = () => {
      setConnected(true);
      requestState();
      syncClock();
    };
    const onDisconnect = () => setConnected(false);

    socket.on("program:state", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on('playback:output', onOutput);
    const timer = window.setInterval(syncClock, 30000);

    if (socket.connected) {
      setConnected(true);
      requestState();
      syncClock();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("program:state", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off('playback:output', onOutput);
      clearInterval(timer);
    };
  }, []);

  const reportPlayback = useCallback((sample: PlaybackSample) => {
    if (socket.connected) socket.volatile.emit('playback:report', sample);
  }, []);
  return { program, connected, clockOffset, outputPlayback, reportPlayback };
}
