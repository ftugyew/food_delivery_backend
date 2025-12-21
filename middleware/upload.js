// middleware/upload.js - Multer + Cloudinary storage configuration
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// ===== RESTAURANT IMAGE UPLOAD =====
const restaurantStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "tindo/restaurants",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"]
  }
});

const restaurantUpload = multer({
  storage: restaurantStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = /image\/(jpg|jpeg|png|gif|webp)/;
    if (allowedMimes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed (jpg, png, gif, webp)"));
    }
  }
});

// ===== MENU IMAGE UPLOAD =====
const menuStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "tindo/menu",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"]
  }
});

const menuUpload = multer({
  storage: menuStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = /image\/(jpg|jpeg|png|gif|webp)/;
    if (allowedMimes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed (jpg, png, gif, webp)"));
    }
  }
});

// ===== BANNER IMAGE UPLOAD =====
const bannerStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "tindo/banners",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"]
  }
});

const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = /image\/(jpg|jpeg|png|gif|webp)/;
    if (allowedMimes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed (jpg, png, gif, webp)"));
    }
  }
});

module.exports = {
  restaurantUpload,
  menuUpload,
  bannerUpload
};
