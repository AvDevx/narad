import { Elysia } from "elysia";
import { kafkaService } from "../../../services/kafka.js";

const intervals = new Map();

export const websocketRoutes = new Elysia({ prefix: "/ws" }).ws("/", {
  open(ws) {
    console.log("Client connected");
    let count = 0;
    const interval = setInterval(async () => {
      count++;
      const message = `Message #${count} at ${new Date().toISOString()}`;
      ws.send(message);

      await kafkaService.send("websocket", {
        type: "heartbeat",
        count,
        timestamp: new Date().toISOString(),
      });
    }, 1000);
    intervals.set(ws.id, interval);
  },
  message(ws, message) {
    console.log("Received:", message);
    ws.send(`Echo: ${message}`);

    kafkaService.send("websocket", {
      type: "user-message",
      content: message,
      timestamp: new Date().toISOString(),
    });
  },
  close(ws) {
    console.log("Client disconnected");
    const interval = intervals.get(ws.id);
    if (interval) {
      clearInterval(interval);
      intervals.delete(ws.id);
    }
  },
});
