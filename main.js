const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { fork } = require("child_process");

let mainWindow;
let customerWindow; // ✅ เพิ่มตัวแปรสำหรับจอลูกค้า
let serverProcess;

// 1. สั่งรัน Server
function startServer() {
  const serverPath = path.join(__dirname, "server.js");
  serverProcess = fork(serverPath, [], {
    silent: true,
    env: { ...process.env, PORT: 3000 },
  });
  console.log("🚀 Server started...");
}

// 2. สร้างหน้าต่างหลัก (คนขาย)
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "POS System (Cashier)",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
    },
  });

  // รอ 1.5 วิ ให้ Server พร้อม แล้วค่อยโหลดหน้าเว็บ
  setTimeout(() => {
    mainWindow.loadURL("http://localhost:3000/view/login.html");
  }, 1500);

  mainWindow.on("closed", function () {
    mainWindow = null;
    // ถ้าปิดหน้าหลัก ให้ปิดจอลูกค้าด้วย
    if (customerWindow) customerWindow.close();
  });

  // เช็คอัปเดต
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

function createCustomerWindow() {
  customerWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Customer Display",
    autoHideMenuBar: true,
    autoHideMenuBar: true,
    x: 50,
    y: 50,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  customerWindow.loadURL("http://localhost:3000/customer.html");

  customerWindow.on("closed", () => {
    customerWindow = null;
  });
}

// --- เริ่มทำงาน ---
app.on("ready", () => {
  startServer();

  createWindow(); // เปิดหน้าหลัก

  // ✅ สั่งเปิดหน้าลูกค้าตามมา (ดีเลย์นิดนึง 2 วิ)
  setTimeout(createCustomerWindow, 2000);
});

// ปิดโปรแกรม
app.on("window-all-closed", function () {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

// --- Auto Update ---
autoUpdater.on("update-available", () => {
  dialog.showMessageBox({
    type: "info",
    title: "พบเวอร์ชันใหม่",
    message: "กำลังดาวน์โหลดอัปเดต...",
    buttons: ["ตกลง"],
  });
});
autoUpdater.on("update-downloaded", () => {
  dialog
    .showMessageBox({
      type: "question",
      title: "พร้อมติดตั้ง",
      message: "โหลดเสร็จแล้ว ติดตั้งเลยไหม?",
      buttons: ["ใช่", "ไว้ทีหลัง"],
    })
    .then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
});
