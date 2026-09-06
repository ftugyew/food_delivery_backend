// Seed featured and top restaurants from approved restaurants
// Usage: node backend/scripts/seed-featured-top.js

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../db");

async function seed() {
  try {
    const [restaurants] = await db.execute(
      "SELECT id, name FROM restaurants WHERE status='approved' ORDER BY id ASC LIMIT 6"
    );
    if (!restaurants.length) {
      console.log("No approved restaurants found. Approve some restaurants first.");
      process.exit(0);
    }

    for (let i = 0; i < restaurants.length; i++) {
      const rId = restaurants[i].id;
      const position = i + 1;

      const [existsF] = await db.execute(
        "SELECT id FROM featured_restaurants WHERE restaurant_id = ?",
        [rId]
      );
      if (!existsF.length) {
        await db.execute(
          "INSERT INTO featured_restaurants (restaurant_id, position, is_active) VALUES (?, ?, true)",
          [rId, position]
        );
        console.log(`Featured: ${restaurants[i].name} (id=${rId}) @ ${position}`);
      } else {
        console.log(`Featured already has restaurant ${rId}`);
      }

      const [existsT] = await db.execute(
        "SELECT id FROM top_restaurants WHERE restaurant_id = ?",
        [rId]
      );
      if (!existsT.length) {
        await db.execute(
          "INSERT INTO top_restaurants (restaurant_id, position, is_active) VALUES (?, ?, true)",
          [rId, position]
        );
        console.log(`Top: ${restaurants[i].name} (id=${rId}) @ ${position}`);
      } else {
        console.log(`Top already has restaurant ${rId}`);
      }
    }

    const [top] = await db.execute("SELECT * FROM top_restaurants ORDER BY position");
    const [feat] = await db.execute("SELECT * FROM featured_restaurants ORDER BY position");
    console.log("top_restaurants:", top);
    console.log("featured_restaurants:", feat);
    console.log("Seeding complete.");
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
