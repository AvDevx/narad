# Narad Services Documentation

## Overview

This document provides an overview of the messaging and caching services available in the Narad application. The project includes robust implementations for both Apache Kafka (messaging) and Redis (caching/storage) with development-friendly fallbacks and production-ready configurations.

## Service Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │  Kafka Service  │    │  Redis Service  │
│                 │    │                 │    │                 │
│  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │
│  │  Routes   │──┼────┼──│ Producers │  │    │  │   Cache   │  │
│  └───────────┘  │    │  │ Consumers │  │    │  │ Sessions  │  │
│                 │    │  └───────────┘  │    │  │ Realtime  │  │
│  ┌───────────┐  │    │                 │    │  └───────────┘  │
│  │Middleware │──┼─────────────────────────────┼──────────────  │
│  └───────────┘  │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Quick Start

### 1. Environment Setup

Create a `.env.local` file with the following configuration:

```bash
# Application
NODE_ENV=development

# Kafka Configuration
KAFKA_CLIENT_ID=narad
KAFKA_BROKERS=localhost:9092
KAFKA_SSL=false

# Redis Configuration  
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_TLS=false
```

### 2. Service Initialization

```javascript
import { kafkaService } from './src/services/kafka.js';
import { redisService } from './src/services/redis.js';

// Initialize services
async function initializeServices() {
  try {
    // Connect to Redis
    await redisService.connect();
    console.log('✅ Redis connected');

    // Initialize Kafka (producer and consumer as needed)
    await kafkaService.init().connectProducer();
    console.log('✅ Kafka producer connected');
    
    // Optional: Initialize consumer for specific use cases
    // await kafkaService.connectConsumer('my-app-group');
    
  } catch (error) {
    console.error('❌ Service initialization failed:', error);
    
    // In development, services will work in fallback mode
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️  Continuing with service fallbacks...');
    } else {
      throw error;
    }
  }
}

// Initialize on application start
await initializeServices();
```

## Service Integration Patterns

### 1. Event-Driven Caching

Combine Kafka and Redis for event-driven cache invalidation:

```javascript
import { kafkaService } from './services/kafka.js';
import { redisService } from './services/redis.js';

class EventDrivenCache {
  static async init() {
    // Set up consumer for cache invalidation
    await kafkaService.connectConsumer('cache-manager');
    await kafkaService.subscribe('user.events', this.handleUserEvent);
  }

  static async handleUserEvent(event) {
    const { type, userId } = event;
    
    switch (type) {
      case 'USER_UPDATED':
        // Invalidate user cache
        await redisService.del(`user:${userId}:profile`);
        await redisService.del(`user:${userId}:preferences`);
        console.log(`Cache invalidated for user ${userId}`);
        break;
        
      case 'USER_LOGGED_IN':
        // Cache user session
        await redisService.set(
          `session:${event.sessionId}`, 
          JSON.stringify(event.sessionData),
          { EX: 3600 }
        );
        break;
    }
  }

  static async getCachedUser(userId) {
    const cached = await redisService.get(`user:${userId}:profile`);
    if (cached) {
      return JSON.parse(cached);
    }

    // If not cached, fetch from database and cache
    const user = await database.getUser(userId);
    if (user) {
      await redisService.set(
        `user:${userId}:profile`, 
        JSON.stringify(user),
        { EX: 600 } // 10 minutes
      );
    }

    return user;
  }
}
```

### 2. Message Queue with Persistence

Use Kafka for reliable messaging and Redis for temporary state:

```javascript
class OrderProcessingSystem {
  static async init() {
    await kafkaService.init().connectProducer();
    await kafkaService.connectConsumer('order-processor');
    await kafkaService.subscribe('orders', this.processOrder);
  }

  static async createOrder(orderData) {
    const orderId = generateOrderId();
    
    // Store temporary order state in Redis
    await redisService.set(
      `order:${orderId}:processing`,
      JSON.stringify({ status: 'pending', ...orderData }),
      { EX: 300 } // 5 minutes timeout
    );

    // Send order to Kafka for processing
    await kafkaService.send('orders', {
      orderId,
      ...orderData,
      timestamp: new Date().toISOString()
    });

    return orderId;
  }

  static async processOrder(orderMessage) {
    const { orderId } = orderMessage;
    
    try {
      // Update processing status
      await redisService.set(
        `order:${orderId}:processing`,
        JSON.stringify({ status: 'processing', ...orderMessage }),
        { EX: 600 }
      );

      // Process the order (payment, inventory, etc.)
      const result = await this.executeOrderProcessing(orderMessage);

      // Update final status
      await redisService.set(
        `order:${orderId}:result`,
        JSON.stringify(result),
        { EX: 3600 } // Keep result for 1 hour
      );

      // Clean up processing state
      await redisService.del(`order:${orderId}:processing`);

    } catch (error) {
      // Store error state
      await redisService.set(
        `order:${orderId}:error`,
        JSON.stringify({ error: error.message, timestamp: Date.now() }),
        { EX: 86400 } // Keep error for 24 hours
      );
    }
  }
}
```

