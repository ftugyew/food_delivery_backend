const express = require("express");
const db = require("../db");
const router = express.Router();

// ================= USERS =================
router.get("/users", async (req, res) => {
  try {
    const [users] = await db.execute("SELECT id, name, email, role FROM users");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Users count
router.get("/users/count", async (req, res) => {
  const [rows] = await db.execute("SELECT COUNT(*) AS count FROM users");
  res.json(rows[0]);
});

// ================= RESTAURANTS =================
router.get("/restaurants", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
});

// Restaurants count
router.get("/restaurants/count", async (req, res) => {
  const [rows] = await db.execute("SELECT COUNT(*) AS count FROM restaurants");
  res.json(rows[0]);
});

// Pending restaurants for approval
router.get("/restaurants/pending", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM restaurants WHERE status='pending'");
  res.json(rows);
});

// Approve restaurant + linked user account
router.put("/restaurants/approve/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await db.execute("UPDATE restaurants SET status='approved' WHERE id=?", [id]);
    await db.execute("UPDATE users SET status='approved' WHERE restaurant_id=?", [id]);

    res.json({ success: true, message: "Restaurant approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject restaurant
router.put("/restaurants/reject/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await db.execute("UPDATE restaurants SET status='rejected' WHERE id=?", [id]);
    await db.execute("UPDATE users SET status='rejected' WHERE restaurant_id=?", [id]);

    res.json({ success: true, message: "Restaurant rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Top Restaurant feature
router.put("/restaurants/:id/toggle-top", async (req, res) => {
  const restId = req.params.id;
  const [rows] = await db.execute("SELECT is_top FROM restaurants WHERE id=?", [restId]);
  const newStatus = !rows[0].is_top;
  await db.execute("UPDATE restaurants SET is_top=? WHERE id=?", [newStatus, restId]);
  res.json({ message: "Updated top status", is_top: newStatus });
});

// ================= ORDERS =================
router.get("/orders/count", async (req, res) => {
  const [rows] = await db.execute("SELECT COUNT(*) AS count FROM orders");
  res.json(rows[0]);
});

router.get("/orders", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM orders WHERE status!='delivered'");
  res.json(rows);
});

// ================= DELIVERY AGENTS =================
router.get("/delivery", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM delivery_agents");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

module.exports = router;
