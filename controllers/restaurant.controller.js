// controllers/restaurant.controller.js - Restaurant CRUD (Cloudinary)
const db = require("../db");

// ===== GET ALL APPROVED RESTAURANTS (PUBLIC) =====
exports.getAllRestaurants = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM restaurants WHERE status='approved' ORDER BY id DESC"
    );

    const restaurants = rows.map(r => ({
      ...r,
      image_url: r.image_url || null // Cloudinary URL (already full)
    }));

    console.log(`✅ Fetched ${restaurants.length} restaurants`);
    return res.json({ success: true, data: restaurants });
  } catch (err) {
    console.error("❌ Error fetching restaurants:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to fetch restaurants" 
    });
  }
};

// ===== GET SINGLE RESTAURANT BY ID (PUBLIC) =====
exports.getRestaurantById = async (req, res) => {
  try {
    const restaurantId = req.params.id;

    const [rows] = await db.execute(
      "SELECT * FROM restaurants WHERE id = ?",
      [restaurantId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Restaurant not found" 
      });
    }

    const restaurant = rows[0];

    const data = {
      ...restaurant,
      image_url: restaurant.image_url || null // Cloudinary URL
    };

    console.log(`✅ Fetched restaurant ${restaurantId}`);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Error fetching restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to fetch restaurant" 
    });
  }
};

// ===== GET RESTAURANT + MENU (PUBLIC) =====
exports.getRestaurantWithMenu = async (req, res) => {
  try {
    const restaurantId = req.params.id;

    // Get restaurant
    const [restaurantRows] = await db.execute(
      "SELECT * FROM restaurants WHERE id = ?",
      [restaurantId]
    );

    if (!restaurantRows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Restaurant not found" 
      });
    }

    // Get menu items
    const [menuRows] = await db.execute(
      "SELECT * FROM menu WHERE restaurant_id = ? ORDER BY id DESC",
      [restaurantId]
    );

    const restaurant = restaurantRows[0];
    const menu = menuRows.map(m => ({
      ...m,
      image_url: m.image_url || null // Cloudinary URL
    }));

    const data = {
      restaurant: {
        ...restaurant,
        image_url: restaurant.image_url || null
      },
      menu: menu
    };

    console.log(`✅ Fetched restaurant ${restaurantId} with ${menu.length} items`);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Error fetching restaurant with menu:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to fetch restaurant data" 
    });
  }
};

// ===== CREATE RESTAURANT (WITH CLOUDINARY IMAGE) =====
exports.createRestaurant = async (req, res) => {
  try {
    const user = req.user || {};
    const { name, description, cuisine, phone, email, address, lat, lng } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        error: "Restaurant name is required" 
      });
    }

    // req.file.path contains full Cloudinary URL from multer-storage-cloudinary
    const imageUrl = req.file?.path || null;

    const [result] = await db.execute(
      `INSERT INTO restaurants 
       (name, description, cuisine, phone, email, address, lat, lng, image_url, status, created_by, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW())`,
      [name, description || "", cuisine || "Multi Cuisine", phone || "", email || "", address || "", lat || 0, lng || 0, imageUrl, user.id || null]
    );

    console.log(`✅ Restaurant created: ID ${result.insertId}, Image: ${imageUrl || 'none'}`);
    
    return res.json({ 
      success: true, 
      message: "Restaurant created successfully",
      id: result.insertId,
      image_url: imageUrl
    });
  } catch (err) {
    console.error("❌ Error creating restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to create restaurant",
      details: err.message
    });
  }
};

// ===== UPDATE RESTAURANT =====
exports.updateRestaurant = async (req, res) => {
  try {
    const user = req.user || {};
    const restaurantId = req.params.id;
    const { name, description, cuisine, phone, email, address, lat, lng } = req.body;

    // Check ownership or admin
    const [checkRows] = await db.execute(
      "SELECT created_by FROM restaurants WHERE id = ?",
      [restaurantId]
    );

    if (!checkRows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Restaurant not found" 
      });
    }

    if (user.role !== "admin" && checkRows[0].created_by !== user.id) {
      return res.status(403).json({ 
        success: false, 
        error: "Not authorized to update this restaurant" 
      });
    }

    const imageUrl = req.file?.path || undefined;

    const updates = [];
    const params = [];

    if (name) {
      updates.push("name = ?");
      params.push(name);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (cuisine) {
      updates.push("cuisine = ?");
      params.push(cuisine);
    }
    if (phone) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (email) {
      updates.push("email = ?");
      params.push(email);
    }
    if (address) {
      updates.push("address = ?");
      params.push(address);
    }
    if (lat !== undefined) {
      updates.push("lat = ?");
      params.push(lat);
    }
    if (lng !== undefined) {
      updates.push("lng = ?");
      params.push(lng);
    }
    if (imageUrl) {
      updates.push("image_url = ?");
      params.push(imageUrl);
    }

    if (updates.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "No fields to update" 
      });
    }

    params.push(restaurantId);

    await db.execute(
      `UPDATE restaurants SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    console.log(`✅ Restaurant ${restaurantId} updated`);
    return res.json({ 
      success: true, 
      message: "Restaurant updated successfully",
      image_url: imageUrl || undefined
    });
  } catch (err) {
    console.error("❌ Error updating restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to update restaurant" 
    });
  }
};

// ===== DELETE RESTAURANT =====
exports.deleteRestaurant = async (req, res) => {
  try {
    const user = req.user || {};
    const restaurantId = req.params.id;

    const [rows] = await db.execute(
      "SELECT created_by FROM restaurants WHERE id = ?",
      [restaurantId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Restaurant not found" 
      });
    }

    if (user.role !== "admin" && rows[0].created_by !== user.id) {
      return res.status(403).json({ 
        success: false, 
        error: "Not authorized to delete this restaurant" 
      });
    }

    await db.execute("DELETE FROM restaurants WHERE id = ?", [restaurantId]);

    console.log(`✅ Restaurant ${restaurantId} deleted`);
    return res.json({ 
      success: true, 
      message: "Restaurant deleted" 
    });
  } catch (err) {
    console.error("❌ Error deleting restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to delete restaurant" 
    });
  }
};

// ===== APPROVE RESTAURANT (ADMIN) =====
exports.approveRestaurant = async (req, res) => {
  try {
    const user = req.user || {};

    if (user.role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        error: "Only admin can approve restaurants" 
      });
    }

    await db.execute(
      "UPDATE restaurants SET status = 'approved' WHERE id = ?",
      [req.params.id]
    );

    console.log(`✅ Restaurant ${req.params.id} approved`);
    return res.json({ success: true, message: "Restaurant approved" });
  } catch (err) {
    console.error("❌ Error approving restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to approve restaurant" 
    });
  }
};

// ===== REJECT RESTAURANT (ADMIN) =====
exports.rejectRestaurant = async (req, res) => {
  try {
    const user = req.user || {};

    if (user.role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        error: "Only admin can reject restaurants" 
      });
    }

    await db.execute(
      "UPDATE restaurants SET status = 'rejected' WHERE id = ?",
      [req.params.id]
    );

    console.log(`✅ Restaurant ${req.params.id} rejected`);
    return res.json({ success: true, message: "Restaurant rejected" });
  } catch (err) {
    console.error("❌ Error rejecting restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to reject restaurant" 
    });
  }
};
