const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { fork } = require("child_process");

let mainWindow;
let customerWindow;
let serverProcess;

function startServer() {
  const serverPath = path.join(__dirname, "server.js");

  console.log("Checking server path:", serverPath);

  serverProcess = fork(serverPath, [], {
    silent: true,
    env: { ...process.env, PORT: 3000 },
  });

  console.log("🚀 Server process started with PID:", serverProcess.pid);

  serverProcess.stderr.on("data", (data) => {
    const errorMsg = data.toString();
    console.error(`Server Error: ${errorMsg}`);
    if (errorMsg.includes("Error") || errorMsg.includes("Cannot find module")) {
      dialog.showErrorBox("Server Error (จากไส้ใน)", errorMsg);
    }
  });

  serverProcess.on("exit", (code, signal) => {
    if (code !== 0) {
      dialog.showErrorBox(
        "Server Crashed",
        `Server ดับไปเอง! (Code: ${code})\nสาเหตุอาจเกิดจาก sqlite3 หรือ path ผิด`
      );
    }
  });

  serverProcess.on("error", (err) => {
    dialog.showErrorBox(
      "Spawn Error",
      "ไม่สามารถเริ่ม Server ได้: " + err.message
    );
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "POS System (Cashier)",
    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
    },
  });

  mainWindow.setMenu(null);

  setTimeout(() => {
    const url = "http://localhost:3000/view/login.html";
    mainWindow.loadURL(url);
  }, 2000);

  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      dialog.showErrorBox(
        "Load Error",
        `โหลดหน้าจอไม่ขึ้นครับ!\nError: ${errorDescription} (${errorCode})`
      );
    }
  );

  mainWindow.on("closed", function () {
    mainWindow = null;
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
    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,

    x: 50,
    y: 50,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  customerWindow.setMenu(null);

  setTimeout(() => {
    customerWindow.loadURL("http://localhost:3000/view/customer.html");
  }, 2500);

  customerWindow.on("closed", () => {
    customerWindow = null;
  });
}

// --- เริ่มทำงาน ---
app.on("ready", () => {
  startServer();
  createWindow();
  // เปิดหน้าลูกค้า
  setTimeout(createCustomerWindow, 3000);
});

// ปิดโปรแกรม
app.on("window-all-closed", function () {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});
