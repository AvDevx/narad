import { Elysia, t } from "elysia";
import { messageRoutingService } from "../../../services/messageRoutingService.js";
import { userConnectionManager } from "../../../services/userConnectionManager.js";

export const messagingApiRoutes = new Elysia({ prefix: "/api/messaging" })
  // Send a message to a specific user (all sessions)
  .post("/send", async ({ body }) => {
    try {
      const { userId, messageData, messageType } = body;
      
      if (!userId || messageData === undefined) {
        return {
          success: false,
          error: "userId and messageData are required"
        };
      }

      // Send through Kafka for reliable delivery
      await messageRoutingService.sendMessageToUser(userId, messageData, messageType);
      
      return {
        success: true,
        message: "Message queued for delivery to user",
        userId,
        messageType: messageType || "notification"
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }, {
    body: t.Object({
      userId: t.String(),
      messageData: t.Any(),
      messageType: t.Optional(t.String())
    })
  })

  // Send a message to a specific session only
  .post("/send-to-session", async ({ body }) => {
    try {
      const { sessionId, messageData, messageType } = body;
      
      if (!sessionId || messageData === undefined) {
        return {
          success: false,
          error: "sessionId and messageData are required"
        };
      }

      // Send through Kafka for reliable delivery
      await messageRoutingService.sendMessageToSession(sessionId, messageData, messageType);
      
      return {
        success: true,
        message: "Message queued for delivery to session",
        sessionId,
        messageType: messageType || "notification"
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }, {
    body: t.Object({
      sessionId: t.String(),
      messageData: t.Any(),
      messageType: t.Optional(t.String())
    })
  })
  
  // Broadcast a message to all connected users
  .post("/broadcast", async ({ body }) => {
    try {
      const { messageData, messageType } = body;
      
      if (messageData === undefined) {
        return {
          success: false,
          error: "messageData is required"
        };
      }

      await messageRoutingService.broadcastMessage(messageData, messageType);
      
      return {
        success: true,
        message: "Broadcast queued for all connected users"
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }, {
    body: t.Object({
      messageData: t.Any(),
      messageType: t.Optional(t.String())
    })
  })
  
  // Get system status and connection stats
  .get("/status", () => {
    const status = messageRoutingService.getStatus();
    const connectionStats = userConnectionManager.getConnectionStats();
    
    return {
      success: true,
      data: {
        messageRouting: status,
        connections: connectionStats,
        connectedUsers: userConnectionManager.getConnectedUsers(),
        timestamp: new Date().toISOString()
      }
    };
  })
  
  // Get connected users
  .get("/users", () => {
    const connectedUsers = userConnectionManager.getConnectedUsers();
    const userDetails = connectedUsers.map(userId => ({
      userId,
      connectionCount: userConnectionManager.getUserConnectionCount(userId)
    }));
    
    return {
      success: true,
      data: {
        totalUsers: connectedUsers.length,
        users: userDetails
      }
    };
  })
  
  // Get user-specific connection info
  .get("/users/:userId", ({ params }) => {
    const { userId } = params;
    const connectionCount = userConnectionManager.getUserConnectionCount(userId);
    
    return {
      success: true,
      data: {
        userId,
        connectionCount,
        isConnected: connectionCount > 0
      }
    };
  });