import { Kafka, logLevel } from "kafkajs";
import { config, isDev, isProd } from "../config/env.js";

class KafkaService {
  constructor() {
    this.kafka = null;
    this.producer = null;
    this.consumer = null;
    this.isConnected = false;
  }

  init() {
    this.kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      connectionTimeout: config.kafka.connectionTimeout,
      retry: config.kafka.retry,
      ssl: config.kafka.ssl,
      sasl: config.kafka.sasl,
      logLevel: isDev ? logLevel.DEBUG : logLevel.ERROR,
    });

    console.log(
      `📦 Kafka initialized [${isDev ? "DEV" : "PROD"}] - Brokers: ${config.kafka.brokers.join(", ")}`
    );

    return this;
  }

  async connectProducer() {
    if (!this.kafka) this.init();

    try {
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.isConnected = true;
      console.log("✅ Kafka producer connected");
    } catch (error) {
      console.error("❌ Kafka producer connection failed:", error.message);
      if (isDev) {
        console.log("⚠️  Running in dev mode without Kafka connection");
        this.isConnected = false;
      } else {
        throw error;
      }
    }

    return this;
  }

  async connectConsumer(groupId = "narad-group") {
    if (!this.kafka) this.init();

    try {
      this.consumer = this.kafka.consumer({ groupId });
      await this.consumer.connect();
      console.log(`✅ Kafka consumer connected (group: ${groupId})`);
    } catch (error) {
      console.error("❌ Kafka consumer connection failed:", error.message);
      if (isDev) {
        console.log("⚠️  Running in dev mode without Kafka connection");
      } else {
        throw error;
      }
    }

    return this;
  }

  async send(topic, messages) {
    if (!this.isConnected) {
      if (isDev) {
        console.log(`[DEV] Would send to ${topic}:`, messages);
        return;
      }
      throw new Error("Kafka producer not connected");
    }

    const formattedMessages = Array.isArray(messages)
      ? messages.map((m) => ({ value: JSON.stringify(m) }))
      : [{ value: JSON.stringify(messages) }];

    await this.producer.send({
      topic,
      messages: formattedMessages,
    });

    console.log(`📤 Sent ${formattedMessages.length} message(s) to ${topic}`);
  }

  async subscribe(topic, onMessage) {
    if (!this.consumer) {
      if (isDev) {
        console.log(`[DEV] Would subscribe to ${topic}`);
        return;
      }
      throw new Error("Kafka consumer not connected");
    }

    try {
      await this.consumer.subscribe({ topic, fromBeginning: false });

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const value = message.value?.toString();
          try {
            const parsed = JSON.parse(value);
            await onMessage(parsed, { topic, partition });
          } catch {
            await onMessage(value, { topic, partition });
          }
        },
      });

      console.log(`📥 Subscribed to topic: ${topic}`);
    } catch (error) {
      console.error(`❌ Failed to subscribe to topic ${topic}:`, error.message);
      if (isDev) {
        console.log(`⚠️  Running in dev mode, continuing without ${topic} subscription`);
      } else {
        throw error;
      }
    }
  }
   async disconnect() {
    if (this.producer) {
      await this.producer.disconnect();
      console.log("🔌 Kafka producer disconnected");
    }
    if (this.consumer) {
      await this.consumer.disconnect();
      console.log("🔌 Kafka consumer disconnected");
    }
    this.isConnected = false;
  }
  }

 


// Export singleton instance
export const kafkaService = new KafkaService();
