/**
 * Complete Example: Using Kafka and Redis Together
 * 
 * This example demonstrates how to use both Kafka and Redis services
 * in a real-world scenario with user session management and event streaming.
 */

import { kafkaService } from '../services/kafka.js';
import { redisService } from '../services/redis.js';

/**
 * User Session and Event Management System
 * 
 * Features:
 * - User login/logout events via Kafka
 * - Session storage in Redis
 * - Event-driven cache invalidation
 * - Real-time user activity tracking
 */
export class UserSessionManager {
  
  /**
   * Initialize the session manager
   * Sets up both Kafka producer/consumer and Redis connection
   */
  static async init() {
    try {
      console.log('🚀 Initializing User Session Manager...');
      
      // Initialize services
      await redisService.connect();
      await kafkaService.init().connectProducer();
      await kafkaService.connectConsumer('user-session-manager');
      
      // Subscribe to user events
      await kafkaService.subscribe('user.events', this.handleUserEvent.bind(this));
      
      console.log('✅ User Session Manager initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize User Session Manager:', error.message);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️  Running in development mode with service fallbacks');
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle user login
   */
  static async loginUser(userId, loginData) {
    try {
      const sessionId = `session_${userId}_${Date.now()}`;
      const sessionData = {
        userId,
        sessionId,
        loginTime: new Date().toISOString(),
        ipAddress: loginData.ipAddress,
        userAgent: loginData.userAgent,
        isActive: true
      };

      // Store session in Redis (expires in 24 hours)
      await redisService.set(
        `session:${sessionId}`, 
        JSON.stringify(sessionData), 
        { EX: 86400 }
      );

      // Store user's active session reference
      await redisService.set(`user:${userId}:active_session`, sessionId, { EX: 86400 });

      // Publish login event to Kafka
      const loginEvent = {
        type: 'USER_LOGIN',
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        metadata: {
          ipAddress: loginData.ipAddress,
          userAgent: loginData.userAgent
        }
      };

      await kafkaService.send('user.events', loginEvent);

      // Update user activity counter in Redis
      const today = new Date().toISOString().split('T')[0];
      await redisService.getClient()?.sAdd(`daily_active_users:${today}`, userId);

      console.log(`✅ User ${userId} logged in successfully`);
      return sessionId;

    } catch (error) {
      console.error(`❌ Login failed for user ${userId}:`, error.message);
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  /**
   * Handle user logout
   */
  static async logoutUser(sessionId) {
    try {
      // Get session data
      const sessionData = await this.getSession(sessionId);
      if (!sessionData) {
        throw new Error('Session not found');
      }

      const { userId } = sessionData;

      // Update session status
      sessionData.isActive = false;
      sessionData.logoutTime = new Date().toISOString();
      
      await redisService.set(
        `session:${sessionId}`, 
        JSON.stringify(sessionData), 
        { EX: 3600 } // Keep for 1 hour after logout
      );

      // Remove active session reference
      await redisService.del(`user:${userId}:active_session`);

      // Publish logout event to Kafka
      const logoutEvent = {
        type: 'USER_LOGOUT',
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        sessionDuration: new Date(sessionData.logoutTime).getTime() - 
                        new Date(sessionData.loginTime).getTime()
      };

      await kafkaService.send('user.events', logoutEvent);

      console.log(`✅ User ${userId} logged out successfully`);
      return true;

    } catch (error) {
      console.error(`❌ Logout failed for session ${sessionId}:`, error.message);
      throw new Error(`Logout failed: ${error.message}`);
    }
  }

  /**
   * Get user session data
   */
  static async getSession(sessionId) {
    try {
      const sessionData = await redisService.get(`session:${sessionId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      console.error(`Error retrieving session ${sessionId}:`, error.message);
      return null;
    }
  }

  /**
   * Get user's active session
   */
  static async getUserActiveSession(userId) {
    try {
      const sessionId = await redisService.get(`user:${userId}:active_session`);
      if (!sessionId) return null;

      return await this.getSession(sessionId);
    } catch (error) {
      console.error(`Error retrieving active session for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Track user activity
   */
  static async trackUserActivity(userId, activity) {
    try {
      // Get active session
      const session = await this.getUserActiveSession(userId);
      if (!session) {
        console.warn(`No active session found for user ${userId}`);
        return false;
      }

      // Update last activity time in session
      session.lastActivity = new Date().toISOString();
      await redisService.set(
        `session:${session.sessionId}`, 
        JSON.stringify(session), 
        { EX: 86400 }
      );

      // Store recent activity in Redis list
      const activityData = {
        userId,
        activity,
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId
      };

      const client = redisService.getClient();
      if (client) {
        const key = `user:${userId}:recent_activity`;
        await client.lPush(key, JSON.stringify(activityData));
        await client.lTrim(key, 0, 49); // Keep last 50 activities
        await client.expire(key, 86400); // Expire after 24 hours
      }

      // Publish activity event to Kafka
      const activityEvent = {
        type: 'USER_ACTIVITY',
        userId,
        sessionId: session.sessionId,
        activity,
        timestamp: new Date().toISOString()
      };

      await kafkaService.send('user.events', activityEvent);

      return true;

    } catch (error) {
      console.error(`Error tracking activity for user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Get user's recent activities
   */
  static async getUserRecentActivity(userId, limit = 10) {
    try {
      const client = redisService.getClient();
      if (!client) return [];

      const key = `user:${userId}:recent_activity`;
      const activities = await client.lRange(key, 0, limit - 1);
      
      return activities.map(activity => JSON.parse(activity));

    } catch (error) {
      console.error(`Error getting recent activity for user ${userId}:`, error.message);
      return [];
    }
  }

  /**
   * Handle incoming user events from Kafka
   */
  static async handleUserEvent(event) {
    try {
      const { type, userId, timestamp } = event;
      
      console.log(`📥 Processing ${type} event for user ${userId}`);

      switch (type) {
        case 'USER_LOGIN':
          await this.processLoginEvent(event);
          break;
          
        case 'USER_LOGOUT':
          await this.processLogoutEvent(event);
          break;
          
        case 'USER_ACTIVITY':
          await this.processActivityEvent(event);
          break;
          
        default:
          console.log(`Unknown event type: ${type}`);
      }

    } catch (error) {
      console.error('Error processing user event:', error.message);
    }
  }

  /**
   * Process login event (for analytics, notifications, etc.)
   */
  static async processLoginEvent(event) {
    const { userId, metadata } = event;
    
    // Update login counter
    const today = new Date().toISOString().split('T')[0];
    await redisService.getClient()?.incr(`login_count:${today}`);
    
    // Store login analytics
    const loginStats = await redisService.hGetAll(`user:${userId}:login_stats`) || {};
    loginStats.lastLogin = event.timestamp;
    loginStats.totalLogins = (parseInt(loginStats.totalLogins) || 0) + 1;
    
    await redisService.hSet(`user:${userId}:login_stats`, 'lastLogin', loginStats.lastLogin);
    await redisService.hSet(`user:${userId}:login_stats`, 'totalLogins', loginStats.totalLogins.toString());

    console.log(`📊 Updated login stats for user ${userId}`);
  }

  /**
   * Process logout event
   */
  static async processLogoutEvent(event) {
    const { userId, sessionDuration } = event;
    
    // Update session duration stats
    const stats = await redisService.hGetAll(`user:${userId}:login_stats`) || {};
    const avgSessionTime = parseInt(stats.avgSessionTime) || 0;
    const totalSessions = parseInt(stats.totalLogins) || 1;
    
    const newAvgSessionTime = Math.round(
      ((avgSessionTime * (totalSessions - 1)) + sessionDuration) / totalSessions
    );
    
    await redisService.hSet(`user:${userId}:login_stats`, 'avgSessionTime', newAvgSessionTime.toString());

    console.log(`📊 Updated session stats for user ${userId}`);
  }

  /**
   * Process activity event
   */
  static async processActivityEvent(event) {
    const { userId, activity } = event;
    
    // Update activity counters
    const today = new Date().toISOString().split('T')[0];
    await redisService.getClient()?.incr(`activity_count:${today}:${activity}`);
    
    console.log(`📊 Tracked ${activity} for user ${userId}`);
  }

  /**
   * Get system statistics
   */
  static async getSystemStats(date = null) {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      const client = redisService.getClient();
      
      if (!client) {
        return { error: 'Redis not available' };
      }

      const pipeline = client.multi();
      pipeline.sCard(`daily_active_users:${targetDate}`);
      pipeline.get(`login_count:${targetDate}`);
      
      const results = await pipeline.exec();
      
      return {
        date: targetDate,
        activeUsers: parseInt(results[0][1]) || 0,
        totalLogins: parseInt(results[1][1]) || 0
      };

    } catch (error) {
      console.error('Error getting system stats:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Clean up expired sessions and old data
   */
  static async cleanupOldData() {
    try {
      const client = redisService.getClient();
      if (!client) return;

      // Clean up old daily stats (keep last 30 days)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      
      const oldDateKey = cutoffDate.toISOString().split('T')[0];
      
      // Remove old active users sets and login counts
      await client.del(`daily_active_users:${oldDateKey}`);
      await client.del(`login_count:${oldDateKey}`);
      
      console.log(`🧹 Cleaned up data older than ${oldDateKey}`);

    } catch (error) {
      console.error('Error during cleanup:', error.message);
    }
  }
}

/**
 * Example usage in an Express/Elysia route
 */
export const exampleUsage = {
  // Login endpoint
  async login(request) {
    const { userId, ipAddress, userAgent } = request.body;
    
    try {
      const sessionId = await UserSessionManager.loginUser(userId, {
        ipAddress,
        userAgent
      });
      
      return { success: true, sessionId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Logout endpoint  
  async logout(request) {
    const { sessionId } = request.body;
    
    try {
      await UserSessionManager.logoutUser(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Track activity endpoint
  async trackActivity(request) {
    const { userId, activity } = request.body;
    
    try {
      const success = await UserSessionManager.trackUserActivity(userId, activity);
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Get user session
  async getSession(request) {
    const { sessionId } = request.params;
    
    try {
      const session = await UserSessionManager.getSession(sessionId);
      return session ? { session } : { error: 'Session not found' };
    } catch (error) {
      return { error: error.message };
    }
  },

  // Get system stats
  async getStats(request) {
    const { date } = request.query;
    
    try {
      const stats = await UserSessionManager.getSystemStats(date);
      return { stats };
    } catch (error) {
      return { error: error.message };
    }
  }
};

// Initialize on module load (optional)
// UserSessionManager.init().catch(console.error);

export default UserSessionManager;