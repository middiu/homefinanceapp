import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Each test process gets its own temp SQLite file so tests are isolated.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-test-'));
process.env.DATABASE_URL = path.join(tmpDir, `${randomUUID()}.sqlite`);

import { bootstrap } from '../db/bootstrap.js';
import { seedDefaults } from '../db/seed.js';
import { getDb, schema } from '../db/index.js';

export function setupDb() {
  bootstrap();
  seedDefaults();
}

export { getDb, schema, randomUUID };