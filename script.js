const { ipcRenderer } = require("electron");
let allProducts = [];
let cart = [];
let currentTotalToPay = 0;
let currentMember = null;
let currentPaymentMethod = "cash";
let redeemRatio = 10;
let currentDiscount = 0;
let pointsToUse = 0;
let printerType = "a4";
let currentCategory = "all";
let heldBills = [];

// --- โหลดข้อมูลเริ่มต้น ---
document.addEventListener("DOMContentLoaded", () => {
  fetchProducts();
  fetchCategoriesForPOS();
  loadRedeemSettings();
  loadPrinterSettings();
  fetchDailySales();
  checkShiftStatus();

  const input = document.getElementById("barcode-input");
  if (input) {
    input.focus();

    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        if (input.value.trim() !== "") {
          addToCartByBarcode(input.value);
          input.value = "";
        }
      }
    });

    document.addEventListener("click", (e) => {
      const isInput =
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT";
      const isButton =
        e.target.tagName === "BUTTON" || e.target.closest("button");
      const isSwal = e.target.closest(".swal2-container");

      if (!isInput && !isButton && !isSwal) {
        input.focus();
      }
    });
  }

  const memberInput = document.getElementById("member-phone");
  if (memberInput) {
    memberInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") searchMember();
    });
  }
  const savedBills = localStorage.getItem("pos_held_bills");
  if (savedBills) {
    heldBills = JSON.parse(savedBills);
    updateHeldCount();
  }
});

function holdBill() {
  if (cart.length === 0) {
    return Swal.fire("ไม่สามารถพักบิลได้", "ตะกร้าสินค้าว่างเปล่า", "warning");
  }

  const billData = {
    id: Date.now(),
    timestamp: new Date().getTime(),
    timeStr: new Date().toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cart: [...cart],
    member: currentMember,
    total: currentTotalToPay,
  };

  heldBills.push(billData);
  saveHeldBills();

  cart = [];
  clearMember();
  updateCartUI();

  Swal.fire({
    icon: "success",
    title: "พักบิลเรียบร้อย",
    text: "คุณสามารถทำรายการต่อไปได้เลย",
    timer: 1500,
    showConfirmButton: false,
  });
}

function saveHeldBills() {
  localStorage.setItem("pos_held_bills", JSON.stringify(heldBills));
  updateHeldCount();
}

function updateHeldCount() {
  const el = document.getElementById("held-count");
  if (el) el.innerText = heldBills.length;
}

function openHeldBillsModal() {
  const modal = document.getElementById("held-bills-modal");
  const tbody = document.getElementById("held-bills-list");
  const noData = document.getElementById("no-held-bills");

  tbody.innerHTML = "";

  if (heldBills.length === 0) {
    noData.style.display = "block";
  } else {
    noData.style.display = "none";
    heldBills.forEach((bill, index) => {
      const row = document.createElement("tr");
      row.style.borderBottom = "1px solid #eee";

      let summary = bill.cart[0].name;
      if (bill.cart.length > 1)
        summary += ` และอีก ${bill.cart.length - 1} อย่าง`;
      if (bill.member)
        summary += ` <br><small style="color:blue">👤 ${bill.member.name}</small>`;

      row.innerHTML = `
                <td style="padding:10px;">${bill.timeStr}</td>
                <td style="padding:10px;">${summary}</td>
                <td style="padding:10px; font-weight:bold;">${bill.total.toLocaleString()}</td>
                <td style="padding:10px; text-align:right;">
                    <button onclick="restoreBill(${index})" style="background:#2ecc71; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">▶️ เรียกคืน</button>
                    <button onclick="deleteHeldBill(${index})" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">🗑️</button>
                </td>
            `;
      tbody.appendChild(row);
    });
  }

  modal.style.display = "flex";
}

function closeHeldBillsModal() {
  document.getElementById("held-bills-modal").style.display = "none";
}

function restoreBill(index) {
  if (cart.length > 0) {
    Swal.fire({
      title: "มีสินค้าค้างอยู่หน้าจอ",
      text: "ต้องการเคลียร์สินค้าปัจจุบันทิ้ง แล้วดึงบิลเก่ามาแทนหรือไม่?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "ใช่, ดึงบิลเก่ามา",
      cancelButtonText: "ยกเลิก",
    }).then((res) => {
      if (res.isConfirmed) {
        doRestore(index);
      }
    });
  } else {
    doRestore(index);
  }
}

function doRestore(index) {
  const bill = heldBills[index];

  cart = [...bill.cart];
  if (bill.member) {
    setMember(bill.member);
  } else {
    clearMember();
  }

  heldBills.splice(index, 1);
  saveHeldBills();

  updateCartUI();
  closeHeldBillsModal();

  const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 1500,
  });
  Toast.fire({ icon: "success", title: "ดึงบิลกลับมาแล้ว" });
}

