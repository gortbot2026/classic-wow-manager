// Auth gate for loot page
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/user');
    const user = res.ok ? await res.json() : { loggedIn: false };
    const gate = document.getElementById('loot-auth-gate');
    const main = document.querySelector('.main-content');
    if (!user.loggedIn) {
      if (gate) gate.style.display = 'block';
      // hide existing sections
      const sections = ['import-section','loot-section','lootManagementTitle'];
      sections.forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
      const btn = document.getElementById('lootAuthLoginBtn');
      if (btn) {
        const rt = encodeURIComponent(location.pathname + location.search + location.hash);
        btn.addEventListener('click', ()=>{ location.href = `/auth/login?returnTo=${rt}`; });
      }
    }
  } catch {}
});
// loot.js - Loot management functionality

class LootManager {
    constructor() {
        this.activeEventId = null;
        this.init();
    }

    async init() {
        console.log('[LOOT] Initializing Loot Manager');
        
        // Prefer URL param /event/:eventId/loot; fallback to localStorage
        let eventIdFromUrl = null;
        try {
            const parts = window.location.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('event');
            if (idx >= 0 && parts[idx + 1]) {
                eventIdFromUrl = parts[idx + 1];
            }
        } catch {}

        // Get active event from URL or localStorage
        this.activeEventId = eventIdFromUrl || localStorage.getItem('activeEventSession');

        // Normalize URL: if we have an active event but current URL is not event-scoped, redirect
        try {
            const parts = window.location.pathname.split('/').filter(Boolean);
            const isEventScoped = parts.includes('event') && parts[parts.indexOf('event') + 1];
            const isLootPage = parts.includes('loot');
            if (!isEventScoped && isLootPage && this.activeEventId) {
                window.location.replace(`/event/${this.activeEventId}/loot`);
                return;
            }
        } catch {}

        if (eventIdFromUrl) {
            localStorage.setItem('activeEventSession', eventIdFromUrl);
            if (typeof updateRaidBar === 'function') {
                setTimeout(() => updateRaidBar(), 0);
            }
        }
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Check user permissions and load data
        await this.loadUserPermissions();
        await this.loadLootData();

        // Live updates via SSE
        this.initializeLiveUpdates();
    }

    setupEventListeners() {
        // Import button
        const importButton = document.getElementById('importButton');
        if (importButton) {
            importButton.addEventListener('click', () => this.importGargulData());
        }

        // Clear button
        const clearButton = document.getElementById('clearButton');
        if (clearButton) {
            clearButton.addEventListener('click', () => this.clearInput());
        }

        // Input validation
        const gargulInput = document.getElementById('gargulInput');
        if (gargulInput) {
            gargulInput.addEventListener('input', () => this.validateInput());
        }
    }

