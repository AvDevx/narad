import { kafkaService } from "./services/system/kafka.js";
import { redisService } from "./services/system/redis.js";
import { messageRoutingService } from "./services/messageRoutingService.js";
import { config } from "./config/env.js";
import { createApp } from "./app/index.js";

// Initialize services
console.log("🔌 Initializing services...");

try {
  // Initialize Kafka Producer
  await kafkaService.connectProducer();

  // Initialize Redis
  await redisService.connect();

  // Initialize Message Routing Service (includes Kafka Consumer)
  await messageRoutingService.start();

  console.log("✅ All services initialized successfully");
} catch (error) {
  console.error("❌ Service initialization failed:", error.message);
  console.log("⚠️  Server will continue without failed services");
}

// Create and start app
const app = createApp().listen(config.server.port);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log(`WebSocket available at ws://${app.server?.hostname}:${app.server?.port}/ws`);
console.log(`API available at http://${app.server?.hostname}:${app.server?.port}/api/messaging`);
console.log(`📚 API Documentation at http://${app.server?.hostname}:${app.server?.port}/swagger`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await messageRoutingService.stop();
  await kafkaService.disconnect();
  await redisService.disconnect();
  process.exit(0);
});
