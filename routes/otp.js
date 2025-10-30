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

// helper: create OTP table if not exists (safe)
db.query(`CREATE TABLE IF NOT EXISTS otps (
  phone VARCHAR(20) PRIMARY KEY,
  otp VARCHAR(6) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, (err)=>{ if(err) console.warn("otps table create:", err); });

// send OTP
router.post("/send", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone required" });

  const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit

  // upsert into otps table
  db.query("INSERT INTO otps (phone, otp) VALUES (?, ?) ON DUPLICATE KEY UPDATE otp = ?, created_at = NOW()", [phone, otp, otp], (err) => {
    if (err) { console.error(err); return res.status(500).json({ error: "DB error" }); }

    if (useTwilio) {
      twilioClient.messages.create({
        body: `Your FoodieX OTP is ${otp}`,
        from: process.env.TWILIO_FROM,
        to: phone.startsWith('+') ? phone : (`+91${phone}`)
      }).then(() => res.json({ message: "OTP sent" }))
        .catch(err => { console.error("Twilio error", err); res.status(500).json({ error: "SMS send failed" }); });
    } else {
      // dev mode — do not send SMS, print to server console
      console.log(`[DEV OTP] for ${phone}: ${otp}`);
      return res.json({ message: "OTP (dev) generated — check server console" });
    }
  });
});

// verify OTP
router.post("/verify", (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: "phone & otp required" });

  db.query("SELECT * FROM otps WHERE phone = ? AND otp = ?", [phone, otp], (err, rows) => {
    if (err) { console.error(err); return res.status(500).json({ error: "DB error" }); }
    if (!rows.length) return res.status(401).json({ error: "Invalid OTP" });

    // optional: check created_at within last 10 minutes
    // If valid -> ensure user exists (create if not), then return JWT
    db.query("SELECT * FROM users WHERE phone = ?", [phone], (err2, users) => {
      if (err2) { console.error(err2); return res.status(500).json({ error: "DB error" }); }

      const finishLogin = (user) => {
        const token = jwt.sign({ id: user.id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        // delete used OTP
        db.query("DELETE FROM otps WHERE phone = ?", [phone], ()=>{});
        return res.json({ message: "OTP verified", token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
      };

      if (users.length === 0) {
        // create new user
        db.query("INSERT INTO users (name, email, phone, role) VALUES (?, NULL, ?, 'customer')", ["PhoneUser", phone], (err3, result) => {
          if (err3) { console.error(err3); return res.status(500).json({ error: "Create user failed" }); }
          const newUser = { id: result.insertId, name: "PhoneUser", email: null, phone, role: "customer" };
          return finishLogin(newUser);
        });
      } else {
        return finishLogin(users[0]);
      }
    });
  });
});

module.exports = router;
