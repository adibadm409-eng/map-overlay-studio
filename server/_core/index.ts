import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";

async function serveGoogleMapsScript(req: express.Request, res: express.Response) {
  try {
    const baseUrl = ENV.forgeApiUrl?.replace(/\/+$/, "");
    const apiKey = process.env.VITE_FRONTEND_FORGE_API_KEY;
    if (!baseUrl || !apiKey) {
      res.status(503).type("text/plain").send("Google Maps integration is unavailable.");
      return;
    }

    const url = new URL("/v1/maps/proxy/maps/api/js", baseUrl);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("v", typeof req.query.v === "string" ? req.query.v : "weekly");
    url.searchParams.set(
      "libraries",
      typeof req.query.libraries === "string" ? req.query.libraries : "marker,places,geocoding,geometry",
    );
    const requestOrigin = req.get("origin") || `${req.protocol}://${req.get("host")}`;
    const upstream = await fetch(url, { headers: { Origin: requestOrigin } });
    const script = await upstream.text();
    res.status(upstream.status).type("application/javascript").send(script);
  } catch (error) {
    console.error("[Maps] Failed to retrieve Google Maps JavaScript:", error);
    res.status(502).type("text/plain").send("Unable to retrieve Google Maps JavaScript.");
  }
}

async function serveGoogleStaticMap(req: express.Request, res: express.Response) {
  try {
    const baseUrl = ENV.forgeApiUrl?.replace(/\/+$/, "");
    const apiKey = ENV.forgeApiKey;
    const lat = typeof req.query.lat === "string" ? req.query.lat : "";
    const lng = typeof req.query.lng === "string" ? req.query.lng : "";
    const zoom = typeof req.query.zoom === "string" ? req.query.zoom : "14";
    const width = Math.min(1280, Math.max(320, Number(req.query.width) || 1280));
    const height = Math.min(1280, Math.max(320, Number(req.query.height) || 960));
    if (!baseUrl || !apiKey || !lat || !lng) {
      res.status(400).type("text/plain").send("Static map parameters are incomplete.");
      return;
    }
    const url = new URL("/v1/maps/proxy/maps/api/staticmap", baseUrl);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("center", `${lat},${lng}`);
    url.searchParams.set("zoom", zoom);
    url.searchParams.set("size", `${width}x${height}`);
    url.searchParams.set("scale", "2");
    url.searchParams.set("maptype", "hybrid");
    url.searchParams.set("format", "png");
    const requestOrigin = req.get("origin") || `${req.protocol}://${req.get("host")}`;
    const upstream = await fetch(url, { headers: { Origin: requestOrigin } });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).type(upstream.headers.get("content-type") || "image/png").send(bytes);
  } catch (error) {
    console.error("[Maps] Failed to retrieve static map:", error);
    res.status(502).type("text/plain").send("Unable to retrieve static map.");
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/maps/javascript", serveGoogleMapsScript);
  app.get("/api/maps/static", serveGoogleStaticMap);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
