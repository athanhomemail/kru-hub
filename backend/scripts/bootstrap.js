import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
try {
  const username = process.env.SUPER_ADMIN_USERNAME || 'owner';
  const password = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
  const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    console.log('Account already exists; no changes made.');
  } else {
    if (!password || password.length < 16) throw new Error('Initial password must contain at least 16 characters');
    await pool.query('INSERT INTO users (username, password_hash, display_name, is_super_admin, must_change_password) VALUES (?, ?, ?, TRUE, TRUE)', [username, await bcrypt.hash(password, 12), 'เจ้าของระบบ']);
    console.log('Super admin created. Sign in using the configured username and initial password; password change is required on first login.');
  }
} finally { await pool.end(); }
