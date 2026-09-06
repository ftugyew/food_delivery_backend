const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../db");

(async () => {
  const [u] = await db.execute("SELECT id, name, email, role FROM users ORDER BY id LIMIT 15");
  console.log(JSON.stringify(u, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
