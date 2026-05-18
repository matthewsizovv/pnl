import 'dotenv/config';
import { getDb } from './index.js';

const db = getDb();
console.log('Migration complete.');
