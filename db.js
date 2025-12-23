const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
const path = require("path");
const bcrypt = require("bcryptjs");

// ชื่อDatabase
const dbPath = path.join(__dirname, "my_pos_data.db");

let dbInstance = null;

async function getDB() {
  if (dbInstance) return dbInstance;
  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  return dbInstance;
}

module.exports = {
  query: async (sql, params = []) => {
    const db = await getDB();

    // แปลงคำสั่ง SQL บางตัวให้เข้ากับ SQLite
    let safeSql = sql
      .replace(/NOW\(\)/gi, "datetime('now', 'localtime')")
      .replace(/CURDATE\(\)/gi, "date('now', 'localtime')")
      .replace(/INSERT IGNORE/gi, "INSERT OR IGNORE");

    // เช็คว่าเป็นคำสั่ง SELECT หรือไม่
    if (safeSql.trim().toUpperCase().startsWith("SELECT")) {
      const rows = await db.all(safeSql, params);
      return [rows, null];
    } else {
      const result = await db.run(safeSql, params);
      return [
        {
          insertId: result.lastID,
          affectedRows: result.changes,
        },
        null,
      ];
    }
  },

  initSchema: async () => {
    const db = await getDB();
    console.log("📂 ตรวจสอบฐานข้อมูล SQLite...");

    //สินค้า
    await db.exec(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT, name TEXT, cost_price REAL DEFAULT 0, selling_price REAL DEFAULT 0,
            stock_qty INTEGER DEFAULT 0, category_id INTEGER, image_url TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);

    // หมวดหมู่
    await db.exec(
      `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`
    );

    //พนักงาน
    await db.exec(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT, fullname TEXT, role TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);
    // สร้าง Admin
    const admin = await db.get("SELECT * FROM users WHERE username = 'admin'");
    if (!admin) {
      const passwordHash = await bcrypt.hash("1234", 10);
      await db.run(
        "INSERT INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)",
        ["admin", passwordHash, "Admin Manager", "admin"]
      );

      console.log("✅ สร้าง User เริ่มต้น: admin / 1234");
    }

    //บิลขาย
    await db.exec(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_no TEXT, total_amount REAL, received_amount REAL,
            change_amount REAL, payment_method TEXT, sale_date DATETIME DEFAULT (datetime('now', 'localtime')),
            member_id INTEGER, user_id INTEGER, earned_points INTEGER DEFAULT 0, points_used INTEGER DEFAULT 0, discount_amount REAL DEFAULT 0
        )`);

    //รายการในบิล
    await db.exec(`CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER, product_name TEXT,
            price_at_sale REAL, qty INTEGER, subtotal REAL
        )`);

    //สมาชิก
    await db.exec(`CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, points INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);

    //(Suppliers)
    await db.exec(`CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, contact_name TEXT, phone TEXT, address TEXT
        )`);

    //Stock Card
    await db.exec(`CREATE TABLE IF NOT EXISTS stock_card (
            id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT, action_type TEXT,
            qty_change INTEGER, balance_after INTEGER, details TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);

    //ตั้งค่า
    await db.exec(`CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, shop_name TEXT, phone TEXT, shop_address TEXT, tax_id TEXT,
            vat_rate REAL DEFAULT 7, receipt_footer TEXT, line_token TEXT, points_ratio INTEGER DEFAULT 10,
            printer_type TEXT DEFAULT 'a4', promptpay_id TEXT, redeem_ratio INTEGER DEFAULT 10
        )`);
    const setCheck = await db.get("SELECT * FROM settings WHERE id = 1");
    if (!setCheck)
      await db.run(
        `INSERT INTO settings (id, shop_name, printer_type) VALUES (1, 'My Shop', 'a4')`
      );

    // Purchase Orders
    await db.exec(`CREATE TABLE IF NOT EXISTS purchase_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, po_number TEXT, supplier_id INTEGER, total_amount REAL,
            user_id INTEGER, created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )`);

    // Purchase Items
    await db.exec(`CREATE TABLE IF NOT EXISTS purchase_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, product_id INTEGER,
            qty INTEGER, cost_price REAL, total REAL
        )`);

    console.log("✅ SQLite Database Ready: ตารางครบแล้ว!");
  },
};
