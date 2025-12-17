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
      ? `${IMAGE_BASE_URL}/${item.image_url}`
      : "assets/placeholder.jpg";

    const card = document.createElement("div");
    card.className =
      "bg-white rounded-xl shadow-lg p-4 hover:scale-105 transition text-center";

    card.innerHTML = `
      <img src="${imgSrc}"
           onerror="this.src='assets/placeholder.jpg'"
           class="w-full h-48 object-cover rounded-lg mb-3">

      <h3 class="font-semibold text-lg">${item.item_name}</h3>
      <p class="text-green-600 font-medium">₹${item.price}</p>
      <p class="text-sm text-gray-500 mb-3">${item.category || "Other"}</p>

      <button onclick="addToCart('${item.id}','${item.item_name}',${item.price})"
        class="bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
        Add to Cart
      </button>
    `;

    container.appendChild(card);
  });
}

function createCategoryFilter(categories, menus) {
  const filterContainer = document.getElementById("filterContainer");
  if (!filterContainer) return;

  filterContainer.innerHTML = `
    <select id="categorySelect" class="p-2 rounded-lg border">
      <option value="all">All Categories</option>
      ${categories.map(c => `<option value="${c}">${c}</option>`).join("")}
    </select>
  `;

  document.getElementById("categorySelect").addEventListener("change", e => {
    const selected = e.target.value;
    selected === "all"
      ? displayMenuItems(menus)
      : displayMenuItems(menus.filter(m => m.category === selected));
  });
}

function addToCart(id, name, price) {
  let cart = JSON.parse(localStorage.getItem("tindo_cart")) || [];
  const existing = cart.find(item => item.id === id);

  if (existing) existing.quantity += 1;
  else cart.push({ id, name, price, quantity: 1 });

  localStorage.setItem("tindo_cart", JSON.stringify(cart));
  alert(`${name} added to cart ✅`);
}

document.addEventListener("DOMContentLoaded", loadMenu);
