# Kafka Service Documentation

## Overview

The Kafka service provides a comprehensive wrapper around KafkaJS to handle message production and consumption in the Narad application. It includes automatic reconnection, development mode fallbacks, and proper error handling.

## Configuration

### Environment Variables

Set the following environment variables in your `.env` file:

```bash
# Kafka Configuration
KAFKA_CLIENT_ID=narad
KAFKA_BROKERS=localhost:9092,localhost:9093
KAFKA_SSL=false

# Authentication (optional)
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=your_username
KAFKA_SASL_PASSWORD=your_password
```

### Configuration Details

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_CLIENT_ID` | `narad` | Unique identifier for the Kafka client |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated list of broker addresses |
| `KAFKA_SSL` | `false` | Enable SSL/TLS connection |
| `KAFKA_SASL_MECHANISM` | `plain` | SASL authentication mechanism |
| `KAFKA_SASL_USERNAME` | - | Username for SASL authentication |
| `KAFKA_SASL_PASSWORD` | - | Password for SASL authentication |

## Basic Usage

### Importing the Service

```javascript
import { kafkaService } from './services/kafka.js';
```

### Producer Usage

#### Initialize and Connect Producer

```javascript
// Initialize and connect producer
await kafkaService.init().connectProducer();

// Send single message
await kafkaService.send('user-events', {
  userId: '123',
  action: 'login',
  timestamp: new Date().toISOString()
});

// Send multiple messages
await kafkaService.send('user-events', [
  { userId: '123', action: 'login' },
  { userId: '124', action: 'logout' }
]);
```

#### Producer Example

```javascript
import { kafkaService } from './services/kafka.js';

class UserEventService {
  static async init() {
    await kafkaService.init().connectProducer();
  }

  static async publishUserLogin(userId, metadata = {}) {
    const event = {
      type: 'USER_LOGIN',
      userId,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    await kafkaService.send('user-events', event);
    console.log(`Published login event for user: ${userId}`);
  }

  static async publishUserAction(userId, action, data = {}) {
    const event = {
      type: 'USER_ACTION',
      userId,
      action,
      data,
      timestamp: new Date().toISOString()
    };

    await kafkaService.send('user-activity', event);
  }
}

// Usage
await UserEventService.init();
await UserEventService.publishUserLogin('user123', { ip: '192.168.1.1' });
```

### Consumer Usage

#### Basic Consumer Setup

```javascript
// Initialize and connect consumer
await kafkaService.init().connectConsumer('my-consumer-group');

// Subscribe to topic with message handler
await kafkaService.subscribe('user-events', async (message, { topic, partition }) => {
  console.log('Received message:', message);
  console.log('From topic:', topic, 'partition:', partition);
  
  // Process the message
  if (message.type === 'USER_LOGIN') {
    await handleUserLogin(message);
  }
});
```

#### Advanced Consumer Example

```javascript
import { kafkaService } from './services/kafka.js';

class EventProcessor {
  static async init() {
    await kafkaService.init().connectConsumer('event-processor');
  }

  static async startProcessing() {
    // Subscribe to multiple topics if needed
    await kafkaService.subscribe('user-events', this.handleUserEvent);
    await kafkaService.subscribe('system-events', this.handleSystemEvent);
  }

  static async handleUserEvent(message, context) {
    try {
      const { type, userId, timestamp } = message;
      
      switch (type) {
        case 'USER_LOGIN':
          await this.processUserLogin(userId, message);
          break;
        case 'USER_ACTION':
          await this.processUserAction(userId, message);
          break;
        default:
          console.log('Unknown user event type:', type);
      }
    } catch (error) {
      console.error('Error processing user event:', error);
      // Implement error handling strategy (retry, dead letter queue, etc.)
    }
  }

