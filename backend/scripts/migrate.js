import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
const directory = fileURLToPath(new URL('../../schemas/', import.meta.url));
const connection = await pool.getConnection();
let locked = false;
try {
  const [[result]] = await connection.query("SELECT GET_LOCK('kruhub_schema_migrations', 60) AS acquired");
  if (result.acquired !== 1) throw new Error('Another migration is running');
  locked = true;
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, status ENUM('running','applied') NOT NULL, applied_at TIMESTAMP(6) NULL)`);
  for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const [[existing]] = await connection.query('SELECT checksum, status FROM schema_migrations WHERE name = ?', [name]);
    if (existing) {
      if (existing.checksum !== checksum) throw new Error(`Applied migration was modified: ${name}`);
      if (existing.status !== 'applied') throw new Error(`Incomplete migration: ${name}; review partial DDL before recovery`);
      continue;
    }
    await connection.query("INSERT INTO schema_migrations (name, checksum, status) VALUES (?, ?, 'running')", [name, checksum]);
    // These versioned SQL files contain plain statements only, no stored routines.
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
    await connection.query("UPDATE schema_migrations SET status = 'applied', applied_at = CURRENT_TIMESTAMP(6) WHERE name = ?", [name]);
    console.log(`Applied ${name}`);
  }
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK('kruhub_schema_migrations')");
  connection.release();
  await pool.end();
}