### 3. Real-time Analytics

Stream events through Kafka and aggregate in Redis:

```javascript
class AnalyticsService {
  static async init() {
    await kafkaService.connectConsumer('analytics-processor');
    await kafkaService.subscribe('user.events', this.processAnalytics);
    await kafkaService.subscribe('system.events', this.processAnalytics);
  }

  static async trackUserAction(userId, action, data = {}) {
    const event = {
      type: 'USER_ACTION',
      userId,
      action,
      data,
      timestamp: Date.now()
    };

    // Send to Kafka for processing
    await kafkaService.send('user.events', event);

    // Also store recent user activity in Redis
    const key = `user:${userId}:recent_activity`;
    const client = redisService.getClient();
    
    if (client) {
      await client.lPush(key, JSON.stringify(event));
      await client.lTrim(key, 0, 49); // Keep last 50 actions
      await client.expire(key, 86400); // Expire after 24 hours
    }
  }

  static async processAnalytics(event) {
    const { type, userId, action } = event;
    const today = new Date().toISOString().split('T')[0];
    
    // Update daily counters
    await redisService.getClient()?.incr(`analytics:daily:${today}:total_events`);
    
    if (type === 'USER_ACTION') {
      // Track user activity
      await redisService.getClient()?.incr(`analytics:daily:${today}:user_actions`);
      
      // Track specific actions
      if (action) {
        await redisService.getClient()?.incr(`analytics:daily:${today}:action:${action}`);
      }
      
      // Track active users
      await redisService.getClient()?.sAdd(`analytics:daily:${today}:active_users`, userId);
    }
  }

  static async getDailyStats(date) {
    const client = redisService.getClient();
    if (!client) return null;

    const pipeline = client.multi();
    pipeline.get(`analytics:daily:${date}:total_events`);
    pipeline.get(`analytics:daily:${date}:user_actions`);
    pipeline.sCard(`analytics:daily:${date}:active_users`);

    const results = await pipeline.exec();
    
    return {
      totalEvents: parseInt(results[0][1]) || 0,
      userActions: parseInt(results[1][1]) || 0,
      activeUsers: parseInt(results[2][1]) || 0
    };
  }
}
```

## Health Monitoring

Create a comprehensive health check that covers both services:

```javascript
class HealthMonitor {
  static async getServiceHealth() {
    const health = {
      timestamp: new Date().toISOString(),
      services: {},
      overall: 'healthy'
    };

    try {
      // Check Redis health
      health.services.redis = await redisService.healthCheck();
      
      // Check Kafka health
      health.services.kafka = {
        status: kafkaService.isConnected ? 'connected' : 'disconnected',
        clientId: process.env.KAFKA_CLIENT_ID,
        brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092']
      };

      // Determine overall health
      const redisOk = health.services.redis.status === 'connected';
      const kafkaOk = health.services.kafka.status === 'connected' || 
                     process.env.NODE_ENV === 'development';

      health.overall = redisOk && kafkaOk ? 'healthy' : 
                      (process.env.NODE_ENV === 'development' ? 'degraded' : 'unhealthy');

    } catch (error) {
      health.overall = 'error';
      health.error = error.message;
    }

    return health;
  }

  static async performServiceTests() {
    const tests = {
      redis: { status: 'unknown' },
      kafka: { status: 'unknown' }
    };

    // Test Redis
    try {
      await redisService.set('health:test', 'ok', { EX: 10 });
      const result = await redisService.get('health:test');
      tests.redis.status = result === 'ok' ? 'pass' : 'fail';
      await redisService.del('health:test');
    } catch (error) {
      tests.redis.status = 'fail';
      tests.redis.error = error.message;
    }

    // Test Kafka (if connected)
    try {
      if (kafkaService.isConnected) {
        await kafkaService.send('health.test', { test: true, timestamp: Date.now() });
        tests.kafka.status = 'pass';
      } else {
        tests.kafka.status = process.env.NODE_ENV === 'development' ? 'skip' : 'fail';
      }
    } catch (error) {
      tests.kafka.status = 'fail';
      tests.kafka.error = error.message;
    }

    return tests;
  }
}

// Use in health endpoint
export const healthEndpoint = async () => {
  const health = await HealthMonitor.getServiceHealth();
  const tests = await HealthMonitor.performServiceTests();
  
  return {
    ...health,
    tests
  };
};
```

## Configuration Management

### Development Configuration

```javascript
// config/development.js
export const developmentConfig = {
  kafka: {
    // More lenient settings for development
    connectionTimeout: 3000,
    retry: { initialRetryTime: 100, retries: 3 },
    // Auto-create topics in development
    allowAutoTopicCreation: true
  },
  redis: {
    // Local Redis instance
    host: 'localhost',
    port: 6379,
    // No authentication in development
    connectTimeout: 5000
  }
};
```

