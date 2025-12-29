import { Elysia } from "elysia";
import { redisService } from "../../../services/redis.js";
import { kafkaService } from "../../../services/kafka.js";
import { userConnectionManager } from "../../../services/userConnectionManager.js";
import { messageRoutingService } from "../../../services/messageRoutingService.js";

export const healthRoutes = new Elysia({ prefix: "/health" })
  .get("/", async () => {
    const redisHealth = await redisService.healthCheck();
    const kafkaHealth = await checkKafkaHealth();
    const wsConnections = userConnectionManager.getConnectionStats();
    
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealth,
        kafka: kafkaHealth,
        websocket: {
          status: "active",
          connections: wsConnections
        },
        messageRouter: {
          status: messageRoutingService.isRunning() ? "running" : "stopped"
        }
      },
    };
  })
  .get("/dashboard", async () => {
    // Return HTML dashboard UI
    return new Response(createHealthDashboard(), {
      headers: { "Content-Type": "text/html" }
    });
  })
  .get("/ready", async () => {
    const redisHealth = await redisService.healthCheck();
    const kafkaHealth = await checkKafkaHealth();
    const isReady = redisHealth.status === "connected" && kafkaHealth.status !== "error";
    
    return {
      status: isReady ? "ready" : "not ready",
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealth,
        kafka: kafkaHealth,
      },
    };
  })
  .get("/live", () => ({
    status: "live",
    timestamp: new Date().toISOString(),
  }))
  .get("/kafka", async () => {
    return await checkKafkaHealth();
  })
  .get("/websockets", () => {
    const stats = userConnectionManager.getConnectionStats();
    const connectedUsers = userConnectionManager.getConnectedUsers();
    
    // Get detailed connection information for each user
    const userDetails = connectedUsers.map(userId => {
      const connectionCount = userConnectionManager.getUserConnectionCount(userId);
      const connections = [];
      
      // Get connection details from websocketStore
      const userConnections = userConnectionManager.getUserConnections().get(userId) || new Set();
      const websocketStore = userConnectionManager.getWebsocketStore();
      
      for (const websocketId of userConnections) {
        const connectionInfo = websocketStore.get(websocketId);
        if (connectionInfo) {
          connections.push({
            websocketId,
            connectionTime: connectionInfo.connectionTime,
            status: connectionInfo.ws ? 'active' : 'inactive'
          });
        }
      }
      
      return {
        userId,
        connectionCount,
        connections,
        lastSeen: connections.length > 0 ? 
          Math.max(...connections.map(c => new Date(c.connectionTime).getTime())) :
          null
      };
    });
    
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      stats,
      connectedUsers: userDetails
    };
  })
  .get("/test-message/:userId", async ({ params: { userId } }) => {
    try {
      const testMessage = {
        type: "test",
        message: "Health check test message",
        timestamp: new Date().toISOString(),
        messageId: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
      
      // Send directly through WebSocket manager to ensure immediate delivery to all sessions
      const directResult = await userConnectionManager.sendMessageToUser(userId, testMessage);
      
      // Also send through Kafka for redundancy and logging
      let kafkaResult = null;
      try {
        await messageRoutingService.sendMessageToUser(userId, testMessage, "test");
        kafkaResult = { sent: true, method: 'kafka' };
      } catch (kafkaError) {
        console.warn('Kafka routing failed:', kafkaError.message);
        kafkaResult = { sent: false, error: kafkaError.message, method: 'kafka' };
      }
      
      return {
        success: directResult.sent,
        message: `Test message sent to user ${userId}`,
        data: testMessage,
        deliveryDetails: {
          direct: {
            sent: directResult.sent,
            successCount: directResult.successCount,
            failureCount: directResult.failureCount,
            totalAttempts: directResult.totalAttempts,
            method: 'websocket'
          },
          kafka: kafkaResult
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  .post("/stress-test/:userId", async ({ params: { userId }, body }) => {
    try {
      const messageCount = body?.count || 1000;
      const batchSize = body?.batchSize || 100;
      
      console.log(`🚀 Starting stress test for user ${userId}: ${messageCount} messages`);
      
      let sentCount = 0;
      let errorCount = 0;
      const startTime = Date.now();
      
      // Send messages in batches to avoid overwhelming the system
      for (let i = 0; i < messageCount; i += batchSize) {
        const currentBatch = Math.min(batchSize, messageCount - i);
        const promises = [];
        
        for (let j = 0; j < currentBatch; j++) {
          const messageIndex = i + j;
          const stressMessage = {
            type: "stress_test",
            message: `Stress test message #${messageIndex + 1}`,
            messageIndex: messageIndex + 1,
            totalMessages: messageCount,
            timestamp: new Date().toISOString()
          };
          
          promises.push(
            userConnectionManager.sendMessageToUser(userId, stressMessage)
              .then((result) => result.sent ? 1 : 0)
              .catch(() => 0)
          );
        }
        
        const batchResults = await Promise.all(promises);
        const batchSent = batchResults.reduce((sum, result) => sum + result, 0);
        sentCount += batchSent;
        errorCount += (currentBatch - batchSent);
        
        // Small delay between batches to prevent overwhelming
        if (i + batchSize < messageCount) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        message: `Stress test completed for user ${userId}`,
        stats: {
          totalMessages: messageCount,
          sentCount,
          errorCount,
          duration: `${duration}ms`,
          messagesPerSecond: Math.round((sentCount / duration) * 1000)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  .get("/api/stats", async () => {
    try {
      const redisHealth = await redisService.healthCheck();
      const kafkaHealth = await checkKafkaHealth();
      const wsConnections = userConnectionManager.getConnectionStats();
      const connectedUsers = userConnectionManager.getConnectedUsers();
      
      return {
        services: {
          redis: redisHealth,
          kafka: kafkaHealth,
          websocket: {
            status: "active",
            connections: wsConnections
          },
          messageRouter: {
            status: messageRoutingService.isRunning() ? "running" : "stopped"
          }
        },
        users: connectedUsers.map(userId => {
          const connectionCount = userConnectionManager.getUserConnectionCount(userId);
          const connections = [];
          
          // Get detailed connection information
          const userConnections = userConnectionManager.getUserConnections().get(userId) || new Set();
          const websocketStore = userConnectionManager.getWebsocketStore();
          
          for (const websocketId of userConnections) {
            const connectionInfo = websocketStore.get(websocketId);
            if (connectionInfo) {
              connections.push({
                websocketId: websocketId.substring(0, 8) + '...', // Shortened for display
                connectionTime: connectionInfo.connectionTime,
                status: connectionInfo.ws ? 'active' : 'inactive'
              });
            }
          }
          
          return {
            userId,
            connectionCount,
            connections
          };
        }),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return { error: error.message };
    }
  });

// Helper function to check Kafka health
async function checkKafkaHealth() {
  try {
    if (!kafkaService.isConnected) {
      return {
        status: "disconnected",
        message: "Kafka producer not connected",
        isDevMode: process.env.NODE_ENV !== "production"
      };
    }
    
    return {
      status: "connected",
      message: "Kafka producer is connected"
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message
    };
  }
}

// HTML Dashboard UI
function createHealthDashboard() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Narad Health Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: #f5f5f5; 
            color: #333; 
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header h1 { color: #2c3e50; margin-bottom: 10px; }
        .header .subtitle { color: #7f8c8d; font-size: 16px; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-card h3 { margin-bottom: 15px; color: #34495e; }
        .stat-value { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .stat-label { color: #7f8c8d; font-size: 14px; }
        
        .status-indicator { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
        .status-connected { background: #27ae60; }
        .status-disconnected { background: #e74c3c; }
        .status-error { background: #f39c12; }
        
        .users-section { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .user-card { 
            border: 1px solid #ecf0f1; 
            border-radius: 6px; 
            margin-bottom: 15px; 
            padding: 15px; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
        }
        .user-info h4 { margin-bottom: 5px; color: #2c3e50; }
        .user-info .connection-count { color: #7f8c8d; font-size: 14px; }
        
        .button-group { display: flex; gap: 10px; }
        .btn { 
            padding: 8px 16px; 
            border: none; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 14px; 
            transition: background-color 0.2s;
        }
        .btn-primary { background: #3498db; color: white; }
        .btn-primary:hover { background: #2980b9; }
        .btn-danger { background: #e74c3c; color: white; }
        .btn-danger:hover { background: #c0392b; }
        .btn-success { background: #27ae60; color: white; }
        .btn-success:hover { background: #229954; }
        .btn:disabled { background: #bdc3c7; cursor: not-allowed; }
        
        .refresh-btn { 
            position: fixed; 
            top: 20px; 
            right: 20px; 
            background: #3498db; 
            color: white; 
            border: none; 
            padding: 10px 20px; 
            border-radius: 20px; 
            cursor: pointer; 
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        
        .loading { opacity: 0.6; pointer-events: none; }
        .log { 
            background: #2c3e50; 
            color: #ecf0f1; 
            padding: 15px; 
            border-radius: 6px; 
            font-family: monospace; 
            font-size: 12px; 
            max-height: 200px; 
            overflow-y: auto; 
            margin-top: 15px;
            white-space: pre-wrap;
        }
        
        .modal { 
            display: none; 
            position: fixed; 
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 100%; 
            background: rgba(0,0,0,0.5); 
            z-index: 1000;
        }
        .modal-content { 
            background: white; 
            margin: 10% auto; 
            padding: 20px; 
            border-radius: 8px; 
            width: 80%; 
            max-width: 500px;
        }
        .close { 
            float: right; 
            font-size: 28px; 
            font-weight: bold; 
            cursor: pointer;
        }
        
        .input-group { margin-bottom: 15px; }
        .input-group label { display: block; margin-bottom: 5px; font-weight: bold; }
        .input-group input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    </style>
</head>
<body>
    <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>
    
    <div class="container">
        <div class="header">
            <h1>🚀 Narad Health Dashboard</h1>
            <p class="subtitle">Real-time monitoring and stress testing for WebSocket connections</p>
            <p id="lastUpdate">Loading...</p>
        </div>
        
        <div class="stats-grid" id="statsGrid">
            <!-- Stats will be loaded here -->
        </div>
        
        <div class="users-section">
            <h2 style="margin-bottom: 20px;">Connected Users</h2>
            <div id="usersList">
                <!-- Users will be loaded here -->
            </div>
        </div>
        
        <div id="logSection" style="display: none;">
            <h3>Activity Log</h3>
            <div id="log" class="log"></div>
        </div>
    </div>
    
    <!-- Stress Test Modal -->
    <div id="stressTestModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h2>Stress Test Configuration</h2>
            <div class="input-group">
                <label>User ID:</label>
                <input type="text" id="stressUserId" readonly>
            </div>
            <div class="input-group">
                <label>Number of Messages:</label>
                <input type="number" id="messageCount" value="1000" min="1" max="100000">
            </div>
            <div class="input-group">
                <label>Batch Size:</label>
                <input type="number" id="batchSize" value="100" min="1" max="1000">
            </div>
            <div class="button-group">
                <button class="btn btn-danger" onclick="startStressTest()">🚀 Start Stress Test</button>
                <button class="btn" onclick="closeModal()">Cancel</button>
            </div>
            <div id="stressTestResults" style="margin-top: 15px;"></div>
        </div>
    </div>

    <script>
        let currentData = null;
        
        async function loadData() {
            try {
                document.body.classList.add('loading');
                const response = await fetch('/health/api/stats');
                const data = await response.json();
                currentData = data;
                renderDashboard(data);
                document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
            } catch (error) {
                console.error('Failed to load data:', error);
                addLog('❌ Failed to load data: ' + error.message);
            } finally {
                document.body.classList.remove('loading');
            }
        }
        
        function renderDashboard(data) {
            renderStats(data);
            renderUsers(data.users || []);
        }
        
        function renderStats(data) {
            const statsGrid = document.getElementById('statsGrid');
            const services = data.services || {};
            
            statsGrid.innerHTML = \`
                <div class="stat-card">
                    <h3><span class="status-indicator status-\${getStatusClass(services.redis?.status)}"></span>Redis</h3>
                    <div class="stat-value">\${services.redis?.status || 'unknown'}</div>
                    <div class="stat-label">\${services.redis?.message || ''}</div>
                </div>
                
                <div class="stat-card">
                    <h3><span class="status-indicator status-\${getStatusClass(services.kafka?.status)}"></span>Kafka</h3>
                    <div class="stat-value">\${services.kafka?.status || 'unknown'}</div>
                    <div class="stat-label">\${services.kafka?.message || ''}</div>
                </div>
                
                <div class="stat-card">
                    <h3><span class="status-indicator status-connected"></span>WebSocket</h3>
                    <div class="stat-value">\${services.websocket?.connections?.totalConnections || 0}</div>
                    <div class="stat-label">Total Connections</div>
                </div>
                
                <div class="stat-card">
                    <h3>📊 Users</h3>
                    <div class="stat-value">\${services.websocket?.connections?.totalUsers || 0}</div>
                    <div class="stat-label">Connected Users</div>
                </div>
            \`;
        }
        
        function renderUsers(users) {
            const usersList = document.getElementById('usersList');
            
            if (!users.length) {
                usersList.innerHTML = '<p style="color: #7f8c8d; text-align: center; padding: 20px;">No users currently connected</p>';
                return;
            }
            
            usersList.innerHTML = users.map(user => {
                const connectionsHtml = user.connections && user.connections.length > 0 ? 
                    user.connections.map(conn => \`
                        <div style="font-size: 12px; color: #666; margin-left: 10px; padding: 2px 0;">
                            📱 Session: \${conn.websocketId || 'N/A'} 
                            <span style="color: \${conn.status === 'active' ? '#27ae60' : '#e74c3c'};">●</span>
                            <br><span style="color: #888;">Connected: \${new Date(conn.connectionTime).toLocaleTimeString()}</span>
                        </div>
                    \`).join('') : 
                    '<div style="font-size: 12px; color: #666; margin-left: 10px;">No session details available</div>';
                
                return \`
                    <div class="user-card">
                        <div class="user-info">
                            <h4>\${user.userId}</h4>
                            <div class="connection-count" style="margin-bottom: 8px;">
                                \${user.connectionCount} active session\${user.connectionCount !== 1 ? 's' : ''}
                            </div>
                            \${connectionsHtml}
                        </div>
                        <div class="button-group">
                            <button class="btn btn-success" onclick="sendTestMessage('\${user.userId}')">📤 Test All Sessions</button>
                            <button class="btn btn-danger" onclick="openStressTestModal('\${user.userId}')">⚡ Stress Test</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        function getStatusClass(status) {
            if (status === 'connected' || status === 'running') return 'connected';
            if (status === 'disconnected' || status === 'stopped') return 'disconnected';
            return 'error';
        }
        
        async function sendTestMessage(userId) {
            try {
                addLog(\`📤 Sending test message to all sessions for user \${userId}...\`);
                const response = await fetch(\`/health/test-message/\${userId}\`);
                const result = await response.json();
                
                if (result.success) {
                    const delivery = result.deliveryDetails;
                    const directDelivery = delivery?.direct;
                    const kafkaDelivery = delivery?.kafka;
                    
                    let logMessage = \`✅ Test message sent to user \${userId}\`;
                    if (directDelivery) {
                        logMessage += \` - WebSocket: \${directDelivery.successCount}/\${directDelivery.totalAttempts} sessions\`;
                    }
                    if (kafkaDelivery?.sent) {
                        logMessage += \` - Kafka: queued\`;
                    }
                    addLog(logMessage);
                } else {
                    addLog(\`❌ Failed to send test message to user \${userId}: \${result.error}\`);
                }
            } catch (error) {
                addLog(\`❌ Error sending test message to user \${userId}: \${error.message}\`);
            }
        }
        
        function openStressTestModal(userId) {
            document.getElementById('stressUserId').value = userId;
            document.getElementById('stressTestModal').style.display = 'block';
            document.getElementById('stressTestResults').innerHTML = '';
        }
        
        function closeModal() {
            document.getElementById('stressTestModal').style.display = 'none';
        }
        
        async function startStressTest() {
            const userId = document.getElementById('stressUserId').value;
            const messageCount = parseInt(document.getElementById('messageCount').value);
            const batchSize = parseInt(document.getElementById('batchSize').value);
            
            const resultsDiv = document.getElementById('stressTestResults');
            resultsDiv.innerHTML = '<p>🚀 Starting stress test...</p>';
            
            try {
                addLog(\`🚀 Starting stress test for user \${userId}: \${messageCount} messages\`);
                
                const response = await fetch(\`/health/stress-test/\${userId}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ count: messageCount, batchSize })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultsDiv.innerHTML = \`
                        <div style="background: #d4edda; color: #155724; padding: 10px; border-radius: 4px;">
                            <h4>✅ Stress Test Completed</h4>
                            <p><strong>Total Messages:</strong> \${result.stats.totalMessages}</p>
                            <p><strong>Messages Sent:</strong> \${result.stats.sentCount}</p>
                            <p><strong>Errors:</strong> \${result.stats.errorCount}</p>
                            <p><strong>Duration:</strong> \${result.stats.duration}</p>
                            <p><strong>Rate:</strong> \${result.stats.messagesPerSecond} msg/sec</p>
                        </div>
                    \`;
                    addLog(\`✅ Stress test completed for user \${userId}: \${result.stats.sentCount}/\${result.stats.totalMessages} messages sent in \${result.stats.duration}\`);
                } else {
                    resultsDiv.innerHTML = \`
                        <div style="background: #f8d7da; color: #721c24; padding: 10px; border-radius: 4px;">
                            <h4>❌ Stress Test Failed</h4>
                            <p>\${result.error}</p>
                        </div>
                    \`;
                    addLog(\`❌ Stress test failed for user \${userId}: \${result.error}\`);
                }
            } catch (error) {
                resultsDiv.innerHTML = \`
                    <div style="background: #f8d7da; color: #721c24; padding: 10px; border-radius: 4px;">
                        <h4>❌ Error</h4>
                        <p>\${error.message}</p>
                    </div>
                \`;
                addLog(\`❌ Error during stress test for user \${userId}: \${error.message}\`);
            }
        }
        
        function addLog(message) {
            const logSection = document.getElementById('logSection');
            const log = document.getElementById('log');
            
            logSection.style.display = 'block';
            
            const timestamp = new Date().toLocaleTimeString();
            log.textContent += \`[\${timestamp}] \${message}\\n\`;
            log.scrollTop = log.scrollHeight;
        }
        
        // Auto-refresh every 30 seconds
        setInterval(loadData, 30000);
        
        // Initial load
        loadData();
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('stressTestModal');
            if (event.target === modal) {
                closeModal();
            }
        }
    </script>
</body>
</html>
  `;
}
