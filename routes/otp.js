// backend/routes/otp.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_PROD";

const useTwilio = !!(process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
let twilioClient = null;
if (useTwilio) {
  const twilio = require("twilio");
  twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
}

// helper: create OTP table if not exists (Postgres-safe)
db.query(
  `CREATE TABLE IF NOT EXISTS otps (
    phone VARCHAR(20) PRIMARY KEY,
    otp VARCHAR(6) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  (err) => {
    if (err) console.warn("otps table create:", err.message || err);
  }
);

// send OTP
router.post("/send", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone required" });

  const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit

  try {
    await db.execute(
      "INSERT INTO otps (phone, otp) VALUES (?, ?) ON CONFLICT (phone) DO UPDATE SET otp = EXCLUDED.otp, created_at = NOW()",
      [phone, otp]
    );

    if (useTwilio) {
      await twilioClient.messages.create({
        body: `Your Tindo OTP is ${otp}`,
        from: process.env.TWILIO_FROM,
        to: phone.startsWith("+") ? phone : `+91${phone}`,
      });
      return res.json({ message: "OTP sent" });
    }

    console.log(`[DEV OTP] for ${phone}: ${otp}`);
    return res.json({ message: "OTP (dev) generated — check server console", devOtp: otp });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "DB error" });
  }
});

// verify OTP
router.post("/verify", async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: "phone & otp required" });

  try {
    const [rows] = await db.execute("SELECT * FROM otps WHERE phone = ? AND otp = ?", [phone, otp]);
    if (!rows.length) return res.status(401).json({ error: "Invalid OTP" });

    const [users] = await db.execute("SELECT * FROM users WHERE phone = ?", [phone]);

    let user;
    if (!users.length) {
      const [created] = await db.execute(
        "INSERT INTO users (name, email, phone, role) VALUES (?, NULL, ?, 'customer') RETURNING id, name, email, phone, role",
        ["PhoneUser", phone]
      );
      user = created[0] || { id: null, name: "PhoneUser", email: null, phone, role: "customer" };
    } else {
      user = users[0];
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    await db.execute("DELETE FROM otps WHERE phone = ?", [phone]);
    return res.json({
      message: "OTP verified",
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "DB error" });
  }
});

module.exports = router;
