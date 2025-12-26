import { Elysia } from "elysia";
import { registerDomains } from "../domains/index.js";

export const createApp = () => {
  const app = new Elysia();

  // Register all domain routes
  registerDomains(app);

  return app;
};
