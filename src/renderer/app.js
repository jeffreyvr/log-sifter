// State
let logEntries = [];
let filteredEntries = [];
let currentFilter = 'all';
let currentFilePath = null;
let currentFileName = null;

// Chunking config
const CHUNK_SIZE = 200;
const INITIAL_LOAD = 100;
let displayedCount = INITIAL_LOAD;

// DOM Elements
const openFileBtn = document.getElementById('openFileBtn');
const recentFilesList = document.getElementById('recentFilesList');
const noRecentFiles = document.getElementById('noRecentFiles');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const logContainer = document.getElementById('logContainer');
const logEntries_el = document.getElementById('logEntries');
const emptyState = document.getElementById('emptyState');
const loadMore = document.getElementById('loadMore');
const fileNameEl = document.getElementById('fileName');
const statsInfo = document.getElementById('statsInfo');
const liveIndicator = document.getElementById('liveIndicator');
const watchStatus = document.getElementById('watchStatus');
const filterBtns = document.querySelectorAll('.filter-btn');

// Initialize
async function init() {
    // Load recent files
    const recentFiles = await window.electronAPI.getRecentFiles();
    renderRecentFiles(recentFiles);

    // Set up event listeners
    setupEventListeners();
    setupElectronListeners();
}

function setupEventListeners() {
    openFileBtn.addEventListener('click', () => window.electronAPI.openFileDialog());

    searchInput.addEventListener('input', debounce(handleSearch, 150));
    clearSearch.addEventListener('click', handleClearSearch);

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => handleFilterChange(btn.dataset.filter));
    });

    logContainer.addEventListener('scroll', handleScroll);

    // Copy button handler (event delegation)
    logContainer.addEventListener('click', handleCopyClick);

    // Ask AI button handler (event delegation)
    logContainer.addEventListener('click', handleAskAIClick);

    loadMore.querySelector('button').addEventListener('click', loadMoreEntries);
}

