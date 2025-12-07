const express = require("express");
const db = require("../db");
const multer = require("multer");
const path = require("path");
const router = express.Router();

// Multer setup for banner uploads
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

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

// Alias for /delivery → /agents (as per requirement)
router.get("/agents", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM delivery_agents");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch agents" });
  }
});

// ================= TOP RESTAURANTS =================
router.get("/top-restaurants", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants WHERE is_top = 1 ORDER BY name");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch top restaurants" });
  }
});

// Add restaurant to top list (POST)
router.post("/top-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body;
    if (!restaurant_id) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }
    
    // Set is_top = 1 for this restaurant
    await db.execute("UPDATE restaurants SET is_top = 1 WHERE id = ?", [restaurant_id]);
    res.json({ success: true, message: "Restaurant added to top list" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to add top restaurant" });
  }
});

// Remove restaurant from top list (DELETE)
router.delete("/top-restaurants/:id", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    await db.execute("UPDATE restaurants SET is_top = 0 WHERE id = ?", [restaurantId]);
    res.json({ success: true, message: "Restaurant removed from top list" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to remove top restaurant" });
  }
});

// Toggle top restaurant status (PUT)
router.put("/top-restaurants/:id/toggle", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const [rows] = await db.execute("SELECT is_top FROM restaurants WHERE id = ?", [restaurantId]);
    
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }
    
    const newStatus = rows[0].is_top ? 0 : 1;
    await db.execute("UPDATE restaurants SET is_top = ? WHERE id = ?", [newStatus, restaurantId]);
    
    res.json({ success: true, data: { is_top: newStatus }, message: "Top status toggled" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to toggle top status" });
  }
});

// ================= FEATURED RESTAURANTS =================
router.get("/featured-restaurants", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM restaurants WHERE featured = 1 OR rating >= 4.5 ORDER BY rating DESC LIMIT 10"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch featured restaurants" });
  }
});

// Add restaurant to featured list (POST)
router.post("/featured-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body;
    if (!restaurant_id) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }
    
    // Set featured = 1 for this restaurant
    await db.execute("UPDATE restaurants SET featured = 1 WHERE id = ?", [restaurant_id]);
    res.json({ success: true, message: "Restaurant added to featured list" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to add featured restaurant" });
  }
});

// Remove restaurant from featured list (DELETE)
router.delete("/featured-restaurants/:id", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    await db.execute("UPDATE restaurants SET featured = 0 WHERE id = ?", [restaurantId]);
    res.json({ success: true, message: "Restaurant removed from featured list" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to remove featured restaurant" });
  }
});

// Toggle featured restaurant status (PUT)
router.put("/featured-restaurants/:id/toggle", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const [rows] = await db.execute("SELECT featured FROM restaurants WHERE id = ?", [restaurantId]);
    
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }
    
    const newStatus = rows[0].featured ? 0 : 1;
    await db.execute("UPDATE restaurants SET featured = ? WHERE id = ?", [newStatus, restaurantId]);
    
    res.json({ success: true, data: { is_active: newStatus }, message: "Featured status toggled" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to toggle featured status" });
  }
});

// ================= BANNERS =================
router.get("/banners", async (req, res) => {
  try {
    // Check if banners table exists, if not create it
    await db.execute(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_url VARCHAR(500) NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    const [rows] = await db.execute("SELECT * FROM banners WHERE is_active = 1 ORDER BY created_at DESC");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch banners" });
  }
});

// Upload new banner (POST with file upload)
router.post("/banners", upload.single("banner"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    
    // Ensure banners table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_url VARCHAR(500) NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    const imageUrl = req.file.filename;
    await db.execute("INSERT INTO banners (image_url, is_active) VALUES (?, 1)", [imageUrl]);
    
    res.json({ success: true, message: "Banner uploaded successfully", image_url: imageUrl });
  } catch (err) {
    console.error("Banner upload error:", err);
    res.status(500).json({ success: false, error: "Failed to upload banner" });
  }
});

// Delete banner by ID
router.delete("/banners/:id", async (req, res) => {
  try {
    const bannerId = req.params.id;
    await db.execute("DELETE FROM banners WHERE id = ?", [bannerId]);
    res.json({ success: true, message: "Banner deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to delete banner" });
  }
});

// ================= MENU =================
router.get("/menu", async (req, res) => {
  try {
    // Check if menu table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS menu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        category VARCHAR(100),
        image_url VARCHAR(500),
        is_available BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      )
    `);
    
    const [rows] = await db.execute(`
      SELECT m.*, r.name as restaurant_name 
      FROM menu m 
      LEFT JOIN restaurants r ON m.restaurant_id = r.id 
      ORDER BY m.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch menu items" });
  }
});

module.exports = router;
