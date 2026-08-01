import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const dbUrl = process.env.DATABASE_URL || './data/homefinance.sqlite';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbUrl,
  },
  verbose: true,
  strict: true,
});