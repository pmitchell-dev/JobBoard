# 🧩 JobBoard Chrome Extension (Manifest V3)

The **JobBoard Chrome Extension** brings full job tracking capabilities right into your browser popup window. Effortlessly view, search, filter, add, and manage job applications while browsing job boards like LinkedIn, Indeed, Glassdoor, or company career sites.

---

## ⚡ Key Features

- **Compact Screen Adaptation**: Tailored specifically for a sleek, dark-glass popup window (~400px x 580px).
- **Auto-Detect Active Tab**: Click **⚡ Add Current Tab as Job** to automatically pre-fill company name, position title, and listing URL from your active browser tab.
- **Instant Status Management**: Change job stage (`Applied`, `Screening`, `Interview`, `Offer`, `Rejected`) directly from the card dropdowns with real-time updates.
- **Search & Status Filtering**: Search across company, title, or notes, and navigate by status pills with live count badges.
- **Job Notes Drawer**: View and add timestamped notes per job directly from the popup drawer.
- **Right-Click Context Menu**: Right-click on any webpage or selected job title to click **"Add Page to JobBoard"**.
- **Custom Local API Server**: Easily configure your JobBoard API server URL (`http://localhost:3000` or local network IP).

---

## 🛠️ How to Install in Chrome / Chromium Browsers

1. Open **Google Chrome** (or Brave / Edge).
2. Navigate to `chrome://extensions/` in the address bar.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left menu.
5. Select the `extension` folder located inside your JobBoard repository:
   ```
   c:\Users\pmitchell\.gemini\antigravity\scratch\JobBoard\extension
   ```
6. The **JobBoard Tracker** extension icon will appear in your browser toolbar!

---

## ⚙️ Configuration & Connection

1. Click the **JobBoard** extension icon in your Chrome toolbar.
2. If the status badge shows `🔴 Offline`, click the settings icon (`⚙️`) in the top-right of the popup.
3. Enter your local JobBoard server URL (default: `http://localhost:3000`).
4. Click **Test Connection** to verify connectivity, then click **Save Settings**.
