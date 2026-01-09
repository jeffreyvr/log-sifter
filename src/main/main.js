const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const Store = require('electron-store');

// Enable live reload in development
try {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, '../../node_modules', '.bin', 'electron'),
        hardResetMethod: 'exit',
        forceHardReset: false,
        awaitWriteFinish: true
    });
    // Also watch the renderer folder
    require('electron-reload')(path.join(__dirname, '../renderer'), {
        electron: path.join(__dirname, '../../node_modules', '.bin', 'electron'),
        hardResetMethod: 'exit',
        forceHardReset: false,
        awaitWriteFinish: true
    });
} catch (e) {
    // electron-reload not available in production
}

const store = new Store();
let mainWindow;
let fileWatcher = null;
let currentFilePath = null;
let lastFileSize = 0;

// Get background color based on system theme
function getBackgroundColor() {
    return nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7';
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, '../assets/icons/png/512x512.png'),
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        backgroundColor: getBackgroundColor(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Update background color when system theme changes
    nativeTheme.on('updated', () => {
        mainWindow.setBackgroundColor(getBackgroundColor());
    });

    // Build menu
    const template = [
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Log File...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => openFileDialog()
                },
                { type: 'separator' },
                {
                    label: 'Clear Recent Files',
                    click: () => clearRecentFiles()
                },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'copy' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Find...',
                    accelerator: 'CmdOrCtrl+F',
                    click: () => mainWindow.webContents.send('focus-search')
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// Open file dialog
async function openFileDialog() {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Log Files', extensions: ['log', 'txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        loadFile(result.filePaths[0]);
    }
}

// Load a file and start watching
function loadFile(filePath) {
    // Stop watching previous file
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
    }

    currentFilePath = filePath;

    // Add to recent files
    addToRecentFiles(filePath);

    // Read initial content
    readFileContent(filePath, true);

    // Start watching for changes
    fileWatcher = chokidar.watch(filePath, {
        persistent: true,
        usePolling: true,
        interval: 500
    });

    fileWatcher.on('change', () => {
        readFileContent(filePath, false);
    });
}

// Read file content with chunking support
function readFileContent(filePath, isInitial) {
    try {
        const stats = fs.statSync(filePath);
        const currentSize = stats.size;

        if (isInitial) {
            // Initial load - read entire file
            const content = fs.readFileSync(filePath, 'utf-8');
            lastFileSize = currentSize;
            mainWindow.webContents.send('file-loaded', {
                path: filePath,
                name: path.basename(filePath),
                content: content,
                isInitial: true
            });
        } else if (currentSize > lastFileSize) {
            // File grew - read only new content
            const stream = fs.createReadStream(filePath, {
                start: lastFileSize,
                encoding: 'utf-8'
            });

            let newContent = '';
            stream.on('data', (chunk) => {
                newContent += chunk;
            });

            stream.on('end', () => {
                lastFileSize = currentSize;
                mainWindow.webContents.send('file-updated', {
                    path: filePath,
                    newContent: newContent
                });
            });
        } else if (currentSize < lastFileSize) {
            // File was truncated - reload entirely
            const content = fs.readFileSync(filePath, 'utf-8');
            lastFileSize = currentSize;
            mainWindow.webContents.send('file-loaded', {
                path: filePath,
                name: path.basename(filePath),
                content: content,
                isInitial: true
            });
        }
    } catch (error) {
        mainWindow.webContents.send('file-error', {
            message: error.message
        });
    }
}

// Recent files management
function addToRecentFiles(filePath) {
    let recentFiles = store.get('recentFiles', []);

    // Remove if already exists
    recentFiles = recentFiles.filter(f => f.path !== filePath);

    // Add to beginning
    recentFiles.unshift({
        path: filePath,
        name: path.basename(filePath),
        timestamp: Date.now()
    });

    // Keep only last 10
    recentFiles = recentFiles.slice(0, 10);

    store.set('recentFiles', recentFiles);

    // Notify renderer
    mainWindow.webContents.send('recent-files-updated', recentFiles);
}

function getRecentFiles() {
    return store.get('recentFiles', []);
}

function clearRecentFiles() {
    store.set('recentFiles', []);
    mainWindow.webContents.send('recent-files-updated', []);
}

function removeRecentFile(filePath) {
    let recentFiles = store.get('recentFiles', []);
    recentFiles = recentFiles.filter(f => f.path !== filePath);
    store.set('recentFiles', recentFiles);
    mainWindow.webContents.send('recent-files-updated', recentFiles);
}

// IPC Handlers
ipcMain.handle('open-file-dialog', openFileDialog);
ipcMain.handle('get-recent-files', getRecentFiles);
ipcMain.handle('load-file', (event, filePath) => loadFile(filePath));
ipcMain.handle('remove-recent-file', (event, filePath) => removeRecentFile(filePath));
ipcMain.handle('clear-recent-files', clearRecentFiles);

// App lifecycle
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (fileWatcher) {
        fileWatcher.close();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
