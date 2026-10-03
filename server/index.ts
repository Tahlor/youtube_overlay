import http from "node:http";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import type { Asset, CommandAck, ProgramState } from "../src/shared/types.js";
import { ProgramStore } from "./programState.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const program = new ProgramStore();

app.disable("x-powered-by");
app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true, revision: program.getState().revision });
});

const webDist = path.resolve(process.cwd(), "dist");
app.use(express.static(webDist));
app.get(["/director", "/output"], (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

io.on("connection", (socket) => {
  socket.emit("program:state", program.getState());

  socket.on(
    "program:set-video",
    (payload: { videoId?: unknown }, ack?: (result: CommandAck) => void) => {
      runCommand(ack, () => {
        if (typeof payload?.videoId !== "string") {
          throw new Error("videoId must be a string.");
        }
        return program.setVideo(payload.videoId);
      });
    },
  );

  socket.on(
    "program:take",
    (payload: { asset?: Asset }, ack?: (result: CommandAck) => void) => {
      runCommand(ack, () => program.take(payload?.asset as Asset));
    },
  );

  socket.on("program:live", (ack?: (result: CommandAck) => void) => {
    runCommand(ack, () => program.goLive());
  });
});

function runCommand(
  ack: ((result: CommandAck) => void) | undefined,
  command: () => ProgramState,
): void {
  try {
    const next = command();
    io.emit("program:state", next);
    ack?.({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command failed.";
    ack?.({ ok: false, error: message });
  }
}

httpServer.listen(port, host, () => {
  console.log(`YouTube Overlay server listening on http://${host}:${port}`);
});