  static async processUserLogin(userId, data) {
    // Update user last login timestamp
    // Send welcome notifications
    // Update analytics
    console.log(`Processing login for user: ${userId}`);
  }
}

// Initialize and start processing
await EventProcessor.init();
await EventProcessor.startProcessing();
```

## Development Mode

In development mode, the Kafka service provides fallback behavior:

- **No Connection Required**: Messages are logged to console instead of being sent
- **Graceful Degradation**: Application continues running without Kafka
- **Debug Logging**: Detailed logs for troubleshooting

```javascript
// In development, this will log instead of sending
await kafkaService.send('test-topic', { message: 'Hello World' });
// Output: [DEV] Would send to test-topic: { message: 'Hello World' }
```

## Error Handling

### Producer Error Handling

```javascript
try {
  await kafkaService.send('topic', message);
} catch (error) {
  if (error.message.includes('not connected')) {
    console.log('Kafka not available, implementing fallback...');
    // Implement fallback strategy (database, file, etc.)
  } else {
    console.error('Kafka send error:', error);
    // Handle other errors
  }
}
```

### Consumer Error Handling

```javascript
await kafkaService.subscribe('topic', async (message, context) => {
  try {
    await processMessage(message);
  } catch (error) {
    console.error('Message processing failed:', error);
    
    // Implement retry logic or dead letter queue
    if (shouldRetry(error)) {
      await retryMessage(message);
    } else {
      await sendToDeadLetterQueue(message, error);
    }
  }
});
```

## Best Practices

### 1. Topic Naming Convention

Use descriptive, hierarchical topic names:

```javascript
// Good
await kafkaService.send('user.events.login', data);
await kafkaService.send('order.processing.payment', data);
await kafkaService.send('system.alerts.error', data);

// Avoid
await kafkaService.send('events', data);
await kafkaService.send('data', data);
```

### 2. Message Schema

Always include consistent message structure:

```javascript
const messageSchema = {
  id: 'unique-message-id',
  type: 'MESSAGE_TYPE',
  version: '1.0',
  timestamp: new Date().toISOString(),
  source: 'service-name',
  data: {
    // Your actual data
  }
};

await kafkaService.send('topic', messageSchema);
```

### 3. Consumer Groups

Use meaningful consumer group names for different services:

```javascript
// Different services processing the same topic
await kafkaService.connectConsumer('analytics-service');
await kafkaService.connectConsumer('notification-service');
await kafkaService.connectConsumer('audit-service');
```

### 4. Graceful Shutdown

Always disconnect Kafka services on application shutdown:

```javascript
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await kafkaService.disconnect();
  process.exit(0);
});
```

## Monitoring and Health Checks

### Connection Status

```javascript
// Check if producer is connected
console.log('Kafka connected:', kafkaService.isConnected);

// Implement health check endpoint
app.get('/health/kafka', async () => {
  return {
    status: kafkaService.isConnected ? 'connected' : 'disconnected',
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers
  };
});
```

## Common Patterns

### 1. Event Sourcing

```javascript
class OrderEventSourcing {
  static async publishOrderCreated(order) {
    await kafkaService.send('orders.events', {
      type: 'ORDER_CREATED',
      orderId: order.id,
      customerId: order.customerId,
      items: order.items,
      total: order.total,
      timestamp: new Date().toISOString()
    });
  }

  static async publishOrderUpdated(orderId, changes) {
    await kafkaService.send('orders.events', {
      type: 'ORDER_UPDATED',
      orderId,
      changes,
      timestamp: new Date().toISOString()
    });
  }
}
```

### 2. Saga Pattern

```javascript
class OrderSagaOrchestrator {
  static async init() {
    await kafkaService.init().connectConsumer('order-saga');
    await kafkaService.subscribe('orders.events', this.handleOrderEvent);
  }

  static async handleOrderEvent(message) {
    switch (message.type) {
      case 'ORDER_CREATED':
        await this.startOrderSaga(message);
        break;
      case 'PAYMENT_COMPLETED':
        await this.continueOrderSaga(message);
        break;
      // Handle other saga steps
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **Connection Timeout**: Increase `connectionTimeout` in configuration
2. **Authentication Errors**: Verify SASL credentials
3. **Topic Not Found**: Ensure topic exists or enable auto-creation
4. **SSL Issues**: Check certificate configuration

### Debug Mode

Enable debug logging:

```javascript
// In development, debug logs are automatically enabled
// You'll see detailed connection and message logs
```

### Test Connection

```javascript
// Test basic connectivity
const testKafka = async () => {
  try {
    await kafkaService.init().connectProducer();
    await kafkaService.send('test-topic', { test: true });
    console.log('Kafka connection successful');
  } catch (error) {
    console.error('Kafka connection failed:', error.message);
  }
};
```

## Production Considerations

1. **Monitoring**: Implement proper monitoring and alerting
2. **Partitioning**: Consider message ordering and partitioning strategy
3. **Retention**: Configure appropriate message retention policies
4. **Security**: Use SSL/TLS and SASL authentication
5. **Performance**: Tune batch settings and compression
6. **Backup**: Implement disaster recovery procedures