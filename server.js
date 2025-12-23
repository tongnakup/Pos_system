const express = require("express");
// const mysql = require("mysql2"); // ❌ ไม่ใช้แล้ว
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const multer = require("multer");
const xlsx = require("xlsx");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const promptpay = require("promptpay-qr");
const qrcode = require("qrcode");

const db = require("./db");

const upload = multer({ dest: "uploads/" });

const app = express();
const PORT = 3000;

// --- Config & Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "view")));
app.use(express.static(__dirname));

// --- Init Database Schema (สร้างตารางเมื่อเริ่มรัน) ---
db.initSchema()
  .then(() => {
    console.log("✅ Database initialized successfully.");
  })
  .catch((err) => {
    console.error("❌ Database initialization failed:", err);
  });

const initShiftTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        start_time DATETIME,
        end_time DATETIME,
        start_cash REAL,
        expected_cash REAL,
        actual_cash REAL,
        diff_cash REAL,
        status TEXT DEFAULT 'open'
      )
    `);
    console.log("✅ Shifts table ready.");
  } catch (e) {
    console.error("Shift DB Error:", e);
  }
};
initShiftTable();
// --- Helper Functions ---

// ฟังก์ชันอัปเดตสต็อกพร้อมบันทึก (แปลงเป็น Async/Await)
async function updateStockLog(productId, changeAmount, type, details) {
  try {
    // 1. ดึงข้อมูลสินค้าเดิม
    const [products] = await db.query(
      "SELECT name, stock_qty FROM products WHERE id = ?",
      [productId]
    );
    if (products.length === 0) return;

    const product = products[0];
    const oldStock = product.stock_qty;
    const newStock = oldStock + changeAmount;

    // 2. อัปเดตสต็อก
    await db.query("UPDATE products SET stock_qty = ? WHERE id = ?", [
      newStock,
      productId,
    ]);

    // 3. บันทึก Stock Card
    const sqlLog =
      "INSERT INTO stock_card (product_id, product_name, action_type, qty_change, balance_after, details) VALUES (?, ?, ?, ?, ?, ?)";
    await db.query(sqlLog, [
      productId,
      product.name,
      type,
      changeAmount,
      newStock,
      details,
    ]);

    return newStock;
  } catch (err) {
    console.error("Update Stock Error:", err);
    throw err;
  }
}

// --- Routes ---

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "view", "index.html"))
);
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "view", "admin.html"))
);

// --- Categories ---
app.get("/categories", async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM categories");
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/categories", async (req, res) => {
  try {
    await db.query("INSERT INTO categories (name) VALUES (?)", [req.body.name]);
    res.json({ message: "เพิ่มสำเร็จ" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/categories/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM categories WHERE id=?", [req.params.id]);
    res.json({ message: "ลบสำเร็จ" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Products ---
app.get("/products", async (req, res) => {
  try {
    const sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.id DESC`;
    const [results] = await db.query(sql);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/products", async (req, res) => {
  const { barcode, name, price, cost, stock, category_id } = req.body;
  const initialStock = parseInt(stock) || 0;

  try {
    const sql =
      "INSERT INTO products (barcode, name, selling_price, cost_price, stock_qty, category_id) VALUES (?, ?, ?, ?, ?, ?)";
    const [result] = await db.query(sql, [
      barcode,
      name,
      price,
      cost || 0,
      initialStock,
      category_id || null,
    ]);

    const newId = result.insertId;

    if (initialStock !== 0) {
      await updateStockLog(
        newId,
        initialStock,
        "สินค้าใหม่",
        "เพิ่มสินค้าเข้าสู่ระบบครั้งแรก"
      );
    }
    res.json({ id: newId, message: "เพิ่มสำเร็จ" });
  } catch (err) {
    // SQLite error code for constraint violation might differ, but generic catch works
    console.error(err);
    res.status(500).json({ message: "Error (อาจจะบาร์โค้ดซ้ำ)" });
  }
});