// Copy to clipboard handler
async function handleCopyClick(e) {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return;

    const message = copyBtn.dataset.message;

    try {
        await navigator.clipboard.writeText(message);

        // Show success state
        const copyIcon = copyBtn.querySelector('.copy-icon');
        const checkIcon = copyBtn.querySelector('.check-icon');

        copyIcon.classList.add('hidden');
        checkIcon.classList.remove('hidden');
        copyBtn.classList.add('copied');

        // Reset after 2 seconds
        setTimeout(() => {
            copyIcon.classList.remove('hidden');
            checkIcon.classList.add('hidden');
            copyBtn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy:', err);
    }
}

// Ask AI handler - formats error for AI assistants
async function handleAskAIClick(e) {
    const askBtn = e.target.closest('.ask-ai-btn');
    if (!askBtn) return;

    const message = askBtn.dataset.message;
    const level = askBtn.dataset.level;
    const timestamp = askBtn.dataset.timestamp;

    // Detect framework from log content or filename
    const framework = detectFramework(message);

    // Format the prompt for AI
    const aiPrompt = formatAIPrompt({
        message,
        level,
        timestamp,
        framework,
        fileName: currentFileName
    });

    try {
        await navigator.clipboard.writeText(aiPrompt);

        // Show success state
        const icon = askBtn.querySelector('.ai-icon');
        const checkIcon = askBtn.querySelector('.check-icon');

        icon.classList.add('hidden');
        checkIcon.classList.remove('hidden');
        askBtn.classList.add('copied');

        // Reset after 2 seconds
        setTimeout(() => {
            icon.classList.remove('hidden');
            checkIcon.classList.add('hidden');
            askBtn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy:', err);
    }
}

// Detect framework from error message
function detectFramework(message) {
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes('laravel') || lowerMsg.includes('illuminate\\')) return 'Laravel';
    if (lowerMsg.includes('symfony\\')) return 'Symfony';
    if (lowerMsg.includes('wordpress') || lowerMsg.includes('wp-content') || lowerMsg.includes('wp-includes')) return 'WordPress';
    if (lowerMsg.includes('drupal')) return 'Drupal';
    if (lowerMsg.includes('magento')) return 'Magento';
    if (lowerMsg.includes('codeigniter')) return 'CodeIgniter';
    if (lowerMsg.includes('yii\\')) return 'Yii';
    if (lowerMsg.includes('zend\\')) return 'Zend';
    if (lowerMsg.includes('cakephp')) return 'CakePHP';
    if (lowerMsg.includes('next') || lowerMsg.includes('react')) return 'React/Next.js';
    if (lowerMsg.includes('vue')) return 'Vue.js';
    if (lowerMsg.includes('angular')) return 'Angular';
    if (lowerMsg.includes('express') || lowerMsg.includes('node')) return 'Node.js';
    if (lowerMsg.includes('django')) return 'Django';
    if (lowerMsg.includes('flask')) return 'Flask';
    if (lowerMsg.includes('rails')) return 'Ruby on Rails';

    // Check for PHP in general
    if (lowerMsg.includes('.php')) return 'PHP';

    return null;
}

// Format error for AI prompt
function formatAIPrompt({ message, level, timestamp, framework, fileName }) {
    let prompt = '';

    // Header
    prompt += `I'm getting this ${level} in my `;
    prompt += framework ? `${framework} application` : 'application';
    if (fileName) prompt += ` (from ${fileName})`;
    prompt += ':\n\n';

    // Error details
    prompt += '```\n';
    if (timestamp) prompt += `[${timestamp}] `;
    prompt += `${level.toUpperCase()}: ${message}\n`;
    prompt += '```\n\n';

    // Request
    prompt += 'Please:\n';
    prompt += '1. Explain what is causing this error\n';
    prompt += '2. Suggest how to fix it\n';
    prompt += '3. Provide a code example if applicable';

    return prompt;
}

function setupElectronListeners() {
    window.electronAPI.onFileLoaded((data) => {
        currentFilePath = data.path;
        currentFileName = data.name;
        fileNameEl.textContent = data.name;

        logEntries = parseLogFile(data.content);
        applyFilters();
        displayedCount = INITIAL_LOAD;
        renderLogs();
        updateStats();

        // Show live indicator
        liveIndicator.classList.remove('hidden');
        updateWatchStatus(true, data.name);

        // Show entries, hide empty state
        emptyState.classList.add('hidden');
        logEntries_el.classList.remove('hidden');
    });

    window.electronAPI.onFileUpdated((data) => {
        // Parse only new content
        const newEntries = parseLogFile(data.newContent);

        if (newEntries.length > 0) {
            // Mark new entries
            newEntries.forEach(entry => entry.isNew = true);

            // Add to beginning (newest first)
            logEntries = [...newEntries, ...logEntries];
            applyFilters();

            // Prepend new entries to DOM
            prependNewEntries(newEntries);
            updateStats();
        }
    });

    window.electronAPI.onFileError((data) => {
        console.error('File error:', data.message);
        updateWatchStatus(false);
    });

    window.electronAPI.onRecentFilesUpdated((files) => {
        renderRecentFiles(files);
    });

    window.electronAPI.onFocusSearch(() => {
        searchInput.focus();
        searchInput.select();
    });
}

// Log parsing patterns
const patterns = [
    // PHP Error Log: [DD-Mon-YYYY HH:MM:SS Timezone] PHP Error Type: message
    {
        regex: /^\[(\d{2}-\w{3}-\d{4}\s+\d{2}:\d{2}:\d{2}(?:\s+\w+)?)\]\s*(PHP\s+)?(Fatal error|Parse error|Warning|Notice|Deprecated|Error|Exception):\s*(.+)/i,
        parse: (match) => ({
            timestamp: match[1],
            level: match[3].toLowerCase().replace(' ', ''),
            message: match[4]
        })
    },
    // WordPress/PHP: [DD-Mon-YYYY HH:MM:SS UTC] message
    {
        regex: /^\[(\d{2}-\w{3}-\d{4}\s+\d{2}:\d{2}:\d{2}\s+\w+)\]\s*(.+)/i,
        parse: (match) => ({
            timestamp: match[1],
            level: detectLevel(match[2]),
            message: match[2]
        })
    },
    // Standard datetime format: YYYY-MM-DD HH:MM:SS
    {
        regex: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*(?:\[([^\]]+)\])?\s*(.+)/,
        parse: (match) => ({
            timestamp: match[1],
            level: match[2] ? match[2].toLowerCase() : detectLevel(match[3]),
            message: match[3]
        })
    },
    // Laravel/Monolog: [YYYY-MM-DD HH:MM:SS] environment.LEVEL: message
    {
        regex: /^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s*\w+\.(\w+):\s*(.+)/,
        parse: (match) => ({
            timestamp: match[1],
            level: match[2].toLowerCase(),
            message: match[3]
        })
    },
    // Apache/Nginx: [Day Mon DD HH:MM:SS.microseconds YYYY] [level] message
    {
        regex: /^\[(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\d{4})\]\s*\[(\w+)\]\s*(.+)/,
        parse: (match) => ({
            timestamp: match[1],
            level: match[2].toLowerCase(),
            message: match[3]
        })
    },
    // Simple timestamp: Mon DD HH:MM:SS
    {
        regex: /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(.+)/,
        parse: (match) => ({
            timestamp: match[1],
            level: detectLevel(match[2]),
            message: match[2]
        })
    }
];

function parseLogFile(content) {
    const lines = content.split('\n');
    const entries = [];
    let currentEntry = null;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        let matched = false;

        for (const pattern of patterns) {
            const match = trimmedLine.match(pattern.regex);
            if (match) {
                if (currentEntry) {
                    entries.push(currentEntry);
                }
                currentEntry = pattern.parse(match);
                currentEntry.raw = trimmedLine;
                matched = true;
                break;
            }
        }

        if (!matched) {
            if (currentEntry) {
                currentEntry.message += '\n' + trimmedLine;
                currentEntry.raw += '\n' + trimmedLine;
            } else {
                currentEntry = {
                    timestamp: '',
                    level: detectLevel(trimmedLine),
                    message: trimmedLine,
                    raw: trimmedLine
                };
            }
        }
    }

    if (currentEntry) {
        entries.push(currentEntry);
    }

    // Reverse for newest first
    return entries.reverse();
}

function detectLevel(message) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('fatal') || lowerMessage.includes('critical')) return 'error';
    if (lowerMessage.includes('error') || lowerMessage.includes('exception')) return 'error';
    if (lowerMessage.includes('warning') || lowerMessage.includes('warn')) return 'warning';
    if (lowerMessage.includes('notice')) return 'notice';
    if (lowerMessage.includes('deprecated')) return 'deprecated';
    if (lowerMessage.includes('info')) return 'info';
    if (lowerMessage.includes('debug')) return 'debug';

    return 'info';
}

