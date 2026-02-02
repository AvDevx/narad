import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { redisService } from "../../../services/system/redis.js";
import { kafkaService } from "../../../services/system/kafka.js";
import { userConnectionManager } from "../../../services/userConnectionManager.js";
import { messageRoutingService } from "../../../services/messageRoutingService.js";
import { config, isDev } from "../../../config/env.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "../public");

/**
 * Validate admin authentication via query parameter
 */
function validateAdminAuth(request) {
  const url = new URL(request.url);
  const providedKey = url.searchParams.get('key');
  
  // In development, warn if using default secret
  if (isDev && config.admin.secret === "dev-admin-secret-change-in-production") {
    console.warn("⚠️  Using default admin secret in development mode. Set ADMIN_SECRET in production!");
  }
  
  // Check if secret is configured
  if (!config.admin.secret) {
    console.error("❌ ADMIN_SECRET not configured!");
    return false;
  }
  
  return providedKey === config.admin.secret;
}

export const healthRoutes = new Elysia({ prefix: "/health" })
  // Serve static files from public directory
  .use(staticPlugin({
    assets: publicDir,
    prefix: "/health",
  }))
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
  .get("/dashboard", async ({ request, set }) => {
    // Check authentication
    if (!validateAdminAuth(request)) {
      set.redirect = `/health/unauthorized.html?mode=${isDev ? 'dev' : 'prod'}`;
      return;
    }
    
    // Redirect to static dashboard HTML file
    set.redirect = "/health/admin-dashboard.html";
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
    
    // Get detailed connection information for each user
    const userDetails = connectedUsers.map(userId => {
      const connectionCount = userConnectionManager.getUserConnectionCount(userId);
      const connections = [];
      
      // Get connection details from websocketStore
      const userConnections = userConnectionManager.getUserConnections().get(userId) || new Set();
      const websocketStore = userConnectionManager.getWebsocketStore();
      
      for (const websocketId of userConnections) {
        const connectionInfo = websocketStore.get(websocketId);
        if (connectionInfo) {
          connections.push({
            websocketId,
            connectionTime: connectionInfo.connectionTime,
            status: connectionInfo.ws ? 'active' : 'inactive'
          });
        }
      }
      
      return {
        userId,
        connectionCount,
        connections,
        lastSeen: connections.length > 0 ? 
          Math.max(...connections.map(c => new Date(c.connectionTime).getTime())) :
          null
      };
    });
    
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      stats,
      connectedUsers: userDetails
    };
  })
  .get("/test-message/:userId", async ({ params: { userId } }) => {
    try {
      const testMessage = {
        type: "test",
        message: "Health check test message",
        timestamp: new Date().toISOString(),
        messageId: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
      
      // Send directly through WebSocket manager to ensure immediate delivery to all sessions
      const directResult = await userConnectionManager.sendMessageToUser(userId, testMessage);
      
      // Also send through Kafka for redundancy and logging
      let kafkaResult = null;
      try {
        await messageRoutingService.sendMessageToUser(userId, testMessage, "test");
        kafkaResult = { sent: true, method: 'kafka' };
      } catch (kafkaError) {
        console.warn('Kafka routing failed:', kafkaError.message);
        kafkaResult = { sent: false, error: kafkaError.message, method: 'kafka' };
      }
      
      return {
        success: directResult.sent,
        message: `Test message sent to all sessions of user ${userId}`,
        data: testMessage,
        deliveryDetails: {
          direct: {
            sent: directResult.sent,
            successCount: directResult.successCount,
            failureCount: directResult.failureCount,
            totalAttempts: directResult.totalAttempts,
            method: 'websocket'
          },
          kafka: kafkaResult
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  .get("/test-session/:sessionId", async ({ params: { sessionId } }) => {
    try {
      const testMessage = {
        type: "test",
        message: "Health check test message for specific session",
        timestamp: new Date().toISOString(),
        messageId: `test-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
      
      // Send directly through WebSocket manager to specific session
      const directResult = await userConnectionManager.sendMessageToSession(sessionId, testMessage);
      
      // Also send through Kafka for redundancy and logging
      let kafkaResult = null;
      try {
        await messageRoutingService.sendMessageToSession(sessionId, testMessage, "test");
        kafkaResult = { sent: true, method: 'kafka' };
      } catch (kafkaError) {
        console.warn('Kafka routing failed:', kafkaError.message);
        kafkaResult = { sent: false, error: kafkaError.message, method: 'kafka' };
      }
      
      return {
        success: directResult.sent,
        message: `Test message sent to session ${sessionId}`,
        data: testMessage,
        deliveryDetails: {
          direct: {
            sent: directResult.sent,
            successCount: directResult.successCount,
            failureCount: directResult.failureCount,
            totalAttempts: directResult.totalAttempts,
            method: 'websocket',
            websocketId: directResult.websocketId,
            userId: directResult.userId
          },
          kafka: kafkaResult
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  .post("/stress-test/:userId", async ({ params: { userId }, body }) => {
    try {
      const messageCount = body?.count || 1000;
      const batchSize = body?.batchSize || 100;
      
      console.log(`🚀 Starting stress test for user ${userId}: ${messageCount} messages`);
      
      let sentCount = 0;
      let errorCount = 0;
      const startTime = Date.now();
      
      // Send messages in batches to avoid overwhelming the system
      for (let i = 0; i < messageCount; i += batchSize) {
        const currentBatch = Math.min(batchSize, messageCount - i);
        const promises = [];
        
        for (let j = 0; j < currentBatch; j++) {
          const messageIndex = i + j;
          const stressMessage = {
            type: "stress_test",
            message: `Stress test message #${messageIndex + 1}`,
            messageIndex: messageIndex + 1,
            totalMessages: messageCount,
            timestamp: new Date().toISOString()
          };
          
          promises.push(
            userConnectionManager.sendMessageToUser(userId, stressMessage)
              .then((result) => result.sent ? 1 : 0)
              .catch(() => 0)
          );
        }
        
        const batchResults = await Promise.all(promises);
        const batchSent = batchResults.reduce((sum, result) => sum + result, 0);
        sentCount += batchSent;
        errorCount += (currentBatch - batchSent);
        
        // Small delay between batches to prevent overwhelming
        if (i + batchSize < messageCount) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        message: `Stress test completed for user ${userId}`,
        stats: {
          totalMessages: messageCount,
          sentCount,
          errorCount,
          duration: `${duration}ms`,
          messagesPerSecond: Math.round((sentCount / duration) * 1000)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  .get("/api/stats", async () => {
    try {
      const redisHealth = await redisService.healthCheck();
      const kafkaHealth = await checkKafkaHealth();
      const wsConnections = userConnectionManager.getConnectionStats();
      const connectedUsers = userConnectionManager.getConnectedUsers();
      
      return {
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
        users: connectedUsers.map(userId => {
          const connectionCount = userConnectionManager.getUserConnectionCount(userId);
          const connections = [];
          
          // Get detailed connection information
          const userConnections = userConnectionManager.getUserConnections().get(userId) || new Set();
          const websocketStore = userConnectionManager.getWebsocketStore();
          
          for (const websocketId of userConnections) {
            const connectionInfo = websocketStore.get(websocketId);
            if (connectionInfo) {
              connections.push({
                websocketId: websocketId, // Full ID for proper session targeting
                connectionTime: connectionInfo.connectionTime,
                status: connectionInfo.ws ? 'active' : 'inactive'
              });
            }
          }
          
          return {
            userId,
            connectionCount,
            connections
          };
        }),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return { error: error.message };
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