    initializeLiveUpdates() {
        try {
            if (!this.activeEventId) return;
            const url = `/api/updates/stream?scope=${encodeURIComponent('loot')}&eventId=${encodeURIComponent(this.activeEventId)}`;
            const es = new EventSource(url, { withCredentials: true });
            this._es = es;
            const showToast = () => {
                if (this._refreshToastShown) return;
                this._refreshToastShown = true;
                const t = document.createElement('div');
                t.className = 'refresh-toast';
                t.style.opacity = '0';
                t.style.transform = 'translateY(-12px)';
                t.innerHTML = `<span class="msg">There has been updates to this page, refresh the page to see the latest version</span><button class="btn" id="refresh-now-btn">Refresh</button>`;
                document.body.appendChild(t);
                const btn = t.querySelector('#refresh-now-btn');
                if (btn) btn.onclick = ()=>{ try { location.reload(); } catch {} };
                requestAnimationFrame(()=>{
                    t.style.transition = 'opacity 300ms ease, transform 300ms ease';
                    t.style.opacity = '1';
                    t.style.transform = 'translateY(0)';
                });
            };
            es.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data||'{}');
                    if (!msg || msg.type === 'connected') return;
                    const myUserId = (window.__currentUser && window.__currentUser.id) ? String(window.__currentUser.id) : null;
                    const byUserId = msg && msg.data && msg.data.byUserId ? String(msg.data.byUserId) : null;
                    if (myUserId && byUserId && myUserId === byUserId) return;
                    showToast();
                } catch {}
            };
        } catch (e) { console.warn('[LOOT] SSE init failed', e); }
    }

    async loadUserPermissions() {
        try {
            const response = await fetch('/user');
            const data = await response.json();
            
            if (data.loggedIn && data.hasManagementRole) {
                console.log('[LOOT] User has management role, showing import section');
                document.getElementById('import-section').style.display = 'block';
                const title = document.getElementById('lootManagementTitle');
                if (title) title.style.display = 'none'; // Hide title for everyone as requested
            } else {
                console.log('[LOOT] User does not have management role, hiding import section');
                document.getElementById('import-section').style.display = 'none';
                const title = document.getElementById('lootManagementTitle');
                if (title) title.style.display = 'none'; // Hide title for everyone
            }
        } catch (error) {
            console.error('[LOOT] Error checking user permissions:', error);
            document.getElementById('import-section').style.display = 'none';
            const title = document.getElementById('lootManagementTitle');
            if (title) title.style.display = 'none'; // Hide title for everyone
        }
    }

    updateStatsDashboard(items) {
        console.log('[LOOT] Updating stats dashboard with', items.length, 'items');
        
        if (!items || items.length === 0) {
            this.showEmptyStats();
            return;
        }

        // Calculate statistics
        const totalItems = items.length;
        const totalGold = items.reduce((sum, item) => sum + (parseInt(item.gold_amount) || 0), 0);
        
        // Find most expensive item
        const mostExpensive = items.reduce((max, item) => {
            const gold = parseInt(item.gold_amount) || 0;
            return gold > (parseInt(max.gold_amount) || 0) ? item : max;
        }, items[0]);

        // Calculate biggest spender (player who spent most total gold)
        const playerTotals = {};
        items.forEach(item => {
            const player = item.player_name;
            const gold = parseInt(item.gold_amount) || 0;
            playerTotals[player] = (playerTotals[player] || 0) + gold;
        });
        
        const biggestSpender = Object.entries(playerTotals).reduce((max, [player, total]) => {
            return total > max.total ? { player, total } : max;
        }, { player: '', total: 0 });

        // Update DOM elements
        document.getElementById('totalItemsCount').textContent = totalItems.toLocaleString();
        document.getElementById('totalGoldAmount').textContent = totalGold.toLocaleString();
        
        if (mostExpensive) {
            document.getElementById('expensiveItemName').textContent = mostExpensive.item_name;
            document.getElementById('expensiveItemGold').textContent = `${parseInt(mostExpensive.gold_amount).toLocaleString()} gold`;
        }
        
        if (biggestSpender.player) {
            document.getElementById('biggestSpenderName').textContent = biggestSpender.player;
            document.getElementById('biggestSpenderAmount').textContent = `${biggestSpender.total.toLocaleString()} gold spent`;
        }

        // Remove no-data class from all cards
        document.querySelectorAll('.stat-card').forEach(card => {
            card.classList.remove('no-data');
        });
    }

    showEmptyStats() {
        console.log('[LOOT] Showing empty stats dashboard');
        
        document.getElementById('totalItemsCount').textContent = '0';
        document.getElementById('totalGoldAmount').textContent = '0';
        document.getElementById('expensiveItemName').textContent = 'No items';
        document.getElementById('expensiveItemGold').textContent = '';
        document.getElementById('biggestSpenderName').textContent = 'No data';
        document.getElementById('biggestSpenderAmount').textContent = '';

        // Add no-data class to all cards
        document.querySelectorAll('.stat-card').forEach(card => {
            card.classList.add('no-data');
        });
    }

    async loadLootData() {
        console.log('[LOOT] Loading loot data for event:', this.activeEventId);
        
        if (!this.activeEventId) {
            this.showEmptyStats();
            this.displayNoItems('No active event selected');
            return;
        }

        // Show loading - either find existing indicator or create one
        let loadingIndicator = document.getElementById('loadingIndicator');
        const lootList = document.getElementById('lootList');
        
        if (!loadingIndicator) {
            // Create loading indicator if it doesn't exist
            lootList.innerHTML = `
                <div class="loading-indicator" id="loadingIndicator">
                    <div class="spinner"></div>
                    <p>Loading loot data...</p>
                </div>
            `;
            loadingIndicator = document.getElementById('loadingIndicator');
        }
        
        loadingIndicator.style.display = 'flex';

        try {
            const response = await fetch(`/api/loot/${this.activeEventId}`);
            
            if (response.status === 401) {
                console.log('[LOOT] 401 Unauthorized - user not logged in or session expired');
                this.displayNoItems('Please log in to view loot data');
                return;
            }
            
            const data = await response.json();

            if (data.success) {
                console.log('[LOOT] Loaded', data.items.length, 'items');
                this.updateStatsDashboard(data.items);
                this.displayLootItems(data.items);
            } else {
                console.log('[LOOT] Error loading loot data:', data.message);
                this.showEmptyStats();
                this.displayNoItems(data.message || 'Error loading loot data');
            }
        } catch (error) {
            console.error('[LOOT] Error loading loot data:', error);
            this.showEmptyStats();
            this.displayNoItems('Error loading loot data');
        } finally {
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
        }
    }

    displayLootItems(items) {
        const lootList = document.getElementById('lootList');
        
        if (!items || items.length === 0) {
            this.displayNoItems('No items imported yet');
            return;
        }

        const container = document.createElement('div');
        container.className = 'loot-items-container';

        items.forEach(item => {
            const itemElement = this.createLootItemElement(item);
            container.appendChild(itemElement);
        });

        lootList.innerHTML = '';
        lootList.appendChild(container);
    }

    createLootItemElement(item) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'loot-item';

        itemDiv.innerHTML = `
            <img 
                src="${item.icon_link || ''}" 
                alt="${item.item_name}" 
                class="item-icon"
                onerror="this.classList.add('error')"
            />
            <div class="item-details">
                <div class="item-name">${this.escapeHtml(item.item_name)}</div>
                <div class="item-player">Won by: ${this.escapeHtml(item.player_name)}</div>
                <div class="item-gold">${parseInt(item.gold_amount).toLocaleString()}</div>
                <a href="${item.wowhead_link}" target="_blank" class="item-link">
                    <i class="fas fa-external-link-alt"></i>
                    See item
                </a>
            </div>
        `;

        return itemDiv;
    }

    displayNoItems(message) {
        const lootList = document.getElementById('lootList');
        lootList.innerHTML = `
            <div class="no-items">
                <i class="fas fa-treasure-chest" style="font-size: 2em; margin-bottom: 10px; opacity: 0.3;"></i>
                <p>${message}</p>
            </div>
        `;
    }

    validateInput() {
        const input = document.getElementById('gargulInput');
        const importButton = document.getElementById('importButton');
        
        if (input.value.trim()) {
            importButton.disabled = false;
        } else {
            importButton.disabled = true;
        }
    }

    clearInput() {
        document.getElementById('gargulInput').value = '';
        this.hideStatus();
        this.validateInput();
    }

    async importGargulData() {
        if (!this.activeEventId) {
            this.showStatus('error', 'No active event selected. Please select an event from the Events page.');
            return;
        }

        const input = document.getElementById('gargulInput');
        const expandExisting = document.getElementById('expandExisting').checked;
        const importButton = document.getElementById('importButton');
        
        const gargulText = input.value.trim();
        if (!gargulText) {
            this.showStatus('error', 'Please paste Gargul loot data');
            return;
        }

        importButton.disabled = true;
        this.showStatus('info', 'Parsing and importing loot data...');

        try {
            // Parse the Gargul string
            const items = this.parseGargulString(gargulText);
            
            if (items.length === 0) {
                this.showStatus('error', 'No valid items found in the provided data');
                return;
            }

            console.log('[LOOT] Parsed', items.length, 'items');

            // Send to backend
            const response = await fetch('/api/loot/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    eventId: this.activeEventId,
                    items: items,
                    expandExisting: expandExisting
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showStatus('success', `Successfully imported ${items.length} items`);
                input.value = '';
                
                // Reload the loot data
                await this.loadLootData();
            } else {
                this.showStatus('error', data.message || 'Failed to import loot data');
            }
        } catch (error) {
            console.error('[LOOT] Error importing loot data:', error);
            this.showStatus('error', 'Error processing loot data: ' + error.message);
        } finally {
            importButton.disabled = false;
            this.validateInput();
        }
    }

    parseGargulString(gargulText) {
        const lines = gargulText.split('\n').map(line => line.trim()).filter(line => line);
        const items = [];

        console.log('[LOOT] Parsing', lines.length, 'lines');

        lines.forEach((line, index) => {
            // Skip header lines (first line or lines that look like headers)
            if (index === 0 && (line.toLowerCase().includes('item') || line.toLowerCase().includes('player'))) {
                console.log('[LOOT] Skipping header line:', line);
                return;
            }

            // Parse item line - expecting semicolon-separated values
            const parts = line.split(';').map(part => part.trim());
            
            if (parts.length >= 4) {
                const item = {
                    item_name: parts[0],
                    player_name: parts[1],
                    gold_amount: parseInt(parts[2]) || 0,
                    wowhead_link: parts[3],
                    icon_link: parts.length > 4 ? parts[4] : null
                };

                // Basic validation
                if (item.item_name && item.player_name && item.wowhead_link) {
                    items.push(item);
                    console.log('[LOOT] Parsed item:', item.item_name, 'for', item.player_name);
                } else {
                    console.warn('[LOOT] Invalid item line:', line);
                }
            } else {
                console.warn('[LOOT] Skipping malformed line:', line);
            }
        });

        return items;
    }

    showStatus(type, message) {
        const status = document.getElementById('importStatus');
        status.className = `import-status ${type}`;
        status.textContent = message;
    }

    hideStatus() {
        const status = document.getElementById('importStatus');
        status.className = 'import-status';
        status.style.display = 'none';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('[LOOT] DOM loaded, initializing Loot Manager');
    window.lootManager = new LootManager();
}); 