// Filtering
function handleFilterChange(filter) {
    currentFilter = filter;

    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    applyFilters();
    displayedCount = INITIAL_LOAD;
    renderLogs();
    updateStats();
}

function handleSearch() {
    applyFilters();
    displayedCount = INITIAL_LOAD;
    renderLogs();
    updateStats();

    clearSearch.classList.toggle('hidden', searchInput.value.length === 0);
}

function handleClearSearch() {
    searchInput.value = '';
    clearSearch.classList.add('hidden');
    applyFilters();
    displayedCount = INITIAL_LOAD;
    renderLogs();
    updateStats();
    searchInput.focus();
}

function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();

    filteredEntries = logEntries.filter(entry => {
        // Type filter
        if (currentFilter !== 'all') {
            if (currentFilter === 'error' && entry.level !== 'error') return false;
            if (currentFilter === 'warning' && !['warning', 'deprecated'].includes(entry.level)) return false;
            if (currentFilter === 'info' && !['info', 'notice', 'debug'].includes(entry.level)) return false;
        }

        // Search filter
        if (query) {
            const searchable = (entry.message + entry.timestamp + entry.level).toLowerCase();
            if (!searchable.includes(query)) return false;
        }

        return true;
    });
}

// Rendering
function renderLogs(highlightQuery = '') {
    const query = highlightQuery || searchInput.value.toLowerCase().trim();

    if (filteredEntries.length === 0) {
        logEntries_el.innerHTML = `
            <div class="flex flex-col items-center justify-center py-4 text-tertiary" style="height: 200px;">
                <p class="text-sm">No matching entries</p>
            </div>
        `;
        loadMore.classList.add('hidden');
        return;
    }

    const entriesToRender = filteredEntries.slice(0, displayedCount);
    const hasMore = displayedCount < filteredEntries.length;

    logEntries_el.innerHTML = entriesToRender.map(entry => createEntryHTML(entry, query)).join('');

    loadMore.classList.toggle('hidden', !hasMore);
    if (hasMore) {
        loadMore.querySelector('button').textContent = `Load more (${filteredEntries.length - displayedCount} remaining)`;
    }
}

