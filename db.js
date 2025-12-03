const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  ssl: {
    require: true,
    rejectUnauthorized: false
  },
  connectTimeout: 20000 // 20 seconds timeout
});

const testConnection = async () => {
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
