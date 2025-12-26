# Redis Service Documentation

## Overview

The Redis service provides a comprehensive wrapper around the Redis client with automatic connection management, error handling, and graceful fallbacks for development. It includes common Redis operations and patterns for caching, session management, and real-time data storage.

## Configuration

### Environment Variables

Set the following environment variables in your `.env` file:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_TLS=false
```

### Configuration Details

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_TLS` | `false` | Enable TLS connection (for cloud services like AWS ElastiCache) |

## Basic Usage

### Importing the Service

```javascript
import { redisService } from './services/redis.js';
```

### Connection Management

```javascript
// Connect to Redis
await redisService.connect();

// Check connection status
console.log('Redis connected:', redisService.isConnected);

// Disconnect when application shuts down
await redisService.disconnect();
```

## Core Operations

### String Operations

```javascript
// Set a key-value pair
await redisService.set('user:123', JSON.stringify({ name: 'John Doe' }));

// Set with expiration (5 minutes)
await redisService.set('session:abc', 'session-data', { EX: 300 });

// Get a value
const userData = await redisService.get('user:123');
const user = userData ? JSON.parse(userData) : null;

// Check if key exists
const exists = await redisService.exists('user:123');

// Delete a key
await redisService.del('user:123');

// Set expiration on existing key
await redisService.expire('session:abc', 600); // 10 minutes
```

### Hash Operations

```javascript
// Set hash field
await redisService.hSet('user:123:profile', 'name', 'John Doe');
await redisService.hSet('user:123:profile', 'email', 'john@example.com');

// Get hash field
const userName = await redisService.hGet('user:123:profile', 'name');

// Get all hash fields
const profile = await redisService.hGetAll('user:123:profile');
console.log(profile); // { name: 'John Doe', email: 'john@example.com' }
```

### Advanced Operations

For complex Redis operations, use the raw client:

```javascript
const client = redisService.getClient();

if (client) {
  // List operations
  await client.lPush('notifications:user:123', 'New message');
  const notifications = await client.lRange('notifications:user:123', 0, 9);
  
  // Set operations
  await client.sAdd('active-users', 'user123', 'user456');
  const activeUsers = await client.sMembers('active-users');
  
  // Sorted set operations
  await client.zAdd('leaderboard', [
    { score: 100, value: 'player1' },
    { score: 85, value: 'player2' }
  ]);
  const topPlayers = await client.zRevRange('leaderboard', 0, 4);
  
  // Pub/Sub
  await client.publish('notifications', JSON.stringify({ message: 'Hello!' }));
}
```

## Common Use Cases

### 1. Caching API Responses

```javascript
import { redisService } from './services/redis.js';

class ApiCache {
  static async getCachedResponse(endpoint) {
    const key = `api:${endpoint}`;
    const cached = await redisService.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  static async setCachedResponse(endpoint, data, ttlSeconds = 300) {
    const key = `api:${endpoint}`;
    return await redisService.set(key, JSON.stringify(data), { EX: ttlSeconds });
  }

  static async invalidateCache(endpoint) {
    const key = `api:${endpoint}`;
    return await redisService.del(key);
  }
}

// Usage in route handler
export const getUserProfile = async (userId) => {
  const cacheKey = `user-profile-${userId}`;
  
  // Try cache first
  let profile = await ApiCache.getCachedResponse(cacheKey);
  if (profile) {
    return { ...profile, fromCache: true };
  }
  
  // Fetch from database
  profile = await database.getUserProfile(userId);
  
  // Cache for 5 minutes
  await ApiCache.setCachedResponse(cacheKey, profile, 300);
  
  return { ...profile, fromCache: false };
};
```

### 2. Session Management

```javascript
class SessionManager {
  static async createSession(userId, sessionData) {
    const sessionId = generateSessionId();
    const key = `session:${sessionId}`;
    
    const data = {
      userId,
      createdAt: new Date().toISOString(),
      ...sessionData
    };
    
    // Session expires in 24 hours
    await redisService.set(key, JSON.stringify(data), { EX: 86400 });
    return sessionId;
  }

  static async getSession(sessionId) {
    const key = `session:${sessionId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  static async updateSession(sessionId, updates) {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    const updatedSession = { ...session, ...updates };
    const key = `session:${sessionId}`;
    
    return await redisService.set(key, JSON.stringify(updatedSession), { EX: 86400 });
  }

  static async destroySession(sessionId) {
    const key = `session:${sessionId}`;
    return await redisService.del(key);
  }

  static async extendSession(sessionId, additionalSeconds = 3600) {
    const key = `session:${sessionId}`;
    return await redisService.expire(key, additionalSeconds);
  }
}

// Usage
const sessionId = await SessionManager.createSession('user123', { 
  role: 'admin', 
  permissions: ['read', 'write'] 
});

