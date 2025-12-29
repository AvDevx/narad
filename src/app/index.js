import { Elysia } from "elysia";
import { openapi } from '@elysiajs/openapi'
import { registerDomains } from "../domains/index.js";

export const createApp = () => {
  const app = new Elysia()
  .use(
		openapi({
		})
	)

  // Register all domain routes
  registerDomains(app);

  return app;
};
