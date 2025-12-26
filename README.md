# Narad - Real-time Messaging Platform

A high-performance Node.js application built with Elysia and Bun runtime, featuring Kafka messaging and Redis caching.

## Features

- 🚀 **High Performance**: Built on Bun runtime for optimal performance
- 📨 **Message Streaming**: Apache Kafka integration for reliable messaging
- ⚡ **Fast Caching**: Redis integration for session management and caching  
- 🔧 **Development Friendly**: Fallback modes for development without external services
- 📊 **Health Monitoring**: Built-in health checks and service monitoring
- 🔒 **Production Ready**: SSL/TLS and authentication support

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- Redis server (optional for development)
- Apache Kafka (optional for development)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd narad

# Install dependencies
bun install

# Create environment file
cp .env.example .env.local
```

### Configuration

Edit `.env.local` with your service configurations:

```bash
# Application
NODE_ENV=development

# Kafka Configuration (optional for development)
KAFKA_CLIENT_ID=narad
KAFKA_BROKERS=localhost:9092

# Redis Configuration (optional for development)  
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Development

Start the development server:

```bash
bun run dev
```

The server will start on http://localhost:8080/ with hot reloading enabled.

## Documentation

### Service Documentation
- 📖 [Services Overview](./docs/SERVICES_OVERVIEW.md) - Complete guide to Kafka and Redis integration
- 🔄 [Kafka Usage Guide](./docs/KAFKA_USAGE.md) - Detailed Kafka service documentation  
- 📦 [Redis Usage Guide](./docs/REDIS_USAGE.md) - Comprehensive Redis service guide

### API Documentation
- 🏥 Health Check: `GET /health` - Service health status
- 🔌 WebSocket: Available for real-time messaging

## Architecture

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

## Development Mode

The application includes development-friendly features:

- **Service Fallbacks**: Works without Kafka/Redis in development
- **Mock Data**: Simulated service responses when external services unavailable
- **Debug Logging**: Detailed logs for troubleshooting
- **Hot Reload**: Automatic restart on code changes

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Configure external Kafka and Redis services
3. Set up SSL/TLS certificates
4. Configure authentication credentials
5. Enable monitoring and logging

See the [Services Overview](./docs/SERVICES_OVERVIEW.md) for detailed production configuration.