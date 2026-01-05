const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// 🔑 รหัสลับสำหรับปลดล็อคถาวร
const MASTER_KEY = "Mypos2025";

// ⏳ เวลาทดลองใช้งาน (หน่วยมิลลิวินาที)
const TRIAL_LIMIT = 1 * 60 * 60 * 1000; // เทส 1 ชม.
// const TRIAL_LIMIT = 30 * 1000; // (เทส 30 วินาที)

const PORT = 3000;
let mainWindow;
let customerWindow;
let serverProcess;

function getAppStatus() {
  const userDataPath = app.getPath("userData");
  const configPath = path.join(userDataPath, "pos_config.json");

  try {
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath));
    } else {
      config = { firstRun: Date.now(), isActivated: false };
      fs.writeFileSync(configPath, JSON.stringify(config));
    }

    if (config.isActivated) return "active";

    const timeUsed = Date.now() - config.firstRun;
    if (timeUsed > TRIAL_LIMIT) {
      return "expired";
    }

    return "trial";
  } catch (error) {
    console.error("Config Error:", error);
    return "trial";
  }
}

function activateApp() {
  const userDataPath = app.getPath("userData");
  const configPath = path.join(userDataPath, "pos_config.json");

  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath));
    config.isActivated = true;
    fs.writeFileSync(configPath, JSON.stringify(config));
  }
}

function startServer() {
  const serverPath = path.join(__dirname, "server.js");

  serverProcess = spawn("node", [serverPath], {
    cwd: __dirname,
    silent: true,
  });

  if (serverProcess.stdout) {
    serverProcess.stdout.on("data", (data) => console.log(`Server: ${data}`));
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.on("data", (data) =>
      console.error(`Server Error: ${data}`)
    );
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "POS System (Cashier)",
    icon: path.join(__dirname, "icon.png"),

    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
    },
  });

  mainWindow.setMenu(null);

  setTimeout(() => {
    mainWindow.loadURL(`http://localhost:${PORT}`);
  }, 2000);

  createCustomerWindow();

  mainWindow.on("closed", function () {
    mainWindow = null;
    if (customerWindow) customerWindow.close();
  });

  autoUpdater.checkForUpdatesAndNotify();
}

function createCustomerWindow() {
  const displays = require("electron").screen.getAllDisplays();

  let externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  let xPos = 50;
  let yPos = 50;
  if (externalDisplay) {
    xPos = externalDisplay.bounds.x + 50;
    yPos = externalDisplay.bounds.y + 50;
  }

  customerWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Customer Display",

    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,
    x: xPos,
    y: yPos,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  customerWindow.setMenu(null);

  setTimeout(() => {
    customerWindow.loadURL(`http://localhost:${PORT}/view/customer.html`);
  }, 2500);

  customerWindow.on("closed", () => {
    customerWindow = null;
  });
}

function createActivationWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 500,
    title: "หมดเวลาทดลองใช้",
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile("activate.html");
  win.setMenu(null);
}

app.whenReady().then(() => {
  startServer();

  const status = getAppStatus();

  if (status === "active" || status === "trial") {
    createWindow();
  } else {
    createActivationWindow();
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
  if (serverProcess) {
    serverProcess.kill();
  }
});

ipcMain.on("activate-license", (event, inputKey) => {
  if (inputKey === MASTER_KEY) {
    activateApp();

    dialog
      .showMessageBox({
        type: "info",
        title: "สำเร็จ",
        message: "🎉 ปลดล็อคเรียบร้อย! ขอบคุณที่อุดหนุนครับ",
      })
      .then(() => {
        app.relaunch();
        app.exit();
      });
  } else {
    event.sender.send("activation-failed");
  }
});

ipcMain.on("do-silent-print", (event, arg) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (win) {
    win.webContents.print(
      {
        silent: true,
        printBackground: true,
        deviceName: "",
      },
      (success, errorType) => {
        if (!success) console.log("Print failed:", errorType);
      }
    );
  }
});

ipcMain.on("app-quit", () => {
  app.quit();
});
