import { io } from "socket.io-client";
import { socketPath } from "./basePath";

export const socket = io({
  autoConnect: false,
  path: socketPath,
  transports: ["websocket", "polling"],
});
