import { io } from "socket.io-client";
import { socketPath } from "./basePath";

export const socket = io({
  autoConnect: true,
  path: socketPath,
  transports: ["websocket", "polling"],
});
