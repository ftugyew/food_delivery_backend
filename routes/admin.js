const express = require("express");
const db = require("../db");
const router = express.Router();

// View users
router.get("/users", async (req, res) => {
  try {
    const [users] = await db.execute("SELECT id, name, email, role FROM users");
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// View restaurants
router.get("/restaurants", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching restaurants:", err);
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
});

// View delivery agents
router.get("/agents", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM agents");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching agents:", err);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});
// Approve restaurant
router.post("/approve", async (req, res) => {
  const { restaurant_id } = req.body;
  try {
    await db.execute("UPDATE restaurants SET status='approved' WHERE id=?", [restaurant_id]);
    res.json({ success: true, message: "Restaurant approved" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reject restaurant
router.post("/reject", async (req, res) => {
  const { restaurant_id } = req.body;
  try {
    await db.execute("UPDATE restaurants SET status='rejected' WHERE id=?", [restaurant_id]);
    res.json({ success: true, message: "Restaurant rejected" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

// Toggle is_top status for a restaurant (moved after router initialization)
router.put("/restaurants/:id/toggle-top", async (req, res) => {
  try {
    const restId = req.params.id;
    const [rows] = await db.execute("SELECT is_top FROM restaurants WHERE id=?", [restId]);
    if (!rows.length) return res.status(404).json({ error: "Restaurant not found" });
    const newStatus = !rows[0].is_top;
    await db.execute("UPDATE restaurants SET is_top=? WHERE id=?", [newStatus, restId]);
    res.json({ message: `Restaurant ${newStatus ? 'added to' : 'removed from'} Top list`, is_top: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error toggling top status" });
  }
});
