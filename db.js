const dotenv = require("dotenv");
dotenv.config();

const USE_SQLITE = process.env.USE_SQLITE === "true";

let db = null;

if (USE_SQLITE) {
  console.log("📌 Using SQLite Database (Testing Mode)");

  const sqlite3 = require("sqlite3").verbose();
  const sqlite = new sqlite3.Database("tindo.db");

  // ===== AUTO CREATE TABLES =====
  sqlite.serialize(() => {
    sqlite.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT,
        password_hash TEXT,
        role TEXT,
        restaurant_id INTEGER
      )
    `);

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        cuisine TEXT,
        description TEXT,
        eta INTEGER,
        status TEXT,
        image_url TEXT
      )
    `);

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        restaurant_id INTEGER,
        items TEXT,
        total REAL,
        status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS delivery_agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        aadhar TEXT,
        vehicle_type TEXT
      )
    `);
  });

  // ===== UNIFIED QUERY WRAPPER =====
  db = {
    query(sql, params = []) {
      return new Promise((resolve, reject) => {
        const isSelect = sql.trim().toLowerCase().startsWith("select");

        if (isSelect) {
          sqlite.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve([rows]);
          });
        } else {
          sqlite.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve([{ insertId: this.lastID }]);
          });
        }
      });
    }
  };

} else {
  // ===== MySQL MODE =====
  console.log("📌 Using MySQL Database (LIVE MODE)");

  const mysql = require("mysql2/promise");

  db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10
  });
}

module.exports = db;
