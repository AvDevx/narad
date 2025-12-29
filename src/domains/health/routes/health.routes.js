import { Elysia } from "elysia";
import { redisService } from "../../../services/redis.js";
import { kafkaService } from "../../../services/kafka.js";
import { userConnectionManager } from "../../../services/userConnectionManager.js";
import { messageRoutingService } from "../../../services/messageRoutingService.js";

export const healthRoutes = new Elysia({ prefix: "/health" })
  .get("/", async () => {
    const redisHealth = await redisService.healthCheck();
    const kafkaHealth = await checkKafkaHealth();
    const wsConnections = userConnectionManager.getConnectionStats();
    
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealth,
        kafka: kafkaHealth,
        websocket: {
          status: "active",
          connections: wsConnections
        },
        messageRouter: {
          status: messageRoutingService.isRunning() ? "running" : "stopped"
        }
      },
    };
  })
  .get("/ready", async () => {
    const redisHealth = await redisService.healthCheck();
    const kafkaHealth = await checkKafkaHealth();
    const isReady = redisHealth.status === "connected" && kafkaHealth.status !== "error";
    
    return {
      status: isReady ? "ready" : "not ready",
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealth,
        kafka: kafkaHealth,
      },
    };
  })
  .get("/live", () => ({
    status: "live",
    timestamp: new Date().toISOString(),
  }))
  .get("/kafka", async () => {
    return await checkKafkaHealth();
  })
  .get("/websockets", () => {
    const stats = userConnectionManager.getConnectionStats();
    const connectedUsers = userConnectionManager.getConnectedUsers();
    
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      stats,
      connectedUsers: connectedUsers.map(user => ({
        userId: user.userId,
        connectionCount: user.connections?.length || 0,
        lastSeen: user.lastSeen
      }))
    };
  })
  .get("/test-message/:userId", async ({ params: { userId } }) => {
    try {
      const testMessage = {
        type: "test",
        message: "Health check test message",
        timestamp: new Date().toISOString()
      };
      
      await messageRoutingService.sendMessageToUser(userId, testMessage, "test");
      
      return {
        success: true,
        message: `Test message sent to user ${userId}`,
        data: testMessage
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });

// Helper function to check Kafka health
async function checkKafkaHealth() {
  try {
    if (!kafkaService.isConnected) {
      return {
        status: "disconnected",
        message: "Kafka producer not connected",
        isDevMode: process.env.NODE_ENV !== "production"
      };
    }
    
    return {
      status: "connected",
      message: "Kafka producer is connected"
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message
    };
  }
}