const session = await SessionManager.getSession(sessionId);
console.log('User ID:', session?.userId);
```

### 3. Rate Limiting

```javascript
class RateLimiter {
  static async checkRateLimit(identifier, limit = 100, windowSeconds = 3600) {
    const key = `rate_limit:${identifier}`;
    const client = redisService.getClient();
    
    if (!client) {
      // Fallback when Redis is not available
      return { allowed: true, remaining: limit };
    }

    // Use Redis pipeline for atomic operations
    const pipeline = client.multi();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds);
    
    const results = await pipeline.exec();
    const count = results[0][1];

    if (count > limit) {
      const ttl = await client.ttl(key);
      return { 
        allowed: false, 
        remaining: 0, 
        resetTime: Date.now() + (ttl * 1000) 
      };
    }

    return { 
      allowed: true, 
      remaining: limit - count 
    };
  }

  static async resetRateLimit(identifier) {
    const key = `rate_limit:${identifier}`;
    return await redisService.del(key);
  }
}

// Usage in middleware
export const rateLimitMiddleware = async (request) => {
  const clientIP = request.headers['x-forwarded-for'] || request.ip;
  const limit = await RateLimiter.checkRateLimit(clientIP, 1000, 3600);
  
  if (!limit.allowed) {
    return new Response('Rate limit exceeded', { 
      status: 429,
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': limit.resetTime.toString()
      }
    });
  }

  // Continue to next handler
  request.rateLimitInfo = limit;
};
```

### 4. Real-time Data Storage

```javascript
class RealtimeDataManager {
  // Store WebSocket room participants
  static async addUserToRoom(roomId, userId, userInfo = {}) {
    const key = `room:${roomId}:users`;
    const userData = { ...userInfo, joinedAt: Date.now() };
    
    return await redisService.hSet(key, userId, JSON.stringify(userData));
  }

  static async removeUserFromRoom(roomId, userId) {
    const key = `room:${roomId}:users`;
    const client = redisService.getClient();
    
    if (client) {
      return await client.hDel(key, userId);
    }
    return false;
  }

  static async getRoomUsers(roomId) {
    const key = `room:${roomId}:users`;
    const users = await redisService.hGetAll(key);
    
    // Parse user data
    const parsedUsers = {};
    for (const [userId, userData] of Object.entries(users)) {
      try {
        parsedUsers[userId] = JSON.parse(userData);
      } catch (e) {
        parsedUsers[userId] = { error: 'Invalid data' };
      }
    }
    
    return parsedUsers;
  }

  // Store recent messages for a room
  static async storeMessage(roomId, message) {
    const key = `room:${roomId}:messages`;
    const client = redisService.getClient();
    
    if (client) {
      const messageData = {
        ...message,
        timestamp: Date.now()
      };
      
      // Add to list and keep only last 100 messages
      await client.lPush(key, JSON.stringify(messageData));
      await client.lTrim(key, 0, 99);
      
      // Set expiration for automatic cleanup
      await client.expire(key, 86400); // 24 hours
      
      return true;
    }
    return false;
  }

  static async getRecentMessages(roomId, count = 10) {
    const key = `room:${roomId}:messages`;
    const client = redisService.getClient();
    
    if (client) {
      const messages = await client.lRange(key, 0, count - 1);
      return messages.map(msg => JSON.parse(msg));
    }
    return [];
  }
}

// Usage in WebSocket handler
export const handleWebSocketConnection = async (ws, roomId, userId) => {
  // Add user to room
  await RealtimeDataManager.addUserToRoom(roomId, userId, {
    connectionId: ws.id,
    userAgent: ws.headers['user-agent']
  });

  // Send recent messages
  const recentMessages = await RealtimeDataManager.getRecentMessages(roomId);
  ws.send(JSON.stringify({ type: 'history', messages: recentMessages }));

  ws.on('message', async (data) => {
    const message = JSON.parse(data);
    
    // Store message
    await RealtimeDataManager.storeMessage(roomId, {
      userId,
      content: message.content,
      type: message.type
    });

    // Broadcast to room (implementation depends on your WebSocket setup)
    broadcastToRoom(roomId, message);
  });

  ws.on('close', async () => {
    await RealtimeDataManager.removeUserFromRoom(roomId, userId);
  });
};
```

### 5. Distributed Locks

```javascript
class DistributedLock {
  static async acquireLock(resource, ttlSeconds = 30) {
    const key = `lock:${resource}`;
    const token = generateUniqueToken();
    const client = redisService.getClient();
    
    if (!client) return null;

    // Use SET with NX (only if key doesn't exist) and EX (expiration)
    const result = await client.set(key, token, { NX: true, EX: ttlSeconds });
    
    return result === 'OK' ? token : null;
  }

  static async releaseLock(resource, token) {
    const key = `lock:${resource}`;
    const client = redisService.getClient();
    
    if (!client) return false;

    // Use Lua script for atomic check and delete
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await client.eval(script, 1, key, token);
    return result === 1;
  }

