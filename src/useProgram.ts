import { useEffect, useState } from "react";
import type { ProgramState } from "./shared/types";
import { socket } from "./socket";

const initialState: ProgramState = {
  videoId: null,
  mode: "live",
  activeAsset: null,
  revision: 0,
};

export function useProgram() {
  const [program, setProgram] = useState<ProgramState>(initialState);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onState = (next: ProgramState) => setProgram(next);
    const requestState = () => socket.emit("program:get-state");
    const onConnect = () => {
      setConnected(true);
      requestState();
    };
    const onDisconnect = () => setConnected(false);

    socket.on("program:state", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    if (socket.connected) {
      setConnected(true);
      requestState();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("program:state", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return { program, connected };
}
