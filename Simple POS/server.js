const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- Helper functions ---
function generateInvoiceNumber(prefix) {
  return prefix + '-' + Date.now();
}

// --- Home ---
app.get('/', (req, res) => {
  res.redirect('/inventory');
});

// =============== INVENTORY ===============
app.get('/inventory', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY name').all();
  res.render('inventory', { products });
});

app.post('/inventory/add', (req, res) => {
  const { name, description, sale_price, rental_price, stock } = req.body;
  db.prepare('INSERT INTO products (name, description, sale_price, rental_price, stock) VALUES (?,?,?,?,?)')
    .run(name, description || '', parseFloat(sale_price), parseFloat(rental_price) || 0, parseInt(stock) || 0);
  res.redirect('/inventory');
});

app.post('/inventory/edit/:id', (req, res) => {
  const { name, description, sale_price, rental_price, stock } = req.body;
  db.prepare('UPDATE products SET name=?, description=?, sale_price=?, rental_price=?, stock=? WHERE id=?')
    .run(name, description, parseFloat(sale_price), parseFloat(rental_price), parseInt(stock), req.params.id);
  res.redirect('/inventory');
});

app.post('/inventory/delete/:id', (req, res) => {
  // Check if product is used in any sale or rental (simplified, just delete)
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.redirect('/inventory');
});

// =============== SALES ===============
app.get('/sales', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE stock > 0').all();
  const sales = db.prepare(`
    SELECT s.*, 
      (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as item_count
    FROM sales s ORDER BY s.sale_date DESC
  `).all();
  res.render('sales', { products, sales });
});

app.post('/sales/create', (req, res) => {
  const { product_ids, quantities } = req.body;
  if (!product_ids) return res.redirect('/sales');

  const ids = Array.isArray(product_ids) ? product_ids : [product_ids];
  const qts = Array.isArray(quantities) ? quantities.map(q => parseInt(q)) : [parseInt(quantities)];

  let total = 0;
  const items = [];
  for (let i = 0; i < ids.length; i++) {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(ids[i]);
    if (!product) continue;
    const qty = qts[i] || 1;
    if (qty > product.stock) {
      return res.send(`Not enough stock for ${product.name}`);
    }
    const lineTotal = product.sale_price * qty;
    total += lineTotal;
    items.push({ product, qty, price: product.sale_price });
  }

  const invoice_number = generateInvoiceNumber('INV');
  const saleDate = new Date().toISOString();

  const insertSale = db.prepare('INSERT INTO sales (invoice_number, sale_date, total) VALUES (?,?,?)');
  const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?,?,?,?)');
  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id=?');

  const transaction = db.transaction(() => {
    const info = insertSale.run(invoice_number, saleDate, total);
    const saleId = info.lastInsertRowid;
    for (const item of items) {
      insertItem.run(saleId, item.product.id, item.qty, item.price);
      updateStock.run(item.qty, item.product.id);
    }
  });
  transaction();

  res.redirect('/sales');
});

app.get('/invoice/sale/:id', (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!sale) return res.status(404).send('Sale not found');
  const items = db.prepare(`
    SELECT si.*, p.name, p.description 
    FROM sale_items si JOIN products p ON si.product_id = p.id 
    WHERE si.sale_id = ?
  `).all(sale.id);
  res.render('invoice', { invoice: sale, items, type: 'sale' });
});

