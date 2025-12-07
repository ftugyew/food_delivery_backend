const express = require("express");
const db = require("../db");
const router = express.Router();

// Add restaurant
router.post("/", async (req, res) => {
  try {
    const { name, description, lat, lng, address, phone, email, image_url, rating, eta, cuisine } = req.body;

    const sql = `
      INSERT INTO restaurants (
        name, description, lat, lng, address, phone, email, image_url, rating, eta, cuisine, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `;

    const [result] = await db.execute(sql, [
      name, description, lat, lng, address, phone, email, image_url, rating, eta, cuisine
    ]);

    res.json({ message: "Restaurant added", id: result.insertId });
  } catch (err) {
    console.error("Add restaurant error:", err.sqlMessage || err);
    res.status(500).json({ error: "Failed to add restaurant" });
  }
});

// Get all restaurants
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants WHERE status = 'active' OR status = 'approved'");
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fetch restaurants error:", err.sqlMessage || err);
    res.status(500).json({ success: false, error: "Failed to fetch restaurants" });
  }
});

// Get one restaurant by ID
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants WHERE id = ?", [req.params.id]);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Fetch restaurant by ID error:", err.sqlMessage || err);
    res.status(500).json({ success: false, error: "Failed to fetch restaurant" });
  }
});

module.exports = router;
