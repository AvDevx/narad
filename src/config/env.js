export const ENV = process.env.NODE_ENV || "development";
export const isDev = ENV === "development";
export const isProd = ENV === "production";

export const config = {
  kafka: {
    clientId: process.env.KAFKA_CLIENT_ID || "narad",
    brokers: process.env.KAFKA_BROKERS?.split(",") || ["localhost:9092"],
    // Dev settings - more lenient
    ...(isDev && {
      connectionTimeout: 3000,
      retry: {
        initialRetryTime: 100,
        retries: 3,
      },
      ssl:
        process.env.KAFKA_SSL === "true"
          ? {
              rejectUnauthorized: false,
              checkServerIdentity: () => undefined,
            }
          : false,
      sasl:
        process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD
          ? {
              mechanism: process.env.KAFKA_SASL_MECHANISM || "plain",
              username: process.env.KAFKA_SASL_USERNAME,
              password: process.env.KAFKA_SASL_PASSWORD,
            }
          : undefined,
    }),
    // Prod settings - more robust
    ...(isProd && {
      connectionTimeout: 10000,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
      ssl: process.env.KAFKA_SSL === "true",
      sasl:
        process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD
          ? {
              mechanism: process.env.KAFKA_SASL_MECHANISM || "plain",
              username: process.env.KAFKA_SASL_USERNAME,
              password: process.env.KAFKA_SASL_PASSWORD,
            }
          : undefined,
    }),
  },
  server: {
    port: process.env.PORT || 8080,
  },
};