app.put("/products/:id", async (req, res) => {
  const { name, price, cost, stock, category_id } = req.body;
  const productId = req.params.id;
  const newStockQty = parseInt(stock);

  try {
    const [rows] = await db.query(
      "SELECT stock_qty FROM products WHERE id = ?",
      [productId]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Product not found" });

    const oldStock = rows[0].stock_qty;
    const diff = newStockQty - oldStock;

    const sql =
      "UPDATE products SET name=?, selling_price=?, cost_price=?, stock_qty=?, category_id=? WHERE id=?";
    await db.query(sql, [
      name,
      price,
      cost,
      newStockQty,
      category_id,
      productId,
    ]);

    if (diff !== 0) {
      // Manual log insert because updateStockLog logic is slightly different
      await db.query(
        "INSERT INTO stock_card (product_id, product_name, action_type, qty_change, balance_after, details) VALUES (?, ?, ?, ?, ?, ?)",
        [
          productId,
          name,
          "ปรับสต็อก(Admin)",
          diff,
          newStockQty,
          "แก้ไขข้อมูลสินค้า",
        ]
      );
    }
    res.json({ message: "แก้ไขสำเร็จ" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/products/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM products WHERE id=?", [req.params.id]);
    res.json({ message: "ลบสำเร็จ" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Import Excel
app.post("/products/import", upload.single("file"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ message: "กรุณาเลือกไฟล์ Excel" });

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let successCount = 0;
    let failCount = 0;

    for (const row of data) {
      const barcode = row["Barcode"] || row["barcode"];
      const name = row["Name"] || row["name"] || row["ชื่อสินค้า"];
      const cost = row["Cost"] || row["cost"] || row["ราคาทุน"] || 0;
      const price = row["Price"] || row["price"] || row["ราคาขาย"] || 0;
      const stock = row["Stock"] || row["stock"] || row["คงเหลือ"] || 0;

      if (!barcode || !name) {
        failCount++;
        continue;
      }
      // SQLite ใช้ INSERT OR IGNORE
      const sql = `INSERT OR IGNORE INTO products (barcode, name, cost_price, selling_price, stock_qty) VALUES (?, ?, ?, ?, ?)`;
      try {
        const [result] = await db.query(sql, [
          barcode,
          name,
          cost,
          price,
          stock,
        ]);
        if (result.affectedRows > 0) successCount++;
        else failCount++; // ซ้ำ
      } catch (err) {
        failCount++;
      }
    }

    fs.unlinkSync(req.file.path);
    res.json({ message: `นำเข้าสำเร็จ ${successCount} รายการ` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอ่านไฟล์" });
  }
});

// --- Checkout ---
app.post("/checkout", async (req, res) => {
  const {
    cart,
    total,
    received,
    memberId,
    paymentMethod,
    pointsUsed,
    discount,
  } = req.body;
  if (!cart || cart.length === 0)
    return res.status(400).json({ message: "ตะกร้าว่าง" });

  try {
    const [setRes] = await db.query(
      "SELECT points_ratio FROM settings WHERE id=1"
    );
    const ratio = setRes && setRes.length > 0 ? setRes[0].points_ratio : 10;

    const finalTotal = total - (discount || 0);
    const pointsEarned = memberId ? Math.floor(finalTotal / ratio) : 0;
    const receiptNo = "INV-" + Date.now();
    const change = received - finalTotal;

    const sqlOrder =
      "INSERT INTO orders (receipt_no, total_amount, received_amount, change_amount, payment_method, member_id, earned_points, points_used, discount_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const [orderRes] = await db.query(sqlOrder, [
      receiptNo,
      finalTotal,
      received,
      change,
      paymentMethod || "cash",
      memberId,
      pointsEarned,
      pointsUsed || 0,
      discount || 0,
    ]);

    const orderId = orderRes.insertId;

    if (memberId) {
      await db.query(
        "UPDATE members SET points = points + ? - ? WHERE id = ?",
        [pointsEarned, pointsUsed || 0, memberId]
      );
    }

    for (const item of cart) {
      const sqlItem =
        "INSERT INTO order_items (order_id, product_id, product_name, price_at_sale, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?)";
      await db.query(sqlItem, [
        orderId,
        item.id,
        item.name,
        item.price,
        item.qty,
        item.price * item.qty,
      ]);

      await updateStockLog(
        item.id,
        -item.qty,
        "ขายหน้าร้าน",
        `บิลเลขที่ ${receiptNo}`
      );
    }

    // 5. ส่ง LINE (ถ้ามี)
    const payType = paymentMethod === "transfer" ? "โอนเงิน" : "เงินสด";
    let msg = `\n บิลใหม่: ${receiptNo}\n💵 ยอดขายสุทธิ: ${finalTotal.toLocaleString()} บาท`;
    if (discount > 0) msg += `\n(ส่วนลดใช้แต้ม: -${discount} บาท)`;
    msg += `\nช่องทาง: ${payType}`;
    sendLineNotify(msg);

    res.json({
      message: "ขายสำเร็จ",
      receipt_no: receiptNo,
      change,
      pointsEarned,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาด: " + err.message });
  }
});

// --- Purchase ---
app.post("/purchase", async (req, res) => {
  const { supplier_id, items, total_cost } = req.body;
  if (!items || items.length === 0)
    return res.status(400).json({ message: "ไม่มีสินค้า" });

  try {
    const poNumber = "PO-" + Date.now();
    const sqlPO =
      "INSERT INTO purchase_orders (po_number, supplier_id, total_amount, user_id) VALUES (?, ?, ?, 1)";
    const [poRes] = await db.query(sqlPO, [poNumber, supplier_id, total_cost]);
    const purchaseId = poRes.insertId;

    for (const item of items) {
      // Insert item
      await db.query(
        "INSERT INTO purchase_items (purchase_id, product_id, qty, cost_price, total) VALUES (?, ?, ?, ?, ?)",
        [purchaseId, item.id, item.qty, item.cost, item.cost * item.qty]
      );

      // Update Cost Price
      await db.query("UPDATE products SET cost_price = ? WHERE id = ?", [
        item.cost,
        item.id,
      ]);

      // Add Stock
      await updateStockLog(
        item.id,
        item.qty,
        "รับสินค้าเข้า",
        `PO: ${poNumber}`
      );
    }

    res.json({ message: "บันทึกสำเร็จ", po_number: poNumber });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// --- Members ---
app.get("/members/search", async (req, res) => {
  try {
    const keyword = `%${req.query.phone}%`;
    const [results] = await db.query(
      "SELECT * FROM members WHERE phone LIKE ? OR name LIKE ?",
      [keyword, keyword]
    );
    if (results.length === 0) return res.status(404).json({ message: "ไม่พบ" });
    res.json(results[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/members", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM members ORDER BY created_at DESC"
    );
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/members", async (req, res) => {
  try {
    const [r] = await db.query(
      "INSERT INTO members (name, phone) VALUES (?,?)",
      [req.body.name, req.body.phone]
    );
    res.json({
      id: r.insertId,
      name: req.body.name,
      phone: req.body.phone,
      points: 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/members/:id", async (req, res) => {
  try {
    await db.query("UPDATE members SET name=?, phone=?, points=? WHERE id=?", [
      req.body.name,
      req.body.phone,
      req.body.points,
      req.params.id,
    ]);
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/members/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM members WHERE id=?", [req.params.id]);
    res.json({ msg: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Settings ---
app.get("/settings", async (req, res) => {
  try {
    const [r] = await db.query("SELECT * FROM settings WHERE id=1");
    if (r.length === 0) {
      await db.query("INSERT INTO settings (id) VALUES (1)");
      return res.json({});
    }
    res.json(r[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/settings", async (req, res) => {
  const {
    shop_name,
    shop_address,
    phone,
    tax_id,
    vat_rate,
    receipt_footer,
    line_token,
    points_ratio,
    redeem_ratio,
    promptpay_id,
    printer_type,
  } = req.body;
  try {
    await db.query(
      `UPDATE settings SET shop_name=?, shop_address=?, phone=?, tax_id=?, vat_rate=?, receipt_footer=?, line_token=?, points_ratio=?, redeem_ratio=?, promptpay_id=?, printer_type=? WHERE id=1`,
      [
        shop_name,
        shop_address,
        phone,
        tax_id,
        vat_rate,
        receipt_footer,
        line_token,
        points_ratio,
        redeem_ratio,
        promptpay_id,
        printer_type,
      ]
    );
    res.json({ msg: "Saved" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Suppliers ---
app.get("/suppliers", async (req, res) => {
  try {
    const [r] = await db.query("SELECT * FROM suppliers");
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/suppliers", async (req, res) => {
  const { name, contact, phone, address } = req.body;
  try {
    await db.query(
      "INSERT INTO suppliers (name, contact_name, phone, address) VALUES (?,?,?,?)",
      [name, contact, phone, address]
    );
    res.json({ msg: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/suppliers/:id", async (req, res) => {
  const { name, contact, phone, address } = req.body;
  try {
    await db.query(
      "UPDATE suppliers SET name=?, contact_name=?, phone=?, address=? WHERE id=?",
      [name, contact, phone, address, req.params.id]
    );
    res.json({ msg: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/suppliers/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM suppliers WHERE id=?", [req.params.id]);
    res.json({ msg: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Users & Login ---
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [r] = await db.query("SELECT * FROM users WHERE username=?", [
      username,
    ]);
    if (r.length === 0)
      return res.status(401).json({ message: "ไม่พบชื่อผู้ใช้" });

    const user = r[0];
    const match = await bcrypt.compare(password, user.password);

    if (match) {
      res.json({
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        role: user.role,
      });
    } else {
      res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }
  } catch (e) {
    res.status(500).json({ message: "Login Error" });
  }
});

app.get("/users", async (req, res) => {
  try {
    const [r] = await db.query("SELECT * FROM users");
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/users", async (req, res) => {
  const { username, password, fullname, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await db.query(
      "INSERT INTO users (username, password, fullname, role) VALUES (?,?,?,?)",
      [username, hashedPassword, fullname, role]
    );
    res.json({ msg: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/users/:id", async (req, res) => {
  const { username, password, fullname, role } = req.body;
  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query(
        "UPDATE users SET username=?, password=?, fullname=?, role=? WHERE id=?",
        [username, hashedPassword, fullname, role, req.params.id]
      );
    } else {
      await db.query(
        "UPDATE users SET username=?, fullname=?, role=? WHERE id=?",
        [username, fullname, role, req.params.id]
      );
    }
    res.json({ msg: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM users WHERE id=?", [req.params.id]);
    res.json({ msg: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Admin Dashboard
app.get("/admin/summary", async (req, res) => {
  try {
    const sql = `SELECT COUNT(id) as total_bills, COALESCE(SUM(total_amount),0) as total_sales FROM orders WHERE date(sale_date) = date('now', 'localtime')`;
    const [r] = await db.query(sql);
    res.json(r[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/admin/orders", async (req, res) => {
  try {
    const [r] = await db.query(
      "SELECT * FROM orders ORDER BY sale_date DESC LIMIT 20"
    );
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ดึงรายการสินค้าของบิลนั้น
app.get("/orders/:id/items", async (req, res) => {
  try {
    const [items] = await db.query(
      "SELECT * FROM order_items WHERE order_id = ?",
      [req.params.id]
    );
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

//ยกเลิกบิล
app.delete("/orders/:id", async (req, res) => {
  const orderId = req.params.id;

  try {
    //ดึงข้อมูลบิลมาก่อน
    const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [
      orderId,
    ]);
    if (orders.length === 0)
      return res.status(404).json({ message: "ไม่พบบิลนี้" });
    const order = orders[0];

    //ดึงรายการสินค้าในบิล
    const [items] = await db.query(
      "SELECT * FROM order_items WHERE order_id = ?",
      [orderId]
    );

    //วนลูปคืนสต็อกสินค้า
    for (const item of items) {
      await updateStockLog(
        item.product_id,
        item.qty,
        "ยกเลิกบิล",
        `Void บิลเลขที่ ${order.receipt_no}`
      );
    }

    //จัดการแต้มสมาชิก
    if (order.member_id) {
      if (order.earned_points > 0) {
        await db.query("UPDATE members SET points = points - ? WHERE id = ?", [
          order.earned_points,
          order.member_id,
        ]);
      }
      //คืนแต้มที่ใช้ไปกลับมา
      if (order.points_used > 0) {
        await db.query("UPDATE members SET points = points + ? WHERE id = ?", [
          order.points_used,
          order.member_id,
        ]);
      }
    }

    await db.query("DELETE FROM order_items WHERE order_id = ?", [orderId]);
    await db.query("DELETE FROM orders WHERE id = ?", [orderId]);

    res.json({ message: "ยกเลิกบิลเรียบร้อย คืนสต็อกและแต้มแล้ว" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/admin/export-report", async (req, res) => {
  const { start, end } = req.query;
  try {
    //ดึงข้อมูลจาก Database ตามวันที่เลือก
    const sql =
      "SELECT * FROM orders WHERE date(sale_date) BETWEEN ? AND ? ORDER BY sale_date DESC";
    const [orders] = await db.query(sql, [start, end]);

    if (orders.length === 0) {
      return res.status(404).send("ไม่พบข้อมูลในช่วงเวลานี้");
    }

    // จัดรูปแบบข้อมูล
    const data = orders.map((o) => ({
      วันที่: new Date(o.sale_date).toLocaleString("th-TH"),
      เลขที่บิล: o.receipt_no,
      "ยอดขาย (บาท)": parseFloat(o.total_amount),
      รับเงิน: parseFloat(o.received_amount),
      เงินทอน: parseFloat(o.change_amount),
      วิธีชำระ: o.payment_method === "cash" ? "เงินสด" : "โอนจ่าย",
      ส่วนลด: parseFloat(o.discount_amount || 0),
      แต้มที่ได้: o.earned_points,
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);

    //จัดความกว้างคอลัมน์
    ws["!cols"] = [
      { wch: 20 },
      { wch: 20 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ];

    xlsx.utils.book_append_sheet(wb, ws, "Sales Report");

    //ส่งไฟล์กลับไปให้คนกดโหลด
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Sales_${start}_to_${end}.xlsx"`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).send("Export Failed");
  }
});

// ค้นหารายงานยอดขาย
app.get("/admin/report", async (req, res) => {
  const { start, end } = req.query;
  try {
    const sql =
      "SELECT * FROM orders WHERE date(sale_date) BETWEEN ? AND ? ORDER BY sale_date DESC";
    const [orders] = await db.query(sql, [start, end]);

    res.json(orders);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/admin/chart-data", async (req, res) => {
  try {
    const sql7Days = `
        SELECT strftime('%d/%m', sale_date) as date, SUM(total_amount) as total 
        FROM orders 
        WHERE date(sale_date) >= date('now', 'localtime', '-6 days') 
        GROUP BY date
        ORDER BY sale_date ASC
    `;
    const [salesData] = await db.query(sql7Days);

    const sqlTop5 = `
        SELECT product_name, SUM(qty) as total_qty 
        FROM order_items 
        GROUP BY product_id, product_name 
        ORDER BY total_qty DESC 
        LIMIT 5
    `;
    const [topProducts] = await db.query(sqlTop5);

    res.json({ sales: salesData, topProducts: topProducts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/stock/card/:id", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM stock_card WHERE product_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.params.id]
    );
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Helper: LINE & QR ---
async function sendLineNotify(message) {
  try {
    const [r] = await db.query("SELECT line_token FROM settings WHERE id=1");
    if (!r || r.length === 0 || !r[0].line_token) return;

    await axios.post(
      "https://notify-api.line.me/api/notify",
      `message=${encodeURIComponent(message)}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${r[0].line_token}`,
        },
      }
    );
  } catch (e) {
    console.error("Line Error:", e.message);
  }
}

app.post("/generate-qr", async (req, res) => {
  const amount = parseFloat(req.body.amount);
  try {
    const [result] = await db.query(
      "SELECT promptpay_id FROM settings WHERE id=1"
    );
    if (!result || result.length === 0 || !result[0].promptpay_id) {
      return res.status(400).json({ message: "ยังไม่ได้ตั้งค่าพร้อมเพย์" });
    }
    const payload = promptpay(result[0].promptpay_id, { amount });
    const url = await qrcode.toDataURL(payload);
    res.json({ qrImage: url });
  } catch (e) {
    res.status(500).json({ message: "สร้าง QR ไม่สำเร็จ" });
  }
});

app.get("/shift/current", async (req, res) => {
  try {
    const [shifts] = await db.query(
      "SELECT * FROM shifts WHERE status = 'open' LIMIT 1"
    );
    if (shifts.length > 0) {
      res.json({ status: "open", shift: shifts[0] });
    } else {
      res.json({ status: "closed" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

//(Open Shift)
app.post("/shift/open", async (req, res) => {
  const { user_id, user_name, start_cash } = req.body;
  try {
    const [existing] = await db.query(
      "SELECT * FROM shifts WHERE status = 'open'"
    );
    if (existing.length > 0)
      return res.status(400).json({ message: "มีกะที่ยังไม่ปิดค้างอยู่" });

    const sql =
      "INSERT INTO shifts (user_id, user_name, start_time, start_cash, status) VALUES (?, ?, datetime('now', 'localtime'), ?, 'open')";
    await db.query(sql, [user_id, user_name, start_cash]);

    res.json({ message: "เปิดกะเรียบร้อย" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

//Preview Close Shift)
app.get("/shift/summary", async (req, res) => {
  try {
    //ดึงกะปัจจุบัน
    const [shifts] = await db.query(
      "SELECT * FROM shifts WHERE status = 'open' LIMIT 1"
    );
    if (shifts.length === 0)
      return res.status(404).json({ message: "ไม่มีกะที่เปิดอยู่" });

    const currentShift = shifts[0];

    const sqlSales = `
            SELECT COALESCE(SUM(total_amount), 0) as cash_sales 
            FROM orders 
            WHERE payment_method = 'cash' 
            AND sale_date >= ?
        `;
    const [salesRes] = await db.query(sqlSales, [currentShift.start_time]);
    const cashSales = salesRes[0].cash_sales;

    //เงินที่ควรมีในลิ้นชัก
    const expected = currentShift.start_cash + cashSales;

    res.json({
      shift: currentShift,
      cash_sales: cashSales,
      expected_cash: expected,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/shift/close", async (req, res) => {
  const { actual_cash } = req.body;
  try {
    //ดึงข้อมูลสรุป
    const [shifts] = await db.query(
      "SELECT * FROM shifts WHERE status = 'open' LIMIT 1"
    );
    if (shifts.length === 0)
      return res.status(400).json({ message: "ไม่มีกะเปิดอยู่" });
    const currentShift = shifts[0];

    //คำนวณยอดอีกครั้งเพื่อความชัวร์
    const [salesRes] = await db.query(
      "SELECT COALESCE(SUM(total_amount), 0) as cash_sales FROM orders WHERE payment_method = 'cash' AND sale_date >= ?",
      [currentShift.start_time]
    );
    const cashSales = salesRes[0].cash_sales;
    const expected = currentShift.start_cash + cashSales;
    const diff = actual_cash - expected;

    //อัปเดตตาราง
    const sqlClose = `
            UPDATE shifts 
            SET end_time = datetime('now', 'localtime'), 
                expected_cash = ?, 
                actual_cash = ?, 
                diff_cash = ?, 
                status = 'closed' 
            WHERE id = ?
        `;
    await db.query(sqlClose, [expected, actual_cash, diff, currentShift.id]);

    res.json({
      message: "ปิดกะเรียบร้อย",
      summary: {
        start_time: currentShift.start_time,
        end_time: new Date(),
        start_cash: currentShift.start_cash,
        cash_sales: cashSales,
        expected: expected,
        actual: actual_cash,
        diff: diff,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

//(Backup)
app.get("/admin/backup", (req, res) => {
  const dbPath = path.join(__dirname, "my_pos_data.db");

  if (fs.existsSync(dbPath)) {
    const fileName = `backup_pos_${Date.now()}.sqlite`;
    res.download(dbPath, fileName);
  } else {
    res.status(404).send("ไม่พบไฟล์ฐานข้อมูล");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
