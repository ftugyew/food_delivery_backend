const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../db");

async function main() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS otps (
      phone VARCHAR(20) PRIMARY KEY,
      otp VARCHAR(6) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log("otps ok");
  } catch (e) {
    console.error("otps create", e.message);
  }

  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS banners (
      id BIGSERIAL PRIMARY KEY,
      image_url VARCHAR(500) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log("banners ok");
  } catch (e) {
    console.error("banners create", e.message);
  }

  try {
    const [r] = await db.execute(
      "INSERT INTO otps (phone, otp) VALUES (?, ?) ON DUPLICATE KEY UPDATE otp = ?, created_at = NOW()",
      ["9999999999", "123456", "123456"]
    );
    console.log("otp insert", r);
  } catch (e) {
    console.error("otp insert error", e.message);
  }

  try {
    const [b] = await db.execute("SELECT * FROM banners LIMIT 5");
    console.log("banners rows", b);
  } catch (e) {
    console.error("banners select", e.message);
  }

  process.exit(0);
}

main();
