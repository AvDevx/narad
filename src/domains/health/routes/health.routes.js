import { Elysia } from "elysia";
import { redisService } from "../../../services/redis.js";

export const healthRoutes = new Elysia({ prefix: "/health" })
  .get("/", async () => {
    const redisHealth = await redisService.healthCheck();
    
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealth,
      },
    };
  })
  .get("/ready", async () => {
    const redisHealth = await redisService.healthCheck();
    const isReady = redisHealth.status === "connected";
    
    return {
      status: isReady ? "ready" : "not ready",
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealth,
      },
    };
  })
  .get("/live", () => ({
    status: "live",
    timestamp: new Date().toISOString(),
  }));
