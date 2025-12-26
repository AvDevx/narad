import { Elysia } from "elysia";

const intervals = new Map();

const app = new Elysia()
  .ws("/ws", {
    open(ws) {
      console.log("Client connected");
      let count = 0;
      const interval = setInterval(() => {
        count++;
        ws.send(`Message #${count} at ${new Date().toISOString()}`);
      }, 1000);
      intervals.set(ws.id, interval);
    },
    message(ws, message) {
      console.log("Received:", message);
      ws.send(`Echo: ${message}`);
    },
    close(ws) {
      console.log("Client disconnected");
      const interval = intervals.get(ws.id);
      if (interval) {
        clearInterval(interval);
        intervals.delete(ws.id);
      }
    },
  })
  .listen(process.env.PORT || 8080);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
console.log(`WebSocket available at ws://${app.server?.hostname}:${app.server?.port}/ws`);
