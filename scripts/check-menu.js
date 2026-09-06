-- Quick check: menu items for restaurants
SELECT restaurant_id, COUNT(*) AS items FROM menu GROUP BY restaurant_id;
