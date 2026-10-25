import mysql from 'mysql2/promise';
export const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3309), user: process.env.DB_USER || 'kruhub', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'kruhub', charset: 'utf8mb4', timezone: 'Z', connectionLimit: 10 });
