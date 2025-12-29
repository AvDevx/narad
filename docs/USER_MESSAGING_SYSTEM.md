# User Messaging System

The Narad project has been updated to support user-targeted messaging through WebSocket connections and Kafka message routing.

## Overview

The system maintains a global list of connected users and routes messages from Kafka to the appropriate WebSocket connections based on user IDs.

## Key Components

### 1. User Connection Manager (`src/services/userConnectionManager.js`)
- Maintains in-memory mapping of user IDs to WebSocket connections
- Supports multiple connections per user
- Persists connection data in Redis for scaling
- Provides connection statistics and management

### 2. Message Routing Service (`src/services/messageRoutingService.js`)
- Consumes messages from Kafka topic `websocket-inbound`
- Routes messages to connected users via WebSocket
- Handles undelivered messages (logs to `user-messages-undelivered` topic)
- Provides broadcast functionality

### 3. Enhanced WebSocket Routes (`src/domains/messaging/routes/websocket.routes.js`)
- Requires user authentication on connection
- Maintains heartbeat for connected users
- Logs user events to Kafka

### 4. Messaging API (`src/domains/messaging/routes/messaging-api.routes.js`)
- REST API for sending messages to users
- System status and connection monitoring
- User connection management

## WebSocket Connection Flow

1. **Connection**: Client connects to `ws://localhost:8080/ws`
2. **Authentication**: Client sends authentication message:
   ```json
   {
     "type": "auth",
     "userId": "user123"
   }
   ```
3. **Confirmation**: Server responds with authentication success
4. **Messaging**: User can now send/receive messages

## Kafka Topics

### Input Topic: `websocket-inbound`
Messages sent to this topic will be routed to connected users:
```json
{
  "userId": "user123",
  "messageData": {
    "title": "New Notification",
    "body": "You have a new message"
  },
  "messageType": "notification"
}
```

### Output Topics:
- `websocket`: User events, system events, undelivered messages, and heartbeats

## API Endpoints

### Send Message to User
```http
POST /api/messaging/send
Content-Type: application/json

{
  "userId": "user123",
  "messageData": {
    "title": "Hello",
    "message": "This is a test message"
  },
  "messageType": "notification"
}
```

### Broadcast Message
```http
POST /api/messaging/broadcast
Content-Type: application/json

{
  "messageData": {
    "announcement": "Server maintenance in 30 minutes"
  },
  "messageType": "broadcast"
}
```

### Get System Status
```http
GET /api/messaging/status
```

### Get Connected Users
```http
GET /api/messaging/users
```

### Get User Connection Info
```http
GET /api/messaging/users/{userId}
```

## Usage Examples

### 1. Connecting a User
```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    userId: 'user123'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

### 2. Sending Message via Kafka
```javascript
// Using KafkaJS client
await producer.send({
  topic: 'websocket-inbound',
  messages: [{
    value: JSON.stringify({
      userId: 'user123',
      messageData: {
        type: 'notification',
        title: 'New Message',
        body: 'You have received a new message'
      },
      messageType: 'notification'
    })
  }]
});
```

### 3. Sending Message via API
```javascript
fetch('/api/messaging/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    userId: 'user123',
    messageData: {
      alert: 'Important notification'
    },
    messageType: 'alert'
  })
});
```

## Features

- ✅ Multiple connections per user supported
- ✅ Real-time message delivery via WebSocket
- ✅ Kafka-based message routing
- ✅ Connection persistence in Redis
- ✅ Undelivered message handling
- ✅ System monitoring and statistics
- ✅ Broadcast messaging
- ✅ REST API for message management
- ✅ User authentication for WebSocket connections
- ✅ Heartbeat monitoring
- ✅ Graceful connection cleanup

## Configuration

The system uses the existing Kafka and Redis configurations in `src/config/env.js`. No additional configuration is required.

## Monitoring

- Connection statistics available via `/api/messaging/status`
- Kafka events logged for user connections, disconnections, and heartbeats
- Failed message deliveries logged to `user-messages-undelivered` topic
- Console logging for all major events

## Development

Run the development server:
```bash
bun run dev
```

The system will work in development mode even without Kafka/Redis connections, with appropriate logging for testing.