  static async withLock(resource, operation, ttlSeconds = 30) {
    const token = await this.acquireLock(resource, ttlSeconds);
    
    if (!token) {
      throw new Error(`Could not acquire lock for resource: ${resource}`);
    }

    try {
      return await operation();
    } finally {
      await this.releaseLock(resource, token);
    }
  }
}

// Usage
const result = await DistributedLock.withLock('user:123:update', async () => {
  // Critical section - only one process can execute this at a time
  const user = await database.getUser('123');
  user.balance += 100;
  await database.saveUser(user);
  return user;
});
```

## Health Check

```javascript
// Get detailed Redis health information
const healthInfo = await redisService.healthCheck();
console.log(healthInfo);
/* Output:
{
  status: "connected",
  latency: "2ms",
  host: "localhost",
  port: 6379
}
*/

// Use in health endpoint
export const healthEndpoint = async () => {
  const redis = await redisService.healthCheck();
  
  return {
    status: redis.status === 'connected' ? 'healthy' : 'unhealthy',
    services: {
      redis
    },
    timestamp: new Date().toISOString()
  };
};
```

## Development Mode

In development mode, the Redis service provides fallback behavior:

- **No Connection Required**: Operations return default values instead of throwing errors
- **Graceful Degradation**: Application continues running without Redis
- **Warning Logs**: Clear warnings when operations are skipped

```javascript
// In development without Redis, this will log a warning and return null
const data = await redisService.get('some-key');
// Output: "Redis not connected - skipping GET operation"
// Returns: null
```

## Best Practices

### 1. Key Naming Convention

Use hierarchical, descriptive key names:

```javascript
// Good - hierarchical and descriptive
await redisService.set('user:123:profile', data);
await redisService.set('session:abc123:data', sessionData);
await redisService.set('cache:api:user-list:page-1', userData);

// Avoid - unclear or conflicting
await redisService.set('data', something);
await redisService.set('user', userData);
```

### 2. Expiration Strategy

Always set appropriate expiration times:

```javascript
// Session data - expires when user session should end
await redisService.set('session:123', data, { EX: 86400 }); // 24 hours

// Cache data - expires when data might be stale
await redisService.set('cache:user:123', data, { EX: 300 }); // 5 minutes

// Temporary data - expires soon
await redisService.set('temp:upload:456', data, { EX: 60 }); // 1 minute
```

### 3. Error Handling

Always handle Redis errors gracefully:

```javascript
const getCachedData = async (key) => {
  try {
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis get error:', error);
    // Return null or default value, don't crash the application
    return null;
  }
};
```

### 4. Connection Management

Implement proper connection lifecycle:

```javascript
// Application startup
const initializeServices = async () => {
  await redisService.connect();
  console.log('Redis connected');
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await redisService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM...');
  await redisService.disconnect();
  process.exit(0);
});
```

## Performance Tips

### 1. Use Pipelines for Multiple Operations

```javascript
const client = redisService.getClient();
if (client) {
  const pipeline = client.multi();
  
  pipeline.set('key1', 'value1');
  pipeline.set('key2', 'value2');
  pipeline.set('key3', 'value3');
  
  const results = await pipeline.exec();
  console.log('All operations completed:', results);
}
```

### 2. Batch Operations

```javascript
// Instead of multiple individual operations
// for (const user of users) {
//   await redisService.set(`user:${user.id}`, JSON.stringify(user));
// }

// Use batch operations
const client = redisService.getClient();
if (client) {
  const pipeline = client.multi();
  
  users.forEach(user => {
    pipeline.set(`user:${user.id}`, JSON.stringify(user));
  });
  
  await pipeline.exec();
}
```

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check if Redis server is running
2. **Timeout Errors**: Increase `connectTimeout` if needed
3. **Memory Issues**: Monitor Redis memory usage and set appropriate policies
4. **TLS Errors**: Verify TLS configuration for cloud services

### Debug Information

```javascript
// Check connection status
console.log('Connected:', redisService.isConnected);

// Get raw client for debugging
const client = redisService.getClient();
if (client) {
  console.log('Client ready:', client.isReady);
}

// Test basic operations
const testRedis = async () => {
  try {
    await redisService.set('test-key', 'test-value');
    const value = await redisService.get('test-key');
    console.log('Test successful, value:', value);
    await redisService.del('test-key');
  } catch (error) {
    console.error('Redis test failed:', error);
  }
};
```

## Production Considerations

1. **Persistence**: Configure appropriate persistence settings (RDB/AOF)
2. **Memory Management**: Set memory policies and monitoring
3. **Security**: Use AUTH, TLS, and network restrictions
4. **Monitoring**: Implement Redis monitoring and alerting
5. **Backup**: Regular backups of critical data
6. **High Availability**: Consider Redis Cluster or Sentinel for HA
7. **Connection Pooling**: Configure appropriate connection limits
8. **Key Expiration**: Monitor and manage key expiration policies