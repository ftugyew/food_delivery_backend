const mysql = require("mysql2/promise");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 30000
});

async function testConnection() {
  try {
    const conn = await db.getConnection();
    console.log("✅ MySQL Connected Successfully");
    conn.release();
  } catch (err) {
    console.error("⚠️ MySQL not ready yet:", err.code);
    // DO NOT exit process
  }
}

testConnection();

module.exports = db;
