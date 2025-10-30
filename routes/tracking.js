// backend/routes/tracking.js
const express = require("express");
const router = express.Router();
let riderLocations = {}; // store rider live positions


// API for updating rider location
router.post("/update-location", (req, res) => {
  const { orderId, lat, lng } = req.body;
  riderLocations[orderId] = { lat, lng };
  res.json({ success: true, location: riderLocations[orderId] });
});

// API for getting rider location (for frontend polling)
router.get("/location/:orderId", (req, res) => {
  const { orderId } = req.params;
  if (riderLocations[orderId]) {
    res.json(riderLocations[orderId]);
  } else {
    res.status(404).json({ error: "Location not found" });
  }
});

module.exports = router;
