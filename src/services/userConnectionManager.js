import { redisService } from "./redis.js";
import { isDev } from "../config/env.js";

class UserConnectionManager {
  constructor() {
    // In-memory store for WebSocket connections
    // Map<userId, Set<websocketId>>
    this.userConnections = new Map();
    // Map<websocketId, { userId, ws, connectionTime }>
    this.websocketStore = new Map();
  }

  /**
   * Add a user connection when they connect via WebSocket
   * @param {string} userId - The user's unique ID
   * @param {string} websocketId - The WebSocket connection ID
   * @param {WebSocket} ws - The WebSocket instance
   */
  async addConnection(userId, websocketId, ws) {
    try {
      // Validate required parameters
      if (!userId || typeof userId !== 'string') {
        throw new Error('userId must be a non-empty string');
      }
      if (!websocketId || typeof websocketId !== 'string') {
        throw new Error('websocketId must be a non-empty string');
      }
      if (!ws) {
        throw new Error('WebSocket instance is required');
      }

      // Store in memory maps
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId).add(websocketId);
      
      this.websocketStore.set(websocketId, {
        userId,
        ws,
        connectionTime: new Date().toISOString(),
      });

      // Also store in Redis for persistence and scaling
      await this.storeUserConnectionInRedis(userId, websocketId);
      
      console.log(`✅ User ${userId} connected (WebSocket: ${websocketId})`);
      console.log(`📊 Total connections for user ${userId}: ${this.userConnections.get(userId).size}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to add connection for user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Remove a user connection when they disconnect
   * @param {string} websocketId - The WebSocket connection ID
   */
  async removeConnection(websocketId) {
    try {
      const connectionInfo = this.websocketStore.get(websocketId);
      if (!connectionInfo) {
        console.warn(`⚠️  WebSocket ${websocketId} not found in store`);
        return false;
      }

      const { userId } = connectionInfo;
      
      // Remove from memory maps
      if (this.userConnections.has(userId)) {
        this.userConnections.get(userId).delete(websocketId);
        if (this.userConnections.get(userId).size === 0) {
          this.userConnections.delete(userId);
        }
      }
      this.websocketStore.delete(websocketId);

      // Remove from Redis
      await this.removeUserConnectionFromRedis(userId, websocketId);
      
      console.log(`🔌 User ${userId} disconnected (WebSocket: ${websocketId})`);
      const remainingConnections = this.userConnections.get(userId)?.size || 0;
      console.log(`📊 Remaining connections for user ${userId}: ${remainingConnections}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to remove connection ${websocketId}:`, error.message);
      return false;
    }
  }

  /**
   * Send a message to a specific user across all their connections
   * @param {string} userId - The target user's ID
   * @param {object} message - The message to send
   */
  async sendMessageToUser(userId, message) {
    try {
      const userConnections = this.userConnections.get(userId);
      if (!userConnections || userConnections.size === 0) {
        console.warn(`⚠️  No active connections found for user ${userId}`);
        return { sent: false, reason: 'no_connections' };
      }

      let successCount = 0;
      let failureCount = 0;
      const messageString = JSON.stringify(message);

      // Send to all connections for this user
      for (const websocketId of userConnections) {
        const connectionInfo = this.websocketStore.get(websocketId);
        if (connectionInfo && connectionInfo.ws) {
          try {
            connectionInfo.ws.send(messageString);
            successCount++;
          } catch (error) {
            console.error(`❌ Failed to send message via WebSocket ${websocketId}:`, error.message);
            failureCount++;
            // Remove dead connection
            await this.removeConnection(websocketId);
          }
        } else {
          failureCount++;
          // Clean up orphaned connection
          await this.removeConnection(websocketId);
        }
      }

      console.log(`📤 Message sent to user ${userId}: ${successCount} success, ${failureCount} failures`);
      return { 
        sent: successCount > 0, 
        successCount, 
        failureCount,
        totalAttempts: successCount + failureCount
      };
    } catch (error) {
      console.error(`❌ Failed to send message to user ${userId}:`, error.message);
      return { sent: false, reason: 'send_error', error: error.message };
    }
  }

  /**
   * Get all connected users
   */
  getConnectedUsers() {
    return Array.from(this.userConnections.keys());
  }

  /**
   * Get connection count for a user
   * @param {string} userId 
   */
  getUserConnectionCount(userId) {
    return this.userConnections.get(userId)?.size || 0;
  }

  /**
   * Get total connection statistics
   */
  getConnectionStats() {
    const totalUsers = this.userConnections.size;
    const totalConnections = Array.from(this.userConnections.values())
      .reduce((sum, connections) => sum + connections.size, 0);
    
    return {
      totalUsers,
      totalConnections,
      avgConnectionsPerUser: totalUsers > 0 ? (totalConnections / totalUsers).toFixed(2) : 0
    };
  }

  /**
   * Get user connections map (for admin access)
   */
  getUserConnections() {
    return this.userConnections;
  }

  /**
   * Get websocket store (for admin access)
   */
  getWebsocketStore() {
    return this.websocketStore;
  }

  /**
   * Store user connection in Redis for persistence
   * @private
   */
  async storeUserConnectionInRedis(userId, websocketId) {
    if (!redisService.isConnected) {
      if (isDev) {
        console.log(`[DEV] Would store user ${userId} connection ${websocketId} in Redis`);
      }
      return;
    }

    // Additional validation before Redis operation
    if (!userId || typeof userId !== 'string') {
      console.error('Cannot store in Redis: userId is invalid:', userId);
      return;
    }
    if (!websocketId || typeof websocketId !== 'string') {
      console.error('Cannot store in Redis: websocketId is invalid:', websocketId);
      return;
    }

    try {
      const key = `user_connections:${userId}`;
      await redisService.client.sAdd(key, websocketId);
      await redisService.client.expire(key, 3600); // 1 hour expiry
    } catch (error) {
      console.error("Failed to store connection in Redis:", error.message);
      console.error("Parameters:", { userId, websocketId, type: typeof websocketId });
    }
  }

  /**
   * Remove user connection from Redis
   * @private
   */
  async removeUserConnectionFromRedis(userId, websocketId) {
    if (!redisService.isConnected) {
      if (isDev) {
        console.log(`[DEV] Would remove user ${userId} connection ${websocketId} from Redis`);
      }
      return;
    }

    try {
      const key = `user_connections:${userId}`;
      await redisService.client.sRem(key, websocketId);
    } catch (error) {
      console.error("Failed to remove connection from Redis:", error.message);
    }
  }
}

// Export singleton instance
export const userConnectionManager = new UserConnectionManager();