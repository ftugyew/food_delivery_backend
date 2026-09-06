const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../db");

async function main() {
  const [restaurants] = await db.execute(
    "SELECT id, name, status FROM restaurants ORDER BY id"
  );
  console.log("restaurants:", JSON.stringify(restaurants, null, 2));

  const [top] = await db.execute("SELECT * FROM top_restaurants");
  console.log("top_restaurants:", JSON.stringify(top, null, 2));

  const [featured] = await db.execute("SELECT * FROM featured_restaurants");
  console.log("featured_restaurants:", JSON.stringify(featured, null, 2));

  const [colsTop] = await db.execute(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'top_restaurants'
    ORDER BY ordinal_position
  `);
  console.log("top cols:", JSON.stringify(colsTop, null, 2));

  const [colsFeat] = await db.execute(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'featured_restaurants'
    ORDER BY ordinal_position
  `);
  console.log("featured cols:", JSON.stringify(colsFeat, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