// =============== RENTALS ===============
app.get('/rentals', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE stock > 0 AND rental_price > 0').all();
  const rentals = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM rental_items WHERE rental_id = r.id) as item_count
    FROM rentals r ORDER BY r.start_date DESC
  `).all();
  res.render('rentals', { products, rentals });
});

app.post('/rentals/create', (req, res) => {
  const { customer_name, product_ids, quantities, days } = req.body;
  if (!product_ids) return res.redirect('/rentals');

  const ids = Array.isArray(product_ids) ? product_ids : [product_ids];
  const qts = Array.isArray(quantities) ? quantities.map(q => parseInt(q)) : [parseInt(quantities)];
  const daysArr = Array.isArray(days) ? days.map(d => parseInt(d)) : [parseInt(days)];

  let total = 0;
  const items = [];
  const startDate = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

  for (let i = 0; i < ids.length; i++) {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(ids[i]);
    if (!product) continue;
    const qty = qts[i] || 1;
    const rentalDays = daysArr[i] || 1;
    if (qty > product.stock) {
      return res.send(`Not enough stock to rent ${product.name}`);
    }
    const lineTotal = product.rental_price * qty * rentalDays;
    total += lineTotal;
    items.push({ product, qty, days: rentalDays, pricePerDay: product.rental_price });
  }

  const invoice_number = generateInvoiceNumber('RNT');
  const insertRental = db.prepare('INSERT INTO rentals (invoice_number, customer_name, start_date, total, status) VALUES (?,?,?,?,?)');
  const insertRentalItem = db.prepare('INSERT INTO rental_items (rental_id, product_id, quantity, rental_price_per_day, days) VALUES (?,?,?,?,?)');
  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id=?');

  const transaction = db.transaction(() => {
    const info = insertRental.run(invoice_number, customer_name || 'Walk-in', startDate, total, 'active');
    const rentalId = info.lastInsertRowid;
    for (const item of items) {
      insertRentalItem.run(rentalId, item.product.id, item.qty, item.pricePerDay, item.days);
      updateStock.run(item.qty, item.product.id);
    }
  });
  transaction();

  res.redirect('/rentals');
});

app.post('/rentals/return/:id', (req, res) => {
  const rental = db.prepare('SELECT * FROM rentals WHERE id=?').get(req.params.id);
  if (!rental || rental.status !== 'active') return res.status(400).send('Invalid return');

  const items = db.prepare('SELECT * FROM rental_items WHERE rental_id=?').all(rental.id);
  const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id=?');
  const endDate = new Date().toISOString().split('T')[0];

  const transaction = db.transaction(() => {
    for (const item of items) {
      updateStock.run(item.quantity, item.product_id);
    }
    db.prepare('UPDATE rentals SET end_date=?, status=? WHERE id=?').run(endDate, 'returned', rental.id);
  });
  transaction();

  res.redirect('/rentals');
});

app.get('/invoice/rental/:id', (req, res) => {
  const rental = db.prepare('SELECT * FROM rentals WHERE id=?').get(req.params.id);
  if (!rental) return res.status(404).send('Rental not found');
  const items = db.prepare(`
    SELECT ri.*, p.name, p.description 
    FROM rental_items ri JOIN products p ON ri.product_id = p.id 
    WHERE ri.rental_id = ?
  `).all(rental.id);
  res.render('invoice', { invoice: rental, items, type: 'rental' });
});

// =============== PAYMENT & RECEIPT ===============
app.post('/invoice/sale/:id/pay', (req, res) => {
  db.prepare('UPDATE sales SET paid=1 WHERE id=?').run(req.params.id);
  res.redirect('/receipt/sale/' + req.params.id);
});

app.post('/invoice/rental/:id/pay', (req, res) => {
  db.prepare('UPDATE rentals SET paid=1 WHERE id=?').run(req.params.id);
  res.redirect('/receipt/rental/' + req.params.id);
});

app.get('/receipt/:type/:id', (req, res) => {
  const { type, id } = req.params;
  let invoice, items;
  if (type === 'sale') {
    invoice = db.prepare('SELECT * FROM sales WHERE id=? AND paid=1').get(id);
    if (!invoice) return res.send('No paid sale found or not paid yet.');
    items = db.prepare(`
      SELECT si.*, p.name, p.description 
      FROM sale_items si JOIN products p ON si.product_id = p.id 
      WHERE si.sale_id = ?
    `).all(invoice.id);
  } else if (type === 'rental') {
    invoice = db.prepare('SELECT * FROM rentals WHERE id=? AND paid=1').get(id);
    if (!invoice) return res.send('No paid rental found or not paid yet.');
    items = db.prepare(`
      SELECT ri.*, p.name, p.description 
      FROM rental_items ri JOIN products p ON ri.product_id = p.id 
      WHERE ri.rental_id = ?
    `).all(invoice.id);
  } else {
    return res.status(400).send('Invalid type');
  }
  res.render('receipt', { invoice, items, type });
});

// =============== ALL INVOICES (combined) ===============
app.get('/invoices', (req, res) => {
  const sales = db.prepare('SELECT id, invoice_number, sale_date as date, total, paid, "sale" as type FROM sales').all();
  const rentals = db.prepare('SELECT id, invoice_number, start_date as date, total, paid, "rental" as type FROM rentals').all();
  const invoices = [...sales, ...rentals].sort((a, b) => (a.date < b.date ? 1 : -1));
  res.render('invoices', { invoices });
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});