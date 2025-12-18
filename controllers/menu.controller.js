// controllers/menu.controller.js - Menu CRUD (Cloudinary)
const db = require("../db");

// ===== GET ALL MENU ITEMS FOR A RESTAURANT (PUBLIC) =====
exports.getMenuByRestaurant = async (req, res) => {
  try {
    const restaurantId = req.params.id;
    
    if (!restaurantId) {
      return res.status(400).json({ 
        success: false, 
        error: "Restaurant ID is required" 
      });
    }

    const [rows] = await db.execute(
      "SELECT * FROM menu WHERE restaurant_id = ? ORDER BY id DESC",
      [restaurantId]
    );

    // image_url already contains full Cloudinary URL
    const items = rows.map(item => ({
      ...item,
      image_url: item.image_url || null
    }));

    console.log(`✅ Fetched ${items.length} menu items for restaurant ${restaurantId}`);
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error("❌ Error fetching menu:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to fetch menu items" 
    });
  }
};

// ===== GET MENU FOR AUTHENTICATED RESTAURANT OWNER =====
exports.getMyMenu = async (req, res) => {
  try {
    const user = req.user || {};
    
    if (!user.restaurant_id) {
      return res.status(400).json({ 
        success: false, 
        error: "No restaurant associated with this account" 
      });
    }

    const [rows] = await db.execute(
      "SELECT * FROM menu WHERE restaurant_id = ? ORDER BY id DESC",
      [user.restaurant_id]
    );

    const items = rows.map(item => ({
      ...item,
      image_url: item.image_url || null // Full Cloudinary URL
    }));

    console.log(`✅ Fetched ${items.length} menu items for restaurant ${user.restaurant_id}`);
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error("❌ Error fetching my menu:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to fetch menu" 
    });
  }
};

// ===== ADD MENU ITEM (WITH CLOUDINARY IMAGE) =====
exports.addMenuItem = async (req, res) => {
  try {
    const user = req.user || {};
    
    if (!user.restaurant_id) {
      return res.status(400).json({ 
        success: false, 
        error: "No restaurant associated with this account" 
      });
    }

    const { item_name, price, description, category, is_veg } = req.body;
    
    // req.file.path contains full Cloudinary URL
    const imageUrl = req.file?.path || null;

    if (!item_name || price === undefined || price === null) {
      return res.status(400).json({ 
        success: false, 
        error: "item_name and price are required" 
      });
    }

    const finalIsVeg = (is_veg === '1' || is_veg === 1 || is_veg === true || is_veg === 'veg') ? 1 : 0;

    const [result] = await db.execute(
      `INSERT INTO menu 
       (restaurant_id, item_name, description, price, category, is_veg, image_url, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        user.restaurant_id,
        item_name,
        description || "",
        Number(price) || 0,
        category || "Uncategorized",
        finalIsVeg,
        imageUrl // Full Cloudinary URL
      ]
    );

    console.log(`✅ Menu item added: ID ${result.insertId}, Image: ${imageUrl || 'none'}`);
    
    return res.json({ 
      success: true, 
      message: "Menu item added successfully",
      id: result.insertId,
      image_url: imageUrl
    });
  } catch (err) {
    console.error("❌ Error adding menu item:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to add menu item",
      details: err.message
    });
  }
};

// ===== DELETE MENU ITEM =====
exports.deleteMenuItem = async (req, res) => {
  try {
    const user = req.user || {};
    const itemId = req.params.id;

    // Check ownership
    const [rows] = await db.execute(
      "SELECT restaurant_id, image_url FROM menu WHERE id = ?",
      [itemId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Menu item not found" 
      });
    }

    const item = rows[0];

// ===== DELETE MENU ITEM =====
exports.deleteMenuItem = async (req, res) => {
  try {
    const user = req.user || {};
    const itemId = req.params.id;

    const [rows] = await db.execute(
      "SELECT restaurant_id FROM menu WHERE id = ?",
      [itemId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Menu item not found" 
      });
    }

    // Admin can delete anything, restaurant owner can only delete their own
    if (user.role !== "admin" && user.restaurant_id !== rows[0].restaurant_id) {
      return res.status(403).json({ 
        success: false, 
        error: "Not authorized to delete this item" 
      });
    }

    // Delete from database (Cloudinary auto-manages image cleanup)
    await db.execute("DELETE FROM menu WHERE id = ?", [itemId]);

    console.log(`✅ Menu item ${itemId} deleted`);
    return res.json({ 
      success: true, 
      message: "Menu item deleted" 
    });
  } catch (err) {
    console.error("❌ Error deleting menu item:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to delete menu item" 
    });
  }
};

// ===== UPDATE MENU ITEM =====
exports.updateMenuItem = async (req, res) => {
  try {
    const user = req.user || {};
    const itemId = req.params.id;
    const { item_name, price, description, category, is_veg } = req.body;

    const [rows] = await db.execute(
      "SELECT restaurant_id FROM menu WHERE id = ?",
      [itemId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        error: "Menu item not found" 
      });
    }

    if (user.role !== "admin" && user.restaurant_id !== rows[0].restaurant_id) {
      return res.status(403).json({ 
        success: false, 
        error: "Not authorized" 
      });
    }

    const imageUrl = req.file?.path || undefined; // Full Cloudinary URL
    const finalIsVeg = (is_veg === '1' || is_veg === 1 || is_veg === true) ? 1 : 0;

    const updates = [];
    const params = [];

    if (item_name) {
      updates.push("item_name = ?");
      params.push(item_name);
    }
    if (price !== undefined) {
      updates.push("price = ?");
      params.push(Number(price));
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (category) {
      updates.push("category = ?");
      params.push(category);
    }
    if (is_veg !== undefined) {
      updates.push("is_veg = ?");
      params.push(finalIsVeg);
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

    params.push(itemId);

    await db.execute(
      `UPDATE menu SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    console.log(`✅ Menu item ${itemId} updated`);
    return res.json({ 
      success: true, 
      message: "Menu item updated",
      image_url: imageUrl || undefined
    });
  } catch (err) {
    console.error("❌ Error updating menu item:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to update menu item" 
    });
  }
};