function deleteHeldBill(index) {
  Swal.fire({
    title: "ลบบิลนี้ทิ้ง?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "ลบเลย",
    confirmButtonColor: "#d33",
  }).then((res) => {
    if (res.isConfirmed) {
      heldBills.splice(index, 1);
      saveHeldBills();
      openHeldBillsModal();
    }
  });
}

// --- โหลดข้อมูลต่างๆ ---
async function fetchCategoriesForPOS() {
  try {
    const res = await fetch("/categories");
    const cats = await res.json();

    const tabsContainer = document.getElementById("category-tabs");

    let html = `<button class="cat-tab active" onclick="selectCategory('all', this)">ทั้งหมด</button>`;

    cats.forEach((c) => {
      html += `<button class="cat-tab" onclick="selectCategory(${c.id}, this)">${c.name}</button>`;
    });

    if (tabsContainer) {
      tabsContainer.innerHTML = html;
    }

    const select = document.getElementById("new-category");
    if (select) {
      select.innerHTML = '<option value="">-- เลือกหมวดหมู่ --</option>';
      cats.forEach((c) => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });
    }
  } catch (e) {
    console.error("โหลดหมวดหมู่ไม่สำเร็จ", e);
  }
}

function selectCategory(catId, btnElement) {
  currentCategory = catId;

  document
    .querySelectorAll(".cat-tab")
    .forEach((b) => b.classList.remove("active"));
  btnElement.classList.add("active");

  filterProducts();
}

function filterProducts() {
  const txt = document.getElementById("catalog-search").value.toLowerCase();

  const filtered = allProducts.filter((p) => {
    const matchName =
      p.name.toLowerCase().includes(txt) || String(p.barcode).includes(txt);

    const matchCat =
      currentCategory === "all" || p.category_id == currentCategory;

    return matchName && matchCat;
  });

  renderProducts(filtered);
}

function renderProducts(products) {
  const list = document.getElementById("product-list");
  if (!list) return;
  list.innerHTML = "";

  if (products.length === 0) {
    list.innerHTML = `<div style="text-align:center; width:100%; color:#999; margin-top:50px;">
        <div style="font-size:3em;">🔍</div><br>ไม่พบสินค้า
      </div>`;
    return;
  }

  products.forEach((p) => {
    const card = document.createElement("div");
    card.className = "product-card animate__animated animate__zoomIn";

    const priceDisplay = parseFloat(p.selling_price).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
    });

    card.innerHTML = `
            <h3>${p.name}</h3>
            <div style="font-size:0.8em; color:#aaa; margin:5px 0;">${p.barcode}</div>
            <div class="price-tag">${priceDisplay} ฿</div>
        `;
    card.onclick = () => addToCart(p);
    list.appendChild(card);
  });
}

async function loadRedeemSettings() {
  try {
    const res = await fetch("/settings");
    const data = await res.json();
    redeemRatio = data.redeem_ratio || 10;
    if (document.getElementById("redeem-rate"))
      document.getElementById("redeem-rate").innerText = redeemRatio;
  } catch (e) {
    console.error(e);
  }
}

async function loadPrinterSettings() {
  try {
    const res = await fetch("/settings");
    const data = await res.json();
    if (data.printer_type) {
      printerType = data.printer_type;
      console.log("Printer Config Loaded:", printerType);
    }
  } catch (e) {
    console.error("โหลดตั้งค่าเครื่องปริ้นไม่ได้ ใชัค่าเริ่มต้น A4");
  }
}

// --- Product Logic ---
async function fetchProducts() {
  try {
    const response = await fetch("/products");
    allProducts = await response.json();
    renderProducts(allProducts);
  } catch (error) {
    console.error("Error loading products:", error);
  }
}

function addToCartByBarcode(barcode) {
  const product = allProducts.find(
    (p) => String(p.barcode) === String(barcode)
  );
  if (product) {
    addToCart(product);
  } else {
    playSound("error");
    openQuickAddModal(barcode);
  }
}

function addToCart(product) {
  playSound("beep");
  const existingItem = cart.find((item) => item.id === product.id);
  if (existingItem) {
    existingItem.qty += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: parseFloat(product.selling_price || product.price),
      qty: 1,
    });
  }
  updateCartUI();
}

