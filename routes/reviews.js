const express = require("express");
const db = require("../db");
const router = express.Router();

// Get reviews by restaurant id
router.get("/:id/reviews", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    
    const [rows] = await db.execute(
      "SELECT * FROM restaurant_reviews WHERE restaurant_id = ? ORDER BY created_at DESC",
      [restaurantId]
    );
    
    res.json(rows);
  } catch (err) {
    console.error("Review fetch error:", err.sqlMessage || err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// Add review
router.post("/:id/reviews", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const { user_id, rating, review } = req.body;

    if (!user_id || !rating || !review) {
      return res.status(400).json({ error: "All fields required" });
    }

    await db.execute(
      "INSERT INTO restaurant_reviews (restaurant_id, user_id, rating, review) VALUES (?, ?, ?, ?)",
      [restaurantId, user_id, rating, review]
    );

    res.json({ message: "Review added successfully" });
  } catch (err) {
    console.error("Review insert error:", err.sqlMessage || err);
    res.status(500).json({ error: "Failed to add review" });
  }
});

module.exports = router;
