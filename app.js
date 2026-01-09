// DOM Elements
const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const logContainer = document.getElementById('logContainer');
const stats = document.getElementById('stats');
const autoRefresh = document.getElementById('autoRefresh');
const refreshInterval = document.getElementById('refreshInterval');
const refreshStatus = document.getElementById('refreshStatus');

// State
let logEntries = [];
let filteredEntries = [];
let currentFile = null;
let refreshTimer = null;
let isRefreshing = false;

// Chunking/Virtual Scroll Config
const CHUNK_SIZE = 200; // Number of entries to render at once
const INITIAL_LOAD = 100; // Initial entries to show
let displayedCount = INITIAL_LOAD;
let isLoadingMore = false;

// Event Listeners
fileInput.addEventListener('change', handleFileSelect);
searchInput.addEventListener('input', debounce(handleSearch, 200));
clearSearch.addEventListener('click', handleClearSearch);
autoRefresh.addEventListener('change', handleAutoRefreshToggle);
refreshInterval.addEventListener('change', handleRefreshIntervalChange);
logContainer.addEventListener('scroll', handleScroll);

// File Selection Handler
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    currentFile = file;
    fileName.textContent = file.name;

    loadFile(file);

    // Enable controls
    searchInput.disabled = false;
    autoRefresh.disabled = false;
    refreshInterval.disabled = false;
}

// Load file contents
function loadFile(file, preserveScroll = false) {
    const scrollTop = preserveScroll ? logContainer.scrollTop : 0;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        const previousCount = logEntries.length;
        logEntries = parseLogFile(content);

        // Apply current search filter
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            filteredEntries = logEntries.filter(entry =>
                entry.message.toLowerCase().includes(query) ||
                entry.timestamp.toLowerCase().includes(query) ||
                entry.level.toLowerCase().includes(query)
            );
        } else {
            filteredEntries = [...logEntries];
        }

        // Reset displayed count for new files, keep for refresh
        if (!preserveScroll) {
            displayedCount = INITIAL_LOAD;
        }

        searchInput.value = query;
        clearSearch.classList.toggle('visible', query.length > 0);
        renderLogs(query);
        updateStats();

        if (preserveScroll) {
            logContainer.scrollTop = scrollTop;
            // Show notification if new entries were added
            if (logEntries.length > previousCount) {
                showNewEntriesNotification(logEntries.length - previousCount);
            }
        }
    };
    reader.readAsText(file);
}

// Show notification for new entries
function showNewEntriesNotification(count) {
    // Update refresh status briefly
    const originalStatus = refreshStatus.innerHTML;
    refreshStatus.innerHTML = `<span style="color: var(--accent)">+${count} new</span>`;
    setTimeout(() => {
        if (autoRefresh.checked) {
            refreshStatus.innerHTML = originalStatus;
        }
    }, 2000);
}

// Auto-refresh handlers
function handleAutoRefreshToggle() {
    if (autoRefresh.checked) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
}

function handleRefreshIntervalChange() {
    if (autoRefresh.checked) {
        stopAutoRefresh();
        startAutoRefresh();
    }
}

function startAutoRefresh() {
    if (!currentFile) return;

    const interval = parseInt(refreshInterval.value);
    refreshStatus.innerHTML = '<span class="dot"></span> Live';
    refreshStatus.classList.add('active');

    refreshTimer = setInterval(() => {
        if (currentFile && !isRefreshing) {
            isRefreshing = true;
            // Re-read the file from the input (browser limitation: can't auto-detect changes)
            // For true live updates, user needs to re-select the file or use drag-drop
            loadFile(currentFile, true);
            isRefreshing = false;
        }
    }, interval);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    refreshStatus.innerHTML = '';
    refreshStatus.classList.remove('active');
}

// Infinite scroll handler
function handleScroll() {
    if (isLoadingMore) return;

    const { scrollTop, scrollHeight, clientHeight } = logContainer;
    const threshold = 200; // pixels from bottom

    if (scrollTop + clientHeight >= scrollHeight - threshold) {
        loadMoreEntries();
    }
}

function loadMoreEntries() {
    if (displayedCount >= filteredEntries.length) return;

    isLoadingMore = true;
    displayedCount = Math.min(displayedCount + CHUNK_SIZE, filteredEntries.length);

    const query = searchInput.value.toLowerCase().trim();
    renderLogs(query);

    isLoadingMore = false;
}

