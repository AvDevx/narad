import { kafkaService } from "./services/kafka.js";
import { redisService } from "./services/redis.js";
import { config } from "./config/env.js";
import { createApp } from "./app/index.js";

// Initialize services
console.log("🔌 Initializing services...");

// Initialize Kafka
await kafkaService.connectProducer();

// Initialize Redis
await redisService.connect();

// Send test message to confirm Kafka connection
await kafkaService.send("websocket", {
  type: "server-status",
  message: "server is connected",
  timestamp: new Date().toISOString(),
});

// Create and start app
const app = createApp().listen(config.server.port);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log(`WebSocket available at ws://${app.server?.hostname}:${app.server?.port}/ws`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await kafkaService.disconnect();
  await redisService.disconnect();
  process.exit(0);
});
