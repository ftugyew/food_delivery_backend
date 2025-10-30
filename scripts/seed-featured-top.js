// Seed sample featured and top restaurants based on existing approved restaurants
// Usage: node backend/scripts/seed-featured-top.js

const db = require("../db");

async function seed() {
  try {
    // pick first 3 approved restaurants
    const [restaurants] = await db.execute(
      "SELECT id FROM restaurants WHERE status='approved' ORDER BY id ASC LIMIT 3"
    );
    if (!restaurants.length) {
      console.log("No approved restaurants found. Approve some restaurants first.");
      process.exit(0);
    }

    // Insert into featured_restaurants if not already present
    for (let i = 0; i < restaurants.length; i++) {
      const rId = restaurants[i].id;
      const position = i + 1;
      const [existsF] = await db.execute(
        "SELECT id FROM featured_restaurants WHERE restaurant_id = ?",
        [rId]
      );
      if (!existsF.length) {
        await db.execute(
          "INSERT INTO featured_restaurants (restaurant_id, position, is_active) VALUES (?, ?, 1)",
          [rId, position]
        );
        console.log(`Added restaurant ${rId} to featured at position ${position}`);
      }
    }

    // Insert into top_restaurants if not already present
    for (let i = 0; i < restaurants.length; i++) {
      const rId = restaurants[i].id;
      const position = i + 1;
      const [existsT] = await db.execute(
        "SELECT id FROM top_restaurants WHERE restaurant_id = ?",
        [rId]
      );
      if (!existsT.length) {
        await db.execute(
          "INSERT INTO top_restaurants (restaurant_id, position, is_active) VALUES (?, ?, 1)",
          [rId, position]
        );
        console.log(`Added restaurant ${rId} to top at position ${position}`);
      }
    }

    console.log("Seeding complete.");
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
