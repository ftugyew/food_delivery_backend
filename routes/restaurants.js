const express = require("express");
const db = require("../db");
const router = express.Router();

// Add restaurant (linked to user_id)
router.post("/", (req, res) => {
  const { name, description, lat, lng, user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: "user_id required" });
  }

  db.execute(
    "INSERT INTO restaurants (name, description, lat, lng, user_id) VALUES (?, ?, ?, ?, ?)",
    [name, description, lat, lng, user_id]
  )
    .then(([result]) => {
      res.json({ message: "✅ Restaurant added", id: result.insertId });
    })
    .catch((err) => {
      console.error("Add restaurant error:", err.sqlMessage || err);
      res.status(500).json({ error: "Failed to add restaurant" });
    });
});

// Get all restaurants
router.get("/", (req, res) => {
  db.execute("SELECT * FROM restaurants")
    .then(([rows]) => res.json(rows))
    .catch((err) => {
      console.error("Fetch restaurants error:", err.sqlMessage || err);
      res.status(500).json({ error: "Failed to fetch restaurants" });
    });
});

// Get restaurants by owner (user_id)
router.get("/owner/:userId", (req, res) => {
  const { userId } = req.params;
  db.execute("SELECT * FROM restaurants WHERE user_id = ?", [userId])
    .then(([rows]) => res.json(rows))
    .catch((err) => {
      console.error("Fetch owner restaurants error:", err.sqlMessage || err);
      res.status(500).json({ error: "Failed to fetch owner restaurants" });
    });
});
// Get all restaurants
router.get("/", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM restaurants");
  res.json(rows);
});

// Get one restaurant by ID
router.get("/:id", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM restaurants WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
});

module.exports = router;