function updateCartUI() {
  const cartList = document.getElementById("cart-items");
  const totalEl = document.getElementById("total-price");
  if (!cartList) return;

  cartList.innerHTML = "";
  let total = 0;

  cart.forEach((item, index) => {
    const itemTotal = item.price * item.qty;
    total += itemTotal;

    const row = document.createElement("div");
    row.className = "cart-item animate__animated animate__fadeIn";

    row.innerHTML = `
        <div class="cart-info">
            <div class="cart-name">${item.name}</div>
            <div class="cart-details">
                ${item.qty} x ${item.price.toLocaleString("th-TH", {
      minimumFractionDigits: 2,
    })} 
                = <span class="cart-total-line">${itemTotal.toLocaleString(
                  "th-TH",
                  { minimumFractionDigits: 2 }
                )}</span>
            </div>
        </div>
        
        <div class="cart-actions">
            <button onclick="decreaseItem(${index})" class="btn-circle btn-decrease" title="ลดจำนวน">➖</button>
            <button onclick="removeItem(${index})" class="btn-circle btn-remove" title="ลบรายการ">🗑️</button>
        </div>
    `;
    cartList.appendChild(row);
  });

  currentTotalToPay = total;
  totalEl.innerText = total.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
  });

  syncToCustomerDisplay(false);
}

function decreaseItem(index) {
  if (cart[index].qty > 1) {
    cart[index].qty -= 1;
  } else {
    removeItem(index);
    return;
  }
  updateCartUI();
}

// ยืนยันลบสินค้า
function removeItem(index) {
  Swal.fire({
    title: "ลบรายการนี้?",
    text: "คุณต้องการเอาสินค้าชิ้นนี้ออกจากตะกร้าใช่ไหม?",
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    cancelButtonColor: "#3085d6",
    confirmButtonText: "ใช่, ลบเลย",
    cancelButtonText: "ยกเลิก",
  }).then((result) => {
    if (result.isConfirmed) {
      cart.splice(index, 1);
      updateCartUI();
      const Toast = Swal.mixin({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 1000,
        timerProgressBar: true,
      });
      Toast.fire({
        icon: "success",
        title: "ลบสินค้าเรียบร้อย",
      });
    }
  });
}

//ยกเลิกบิล
function cancelBill() {
  if (cart.length === 0) return;

  Swal.fire({
    title: "ยกเลิกบิลทั้งหมด?",
    text: "สินค้าทั้งหมดในตะกร้าจะหายไป!",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    cancelButtonColor: "#3085d6",
    confirmButtonText: "ยืนยันยกเลิก",
    cancelButtonText: "ไม่",
  }).then((result) => {
    if (result.isConfirmed) {
      cart = [];
      updateCartUI();
      clearMember();
      Swal.fire({
        icon: "success",
        title: "ยกเลิกบิลเรียบร้อย",
        timer: 1000,
        showConfirmButton: false,
      });
    }
  });
}

// --- Quick Add Modal ---
function openQuickAddModal(barcode) {
  document.getElementById("quick-add-modal").style.display = "flex";
  document.getElementById("new-barcode-display").innerText = barcode;
  document.getElementById("new-name").value = "";
  document.getElementById("new-cost").value = "";
  document.getElementById("new-price").value = "";
  document.getElementById("new-category").value = "";
  setTimeout(() => document.getElementById("new-name").focus(), 100);
}

function closeModal() {
  document.getElementById("quick-add-modal").style.display = "none";
  document.getElementById("barcode-input").focus();
}

async function saveNewProduct() {
  const barcode = document.getElementById("new-barcode-display").innerText;
  const name = document.getElementById("new-name").value;
  const price = document.getElementById("new-price").value;
  const categoryId = document.getElementById("new-category").value;

  if (!name || !price) {
    return Swal.fire({
      icon: "warning",
      title: "ข้อมูลไม่ครบ",
      text: "กรุณากรอกชื่อสินค้าและราคาขายให้เรียบร้อยครับ",
    });
  }

  try {
    const res = await fetch("/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode,
        name,
        price,
        category_id: categoryId,
      }),
    });

    if (res.ok) {
      const result = await res.json();
      const newProductObj = {
        id: result.id,
        barcode: barcode,
        name: name,
        selling_price: price,
        category_id: categoryId,
      };

      allProducts.push(newProductObj);
      addToCart(newProductObj);
      closeModal();

      Swal.fire({
        icon: "success",
        title: "เพิ่มสินค้าเรียบร้อย",
        text: `เพิ่ม "${name}" ลงตะกร้าแล้วครับ`,
        timer: 1500,
        showConfirmButton: false,
      });
    } else {
      Swal.fire({
        icon: "error",
        title: "บันทึกไม่สำเร็จ",
        text: "อาจเกิดจากบาร์โค้ดซ้ำ หรือระบบมีปัญหา",
      });
    }
  } catch (e) {
    console.error(e);
    Swal.fire({
      icon: "error",
      title: "เกิดข้อผิดพลาด",
      text: "ไม่สามารถเชื่อมต่อกับ Server ได้",
    });
  }
}

