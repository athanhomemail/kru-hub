import { pool } from './db.js';
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function id(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail(400, 'ข้อมูลอ้างอิงไม่ถูกต้อง'); return n; }
export function text(value, max = 255) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, 'กรุณากรอกข้อมูลให้ครบและไม่เกินความยาวที่กำหนด'); return value.trim(); }
export async function transaction(fn) {
 const c = await pool.getConnection();
 try { await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await c.beginTransaction(); const result = await fn(c); await c.commit(); return result; }
 catch(error) { await c.rollback(); throw error; } finally { c.release(); }
}
export async function audit(c, req, action, type, entityId, details = {}) {
 await c.query('INSERT INTO audit_logs (school_id,actor_user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?)', [req.school?.id || null,req.user.id,action,type,entityId || null,JSON.stringify(details)]);
}
