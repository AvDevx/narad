import { Elysia } from "elysia";
import { websocketRoutes } from "./routes/websocket.routes.js";
import { messagingApiRoutes } from "./routes/messaging-api.routes.js";

// Combine all messaging routes
const messagingRoutes = new Elysia()
  .use(websocketRoutes)
  .use(messagingApiRoutes);

export const messagingDomain = {
  routes: messagingRoutes,
};
