const Database = require('better-sqlite3');
const db = new Database('pos.db');

db.pragma('journal_mode = WAL');

// Products
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    sale_price REAL NOT NULL,
    rental_price REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0
  )
`);

// Sales
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    sale_date TEXT NOT NULL,
    total REAL NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY(sale_id) REFERENCES sales(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )
`);

// Rentals
db.exec(`
  CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    paid INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rental_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rental_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    rental_price_per_day REAL NOT NULL,
    days INTEGER NOT NULL,
    FOREIGN KEY(rental_id) REFERENCES rentals(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )
`);

module.exports = db;