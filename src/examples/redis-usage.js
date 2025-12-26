import { redisService } from "../services/redis.js";

/**
 * Example usage of Redis service
 * These examples show how to use Redis in your application
 */

export class ExampleRedisUsage {
  // Cache user session
  static async cacheUserSession(userId, sessionData, expirationInSeconds = 3600) {
    const key = `session:${userId}`;
    const success = await redisService.set(key, JSON.stringify(sessionData));
    if (success) {
      await redisService.expire(key, expirationInSeconds);
      console.log(`Cached session for user ${userId}`);
    }
    return success;
  }

  // Get user session
  static async getUserSession(userId) {
    const key = `session:${userId}`;
    const data = await redisService.get(key);
    if (data) {
      try {
        return JSON.parse(data);
      } catch (error) {
        console.error("Failed to parse session data:", error);
        return null;
      }
    }
    return null;
  }

  // Cache API response
  static async cacheApiResponse(endpoint, data, ttl = 300) {
    const key = `api:${endpoint}`;
    return await redisService.set(key, JSON.stringify(data), { EX: ttl });
  }

  // Get cached API response
  static async getCachedApiResponse(endpoint) {
    const key = `api:${endpoint}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Store user preferences using hash
  static async setUserPreference(userId, preference, value) {
    const key = `user:${userId}:prefs`;
    return await redisService.hSet(key, preference, value);
  }

  // Get user preference
  static async getUserPreference(userId, preference) {
    const key = `user:${userId}:prefs`;
    return await redisService.hGet(key, preference);
  }

  // Get all user preferences
  static async getAllUserPreferences(userId) {
    const key = `user:${userId}:prefs`;
    return await redisService.hGetAll(key);
  }

  // Rate limiting example
  static async checkRateLimit(userId, limit = 100, window = 3600) {
    const key = `rate_limit:${userId}`;
    const current = await redisService.get(key);
    
    if (!current) {
      await redisService.set(key, "1", { EX: window });
      return { allowed: true, remaining: limit - 1 };
    }
    
    const count = parseInt(current);
    if (count >= limit) {
      return { allowed: false, remaining: 0 };
    }
    
    // Increment counter (this is a simplified version, for production use INCR)
    const client = redisService.getClient();
    if (client) {
      await client.incr(key);
    }
    
    return { allowed: true, remaining: limit - count - 1 };
  }

  // Store real-time data for WebSocket
  static async storeWebSocketMessage(roomId, message) {
    const key = `websocket:${roomId}:messages`;
    const messageData = {
      ...message,
      timestamp: new Date().toISOString()
    };
    
    // Store as a list (using Redis client directly for LIST operations)
    const client = redisService.getClient();
    if (client) {
      await client.lPush(key, JSON.stringify(messageData));
      // Keep only last 100 messages
      await client.lTrim(key, 0, 99);
      return true;
    }
    return false;
  }

  // Get recent WebSocket messages
  static async getRecentMessages(roomId, count = 10) {
    const key = `websocket:${roomId}:messages`;
    const client = redisService.getClient();
    if (client) {
      const messages = await client.lRange(key, 0, count - 1);
      return messages.map(msg => JSON.parse(msg));
    }
    return [];
  }
}

// Usage example in a route handler:
export const exampleRouteHandler = async (request) => {
  const userId = request.headers['user-id'];
  
  if (!userId) {
    return { error: "User ID required" };
  }

  // Check rate limit
  const rateLimit = await ExampleRedisUsage.checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return { error: "Rate limit exceeded", status: 429 };
  }

  // Try to get cached data first
  const cached = await ExampleRedisUsage.getCachedApiResponse('user-profile');
  if (cached) {
    return { data: cached, fromCache: true };
  }

  // If not cached, generate data and cache it
  const userData = { id: userId, name: "Example User", timestamp: Date.now() };
  await ExampleRedisUsage.cacheApiResponse('user-profile', userData);
  
  return { data: userData, fromCache: false };
};