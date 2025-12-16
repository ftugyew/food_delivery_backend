// menu.js — Tindo Restaurant Menu Frontend

const API_BASE =
  "https://food-delivery-backend-cw3m.onrender.com/api/restaurant";

const IMAGE_BASE_URL =
  "https://food-delivery-backend-cw3m.onrender.com/uploads";

async function loadMenu() {
  try {
    const restaurantId =
      localStorage.getItem("restaurantId") ||
      new URLSearchParams(window.location.search).get("id");

    if (!restaurantId) {
      document.getElementById("menuContainer").innerHTML =
        "<p class='text-red-600'>No restaurant ID found.</p>";
      return;
    }

    const response = await fetch(`${API_BASE}/${restaurantId}/menu`);
    if (!response.ok) throw new Error("Failed to fetch menu data");

    const menus = await response.json();
    const container = document.getElementById("menuContainer");
    container.innerHTML = "";

    if (!menus.length) {
      container.innerHTML =
        "<p class='text-gray-600 text-center'>No menu items found.</p>";
      return;
    }

    const categories = [...new Set(menus.map(m => m.category || "Other"))];
    createCategoryFilter(categories, menus);
    displayMenuItems(menus);

  } catch (err) {
    console.error("Error loading menu:", err);
    document.getElementById("menuContainer").innerHTML =
      "<p class='text-red-600'>Failed to load menu.</p>";
  }
}

function displayMenuItems(items) {
  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

  items.forEach(item => {
    const imgSrc = item.image_url
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
