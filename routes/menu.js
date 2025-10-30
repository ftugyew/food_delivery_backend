// menu.js — Tindo Restaurant Menu Frontend
// Fetch and display all menu items from backend

// ---------- CONFIGURATION ----------
const API_BASE = "/api/restaurant"; // Backend API route base

// ---------- MAIN FUNCTION ----------
async function loadMenu() {
  try {
    // Get restaurant ID from localStorage or query param
    const restaurantId =
      localStorage.getItem("restaurantId") ||
      new URLSearchParams(window.location.search).get("id");

    if (!restaurantId) {
      console.error("No restaurantId found in localStorage or URL.");
      document.getElementById("menuContainer").innerHTML =
        "<p class='text-red-600'>No restaurant ID found.</p>";
      return;
    }

    // Fetch menus from server
    const response = await fetch(`${API_BASE}/${restaurantId}/menu`);
    if (!response.ok) throw new Error("Failed to fetch menu data");
    const menus = await response.json();

    const container = document.getElementById("menuContainer");
    container.innerHTML = "";

    if (!menus.length) {
      container.innerHTML =
        "<p class='text-gray-600 text-center w-full'>No menu items found for this restaurant.</p>";
      return;
    }

    // Optional: extract categories
    const categories = [...new Set(menus.map((m) => m.category || "Other"))];
    createCategoryFilter(categories, menus);

    // Display all items initially
    displayMenuItems(menus);
  } catch (err) {
    console.error("Error loading menu:", err);
    document.getElementById("menuContainer").innerHTML =
      "<p class='text-red-600'>Failed to load menu. Please try again later.</p>";
  }
}

// ---------- DISPLAY MENU ITEMS ----------
function displayMenuItems(items) {
  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className =
      "menu-card bg-white rounded-xl shadow-lg p-4 hover:scale-105 transition-all text-center";

    card.innerHTML = `
      <img src="${item.image}" alt="${item.name}" 
           class="w-full h-48 object-cover rounded-lg mb-3">
      <h3 class="font-semibold text-lg">${item.name}</h3>
      <p class="text-green-600 font-medium mb-1">₹${item.price}</p>
      <p class="text-sm text-gray-500 mb-3">${item.category || "Uncategorized"}</p>
      <button 
        onclick="addToCart('${item.id}','${item.name}',${item.price})" 
        class="bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 transition">
        Add to Cart
      </button>
    `;

    container.appendChild(card);
  });
}

// ---------- CATEGORY FILTER ----------
function createCategoryFilter(categories, menus) {
  const filterContainer = document.getElementById("filterContainer");
  if (!filterContainer) return;

  filterContainer.innerHTML = `
    <select id="categorySelect" class="p-2 rounded-lg border">
      <option value="all">All Categories</option>
      ${categories.map((c) => `<option value="${c}">${c}</option>`).join("")}
    </select>
  `;

  document
    .getElementById("categorySelect")
    .addEventListener("change", (e) => {
      const selected = e.target.value;
      if (selected === "all") displayMenuItems(menus);
      else displayMenuItems(menus.filter((m) => m.category === selected));
    });
}

// ---------- ADD TO CART ----------
function addToCart(id, name, price) {
  let cart = JSON.parse(localStorage.getItem("tindo_cart")) || [];
  const existing = cart.find((item) => item.id === id);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ id, name, price, quantity: 1 });
  }

  localStorage.setItem("tindo_cart", JSON.stringify(cart));
  alert(`${name} added to cart ✅`);
}

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", loadMenu);
