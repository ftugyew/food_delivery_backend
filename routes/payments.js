const express = require("express");
const router = express.Router();
const db = require("../db");

// ✅ Razorpay instance (optional - only if razorpay is installed)
let razorpay = null;
try {
  const Razorpay = require("razorpay");
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "YOUR_RAZORPAY_KEY",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "YOUR_RAZORPAY_SECRET"
  });
} catch (error) {
  console.log("⚠️  Razorpay not installed. Payment features will be limited.");
}

// ✅ Create payment order
router.post("/create-order", async (req, res) => {
  const { amount, currency = "INR", order_id } = req.body;

  if (!razorpay) {
    return res.status(503).json({ error: "Payment service not available. Please install razorpay package." });
  }

  try {
    const options = { amount: amount * 100, currency, receipt: `order_${order_id}` };
    const order = await razorpay.orders.create(options);

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Payment creation failed" });
  }
});

// ✅ Save payment in DB
router.post("/save", (req, res) => {
  const { order_id, amount, method, status } = req.body;

  db.execute(
    "INSERT INTO payments (order_id, amount, payment_method, status) VALUES (?, ?, ?, ?)",
    [order_id, amount, method, status]
  )
  .then(() => {
    res.json({ message: "✅ Payment saved" });
  })
  .catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Payment save failed" });
  });
});

module.exports = router;
// UPI collect request endpoint (demo)
router.post('/send-upi', async (req, res) => {
  const { upi_id, amount } = req.body;
  // Simulate UPI collect request (integration with real UPI provider needed)
  console.log(`UPI collect request sent to ${upi_id} for ₹${amount}`);
  // Respond as if request was sent
  res.json({ message: `UPI collect request sent to ${upi_id} for ₹${amount}` });
});