// --- Payment Logic ---
function checkout() {
  if (cart.length === 0) {
    return Swal.fire({
      icon: "warning",
      title: "ตะกร้าว่างเปล่า",
      text: "กรุณาเลือกสินค้าก่อนคิดเงินครับ",
      timer: 1500,
      showConfirmButton: false,
    });
  }

  currentDiscount = 0;
  pointsToUse = 0;
  if (document.getElementById("manual-discount-row"))
    document.getElementById("manual-discount-row").style.display = "none";
  if (document.getElementById("use-points-input"))
    document.getElementById("use-points-input").value = "";
  if (document.getElementById("discount-display"))
    document.getElementById("discount-display").innerText = "0.00";

  selectPayment("cash");

  currentTotalToPay = cart.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  const modal = document.getElementById("payment-modal");
  modal.style.display = "flex";

  if (currentMember) {
    document.getElementById("member-discount-section").style.display = "block";
    document.getElementById("pay-mem-points").innerText = currentMember.points;
  } else {
    document.getElementById("member-discount-section").style.display = "none";
  }

  updateFinalTotal();

  document.getElementById("pay-received").value = "";
  document.getElementById("change-display").innerText = "";
  setTimeout(() => document.getElementById("pay-received").focus(), 100);
}

function calcDiscount() {
  if (!currentMember) return;

  const input = document.getElementById("use-points-input");
  let points = parseInt(input.value) || 0;

  if (points > currentMember.points) {
    points = currentMember.points;
    input.value = points;
  }

  let discount = points / redeemRatio;

  if (discount > currentTotalToPay) {
    discount = currentTotalToPay;
    points = discount * redeemRatio;
    input.value = points;
  }

  pointsToUse = points;
  currentDiscount = discount;

  document.getElementById("discount-display").innerText = discount.toFixed(2);
  updateFinalTotal();
}

function useMaxPoints() {
  if (!currentMember) return;
  document.getElementById("use-points-input").value = currentMember.points;
  calcDiscount();
}

function updateFinalTotal() {
  const finalPrice = currentTotalToPay - (currentDiscount || 0);
  document.getElementById("pay-total-final").innerText = finalPrice.toFixed(2);

  if (currentPaymentMethod === "transfer") {
    document.getElementById("pay-received").value = finalPrice.toFixed(2);
  }
  calculateChangePreview();
}

function appendNum(num) {
  const input = document.getElementById("pay-received");
  input.value += num;
  calculateChangePreview();
}
function addMoney(amount) {
  const input = document.getElementById("pay-received");
  input.value = (parseFloat(input.value) || 0) + amount;
  calculateChangePreview();
}
function setExact() {
  document.getElementById("pay-received").value =
    currentTotalToPay - currentDiscount;
  calculateChangePreview();
}
function clearPay() {
  document.getElementById("pay-received").value = "";
  document.getElementById("change-display").innerText = "";
}
function backspace() {
  const input = document.getElementById("pay-received");
  input.value = input.value.slice(0, -1);
  calculateChangePreview();
}
function calculateChangePreview() {
  const received =
    parseFloat(document.getElementById("pay-received").value) || 0;
  const finalPrice = currentTotalToPay - currentDiscount;
  const change = received - finalPrice;

  syncToCustomerDisplay(false, received, change > 0 ? change : 0);

  const display = document.getElementById("change-display");
  if (change >= 0) {
    display.style.color = "#00ff00";
    display.innerText = `เงินทอน: ${change.toFixed(2)}`;
  } else {
    display.style.color = "#ff5555";
    display.innerText = `ขาดอีก: ${(change * -1).toFixed(2)}`;
  }
}
function closePaymentModal() {
  document.getElementById("payment-modal").style.display = "none";
}

async function selectPayment(method) {
  currentPaymentMethod = method;
  const qrSection = document.getElementById("qr-section");

  if (method === "cash") {
    document.getElementById("btn-cash").style.background = "#2ecc71";
    document.getElementById("btn-cash").style.color = "white";
    document.getElementById("btn-transfer").style.background = "transparent";

    document.getElementById("pay-received").disabled = false;
    document.getElementById("pay-received").focus();
    document.getElementById("change-display").style.visibility = "visible";

    if (qrSection) qrSection.style.display = "none";
  } else {
    document.getElementById("btn-transfer").style.background = "#3498db";
    document.getElementById("btn-cash").style.background = "transparent";

    const finalPrice = currentTotalToPay - (currentDiscount || 0);

    document.getElementById("pay-received").value = finalPrice.toFixed(2);
    document.getElementById("pay-received").disabled = true;
    document.getElementById("change-display").innerText = "เงินทอน: 0.00";

    if (qrSection) {
      qrSection.style.display = "block";
      const img = document.getElementById("qr-image");
      img.style.display = "none";

      let statusText = document.getElementById("transfer-status-text");
      if (!statusText) {
        statusText = document.createElement("div");
        statusText.id = "transfer-status-text";
        statusText.style.cssText =
          "font-size: 1.5em; color: #3498db; margin: 20px 0; animation: blink 1.5s infinite;";
        qrSection.appendChild(statusText);
      }
      statusText.innerHTML =
        "⏳ รอสักครู่...<br><span style='font-size:0.7em; color:#888;'>กำลังรอให้ลูกค้าสแกนจ่ายที่หน้าจอลูกค้า</span>";

      if (finalPrice > 0) {
        try {
          const res = await fetch("/generate-qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: finalPrice }),
          });
          const data = await res.json();
          if (data.qrImage) {
            syncToCustomerDisplay(false, 0, 0, data.qrImage);
          }
        } catch (e) {
          console.error("QR Error:", e);
        }
      }
    }
  }
}

