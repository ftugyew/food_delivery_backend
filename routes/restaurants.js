const express = require("express");
const db = require("../db");
const router = express.Router();

// Add restaurant
router.post("/", (req, res) => {
  const { name, description, lat, lng, address, phone, email, image_url, rating, eta, cuisine } = req.body;

  db.execute(
    "INSERT INTO restaurants (name, description, lat, lng, address, phone, email, image_url, rating, eta, cuisine, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
    [name, description, lat, lng, address, phone, email, image_url, rating, eta, cuisine]
  )
    .then(([result]) => {
      res.json({ message: "Restaurant added", id: result.insertId });
    })
    .catch((err) => {
      console.error("Add restaurant error:", err.sqlMessage || err);
      res.status(500).json({ error: "Failed to add restaurant" });
    });
});

// Get all restaurants
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants WHERE status = 'active'");
    res.json(rows);
  } catch (err) {
    console.error("Fetch restaurants error:", err.sqlMessage || err);
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
});

// Get one restaurant by ID
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants WHERE id = ?", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error("Fetch restaurant by ID error:", err.sqlMessage || err);
    res.status(500).json({ error: "Failed to fetch restaurant" });
  }
});

module.exports = router;
