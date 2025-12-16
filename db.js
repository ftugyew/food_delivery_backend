const mysql = require("mysql2/promise");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 30000
});

// 🔁 Wait & retry until MySQL is ready
async function waitForDB(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await db.getConnection();
      console.log("✅ MySQL Connected Successfully");
      conn.release();
      return;
    } catch (err) {
      console.log(`⏳ Waiting for MySQL... (${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.error("❌ MySQL still not reachable after retries");
}

// Call it once on startup
waitForDB();

module.exports = db;