async function confirmPayment() {
  const received =
    parseFloat(document.getElementById("pay-received").value) || 0;
  const finalTotal = currentTotalToPay - currentDiscount;

  if (received < finalTotal) {
    return Swal.fire({
      icon: "error",
      title: "เงินไม่พอ!",
      text: `ขาดอีก ${(finalTotal - received).toFixed(2)} บาท`,
    });
  }

  try {
    const response = await fetch("/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cart: cart,
        total: currentTotalToPay,
        received: received,
        memberId: currentMember ? currentMember.id : null,
        paymentMethod: currentPaymentMethod,
        pointsUsed: pointsToUse,
        discount: currentDiscount,
      }),
    });

    if (response.ok) {
      const result = await response.json();

      if (currentPaymentMethod === "transfer") {
        speakThai(`ได้รับยอดเงินโอน ${received} บาท เรียบร้อยแล้วครับ`);
      } else {
        playSound("success");
      }

      closePaymentModal();

      printReceipt(
        result.receipt_no,
        result.change,
        finalTotal,
        received,
        result.pointsEarned
      );

      fetchDailySales();
      fetchProducts();

      const change = received - finalTotal;
      syncToCustomerDisplay(true, received, change);

      setTimeout(() => {
        cart = [];
        updateCartUI();
        clearMember();
        syncToCustomerDisplay(false);
      }, 5000);
    } else {
      Swal.fire({
        icon: "error",
        title: "เกิดข้อผิดพลาด",
        text: "บันทึกการขายไม่สำเร็จ",
      });
    }
  } catch (error) {
    console.error(error);
    Swal.fire({
      icon: "error",
      title: "เชื่อมต่อ Server ไม่ได้",
      text: "กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต",
    });
  }
}

function speakThai(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "th-TH";
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

// --- Member Logic ---
async function searchMember() {
  const phone = document.getElementById("member-phone").value;
  if (!phone)
    return Swal.fire("แจ้งเตือน", "กรุณากรอกเบอร์โทรหรือชื่อ", "warning");

  try {
    const res = await fetch(`/members/search?phone=${phone}`);
    if (res.ok) {
      const member = await res.json();
      setMember(member);
      playSound("beep");
    } else {
      Swal.fire({
        title: "ไม่พบสมาชิก",
        text: "ต้องการสมัครสมาชิกใหม่หรือไม่?",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "สมัครใหม่",
      }).then((result) => {
        if (result.isConfirmed) {
          openRegisterModal(phone);
        }
      });
    }
  } catch (e) {
    console.error(e);
  }
}

function setMember(member) {
  currentMember = member;
  document.getElementById("member-search-box").style.display = "none";
  document.getElementById("member-info-box").style.display = "flex";
  document.getElementById("mem-name").innerText = member.name;
  document.getElementById("mem-points").innerText = member.points;
}
function clearMember() {
  currentMember = null;
  document.getElementById("member-search-box").style.display = "flex";
  document.getElementById("member-info-box").style.display = "none";
  document.getElementById("member-phone").value = "";
}
function openRegisterModal(phone) {
  document.getElementById("register-modal").style.display = "flex";
  document.getElementById("reg-phone").value = phone;
  setTimeout(() => document.getElementById("reg-name").focus(), 100);
}
async function submitRegister() {
  const name = document.getElementById("reg-name").value;
  const phone = document.getElementById("reg-phone").value;
  if (!name) return Swal.fire("แจ้งเตือน", "กรุณากรอกชื่อลูกค้า", "warning");

  try {
    const res = await fetch("/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    if (res.ok) {
      const newMember = await res.json();
      Swal.fire("สำเร็จ", "สมัครสมาชิกเรียบร้อย", "success");
      document.getElementById("register-modal").style.display = "none";
      setMember(newMember);
    } else {
      const err = await res.json();
      Swal.fire("ผิดพลาด", err.message, "error");
    }
  } catch (e) {
    console.error(e);
  }
}

function printReceipt(
  receiptNo,
  change,
  total,
  received,
  points = 0,
  itemsForReprint = null
) {
  document.getElementById("rec-no").innerText = receiptNo;
  document.getElementById("rec-date").innerText = new Date().toLocaleString(
    "th-TH"
  );

  const userEl = document.getElementById("current-user-name");
  if (userEl)
    document.getElementById("rec-cashier").innerText = userEl.innerText;

  const list = document.getElementById("rec-items");
  list.innerHTML = "";

  const itemsToPrint = itemsForReprint || cart;

  itemsToPrint.forEach((item) => {
    const row = document.createElement("tr");
    const name = item.name || item.product_name;
    const qty = item.qty;
    const price = item.price || item.price_at_sale;

    row.innerHTML = `
        <td style="text-align: left;">${name}</td>
        <td style="text-align: center;">${qty}</td>
        <td style="text-align: right;">${(price * qty).toFixed(2)}</td>
    `;
    list.appendChild(row);
  });

  document.getElementById("rec-total").innerText = parseFloat(
    total
  ).toLocaleString("th-TH", { minimumFractionDigits: 2 });
  document.getElementById("rec-received").innerText = parseFloat(
    received
  ).toLocaleString("th-TH", { minimumFractionDigits: 2 });
  document.getElementById("rec-change").innerText = parseFloat(
    change
  ).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  const pointEl = document.getElementById("rec-points");
  if (pointEl) pointEl.innerText = points;

  const printArea = document.getElementById("receipt-print-area");
  printArea.classList.remove("paper-a4", "paper-58mm", "paper-80mm");
  printArea.classList.add("paper-" + printerType);

  setTimeout(() => {
    ipcRenderer.send("do-silent-print");
  }, 500);
}

// --- Sound Logic ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  const now = audioCtx.currentTime;

  if (type === "beep") {
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, now);
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === "error") {
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, now);
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === "success") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1500, now + 0.2);
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.linearRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

