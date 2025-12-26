const mysql = require("mysql2/promise");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  user: process.env.DB_USER || process.env.MYSQLUSER,
  password: process.env.DB_PASS || process.env.MYSQLPASSWORD,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE,
  port: process.env.DB_PORT || process.env.MYSQLPORT || 3306,
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
