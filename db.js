const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
testConnection = async () => {
  try {
    const connection = await db.getConnection();
    console.log("✅ Railway MySQL Connected Successfully");
    connection.release();
  } catch (err) {
    console.error("❌ MySQL Connect Error:", err.code);
  }
};

testConnection();

module.exports = db;