// --- คีย์ลัด ---
document.addEventListener("keydown", (e) => {
  if (Swal.isVisible()) return;

  const payModal = document.getElementById("payment-modal");
  const isPayModalOpen = payModal && payModal.style.display === "flex";

  if (isPayModalOpen) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmPayment();
    }
    if (e.key === "Escape") {
      closePaymentModal();
    }
    return;
  }

  const quickModal = document.getElementById("quick-add-modal");
  if (quickModal && quickModal.style.display === "flex") {
    if (e.key === "Escape") closeModal();
    return;
  }

  const activeTag = document.activeElement.tagName;
  const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";

  if ((e.code === "Space" || e.key === "F4") && !isTyping) {
    e.preventDefault();
    checkout();
  }

  if (e.key === "F2") {
    e.preventDefault();
    const memInput = document.getElementById("member-phone");
    if (memInput) memInput.focus();
  }

  if (e.key === "F9") {
    e.preventDefault();
    document.getElementById("barcode-input").focus();
  }

  if (e.key === "Delete" && !isTyping) {
    cancelBill();
  }
});

// --- Customer Display Sync ---
function syncToCustomerDisplay(
  finished = false,
  receivedAmt = 0,
  changeAmt = 0,
  qrCodeUrl = null
) {
  const data = {
    cart: cart,
    total: currentTotalToPay,
    received: receivedAmt,
    change: changeAmt,
    finished: finished,
    qrCode: qrCodeUrl,
    member: currentMember,
    timestamp: new Date().getTime(),
  };
  localStorage.setItem("pos_cart_data", JSON.stringify(data));
}

