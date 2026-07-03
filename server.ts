// server.ts

import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import { Server as SocketServer } from "socket.io";
import { createServer as createViteServer } from "vite";
import { authRouter } from "./auth/authController";
import { registerSocketHandlers } from "./socket/gameHandler";
import { checkDatabaseConnection } from "./src/db";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Gracefully and asynchronously check database connection
  checkDatabaseConnection();

  // Basic security with helmet, disabling CSP to avoid blocking development assets and Socket.io connections
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(cors());
  app.use(express.json());

  // Mount API endpoints
  app.use("/api/auth", authRouter);

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date() });
  });

  const server = http.createServer(app);

  // Attach Socket.io with robust CORS setup
  const io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Register Socket.io events
  registerSocketHandlers(io);

  // Serve static assets or mount Vite dev middleware
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite middleware for development...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static files from /dist in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`=========================================`);
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`=========================================`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
