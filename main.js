// Global Constants
const API_BASE_URL = "https://api.example.com"; // Replace with your actual API base URL
const AUTH_TOKEN_KEY = "authToken";

// Shared UI Helpers
function showLoader() {
    const loader = document.createElement("div");
    loader.id = "global-loader";
    loader.innerHTML = `<div class="loader">Loading...</div>`;
    document.body.appendChild(loader);
}

function hideLoader() {
    const loader = document.getElementById("global-loader");
    if (loader) {
        loader.remove();
    }
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// API Fetch Wrapper
async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    try {
        showLoader();
        const response = await fetch(url, { ...options, headers });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "API Error");
        }
        return data;
    } catch (error) {
        showToast(error.message, "error");
        throw error;
    } finally {
        hideLoader();
    }
}

// Navbar Handler
function setupNavbar() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    const authToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (authToken) {
        navbar.innerHTML = `
            <a href="/profile.html">Profile</a>
            <a href="#" id="logout-btn">Logout</a>
        `;
        document.getElementById("logout-btn").addEventListener("click", () => {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            window.location.href = "/login.html";
        });
    } else {
        navbar.innerHTML = `
            <a href="/login.html">Login</a>
            <a href="/register.html">Register</a>
        `;
    }
}

// Authentication Handlers
function login(username, password) {
    return apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    }).then((data) => {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        window.location.href = "/index.html";
    });
}

function register(username, password) {
    return apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    }).then(() => {
        window.location.href = "/login.html";
    });
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    setupNavbar();
});