#!/usr/bin/env node

/**
 * System Health Check Script
 * Run this to test all components of your messaging system
 */

import { config } from './src/config/env.js';

const BASE_URL = `http://localhost:${config.port}`;

async function testEndpoint(name, url, expectedStatus = 200) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ ${name}: ${response.status === expectedStatus ? 'PASS' : 'FAIL'}`);
    if (response.status !== expectedStatus) {
      console.log(`   Status: ${response.status}, Expected: ${expectedStatus}`);
    }
    console.log(`   Data:`, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.log(`❌ ${name}: FAIL - ${error.message}`);
    return false;
  }
}

async function testWebSocket() {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://localhost:${config.port}/ws`);
      let connected = false;
      
      ws.onopen = () => {
        connected = true;
        console.log('✅ WebSocket Connection: PASS');
        
        // Test authentication
        ws.send(JSON.stringify({
          type: "auth",
          userId: "test-user-123"
        }));
      };
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('   WebSocket Message:', message);
        
        if (message.type === "auth_success") {
          console.log('✅ WebSocket Authentication: PASS');
          ws.close();
          resolve(true);
        }
      };
      
      ws.onerror = (error) => {
        console.log('❌ WebSocket Connection: FAIL -', error.message);
        resolve(false);
      };
      
      ws.onclose = () => {
        if (!connected) {
          console.log('❌ WebSocket Connection: FAIL - Connection closed immediately');
          resolve(false);
        }
      };
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (!connected) {
          console.log('❌ WebSocket Connection: TIMEOUT');
          ws.close();
          resolve(false);
        }
      }, 5000);
      
    } catch (error) {
      console.log('❌ WebSocket Connection: FAIL -', error.message);
      resolve(false);
    }
  });
}

async function testMessageSending() {
  try {
    const response = await fetch(`${BASE_URL}/api/messaging/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'test-user-123',
        messageData: {
          type: 'test',
          message: 'Hello from test script!'
        },
        messageType: 'notification'
      })
    });
    
    const data = await response.json();
    console.log(`✅ Message Sending API: ${data.success ? 'PASS' : 'FAIL'}`);
    console.log('   Response:', JSON.stringify(data, null, 2));
    return data.success;
  } catch (error) {
    console.log(`❌ Message Sending API: FAIL - ${error.message}`);
    return false;
  }
}

async function runHealthChecks() {
  console.log('🔍 Starting System Health Checks...\n');
  console.log(`Testing server at: ${BASE_URL}\n`);
  
  // Test basic endpoints
  await testEndpoint('Basic Health Check', `${BASE_URL}/health`);
  await testEndpoint('Service Readiness', `${BASE_URL}/health/ready`);
  await testEndpoint('Kafka Health', `${BASE_URL}/health/kafka`);
  await testEndpoint('WebSocket Stats', `${BASE_URL}/health/websockets`);
  
  console.log('\n🔗 Testing WebSocket Connection...');
  await testWebSocket();
  
  console.log('\n📨 Testing Message API...');
  await testMessageSending();
  
  console.log('\n📊 Getting System Status...');
  await testEndpoint('Connected Users', `${BASE_URL}/api/messaging/users/connected`);
  await testEndpoint('System Stats', `${BASE_URL}/api/messaging/stats`);
  
  console.log('\n🏁 Health checks complete!');
  console.log('\n💡 To test message delivery:');
  console.log('1. Open a WebSocket connection to ws://localhost:3000/ws');
  console.log('2. Send auth message: {"type": "auth", "userId": "your-user-id"}');
  console.log('3. Send a test message via: curl -X POST http://localhost:3000/health/test-message/your-user-id');
}

// Run the health checks
runHealthChecks().catch(console.error);