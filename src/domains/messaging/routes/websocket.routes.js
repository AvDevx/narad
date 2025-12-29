import { Elysia } from "elysia";
import { kafkaService } from "../../../services/kafka.js";
import { userConnectionManager } from "../../../services/userConnectionManager.js";

// Store intervals for cleanup
const intervals = new Map();

export const websocketRoutes = new Elysia({ prefix: "/ws" })
.ws("/", {
  open(ws) {
    console.log(`🔗 WebSocket connection opened: ${ws.id}`);
    
    // Wait for user authentication message
    ws.send(JSON.stringify({
      type: "auth_required",
      message: "Please send your user ID to authenticate",
      timestamp: new Date().toISOString()
    }));
  },
  
  message(ws, message) {
    try {
      let parsedMessage;
      
      console.log("Received raw message:", message, "Type:", typeof message);
      
      // Handle different message types
      if (typeof message === 'object' && message !== null) {
        // Message is already an object (parsed by framework)
        parsedMessage = message;
      } else if (typeof message === 'string') {
        // Message is a string, try to parse as JSON
        try {
          parsedMessage = JSON.parse(message);
        } catch (parseError) {
          console.log("JSON parse failed:", parseError.message, "Treating as text message");
          parsedMessage = { type: "text", content: message };
        }
      } else {
        // Message is Buffer or other type, convert to string and try parsing
        const messageStr = message.toString();
        try {
          parsedMessage = JSON.parse(messageStr);
        } catch (parseError) {
          console.log("JSON parse failed:", parseError.message, "Treating as text message");
          parsedMessage = { type: "text", content: messageStr };
        }
      }

      console.log(`📨 Received message from WebSocket ${ws.id}:`, parsedMessage);

      // Handle authentication
      if (parsedMessage.type === "auth" && parsedMessage.userId) {
        handleUserAuthentication(ws, parsedMessage.userId);
        return;
      }

      // Handle regular messages (only if user is authenticated)
      if (ws.data?.userId) {
        handleAuthenticatedMessage(ws, parsedMessage);
      } else {
        ws.send(JSON.stringify({
          type: "error",
          message: "Please authenticate first by sending: {\"type\": \"auth\", \"userId\": \"your-user-id\"}",
          timestamp: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error(`❌ Error handling message from WebSocket ${ws.id}:`, error.message);
      ws.send(JSON.stringify({
        type: "error",
        message: "Failed to process message",
        timestamp: new Date().toISOString()
      }));
    }
  },
  
  close(ws) {
    console.log(`🔌 WebSocket disconnected: ${ws.id}`);
    
    // Clean up user connection
    if (ws.data?.userId) {
      userConnectionManager.removeConnection(ws.id);
    }
    
    // Clean up heartbeat interval
    const interval = intervals.get(ws.id);
    if (interval) {
      clearInterval(interval);
      intervals.delete(ws.id);
    }
  },
});

/**
 * Handle user authentication for WebSocket connection
 */
async function handleUserAuthentication(ws, userId) {
  try {
    // Store user data in WebSocket
    ws.data = { userId };
    
    // Register connection with user connection manager
    const success = await userConnectionManager.addConnection(userId, ws.id, ws);
    
    if (success) {
      ws.send(JSON.stringify({
        type: "auth_success",
        message: `Authenticated as user: ${userId}`,
        userId,
        websocketId: ws.id,
        timestamp: new Date().toISOString()
      }));

      // Start heartbeat for authenticated users
      startHeartbeat(ws, userId);
      
      // Log connection stats
      const stats = userConnectionManager.getConnectionStats();
      console.log(`📊 Connection stats:`, stats);
      
      // Send Kafka notification about user connection
      await kafkaService.send("websocket", {
        type: "user_connected",
        userId,
        websocketId: ws.id,
        timestamp: new Date().toISOString(),
        connectionStats: stats
      });
    } else {
      ws.send(JSON.stringify({
        type: "auth_error",
        message: "Failed to register user connection",
        timestamp: new Date().toISOString()
      }));
    }
  } catch (error) {
    console.error(`❌ Authentication error for user ${userId}:`, error.message);
    ws.send(JSON.stringify({
      type: "auth_error",
      message: "Authentication failed",
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Handle messages from authenticated users
 */
async function handleAuthenticatedMessage(ws, message) {
  const userId = ws.data.userId;
  
  try {
    // Echo message back to sender
    ws.send(JSON.stringify({
      type: "message_received",
      originalMessage: message,
      userId,
      timestamp: new Date().toISOString()
    }));

    // Send message to Kafka for processing
    await kafkaService.send("websocket-inbound", {
      type: "user_message",
      userId,
      websocketId: ws.id,
      content: message,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📤 Message from user ${userId} sent to Kafka`);
  } catch (error) {
    console.error(`❌ Error handling message from user ${userId}:`, error.message);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to process your message",
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Start heartbeat for authenticated user
 */
function startHeartbeat(ws, userId) {
  let count = 0;
  const interval = setInterval(async () => {
    try {
      count++;
      const heartbeatMessage = {
        type: "heartbeat",
        count,
        userId,
        timestamp: new Date().toISOString()
      };
      
      ws.send(JSON.stringify(heartbeatMessage));
      
      // Send heartbeat to Kafka every 10 beats to reduce noise
      if (count % 10 === 0) {
        await kafkaService.send("websocket", {
          type: "user_heartbeat",
          userId,
          websocketId: ws.id,
          count,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error(`❌ Heartbeat error for user ${userId}:`, error.message);
      clearInterval(interval);
      intervals.delete(ws.id);
    }
  }, 5000); // Send heartbeat every 5 seconds
  
  intervals.set(ws.id, interval);
}
