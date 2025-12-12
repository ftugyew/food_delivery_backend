const dotenv = require("dotenv");
dotenv.config();

const USE_SQLITE = process.env.USE_SQLITE === "true";

let db = null;

if (USE_SQLITE) {
  // ---------------------------
  //  SQLITE MODE (TESTING)
  // ---------------------------
  console.log("📌 Using SQLite Database (Testing Mode)");

  const Database = require("better-sqlite3");

  db = new Database("tindo.db"); // Creates file in Render
  
  // Create tables if not exist – only minimal tables for testing
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      password_hash TEXT,
      role TEXT,
      restaurant_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      cuisine TEXT,
      description TEXT,
      eta INTEGER,
      status TEXT,
      image_url TEXT
    );
  `);

  module.exports = {
    query(sql, params = []) {
      const stmt = db.prepare(sql);

      if (sql.trim().toLowerCase().startsWith("select")) {
        return [stmt.all(params)];
      } else {
        const info = stmt.run(params);
        return [{ insertId: info.lastInsertRowid }];
      }
    }
  };

} else {
  // ---------------------------
  //  MYSQL MODE (LIVE)
  // ---------------------------
  console.log("📌 Using MySQL Database (Live Mode)");

  const mysql = require("mysql2/promise");

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10
  });

  module.exports = pool;
}