// Log Parsing
function parseLogFile(content) {
    const lines = content.split('\n');
    const entries = [];
    let currentEntry = null;

    // Patterns for different log formats
    const patterns = [
        // PHP Error Log: [DD-Mon-YYYY HH:MM:SS Timezone] PHP Error Type: message
        {
            regex: /^\[(\d{2}-\w{3}-\d{4}\s+\d{2}:\d{2}:\d{2}(?:\s+\w+)?)\]\s*(PHP\s+)?(Fatal error|Parse error|Warning|Notice|Deprecated|Error|Exception):\s*(.+)/i,
            parse: (match) => ({
                timestamp: match[1],
                level: match[3].toLowerCase(),
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
        // Apache/Nginx: [Day Mon DD HH:MM:SS.microseconds YYYY] [level] [pid] [client] message
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

        // If no pattern matched, append to current entry or create new one
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

    // Don't forget the last entry
    if (currentEntry) {
        entries.push(currentEntry);
    }

    // Reverse to show newest first
    return entries.reverse();
}

// Detect log level from message content
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

// Search Handler
function handleSearch(event) {
    const query = event.target.value.toLowerCase().trim();

    if (query) {
        clearSearch.classList.add('visible');
        filteredEntries = logEntries.filter(entry =>
            entry.message.toLowerCase().includes(query) ||
            entry.timestamp.toLowerCase().includes(query) ||
            entry.level.toLowerCase().includes(query)
        );
    } else {
        clearSearch.classList.remove('visible');
        filteredEntries = [...logEntries];
    }

    // Reset displayed count when searching
    displayedCount = INITIAL_LOAD;
    renderLogs(query);
    updateStats();
}

// Clear Search
function handleClearSearch() {
    searchInput.value = '';
    clearSearch.classList.remove('visible');
    filteredEntries = [...logEntries];
    displayedCount = INITIAL_LOAD;
    renderLogs();
    updateStats();
    searchInput.focus();
}

// Render Logs
function renderLogs(highlightQuery = '') {
    if (filteredEntries.length === 0 && logEntries.length > 0) {
        logContainer.innerHTML = `
            <div class="no-results">
                <p>No matching log entries found</p>
            </div>
        `;
        return;
    }

    if (filteredEntries.length === 0) {
        logContainer.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <p>Select a log file to get started</p>
                <span class="hint">Supports PHP error logs, WordPress debug.log, and other common formats</span>
            </div>
        `;
        return;
    }

    // Only render up to displayedCount entries (chunking)
    const entriesToRender = filteredEntries.slice(0, displayedCount);
    const hasMore = displayedCount < filteredEntries.length;

    const html = entriesToRender.map(entry => {
        const levelClass = entry.level;
        const message = highlightQuery
            ? highlightText(escapeHtml(entry.message), highlightQuery)
            : escapeHtml(entry.message);

        return `
            <div class="log-entry ${levelClass}">
                <div class="log-header">
                    ${entry.timestamp ? `<span class="log-timestamp">${escapeHtml(entry.timestamp)}</span>` : ''}
                    <span class="log-level ${levelClass}">${entry.level}</span>
                </div>
                <div class="log-message">${message}</div>
            </div>
        `;
    }).join('');

    // Add load more indicator if there are more entries
    const loadMoreHtml = hasMore ? `
        <div class="load-more">
            <button onclick="loadMoreEntries()">
                Load more (${filteredEntries.length - displayedCount} remaining)
            </button>
        </div>
    ` : '';

    logContainer.innerHTML = html + loadMoreHtml;
}

// Update Stats
function updateStats() {
    if (logEntries.length === 0) {
        stats.innerHTML = '';
        return;
    }

    const errorCount = filteredEntries.filter(e => e.level === 'error').length;
    const warningCount = filteredEntries.filter(e => e.level === 'warning' || e.level === 'deprecated').length;
    const noticeCount = filteredEntries.filter(e => e.level === 'notice' || e.level === 'info').length;

    stats.innerHTML = `
        <span>
            Showing <span class="count">${filteredEntries.length}</span> of <span class="count">${logEntries.length}</span> entries
        </span>
        <span>
            <span class="count" style="color: var(--error)">${errorCount}</span> errors
        </span>
        <span>
            <span class="count" style="color: var(--warning)">${warningCount}</span> warnings
        </span>
        <span>
            <span class="count" style="color: var(--info)">${noticeCount}</span> notices
        </span>
    `;
}

// Utility Functions
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
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
