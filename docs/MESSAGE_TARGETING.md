# Message Targeting: User vs Session Level

This document explains how to send messages to either **all sessions of a user** or **a specific session** in the Narad messaging system.

## Overview

The Narad messaging system supports two types of message targeting:

1. **User-level targeting**: Send messages to all active sessions of a user
2. **Session-level targeting**: Send messages to a specific session only

## API Endpoints

### 1. Send Message to All User Sessions

**Endpoint**: `POST /api/messaging/send`

**Use Case**: When you want to notify a user across all their active devices/browsers.

**Request Body**:
```json
{
  "userId": "6312299418cefa73a6bc7fe4",
  "messageData": {
    "title": "New Notification",
    "body": "You have a new message",
    "type": "notification"
  },
  "messageType": "notification"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Message queued for delivery to all user sessions",
  "data": {
    "userId": "6312299418cefa73a6bc7fe4",
    "messageData": {...},
    "messageType": "notification",
    "timestamp": "2025-12-29T10:30:00.000Z",
    "source": "api",
    "targetType": "user"
  }
}
```

### 2. Send Message to Specific Session

**Endpoint**: `POST /api/messaging/send-to-session`

**Use Case**: When you want to send a message to a specific browser tab/device session only.

**Request Body**:
```json
{
  "sessionId": "69e17040-f59b-4115-b6db-29cee29485c3",
  "messageData": {
    "title": "Session Specific",
    "body": "This message is only for this session",
    "type": "session_notification"
  },
  "messageType": "notification"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Message queued for delivery to specific session",
  "data": {
    "sessionId": "69e17040-f59b-4115-b6db-29cee29485c3",
    "messageData": {...},
    "messageType": "notification",
    "timestamp": "2025-12-29T10:30:00.000Z",
    "source": "api",
    "targetType": "session"
  }
}
```

### 3. Broadcast to All Connected Users

**Endpoint**: `POST /api/messaging/broadcast`

**Use Case**: System-wide announcements or maintenance notifications.

**Request Body**:
```json
{
  "messageData": {
    "title": "System Maintenance",
    "body": "The system will be down for maintenance in 10 minutes",
    "type": "system_announcement"
  },
  "messageType": "broadcast"
}
```

## Backend Integration Examples

### Node.js/Express Example

```javascript
const axios = require('axios');

const NARAD_BASE_URL = 'http://localhost:8080';

// Send to all user sessions
async function sendToUser(userId, message) {
  try {
    const response = await axios.post(`${NARAD_BASE_URL}/api/messaging/send`, {
      userId,
      messageData: message,
      messageType: 'notification'
    });
    return response.data;
  } catch (error) {
    console.error('Error sending to user:', error.response?.data || error.message);
    throw error;
  }
}

// Send to specific session
async function sendToSession(sessionId, message) {
  try {
    const response = await axios.post(`${NARAD_BASE_URL}/api/messaging/send-to-session`, {
      sessionId,
      messageData: message,
      messageType: 'notification'
    });
    return response.data;
  } catch (error) {
    console.error('Error sending to session:', error.response?.data || error.message);
    throw error;
  }
}

// Usage examples
await sendToUser('6312299418cefa73a6bc7fe4', {
  title: 'Welcome Back!',
  body: 'You have 3 new messages'
});

await sendToSession('69e17040-f59b-4115-b6db-29cee29485c3', {
  title: 'Tab Specific',
  body: 'This notification is only for this browser tab'
});
```

### Python/FastAPI Example

```python
import httpx
import asyncio

NARAD_BASE_URL = "http://localhost:8080"

async def send_to_user(user_id: str, message: dict):
    """Send message to all sessions of a user"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{NARAD_BASE_URL}/api/messaging/send",
            json={
                "userId": user_id,
                "messageData": message,
                "messageType": "notification"
            }
        )
        return response.json()

async def send_to_session(session_id: str, message: dict):
    """Send message to specific session only"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{NARAD_BASE_URL}/api/messaging/send-to-session",
            json={
                "sessionId": session_id,
                "messageData": message,
                "messageType": "notification"
            }
        )
        return response.json()

# Usage examples
await send_to_user("6312299418cefa73a6bc7fe4", {
    "title": "Order Update",
    "body": "Your order has been shipped"
})

await send_to_session("69e17040-f59b-4115-b6db-29cee29485c3", {
    "title": "Session Alert",
    "body": "This alert is only for this browser session"
})
```

