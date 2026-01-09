const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // File operations
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    loadFile: (filePath) => ipcRenderer.invoke('load-file', filePath),

    // Recent files
    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    removeRecentFile: (filePath) => ipcRenderer.invoke('remove-recent-file', filePath),
    clearRecentFiles: () => ipcRenderer.invoke('clear-recent-files'),

    // Event listeners
    onFileLoaded: (callback) => ipcRenderer.on('file-loaded', (event, data) => callback(data)),
    onFileUpdated: (callback) => ipcRenderer.on('file-updated', (event, data) => callback(data)),
    onFileError: (callback) => ipcRenderer.on('file-error', (event, data) => callback(data)),
    onRecentFilesUpdated: (callback) => ipcRenderer.on('recent-files-updated', (event, data) => callback(data)),
    onFocusSearch: (callback) => ipcRenderer.on('focus-search', () => callback())
});
