const express = require("express");
const router = express.Router();
const { restaurantUpload } = require("../config/multer");
const restaurantController = require("../controllers/restaurant.controller");
const { authMiddleware } = require("./auth");

// ===== PUBLIC ROUTES =====
// Get all approved restaurants
router.get("/", restaurantController.getAllRestaurants);

// Get restaurant by ID
router.get("/:id", restaurantController.getRestaurantById);

// Get restaurant + menu combined
router.get("/:id/menu", restaurantController.getRestaurantWithMenu);

// ===== PROTECTED ROUTES =====
// Create restaurant (with image)
router.post("/", authMiddleware, restaurantUpload.single("image"), restaurantController.createRestaurant);

// Update restaurant
router.put("/:id", authMiddleware, restaurantUpload.single("image"), restaurantController.updateRestaurant);

// Delete restaurant
router.delete("/:id", authMiddleware, restaurantController.deleteRestaurant);

// ===== ADMIN ROUTES =====
// Approve restaurant
router.put("/approve/:id", authMiddleware, restaurantController.approveRestaurant);

// Reject restaurant
router.put("/reject/:id", authMiddleware, restaurantController.rejectRestaurant);

// LEGACY ROUTES (KEEP FOR BACKWARDS COMPATIBILITY)
const db = require("../db");

// Add restaurant (legacy - keeping for compatibility)
router.post("/legacy", async (req, res) => {
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
