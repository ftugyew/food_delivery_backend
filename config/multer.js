// config/multer.js - Separate upload configurations
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ===== ENSURE UPLOAD DIRECTORIES EXIST =====
// Allow overriding the uploads root with an env var (e.g., when mounting a persistent disk on Render)
const uploadsRoot = process.env.UPLOADS_ROOT
  ? path.resolve(process.env.UPLOADS_ROOT)
  : path.join(__dirname, "..", "uploads");
const menuDir = path.join(uploadsRoot, "menu");
const restaurantsDir = path.join(uploadsRoot, "restaurants");

fs.mkdirSync(menuDir, { recursive: true });
fs.mkdirSync(restaurantsDir, { recursive: true });

// ===== MENU IMAGE STORAGE =====
const menuStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, menuDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// ===== RESTAURANT IMAGE STORAGE =====
const restaurantStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, restaurantsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// ===== FILE FILTER (IMAGES ONLY) =====
const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (jpeg, jpg, png, gif, webp)"));
  }
};

// ===== EXPORT UPLOAD INSTANCES =====
const menuUpload = multer({
  storage: menuStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

const restaurantUpload = multer({
  storage: restaurantStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

module.exports = {
  menuUpload,
  restaurantUpload,
  uploadsRoot,
  menuDir,
  restaurantsDir
};
