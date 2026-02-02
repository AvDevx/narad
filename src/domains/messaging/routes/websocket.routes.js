import { Elysia } from "elysia";
import { kafkaService } from "../../../services/system/kafka.js";
import { userConnectionManager } from "../../../services/userConnectionManager.js";
import { redisService } from "../../../services/system/redis.js";

export const websocketRoutes = new Elysia({ prefix: "/ws" })
.ws("/", {
  async open(ws) {
    console.log(`🔗 WebSocket connection attempt: ${ws.id}`);
    
    // Get session ID from query parameters
    let sessionId = null;
    try {
      // Try different ways to access the URL depending on Elysia version
      let url;
      if (ws.raw && ws.raw.url) {
        // Method 1: Direct URL access
        url = ws.raw.url;
      } else if (ws.url) {
        // Method 2: Direct on ws object
        url = ws.url;
      } else {
        // Method 3: Try to get from request context
        url = ws.data?.url || '';
      }
      
      // Parse the URL to extract query parameters
      if (url) {
        const urlParts = url.split('?');
        if (urlParts.length > 1) {
          const params = new URLSearchParams(urlParts[1]);
          sessionId = params.get('sid');
        }
      }
      
      console.log(`🔍 Parsed URL: ${url}, Session ID: ${sessionId}`);
    } catch (error) {
      console.error(`❌ Error parsing session ID:`, error.message);
      ws.send(JSON.stringify({
        type: "connection_rejected",
        message: "Failed to parse session ID from URL",
        timestamp: new Date().toISOString()
      }));
      ws.close();
      return;
    }

    
    if (!sessionId) {
      console.log(`❌ Connection rejected - no session ID provided: ${ws.id}`);
      ws.send(JSON.stringify({
        type: "connection_rejected",
        message: "Session ID is required. Connect with: ws://localhost:8080/ws?sid=<your-session-id>",
        timestamp: new Date().toISOString()
      }));
      ws.close();
      return;
    }
    
    // Validate session in Redis
    try {
      const sessionData = await redisService.get(`${sessionId}`);

      console.log(`🔍 Retrieved session data for ID ${sessionId}:`, sessionData);
      
      if (!sessionData) {
        console.log(`❌ Connection rejected - invalid session ID: ${sessionId}`);
        ws.send(JSON.stringify({
          type: "connection_rejected",
          message: "Invalid or expired session ID",
          timestamp: new Date().toISOString()
        }));
        ws.close();
        return;
      }
      
      const session = JSON.parse(sessionData);

      console.log("User session data:", session);
      
    //   if (!session.isActive) {
    //     console.log(`❌ Connection rejected - inactive session: ${sessionId}`);
    //     ws.send(JSON.stringify({
    //       type: "connection_rejected",
    //       message: "Session is not active",
    //       timestamp: new Date().toISOString()
    //     }));
    //     ws.close();
    //     return;
    //   }
      
      // Store session info in WebSocket data
      ws.data = { 
        sessionId,
        userId: session._id,
        sessionData: session
      };
      
      console.log(`✅ WebSocket connection authorized for user ${session._id} with session ${sessionId}`);
      
      // Generate a WebSocket ID if one doesn't exist
      let websocketId = ws.id;
      if (!websocketId || typeof websocketId !== 'string') {
        // Generate a unique WebSocket ID
        websocketId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🔗 Generated WebSocket ID: ${websocketId} (original ws.id: ${ws.id})`);
      }
      
      // Automatically register the connection
      const success = await userConnectionManager.addConnection(session._id, websocketId, ws);
      
      if (success) {
        // Store the websocketId in ws.data for later use
        ws.data.websocketId = websocketId;
        
        ws.send(JSON.stringify({
          type: "connection_established",
          message: `Connected successfully as user: ${session._id}`,
          userId: session._id,
          sessionId,
          websocketId: websocketId,
          timestamp: new Date().toISOString()
        }));
        
        // Log connection stats
        const stats = userConnectionManager.getConnectionStats();
        console.log(`📊 Connection stats:`, stats);
        
        // Send Kafka notification about user connection
        await kafkaService.send("websocket", {
          type: "user_connected",
          userId: session.userId,
          sessionId,
          websocketId: websocketId,
          timestamp: new Date().toISOString(),
          connectionStats: stats
        });
      } else {
        ws.send(JSON.stringify({
          type: "connection_error",
          message: "Failed to register user connection",
          timestamp: new Date().toISOString()
        }));
        ws.close();
      }
    } catch (error) {
      console.error(`❌ Error validating session ${sessionId}:`, error.message);
      ws.send(JSON.stringify({
        type: "connection_rejected",
        message: "Session validation failed",
        timestamp: new Date().toISOString()
      }));
      ws.close();
    }
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

      console.log(`📨 Received message from WebSocket ${ws.data?.websocketId || ws.id}:`, parsedMessage);

      // Handle messages (user is already authenticated via session)
      if (ws.data?.userId) {
        handleAuthenticatedMessage(ws, parsedMessage);
      } else {
        ws.send(JSON.stringify({
          type: "error",
          message: "Connection not properly authenticated",
          timestamp: new Date().toISOString()
        }));
        ws.close();
      }
    } catch (error) {
      console.error(`❌ Error handling message from WebSocket ${ws.data?.websocketId || ws.id}:`, error.message);
      ws.send(JSON.stringify({
        type: "error",
        message: "Failed to process message",
        timestamp: new Date().toISOString()
      }));
    }
  },
  
  close(ws) {
    const websocketId = ws.data?.websocketId || ws.id;
    console.log(`🔌 WebSocket disconnected: ${websocketId}`);
    
    // Clean up user connection and send disconnect event
    if (ws.data?.userId) {
      userConnectionManager.removeConnection(websocketId);
      
      // Send Kafka notification about user disconnection
      kafkaService.send("websocket", {
        type: "user_disconnected", 
        userId: ws.data.userId,
        sessionId: ws.data.sessionId,
        websocketId: websocketId,
        timestamp: new Date().toISOString(),
        connectionStats: userConnectionManager.getConnectionStats()
      }).catch(error => {
        console.error(`❌ Failed to send disconnect event to Kafka:`, error.message);
      });
    }
  },
});

/**
 * Handle messages from authenticated users
 */
async function handleAuthenticatedMessage(ws, message) {
  const userId = ws.data.userId;
  const sessionId = ws.data.sessionId;
  
  try {
    // Echo message back to sender
    ws.send(JSON.stringify({
      type: "message_received",
      originalMessage: message,
      userId,
      sessionId,
      timestamp: new Date().toISOString()
    }));

    // Send message to Kafka for processing
    await kafkaService.send("websocket-inbound", {
      type: "user_message",
      userId,
      sessionId,
      websocketId: ws.data?.websocketId || ws.id,
      content: message,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📤 Message from user ${userId} (session: ${sessionId}) sent to Kafka`);
  } catch (error) {
    console.error(`❌ Error handling message from user ${userId}:`, error.message);
    ws.send(JSON.stringify({
      type: "error",
      message: "Failed to process your message",
      timestamp: new Date().toISOString()
    }));
  }
}


