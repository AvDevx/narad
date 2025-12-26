import { messagingDomain } from "./messaging/index.js";
import { healthDomain } from "./health/index.js";

// Export all domain routes
export const domains = [
  messagingDomain,
  healthDomain,
];

// Helper to register all domain routes
export const registerDomains = (app) => {
  domains.forEach((domain) => {
    app.use(domain.routes);
  });
  return app;
};
