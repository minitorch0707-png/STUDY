// Runs in the app window before the page loads. The page needs no special
// powers, so we only tell it that it's running inside the desktop app.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("lecturelabDesktop", { isDesktop: true, platform: process.platform });