function prependNewEntries(newEntries) {
    const query = searchInput.value.toLowerCase().trim();

    // Filter new entries according to current filters
    const filteredNew = newEntries.filter(entry => {
        if (currentFilter !== 'all') {
            if (currentFilter === 'error' && entry.level !== 'error') return false;
            if (currentFilter === 'warning' && !['warning', 'deprecated'].includes(entry.level)) return false;
            if (currentFilter === 'info' && !['info', 'notice', 'debug'].includes(entry.level)) return false;
        }
        if (query) {
            const searchable = (entry.message + entry.timestamp + entry.level).toLowerCase();
            if (!searchable.includes(query)) return false;
        }
        return true;
    });

    if (filteredNew.length === 0) return;

    const html = filteredNew.map(entry => createEntryHTML(entry, query, true)).join('');
    logEntries_el.insertAdjacentHTML('afterbegin', html);

    // Update displayed count
    displayedCount += filteredNew.length;
}

function createEntryHTML(entry, query = '', isNew = false) {
    const message = query
        ? highlightText(escapeHtml(entry.message), query)
        : escapeHtml(entry.message);

    const rawMessage = entry.message;
    const escapedMessage = escapeHtml(rawMessage).replace(/"/g, '&quot;');

    return `
        <div class="log-entry ${entry.level}${isNew || entry.isNew ? ' new' : ''}">
            <div class="timestamp">${escapeHtml(entry.timestamp || '—')}</div>
            <div class="level ${entry.level}">${entry.level}</div>
            <div class="message-wrapper">
                <div class="message">${message}</div>
                <div class="entry-actions">
                    <button class="ask-ai-btn" title="Copy for AI" data-message="${escapedMessage}" data-level="${entry.level}" data-timestamp="${escapeHtml(entry.timestamp || '')}">
                        <svg class="ai-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"></path>
                            <circle cx="7.5" cy="14.5" r="1.5"></circle>
                            <circle cx="16.5" cy="14.5" r="1.5"></circle>
                        </svg>
                        <svg class="check-icon hidden" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button class="copy-btn" title="Copy to clipboard" data-message="${escapedMessage}">
                        <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <svg class="check-icon hidden" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Chunking
function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = logContainer;
    const threshold = 300;

    if (scrollTop + clientHeight >= scrollHeight - threshold) {
        loadMoreEntries();
    }
}

function loadMoreEntries() {
    if (displayedCount >= filteredEntries.length) return;

    displayedCount = Math.min(displayedCount + CHUNK_SIZE, filteredEntries.length);
    renderLogs();
}

// Stats
function updateStats() {
    if (logEntries.length === 0) {
        statsInfo.innerHTML = '<span>No entries</span>';
        return;
    }

    const errorCount = filteredEntries.filter(e => e.level === 'error').length;
    const warningCount = filteredEntries.filter(e => ['warning', 'deprecated'].includes(e.level)).length;
    const infoCount = filteredEntries.filter(e => ['info', 'notice', 'debug'].includes(e.level)).length;

    statsInfo.innerHTML = `
        <span>${filteredEntries.length.toLocaleString()} of ${logEntries.length.toLocaleString()} entries</span>
        <span class="text-error">${errorCount} errors</span>
        <span class="text-warning">${warningCount} warnings</span>
        <span class="text-info">${infoCount} info</span>
    `;
}

// Recent files
function renderRecentFiles(files) {
    if (files.length === 0) {
        recentFilesList.innerHTML = '';
        noRecentFiles.classList.remove('hidden');
        return;
    }

    noRecentFiles.classList.add('hidden');

    recentFilesList.innerHTML = files.map(file => `
        <li class="recent-file-item${currentFilePath === file.path ? ' active' : ''}" data-path="${escapeHtml(file.path)}">
            <svg class="file-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span class="file-name">${escapeHtml(file.name)}</span>
            <button class="remove-btn" title="Remove from recent">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </li>
    `).join('');

    // Add click handlers
    recentFilesList.querySelectorAll('.recent-file-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.remove-btn')) {
                e.stopPropagation();
                window.electronAPI.removeRecentFile(item.dataset.path);
            } else {
                window.electronAPI.loadFile(item.dataset.path);
            }
        });
    });
}

function updateWatchStatus(watching, fileName = '') {
    if (watching) {
        watchStatus.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-success"></span>
            <span>Watching ${fileName}</span>
        `;
    } else {
        watchStatus.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-tertiary"></span>
            <span>No file loaded</span>
        `;
    }
}

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Start
init();