window.addEventListener("storage", (e) => {
  if (e.key === "pos_client_action") {
    try {
      const action = JSON.parse(e.newValue);

      if (action && action.type === "MEMBER_LOGIN") {
        console.log("ลูกค้ากรอกเบอร์มา:", action.phone);

        const memberInput = document.getElementById("member-phone");
        if (memberInput) {
          memberInput.value = action.phone;

          searchMember();

          const Toast = Swal.mixin({
            toast: true,
            position: "top-end",
            showConfirmButton: false,
            timer: 2000,
          });
          Toast.fire({ icon: "info", title: "ลูกค้ากรอกเบอร์สมาชิกมาครับ" });
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
});

async function fetchDailySales() {
  try {
    const res = await fetch("/admin/summary");
    if (res.ok) {
      const data = await res.json();
      const total = parseFloat(data.total_sales || 0);

      const el = document.getElementById("daily-total-display");
      if (el) {
        el.innerText = total.toLocaleString("th-TH", {
          minimumFractionDigits: 2,
        });
      }
    }
  } catch (e) {
    console.error("ไม่สามารถดึงยอดขายรายวันได้:", e);
  }
}

async function openHistoryModal() {
  try {
    const res = await fetch("/admin/orders");
    if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");

    const orders = await res.json();
    const tbody = document.getElementById("history-list");
    tbody.innerHTML = "";

    orders.forEach((order) => {
      const row = document.createElement("tr");
      row.style.borderBottom = "1px solid #eee";
      row.innerHTML = `
             <td style="padding:10px;">${new Date(
               order.sale_date
             ).toLocaleTimeString("th-TH", {
               hour: "2-digit",
               minute: "2-digit",
             })}</td>
             <td style="padding:10px;">${order.receipt_no}</td>
             <td style="padding:10px; font-weight:bold;">${parseFloat(
               order.total_amount
             ).toLocaleString()}</td>
             <td style="padding:10px;">${order.payment_method}</td>
             <td style="padding:10px; text-align:right;">
                 <button onclick='reprintBill(${JSON.stringify(
                   order
                 )})' style="background:#6c757d; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">
                     🖨️ พิมพ์ซ้ำ
                 </button>
                 <button onclick="voidBill(${order.id}, '${
        order.receipt_no
      }')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">
                     ❌ ยกเลิก
                 </button>
             </td>
         `;
      tbody.appendChild(row);
    });

    document.getElementById("history-modal").style.display = "flex";
  } catch (e) {
    console.error(e);
    Swal.fire("Error", "โหลดประวัติไม่สำเร็จ", "error");
  }
}

async function reprintBill(order) {
  try {
    const res = await fetch(`/orders/${order.id}/items`);
    if (!res.ok) throw new Error("โหลดรายการสินค้าไม่ได้");

    const items = await res.json();

    printReceipt(
      order.receipt_no,
      order.change_amount,
      order.total_amount,
      order.received_amount,
      order.earned_points,
      items
    );
  } catch (e) {
    console.error(e);
    Swal.fire("Error", "ไม่สามารถพิมพ์ใบเสร็จซ้ำได้", "error");
  }
}

function voidBill(orderId, receiptNo) {
  const currentUser = JSON.parse(sessionStorage.getItem("pos_user") || "{}");
  const defaultUser = currentUser.username || "";

  Swal.fire({
    title: "ยืนยันยกเลิกบิล?",
    html: `ต้องการยกเลิกบิล <b>${receiptNo}</b> หรือไม่?<br><small style="color:red">สต็อกสินค้าและแต้มจะถูกคำนวณคืนทั้งหมด</small>`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    cancelButtonColor: "#3085d6",
    confirmButtonText: "ดำเนินการต่อ",
    cancelButtonText: "ยกเลิก",
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { value: formValues } = await Swal.fire({
        title: "🔐 ยืนยันสิทธิ์ผู้จัดการ (Manager)",
        html:
          `<div style="text-align:left; margin-bottom:5px;">User Admin:</div>` +
          `<input id="swal-input1" class="swal2-input" placeholder="Username" value="${defaultUser}" style="margin-top:0;">` +
          `<div style="text-align:left; margin-bottom:5px; margin-top:10px;">Password:</div>` +
          `<input id="swal-input2" class="swal2-input" type="password" placeholder="Password" style="margin-top:0;">`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: "อนุมัติการลบ",
        cancelButtonText: "ยกเลิก",
        preConfirm: () => {
          return [
            document.getElementById("swal-input1").value,
            document.getElementById("swal-input2").value,
          ];
        },
      });

      if (!formValues) return;

      const [username, password] = formValues;

      if (!username || !password) {
        return Swal.fire("Error", "กรุณากรอกข้อมูลให้ครบ", "error");
      }

      try {
        Swal.showLoading();

        const authRes = await fetch("/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        if (!authRes.ok) throw new Error("รหัสผ่านไม่ถูกต้อง");

        const user = await authRes.json();

        if (user.role !== "admin") {
          throw new Error(
            "⛔️ ไม่อนุมัติ! เฉพาะ ผู้จัดการ เท่านั้นที่ยกเลิกบิลได้"
          );
        }

        const res = await fetch(`/orders/${orderId}`, { method: "DELETE" });
        if (res.ok) {
          Swal.fire("เรียบร้อย!", `บิล ${receiptNo} ถูกยกเลิกแล้ว`, "success");
          openHistoryModal();
          fetchDailySales();
          fetchProducts();
        } else {
          throw new Error("ระบบขัดข้อง ลบไม่สำเร็จ");
        }
      } catch (e) {
        Swal.fire("เกิดข้อผิดพลาด", e.message, "error");
      }
    }
  });
}
async function openManualDiscount() {
  const { value: discount } = await Swal.fire({
    title: "ระบุส่วนลด (บาท)",
    input: "number",
    inputLabel: "ใส่จำนวนเงินที่ต้องการลด",
    inputPlaceholder: "0.00",
    inputValue: currentDiscount > 0 ? currentDiscount : "",
    showCancelButton: true,
    confirmButtonText: "ตกลง",
    cancelButtonText: "ยกเลิก",
    inputValidator: (value) => {
      if (!value) return "กรุณาใส่ตัวเลข";
      if (parseFloat(value) < 0) return "ส่วนลดติดลบไม่ได้";
      if (parseFloat(value) > currentTotalToPay)
        return "ส่วนลดมากกว่าราคาสินค้าไม่ได้";
    },
  });

  if (discount !== undefined) {
    currentDiscount = parseFloat(discount);

    const row = document.getElementById("manual-discount-row");
    const txt = document.getElementById("manual-discount-text");

    if (currentDiscount > 0) {
      row.style.display = "block";
      txt.innerText = currentDiscount.toLocaleString("th-TH", {
        minimumFractionDigits: 2,
      });
    } else {
      row.style.display = "none";
    }

    updateFinalTotal();

    if (pointsToUse > 0) {
      pointsToUse = 0;
      if (document.getElementById("use-points-input"))
        document.getElementById("use-points-input").value = "";
      Swal.fire(
        "ระบบรีเซ็ตแต้ม",
        "เนื่องจากมีการระบุส่วนลดท้ายบิล ระบบจะยกเลิกการใช้แต้มก่อนนะครับ",
        "info"
      );
    }
  }
}

function exportReport() {
  const start = document.getElementById("rep-start").value;
  const end = document.getElementById("rep-end").value;

  if (!start || !end) {
    return alert("กรุณาเลือกวันที่เริ่มต้น และ สิ้นสุด ก่อนครับ");
  }

  window.location.href = `/admin/export-report?start=${start}&end=${end}`;
}

// --- Shift Management Logic ---

async function checkShiftStatus() {
  try {
    const res = await fetch("/shift/current");
    const data = await res.json();

    if (data.status === "closed") {
      document.getElementById("open-shift-modal").style.display = "flex";
    } else {
      document.getElementById("open-shift-modal").style.display = "none";
    }
  } catch (e) {
    console.error("Shift Check Error:", e);
  }
}

async function submitOpenShift() {
  const startCash = document.getElementById("start-cash-input").value;
  if (!startCash)
    return Swal.fire("แจ้งเตือน", "กรุณาระบุเงินทอนเริ่มต้น", "warning");

  const currentUser = JSON.parse(sessionStorage.getItem("pos_user") || "{}");
  if (!currentUser.id) return alert("กรุณาล็อกอินก่อน");

  try {
    const res = await fetch("/shift/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: currentUser.id,
        user_name: currentUser.fullname || currentUser.username,
        start_cash: parseFloat(startCash),
      }),
    });

    if (res.ok) {
      Swal.fire("สำเร็จ", "เปิดกะเรียบร้อย เริ่มขายได้เลย!", "success");
      document.getElementById("open-shift-modal").style.display = "none";
    } else {
      const err = await res.json();
      Swal.fire("Error", err.message, "error");
    }
  } catch (e) {
    console.error(e);
  }
}

async function initCloseShift() {
  try {
    const res = await fetch("/shift/summary");
    if (!res.ok) return Swal.fire("Error", "ไม่สามารถดึงข้อมูลกะได้", "error");

    const data = await res.json();

    document.getElementById("close-start-cash").innerText =
      data.shift.start_cash.toLocaleString();
    document.getElementById("close-cash-sales").innerText =
      data.cash_sales.toLocaleString();
    document.getElementById("close-expected").innerText =
      data.expected_cash.toLocaleString();

    document.getElementById("actual-cash-input").value = "";
    document.getElementById("close-shift-modal").style.display = "flex";
  } catch (e) {
    console.error(e);
  }
}

async function confirmCloseShift() {
  const actualStr = document.getElementById("actual-cash-input").value;
  if (!actualStr)
    return Swal.fire("แจ้งเตือน", "กรุณาระบุเงินที่นับได้", "warning");

  const actual = parseFloat(actualStr);

  try {
    const res = await fetch("/shift/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual_cash: actual }),
    });

    if (res.ok) {
      const result = await res.json();
      document.getElementById("close-shift-modal").style.display = "none";

      let msg = `ยอดที่ควรมี: ${result.summary.expected.toLocaleString()}\nนับได้จริง: ${result.summary.actual.toLocaleString()}`;
      if (result.summary.diff === 0) msg += "\n\n✅ ยอดเงินตรงเป๊ะ!";
      else if (result.summary.diff > 0)
        msg += `\n\n⚠️ เงินเกิน: ${result.summary.diff.toLocaleString()} บาท`;
      else msg += `\n\n❌ เงินหาย: ${result.summary.diff.toLocaleString()} บาท`;

      await Swal.fire("ปิดกะเรียบร้อย", msg, "info");

      sessionStorage.removeItem("pos_user");
      window.location.href = "/login.html";
    }
  } catch (e) {
    console.error(e);
  }
}