## When to Use Each Method

### Use User-Level Targeting When:
- ✅ Sending notifications that should appear on all user's devices
- ✅ Important updates that users should see regardless of which device they're using
- ✅ General notifications (messages, alerts, system updates)
- ✅ Push notifications that should sync across devices

**Examples**:
- New message notifications
- Order status updates  
- Security alerts
- Friend requests
- System announcements

### Use Session-Level Targeting When:
- ✅ Sending contextual information specific to a browser tab/session
- ✅ Temporary UI updates that shouldn't affect other sessions
- ✅ Session-specific workflows or wizards
- ✅ Real-time collaborative features where each session has different context

**Examples**:
- Form validation errors in a specific tab
- Shopping cart updates in a specific session
- Real-time collaborative editing cursors
- Tab-specific loading states
- Session-specific feature tours

## Message Structure

### Standard Message Format
```json
{
  "type": "notification",
  "data": {
    "title": "Message Title",
    "body": "Message content",
    "timestamp": "2025-12-29T10:30:00.000Z",
    "metadata": {
      "actionUrl": "/some-action",
      "priority": "high",
      "category": "user_notification"
    }
  }
}
```

### Message Types
- `notification`: Standard user notifications
- `system`: System-level messages
- `broadcast`: Messages for all users
- `error`: Error notifications
- `success`: Success confirmations
- `warning`: Warning messages
- `info`: Informational messages

## Testing

### Health Dashboard
The system includes a health dashboard at `/health/dashboard` where you can:
- View all connected users and their sessions
- Test message delivery to all user sessions
- Test message delivery to specific sessions
- Monitor connection statistics

### Test Endpoints
- `GET /health/test-message/:userId` - Test message to all user sessions
- `GET /health/test-session/:sessionId` - Test message to specific session

## Error Handling

### Common Error Responses

**User Not Connected**:
```json
{
  "success": false,
  "error": "No active connections found for user"
}
```

**Session Not Found**:
```json
{
  "success": false,
  "error": "No active connection found for session"
}
```

**Invalid Request**:
```json
{
  "success": false,
  "error": "userId and messageData are required"
}
```

## Technical Architecture

The system uses a hybrid approach:
1. **Kafka**: For reliable message queuing and routing
2. **WebSocket Manager**: For direct real-time delivery
3. **Redis**: For session persistence and scaling

Messages are routed through Kafka first, then delivered via WebSocket connections. This ensures reliability and proper logging while maintaining real-time performance.

## Session Management

- **Session ID**: Generated when a WebSocket connection is established
- **User ID**: Associated with the session during authentication  
- **Multiple Sessions**: Users can have multiple active sessions (different browser tabs/devices)
- **Session Cleanup**: Dead connections are automatically cleaned up

## Monitoring

Monitor message delivery through:
- Connection statistics at `/api/messaging/status`
- User connection info at `/api/messaging/users`
- Health dashboard at `/health/dashboard`
- Kafka logs for message routing
- WebSocket connection logs

## Best Practices

1. **Always validate** user/session existence before sending
2. **Use appropriate targeting** based on your use case
3. **Include meaningful message types** for client-side handling
4. **Implement retry logic** for failed deliveries
5. **Monitor delivery rates** and connection health
6. **Structure messages consistently** for easier client-side processing
7. **Use session targeting sparingly** - most notifications should be user-level

## Security Considerations

- Validate user permissions before sending messages
- Sanitize message content to prevent XSS
- Rate limit message sending to prevent abuse
- Log message delivery for audit purposes
- Ensure session IDs are not exposed to unauthorized users