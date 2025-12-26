import { kafkaService } from "./services/kafka.js";
import { config } from "./config/env.js";
import { createApp } from "./app/index.js";

// Initialize Kafka
await kafkaService.connectProducer();

// // Send test message to confirm connection
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
  process.exit(0);
});
