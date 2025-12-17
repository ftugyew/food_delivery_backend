// controllers/restaurant.controller.js - Restaurant CRUD operations
const db = require("../db");

// ===== GET ALL APPROVED RESTAURANTS (PUBLIC) =====
exports.getAllRestaurants = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM restaurants WHERE status='approved' ORDER BY id DESC"
    );

    const host = `${req.protocol}://${req.get("host")}`;
    const restaurants = rows.map(r => ({
      ...r,
      image_url: r.image_url || null,
      image_url_full: r.image_url 
        ? `${host}/uploads/restaurants/${r.image_url}` 
        : null
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
    const host = `${req.protocol}://${req.get("host")}`;

    const data = {
      ...restaurant,
      image_url: restaurant.image_url || null,
      image_url_full: restaurant.image_url 
        ? `${host}/uploads/restaurants/${restaurant.image_url}` 
        : null
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

    const host = `${req.protocol}://${req.get("host")}`;
    const restaurant = restaurantRows[0];

    const data = {
      restaurant: {
        ...restaurant,
        image_url: restaurant.image_url || null,
        image_url_full: restaurant.image_url 
          ? `${host}/uploads/restaurants/${restaurant.image_url}` 
          : null
      },
      items: menuRows.map(item => ({
        ...item,
        image_url: item.image_url || null,
        image_url_full: item.image_url 
          ? `${host}/uploads/menu/${item.image_url}` 
          : null
      }))
    };

    console.log(`✅ Fetched restaurant ${restaurantId} with ${data.items.length} menu items`);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Error fetching restaurant with menu:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to fetch restaurant data" 
    });
  }
};

// ===== CREATE RESTAURANT (WITH IMAGE) =====
exports.createRestaurant = async (req, res) => {
  try {
    const { name, description, eta, address, latitude, longitude, cuisine } = req.body;
    const imageFilename = req.file?.filename || null;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        error: "Restaurant name is required" 
      });
    }

    const [result] = await db.execute(
      `INSERT INTO restaurants 
       (name, description, image_url, eta, address, latitude, longitude, cuisine, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        name,
        description || "",
        imageFilename,
        eta || 30,
        address || "",
        latitude || null,
        longitude || null,
        cuisine || ""
      ]
    );

    console.log(`✅ Restaurant created: ID ${result.insertId}, Image: ${imageFilename || 'none'}`);
    
    return res.json({ 
      success: true, 
      message: "Restaurant submitted for approval",
      id: result.insertId,
      image_url: imageFilename
    });
  } catch (err) {
    console.error("❌ Error creating restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to create restaurant" 
    });
  }
};

// ===== UPDATE RESTAURANT =====
exports.updateRestaurant = async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const { name, description, eta, address, latitude, longitude, cuisine } = req.body;
    const imageFilename = req.file?.filename || undefined;

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
    if (eta) {
      updates.push("eta = ?");
      params.push(Number(eta));
    }
    if (address !== undefined) {
      updates.push("address = ?");
      params.push(address);
    }
    if (latitude !== undefined) {
      updates.push("latitude = ?");
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push("longitude = ?");
      params.push(longitude);
    }
    if (cuisine !== undefined) {
      updates.push("cuisine = ?");
      params.push(cuisine);
    }
    if (imageFilename) {
      updates.push("image_url = ?");
      params.push(imageFilename);
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
      message: "Restaurant updated" 
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
    const restaurantId = req.params.id;

    // Get image filename before deletion
    const [rows] = await db.execute(
      "SELECT image_url FROM restaurants WHERE id = ?",
      [restaurantId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Restaurant not found" 
      });
    }

    await db.execute("DELETE FROM restaurants WHERE id = ?", [restaurantId]);

    // Optional: Delete image file
    const imageUrl = rows[0].image_url;
    if (imageUrl) {
      const fs = require("fs");
      const path = require("path");
      const imagePath = path.join(__dirname, "..", "uploads", "restaurants", imageUrl);
      
      fs.unlink(imagePath, (err) => {
        if (err) console.warn(`⚠️ Could not delete image: ${imageUrl}`);
        else console.log(`✅ Deleted image: ${imageUrl}`);
      });
    }

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
    const restaurantId = req.params.id;

    await db.execute(
      "UPDATE restaurants SET status='approved' WHERE id=?",
      [restaurantId]
    );

    // Also approve associated user
    await db.execute(
      "UPDATE users SET status='approved' WHERE restaurant_id=?",
      [restaurantId]
    );

    console.log(`✅ Restaurant ${restaurantId} approved`);
    return res.json({ 
      success: true, 
      message: "Restaurant approved" 
    });
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
    const restaurantId = req.params.id;

    await db.execute(
      "UPDATE restaurants SET status='rejected' WHERE id=?",
      [restaurantId]
    );

    await db.execute(
      "UPDATE users SET status='rejected' WHERE restaurant_id=?",
      [restaurantId]
    );

    console.log(`✅ Restaurant ${restaurantId} rejected`);
    return res.json({ 
      success: true, 
      message: "Restaurant rejected" 
    });
  } catch (err) {
    console.error("❌ Error rejecting restaurant:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to reject restaurant" 
    });
  }
};