### Production Configuration

```javascript
// config/production.js
export const productionConfig = {
  kafka: {
    // Robust settings for production
    connectionTimeout: 10000,
    retry: { initialRetryTime: 300, retries: 8 },
    // Security enabled
    ssl: true,
    sasl: {
      mechanism: 'plain',
      username: process.env.KAFKA_SASL_USERNAME,
      password: process.env.KAFKA_SASL_PASSWORD
    }
  },
  redis: {
    // Production Redis (possibly clustered)
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    connectTimeout: 10000
  }
};
```

## Error Handling Strategies

### Graceful Degradation

Both services are designed to gracefully degrade in case of failures:

```javascript
class ServiceFallbacks {
  // Kafka fallback: Use Redis as temporary storage
  static async sendWithFallback(topic, message) {
    try {
      await kafkaService.send(topic, message);
      return true;
    } catch (kafkaError) {
      console.warn('Kafka unavailable, using Redis fallback:', kafkaError.message);
      
      // Store in Redis queue as fallback
      const key = `kafka_fallback:${topic}`;
      const client = redisService.getClient();
      
      if (client) {
        await client.lPush(key, JSON.stringify({
          message,
          timestamp: Date.now(),
          originalTopic: topic
        }));
        
        return true;
      }
      
      throw new Error('Both Kafka and Redis unavailable');
    }
  }

  // Redis fallback: Use in-memory cache
  static memoryCache = new Map();
  
  static async cacheWithFallback(key, value, ttlSeconds = 300) {
    try {
      return await redisService.set(key, value, { EX: ttlSeconds });
    } catch (redisError) {
      console.warn('Redis unavailable, using memory cache:', redisError.message);
      
      // Use in-memory cache as fallback
      this.memoryCache.set(key, { value, expires: Date.now() + (ttlSeconds * 1000) });
      
      // Clean up expired entries
      this.cleanExpiredMemoryCache();
      
      return true;
    }
  }

  static async getWithFallback(key) {
    try {
      return await redisService.get(key);
    } catch (redisError) {
      console.warn('Redis unavailable, checking memory cache:', redisError.message);
      
      const cached = this.memoryCache.get(key);
      if (cached && cached.expires > Date.now()) {
        return cached.value;
      }
      
      return null;
    }
  }

  static cleanExpiredMemoryCache() {
    const now = Date.now();
    for (const [key, data] of this.memoryCache.entries()) {
      if (data.expires <= now) {
        this.memoryCache.delete(key);
      }
    }
  }
}
```

## Performance Optimization

### Connection Pooling and Reuse

```javascript
class ConnectionManager {
  static async optimizeConnections() {
    // Kafka connection optimization
    if (!kafkaService.isConnected) {
      try {
        await kafkaService.init().connectProducer();
      } catch (error) {
        console.error('Failed to establish Kafka connection:', error.message);
      }
    }

    // Redis connection optimization
    if (!redisService.isConnected) {
      try {
        await redisService.connect();
      } catch (error) {
        console.error('Failed to establish Redis connection:', error.message);
      }
    }
  }

  static async gracefulShutdown() {
    console.log('Starting graceful shutdown...');
    
    const shutdownPromises = [];
    
    // Disconnect Kafka
    if (kafkaService.isConnected) {
      shutdownPromises.push(
        kafkaService.disconnect().catch(err => 
          console.error('Kafka disconnect error:', err)
        )
      );
    }

    // Disconnect Redis
    if (redisService.isConnected) {
      shutdownPromises.push(
        redisService.disconnect().catch(err => 
          console.error('Redis disconnect error:', err)
        )
      );
    }

    await Promise.all(shutdownPromises);
    console.log('All services disconnected');
  }
}

// Set up graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    await ConnectionManager.gracefulShutdown();
    process.exit(0);
  });
});
```

## Next Steps

1. **Read Service-Specific Documentation**:
   - [Kafka Service Usage Guide](./KAFKA_USAGE.md)
   - [Redis Service Usage Guide](./REDIS_USAGE.md)

2. **Explore Examples**:
   - Check [src/examples/redis-usage.js](../src/examples/redis-usage.js) for Redis patterns
   - Review the service implementations in [src/services/](../src/services/)

3. **Set Up Development Environment**:
   - Install and run local Kafka and Redis instances
   - Configure environment variables
   - Test service connectivity

4. **Production Deployment**:
   - Review security configurations
   - Set up monitoring and alerting
   - Implement backup and recovery procedures

This documentation provides a comprehensive foundation for using Kafka and Redis in your Narad application. Both services are designed to work seamlessly together while providing robust fallback mechanisms for development and production environments.