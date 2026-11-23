import 'dotenv/config';
import { createApiApp } from '../server/app.ts';

// Vercel Serverless Function entry point handling all /api/* routes
const app = createApiApp();

export default app;
