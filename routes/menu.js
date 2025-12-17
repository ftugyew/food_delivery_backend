// routes/menu.js - Menu routes with proper Multer
const express = require("express");
const router = express.Router();
const { menuUpload } = require("../config/multer");
const menuController = require("../controllers/menu.controller");
const { authMiddleware } = require("./auth");

// ===== PUBLIC ROUTES =====
// Get menu items for a specific restaurant (no auth needed)
router.get("/restaurant/:id", menuController.getMenuByRestaurant);
router.get("/by-restaurant/:id", menuController.getMenuByRestaurant); // Alias

// ===== PROTECTED ROUTES (REQUIRE AUTH) =====
// Get menu for authenticated restaurant owner
router.get("/", authMiddleware, menuController.getMyMenu);
router.get("/my", authMiddleware, menuController.getMyMenu); // Alias

// Add menu item (with image upload)
router.post("/", authMiddleware, menuUpload.single("image"), menuController.addMenuItem);
router.post("/add", authMiddleware, menuUpload.single("image"), menuController.addMenuItem); // Alias

// Update menu item
router.put("/:id", authMiddleware, menuUpload.single("image"), menuController.updateMenuItem);

// Delete menu item
router.delete("/:id", authMiddleware, menuController.deleteMenuItem);

module.exports = router;
