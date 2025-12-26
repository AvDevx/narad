import { createClient } from "redis";
import { config, isDev } from "../config/env.js";

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Create Redis client with configuration
      this.client = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
          connectTimeout: config.redis.connectTimeout,
          tls: config.redis.tls,
        },

      });

      // Event handlers
      this.client.on("error", (err) => {
        console.error("Redis Client Error:", err.message);
        this.isConnected = false;
      });

      this.client.on("connect", () => {
        console.log("Redis Client Connected");
        this.isConnected = true;
      });

      this.client.on("ready", () => {
        console.log("Redis Client Ready");
        this.isConnected = true;
      });

      this.client.on("end", () => {
        console.log("Redis Client Connection Ended");
        this.isConnected = false;
      });

      // Connect to Redis with timeout
      const connectionPromise = this.client.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timeout")), 5000)
      );
      
      await Promise.race([connectionPromise, timeoutPromise]);
      
      // Test connection
      await this.client.ping();
      console.log("✅ Redis connection established successfully");
      
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error.message);
      if (isDev) {
        console.warn("⚠️ Running in development mode - continuing without Redis");
        this.isConnected = false;
      } else {
        throw error;
      }
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.quit();
        console.log("Redis connection closed");
      }
    } catch (error) {
      console.error("Error closing Redis connection:", error);
    }
  }

  // Utility methods for common Redis operations
  async get(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping GET operation");
        return null;
      }
      return await this.client.get(key);
    } catch (error) {
      console.error(`Error getting key ${key}:`, error);
      return null;
    }
  }

  async set(key, value, options = {}) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping SET operation");
        return false;
      }
      await this.client.set(key, value, options);
      return true;
    } catch (error) {
      console.error(`Error setting key ${key}:`, error);
      return false;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping DEL operation");
        return false;
      }
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error(`Error deleting key ${key}:`, error);
      return false;
    }
  }

  async exists(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping EXISTS operation");
        return false;
      }
      return await this.client.exists(key);
    } catch (error) {
      console.error(`Error checking existence of key ${key}:`, error);
      return false;
    }
  }

  async expire(key, seconds) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping EXPIRE operation");
        return false;
      }
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      console.error(`Error setting expiration for key ${key}:`, error);
      return false;
    }
  }

  // Hash operations
  async hGet(key, field) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping HGET operation");
        return null;
      }
      return await this.client.hGet(key, field);
    } catch (error) {
      console.error(`Error getting hash field ${field} from key ${key}:`, error);
      return null;
    }
  }

  async hSet(key, field, value) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping HSET operation");
        return false;
      }
      await this.client.hSet(key, field, value);
      return true;
    } catch (error) {
      console.error(`Error setting hash field ${field} in key ${key}:`, error);
      return false;
    }
  }

  async hGetAll(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected - skipping HGETALL operation");
        return {};
      }
      return await this.client.hGetAll(key);
    } catch (error) {
      console.error(`Error getting all hash fields from key ${key}:`, error);
      return {};
    }
  }

  // Get the raw Redis client for advanced operations
  getClient() {
    return this.client;
  }

  // Health check method
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { status: "disconnected", error: "Redis client not connected" };
      }
      
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      
      return {
        status: "connected",
        latency: `${latency}ms`,
        host: config.redis.host,
        port: config.redis.port
      };
    } catch (error) {
      return {
        status: "error",
        error: error.message
      };
    }
  }
}

// Create and export singleton instance
export const redisService = new RedisService();
export default redisService;