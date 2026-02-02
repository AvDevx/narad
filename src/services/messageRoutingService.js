import { kafkaService } from "./system/kafka.js";
import { userConnectionManager } from "./userConnectionManager.js";
import { isDev } from "../config/env.js";

class MessageRoutingService {
  constructor() {
    this.isStarted = false;
  }

  /**
   * Check if the service is running
   */
  isRunning() {
    return this.isStarted;
  }

  /**
   * Initialize and start the message routing service
   */
  async start() {
    if (this.isStarted) {
      console.log("⚠️  Message routing service already started");
      return;
    }

    try {
      console.log("🚀 Starting message routing service...");
      
      // Connect Kafka consumer
      await kafkaService.connectConsumer("narad-message-router");
      
      // Subscribe to user message topic
      await this.subscribeToUserMessages();
      
      this.isStarted = true;
      console.log("✅ Message routing service started successfully");
    } catch (error) {
      console.error("❌ Failed to start message routing service:", error.message);
      if (!isDev) {
        throw error;
      }
    }
  }

  /**
   * Subscribe to the user messages topic and route messages to connected users
   */
  async subscribeToUserMessages() {
    const topic = "websocket-inbound";
    
    console.log(`📥 Subscribing to topic: ${topic}`);
    
    await kafkaService.subscribe(topic, async (message, context) => {
      try {
        await this.handleIncomingMessage(message, context);
      } catch (error) {
        console.error("❌ Error handling incoming message:", error.message);
        console.error("Message:", message);
      }
    });
  }

  /**
   * Handle incoming messages from Kafka and route them to users
   */
  async handleIncomingMessage(message, context) {
    console.log(`📨 Received message from topic ${context.topic}:`, message);

    // Validate message structure
    if (!this.isValidMessage(message)) {
      console.error("❌ Invalid message structure:", message);
      return;
    }

    const { userId, sessionId, messageData, messageType = "notification", targetType = "user" } = message;

    let result;
    
    if (targetType === "session" && sessionId) {
      // Send to specific session
      result = await userConnectionManager.sendMessageToSession(sessionId, {
        type: messageType,
        data: messageData,
        timestamp: new Date().toISOString(),
        source: "kafka",
        topic: context.topic
      });

      if (result.sent) {
        console.log(`✅ Message routed to session ${sessionId}: ${result.successCount} connection`);
      } else {
        console.warn(`⚠️  Failed to route message to session ${sessionId}: ${result.reason}`);
        await this.handleUndeliveredMessage(`session:${sessionId}`, message, result);
      }
    } else if (userId) {
      // Send to all user sessions (default behavior)
      result = await userConnectionManager.sendMessageToUser(userId, {
        type: messageType,
        data: messageData,
        timestamp: new Date().toISOString(),
        source: "kafka",
        topic: context.topic
      });

      if (result.sent) {
        console.log(`✅ Message routed to user ${userId}: ${result.successCount}/${result.totalAttempts} connections`);
      } else {
        console.warn(`⚠️  Failed to route message to user ${userId}: ${result.reason}`);
        await this.handleUndeliveredMessage(userId, message, result);
      }
    } else {
      console.error("❌ Message must contain either userId or sessionId:", message);
    }
  }

  /**
   * Validate message structure from Kafka
   */
  isValidMessage(message) {
    return (
      message &&
      typeof message === 'object' &&
      (
        // Must have either userId OR sessionId
        (message.userId && typeof message.userId === 'string') ||
        (message.sessionId && typeof message.sessionId === 'string')
      ) &&
      message.messageData !== undefined
    );
  }

  /**
   * Handle messages that couldn't be delivered to users
   */
  async handleUndeliveredMessage(userId, originalMessage, routingResult) {
    console.log(`📝 Handling undelivered message for user ${userId}`);
    
    // Send to a dead letter topic for later processing
    try {
      await kafkaService.send("websocket", {
        userId,
        originalMessage,
        routingResult,
        timestamp: new Date().toISOString(),
        reason: routingResult.reason
      });
      
      console.log(`📤 Undelivered message logged for user ${userId}`);
    } catch (error) {
      console.error(`❌ Failed to log undelivered message for user ${userId}:`, error.message);
    }
  }

  /**
   * Send a message to a user via Kafka (utility method)
   */
  async sendMessageToUser(userId, messageData, messageType = "notification") {
    if (!userId || messageData === undefined) {
      throw new Error("userId and messageData are required");
    }

    const message = {
      userId,
      messageData,
      messageType,
      timestamp: new Date().toISOString(),
      source: "api",
      targetType: "user" // Send to all user sessions
    };

    await kafkaService.send("websocket-inbound", message);
    console.log(`📤 Message queued for user ${userId}`);
    
    return message;
  }

  /**
   * Send a message to a specific session via Kafka
   */
  async sendMessageToSession(sessionId, messageData, messageType = "notification") {
    if (!sessionId || messageData === undefined) {
      throw new Error("sessionId and messageData are required");
    }

    const message = {
      sessionId,
      messageData,
      messageType,
      timestamp: new Date().toISOString(),
      source: "api",
      targetType: "session" // Send to specific session only
    };

    await kafkaService.send("websocket-inbound", message);
    console.log(`📤 Message queued for session ${sessionId}`);
    
    return message;
  }

  /**
   * Broadcast a message to all connected users
   */
  async broadcastMessage(messageData, messageType = "broadcast") {
    const connectedUsers = userConnectionManager.getConnectedUsers();
    console.log(`📢 Broadcasting message to ${connectedUsers.length} connected users`);

    const broadcastPromises = connectedUsers.map(userId => 
      this.sendMessageToUser(userId, messageData, messageType)
    );

    try {
      await Promise.allSettled(broadcastPromises);
      console.log(`✅ Broadcast queued for ${connectedUsers.length} users`);
    } catch (error) {
      console.error("❌ Error during broadcast:", error.message);
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    const connectionStats = userConnectionManager.getConnectionStats();
    
    return {
      isStarted: this.isStarted,
      kafkaConnected: kafkaService.isConnected,
      ...connectionStats,
      connectedUsers: userConnectionManager.getConnectedUsers()
    };
  }

  /**
   * Stop the message routing service
   */
  async stop() {
    console.log("🛑 Stopping message routing service...");
    this.isStarted = false;
    // Note: We don't disconnect Kafka here as it might be used elsewhere
    console.log("✅ Message routing service stopped");
  }
}

// Export singleton instance
export const messageRoutingService = new MessageRoutingService();