// Raid Logs JavaScript

class RaidLogsManager {
    constructor() {
        this.ensureAuthGate().then((ok)=>{ if(!ok) return; this._initAfterAuth(); });
    }

    async ensureAuthGate(){
        try{
            const res = await fetch('/user');
            const user = res.ok ? await res.json() : {loggedIn:false};
            if (user && user.loggedIn) return true;
            const gate = document.getElementById('rl-auth-gate');
            const container = document.getElementById('raid-logs-container');
            if (gate) gate.style.display='block';
            if (container) container.style.display='none';
            const btn = document.getElementById('rlAuthLoginBtn');
            if (btn){ const rt=encodeURIComponent(location.pathname+location.search+location.hash); btn.addEventListener('click',()=>{ location.href=`/auth/login?returnTo=${rt}`; }); }
            return false;
        }catch{ return true; }
    }

    _initAfterAuth(){
        this.activeEventId = null;
        this.logData = null;
        this.abilitiesData = [];
        this.abilitiesSettings = { calculation_divisor: 10, max_points: 20 };
        this.manaPotionsData = [];
        this.manaPotionsSettings = { threshold: 10, points_per_potion: 3, max_points: 10 };
        this.runesData = [];
        this.runesSettings = { usage_divisor: 2, points_per_division: 1 };
        this.interruptsData = [];
        this.interruptsSettings = { points_per_interrupt: 1, interrupts_needed: 1, max_points: 5 };
        this.disarmsData = [];
        this.disarmsSettings = { points_per_disarm: 1, disarms_needed: 1, max_points: 5 };
        this.confirmedAssignmentsData = [];
        this.sunderData = [];
        this.sunderSettings = { point_ranges: [] };
        this.curseData = [];
        this.curseSettings = { uptime_threshold: 85, points: 10 };
        this.curseShadowData = [];
        this.curseShadowSettings = { uptime_threshold: 85, points: 10 };
        this.curseElementsData = [];
        this.curseElementsSettings = { uptime_threshold: 85, points: 10 };
        this.faerieFireData = [];
        this.faerieFireSettings = { uptime_threshold: 85, points: 10 };
        this.scorchData = [];
        this.scorchSettings = { tier1_max: 99, tier1_points: 0, tier2_max: 199, tier2_points: 5, tier3_points: 10 };
        this.demoShoutData = [];
        this.demoShoutSettings = { tier1_max: 99, tier1_points: 0, tier2_max: 199, tier2_points: 5, tier3_points: 10 };
        this.polymorphData = [];
        this.polymorphSettings = { points_per_division: 1, polymorphs_needed: 2, max_points: 5 };
        this.powerInfusionData = [];
        this.powerInfusionSettings = { points_per_division: 1, infusions_needed: 2, max_points: 10 };
        this.decursesData = [];
        this.decursesSettings = { points_per_division: 1, decurses_needed: 3, max_points: 10, min_points: -10, average_decurses: 0 };
        this.voidDamageData = [];
        this.voidDamageSettings = { void_blast_penalty: -10, void_zone_penalty: -5 };
        this.windfuryData = [];
        this.windfurySettings = { threshold: 10, points_per_totem: 1, max_points: 10 };
        this.playerStreaksData = [];
        this.guildMembersData = [];
        this.weeklyNaxRaidsData = [];
        this.rewardSettings = {};
        this.worldBuffsData = [];
        this.worldBuffsRequiredBuffs = 6;
        this.worldBuffsChannelId = null;
        this.frostResistanceData = [];
        this.maxFrostResistance = 0;
        this.worldBuffsArchiveUrl = null;
        this.frostResistanceArchiveUrl = null;
        this.specData = {};
        this.floatingNav = null;
        this.sectionObserver = null;
        this.navOriginalTop = 0;
        this.isScrolling = false;
        this.scrollTimeout = null;
        this.manualRewardsData = [];
        this.playersData = [];
        this.rosterPlayersData = []; // Roster-based player data for autocomplete fallback
        this.currentUser = null;
        this.isEditingEntry = false;
        this.editingEntryId = null;
        this.primaryRoles = null;
        // Gold/points aggregates
        this.totalGoldPot = 0;
        this.sharedGoldPot = 0;
        this.managementCuts = { management: 0, organizer: 0, raidleader: 0, helper: 0, founder: 0 };
        this.myPoints = null;
        this.myGold = null;
        this.goldPerPoint = null;
        // Snapshot/Mode state
        this.snapshotLocked = false;
        this.snapshotLockedAt = null;
        this.snapshotLockedBy = null;
        // Discord class icon emote IDs (fallback when spec icon is missing)
        this.classIconEmotes = {
            'warrior': '579532030153588739',
            'paladin': '579532029906124840',
            'hunter': '579532029880827924',
            'rogue': '579532030086217748',
            'priest': '637564323442720768',
            'shaman': '579532030056857600',
            'mage': '579532030161977355',
            'warlock': '579532029851336716',
            'druid': '579532029675438081'
        };
        this.classColors = {
            'warrior': '#C79C6E',
            'paladin': '#F58CBA',
            'hunter': '#ABD473',
            'rogue': '#FFF569',
            'priest': '#FFFFFF',
            'shaman': '#0070DE',
            'mage': '#69CCF0',
            'warlock': '#9482C9',
            'druid': '#FF7D0A',
            'unknown': '#e5e7eb'
        };
        this._loadingRaid = false;
        this._storageDebounce = null;
        this.initializeEventListeners();
        this.loadSpecData();
        this.playerPanels = new Map(); // key: panelId, value: { slug, name, className }
        this._myGoldTooltipCards = new WeakSet();
        this.engineResult = null;
        this.loadRaidLogsData();
    }

    initializeEventListeners() {
        // Listen for storage changes to reload data when event changes (debounced, ignore same value)
        window.addEventListener('storage', (e) => {
            if (e.key !== 'activeEventSession') return;
            if (String(e.newValue || '') === String(this.activeEventId || '')) return;
            if (this._storageDebounce) clearTimeout(this._storageDebounce);
            this._storageDebounce = setTimeout(() => {
                if (!this._loadingRaid) this.loadRaidLogsData();
            }, 150);
        });
        
        // Cleanup SSE connections on page unload
        window.addEventListener('beforeunload', () => {
            this.cleanupSSEConnection();
        });
        
        // Also cleanup on visibility change (tab switch/minimize)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('🔍 [SSE] Page hidden, cleaning up connection');
                this.cleanupSSEConnection();
            } else {
                console.log('🔍 [SSE] Page visible, reinitializing connection');
                // Small delay to avoid rapid reconnections
                setTimeout(() => {
                    this.initializeLiveUpdates();
                }, 1000);
            }
        });

        // Add click handlers for page navigation buttons
        this.setupPageNavigationButtons();
        
        // Set up stats panel toggle buttons
        this.setupStatsPanelToggle();
        
        // Initialize floating navigation
        this.initializeFloatingNavigation();
        this.initializeLiveUpdates();
        
        // Initialize manual rewards functionality
        this.initializeManualRewards();

        // Initialize panel editing (after DOM ready)
        this.initializePanelEditing();

        // Top controls wiring (always set up; visibility handled after role fetch)
        try {
            // Floating Admin Actions wiring (admin view)
            const faa = document.getElementById('floating-admin-actions');
            if (faa) {
                // Always show the admin actions bar; server will enforce permissions on actions
                faa.style.display = 'block';
            }
            const eid = this.activeEventId || localStorage.getItem('activeEventSession');
            const goPublic = document.getElementById('faa-switch-public');
            if (goPublic) {
                goPublic.onclick = () => { window.location.href = eid ? `/event/${eid}/raidlogs` : '/raidlogs'; };
            }
            const publishBtn = document.getElementById('faa-publish');
            const refreshBtn = document.getElementById('faa-refresh');
            
            // SIMPLIFIED PUBLISH BUTTON: Just toggles published flag
            if (publishBtn && !publishBtn._wired) {
                const updatePublishUi = (pub)=>{
                    publishBtn.classList.remove('state-published','state-unpublished');
                    if (pub) {
                        publishBtn.classList.add('state-published');
                        publishBtn.title = 'Unpublish data';
                        publishBtn.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Unpublish data`;
                    } else {
                        publishBtn.classList.add('state-unpublished');
                        publishBtn.title = 'Publish data';
                        publishBtn.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Publish data`;
                    }
                };
                // initial state from header if available
                setTimeout(()=>{ try { updatePublishUi(!!(this.snapshotHeader && this.snapshotHeader.published)); } catch {} }, 0);
                // Also check server-published status
                (async()=>{ try {
                    const evId = this.activeEventId || eid; if (!evId) return;
                    const res = await fetch(`/api/raidlogs/published/${evId}`);
                    if (res && res.ok) {
                        const data = await res.json();
                        const isPublished = !!(data && data.header);
                        if (isPublished) {
                            this.snapshotHeader = this.snapshotHeader || {}; this.snapshotHeader.published = true;
                            updatePublishUi(true);
                        }
                    }
                } catch {} })();
                publishBtn.addEventListener('click', async () => {
                    if (!this.activeEventId) return;
                    try {
                        const currentlyPublished = !!(this.snapshotHeader && this.snapshotHeader.published);
                        
                        if (!currentlyPublished) {
                            // PUBLISH: Save if needed, then toggle published = true
                            const ok = confirm('Publish current data to public viewer?\n\nThis will make the data visible on public pages.');
                            if (!ok) return;
                            
                            // If not in manual mode yet, save all panels first by scraping the current view
                            if (!this.snapshotLocked || !this.snapshotEntries || this.snapshotEntries.length === 0) {
                                this.showSavingProgress('Building snapshot from current view...');
                                try {
                                    await this.lockSnapshotFromCurrentView();
                                    this.snapshotLocked = true;
                                    this.updateModeBadge();
                                } catch (error) {
                                    this.hideSavingProgress();
                                    console.error('Error saving panels:', error);
                                    alert('Error saving panels. Please try again.');
                                    return;
                                }
                                this.hideSavingProgress();
                            }
                            
                            // Toggle published flag to true
                            const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/publish`, { method: 'POST' });
                            if (res && res.ok) {
                                this.snapshotHeader = this.snapshotHeader || {}; 
                                this.snapshotHeader.published = true;
                                updatePublishUi(true);
                                alert('Published! Data is now visible on public pages.');
                            } else {
                                alert('Failed to publish. Please try again.');
                            }
                        } else {
                            // UNPUBLISH: Just toggle published = false
                            const ok = confirm('Unpublish and hide from public viewer?');
                            if (!ok) return;
                            const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/unpublish`, { method: 'POST' });
                            if (res && res.ok) {
                                this.snapshotHeader = this.snapshotHeader || {}; 
                                this.snapshotHeader.published = false;
                                updatePublishUi(false);
                                alert('Unpublished! Data is now hidden from public pages.');
                            } else {
                                alert('Failed to unpublish. Please try again.');
                            }
                        }
                    } catch (e) { console.error('Publish toggle error', e); alert('Error. See console.'); }
                });
                publishBtn._wired = true;
            }
            
            // REFRESH BUTTON REMOVED - No longer needed with simplified workflow
            // Manual edits after publishing now instantly reflect on public pages
            if (refreshBtn) {
                refreshBtn.style.display = 'none'; // Hide the refresh button
            }
            const revertBtnTop = document.getElementById('faa-revert');
            if (revertBtnTop && !revertBtnTop._wired) {
                revertBtnTop.addEventListener('click', async () => {
                    if (!this.activeEventId) return;
                    const ok = confirm('Are you sure you want to reset all manual edits and revert to computed mode?');
                    if (!ok) return;
                    try {
                        const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/unlock`, { method: 'POST' });
                        if (res && res.ok) { alert('Reverted to computed'); location.reload(); } else { alert('Failed to revert'); }
                    } catch (e) { console.error('Revert error', e); alert('Failed to revert'); }
                });
                revertBtnTop._wired = true;
            }
            const uploadLogs = document.getElementById('faa-upload-logs');
            if (uploadLogs) uploadLogs.onclick = () => {
                const target = eid ? `/event/${eid}/logs` : '/logs';
                window.location.href = target;
            };
        } catch {}

        // Standardize point value colors and keep them updated as DOM changes
        this._normalizePointValuesColors();
        const container = document.getElementById('raid-logs-container');
        if (container) {
            const mo = new MutationObserver(()=> this._normalizePointValuesColors());
            mo.observe(container, { childList: true, subtree: true });
            this._pointsColorObserver = mo;
        }

        // Debug panel
        setTimeout(()=>{
            const btn = document.getElementById('rl-debug-toggle');
            const panel = document.getElementById('rl-debug-panel');
            if (btn && panel) {
                btn.addEventListener('click', ()=>{
                    const show = panel.style.display === 'none';
                    panel.style.display = show? 'block':'none';
                    if (show) this.renderRaidlogsDebugPanel();
                });
            }
            // Temporary parity button for engine vs legacy
            try {
                let pbtn = document.getElementById('rl-parity-btn');
                if (!pbtn) {
                    pbtn = document.createElement('button');
                    pbtn.id = 'rl-parity-btn';
                    pbtn.className = 'btn-templates btn-mini';
                    pbtn.style.marginLeft = '8px';
                    pbtn.textContent = 'Check vs engine';
                    const hdr = document.querySelector('.page-header h1');
                    if (hdr && hdr.parentElement) hdr.parentElement.appendChild(pbtn);
                }
                pbtn.onclick = async () => {
                    try {
                        const resp = await fetch(`/api/rewards/${this.activeEventId}/effective`).catch(()=>null);
                        if (!resp || !resp.ok) { console.warn('[Parity] Engine unavailable'); return; }
                        const eff = await resp.json(); if (!eff || !eff.success) { console.warn('[Parity] Engine error'); return; }
                        const engTotals = new Map(Object.entries(eff.totals||{}).map(([k,v])=>[k, Math.round(Number(v.points)||0)]));
                        const legacyTotals = new Map();
                        (this.logData||[]).filter(p=>!this.shouldIgnorePlayer(p.character_name)).forEach(p=>{
                            const k=String(p.character_name||'').trim().toLowerCase();
                            const row = (this.pointsBreakdownRowsCache && this.pointsBreakdownRowsCache.get) ? this.pointsBreakdownRowsCache.get(k) : null;
                            // Fallback: recompute from breakdown table provider if present
                            let pts=null; try { pts = this.totalPointsComputedPerName ? this.totalPointsComputedPerName.get(k) : null; } catch {}
                            if (pts==null) return; legacyTotals.set(k, Math.round(Number(pts)||0));
                        });
                        const mismatches=[]; legacyTotals.forEach((v,k)=>{ const e=engTotals.get(k); if (typeof e==='number' && e!==v) mismatches.push({name:k, legacy:v, engine:e}); });
                        console.warn('[Raidlogs Parity] Mismatches', mismatches);
                    } catch {}
                };
            } catch {}
            // Render points table after data load
            const ready = () => {
                try { this.renderPointsBreakdownTable(); } catch(e) { console.warn('Points table render skipped', e); }
            };
            // If data is already present, render immediately; else wait a tick
            setTimeout(ready, 0);
        }, 0);
    }

    _normalizePointValuesColors() {
        try {
            const nodes = document.querySelectorAll('.performance-amount .amount-value');
            nodes.forEach((el)=>{
                // Remove inline color styles
                if (el.style && el.style.color) el.style.removeProperty('color');
                // If element contains input (manual edit mode), use input value
                let valText = el.textContent;
                const inp = el.querySelector('input');
                if (inp && typeof inp.value !== 'undefined') valText = inp.value;
                const num = Number(String(valText||'').replace(/[^0-9+\-\.]/g, ''));
                el.classList.remove('positive','negative','zero');
                if (!isNaN(num)) {
                    if (num > 0) el.classList.add('positive');
                    else if (num < 0) el.classList.add('negative');
                    else el.classList.add('zero');
                }
            });
        } catch (e) { /* noop */ }
    }
    initializeLiveUpdates(){
        try {
            // Temporarily disabled SSE
            return;
            // Initialize reconnection state
            if (!this._sseReconnectAttempts) this._sseReconnectAttempts = 0;
            if (!this._sseBaseDelay) this._sseBaseDelay = 2000; // Start with 2 seconds
            
            const scope = 'raidlogs';
            const eventId = this.activeEventId || '';
            if (!eventId) return;
            
            const url = `/api/updates/stream?scope=${encodeURIComponent(scope)}&eventId=${encodeURIComponent(eventId)}`;
            console.log(`🔌 [SSE] Attempting connection (attempt ${this._sseReconnectAttempts + 1})`);
            
            const es = new EventSource(url, { withCredentials: true });
            this._es = es;
            
            const showToast = () => {
                if (this._refreshToastShown) return;
                this._refreshToastShown = true;
                const t = document.createElement('div');
                t.className = 'refresh-toast';
                t.innerHTML = `<span class="msg">There has been updates to this page, refresh the page to see the latest version</span><button class="btn" id="refresh-now-btn">Refresh</button>`;
                t.style.opacity = '0';
                t.style.transform = 'translateY(-12px)';
                document.body.appendChild(t);
                const btn = t.querySelector('#refresh-now-btn');
                if (btn) btn.onclick = ()=>{ try { location.reload(); } catch {} };
                // Slide-in (soft appear)
                requestAnimationFrame(()=>{
                    t.style.transition = 'opacity 300ms ease, transform 300ms ease';
                    t.style.opacity = '1';
                    t.style.transform = 'translateY(0)';
                });
            };
            
            es.onopen = () => {
                console.log(`✅ [SSE] Connection established successfully`);
                // Reset reconnection attempts on successful connection
                this._sseReconnectAttempts = 0;
                this._sseBaseDelay = 2000;
            };
            
            es.onmessage = (e)=>{
                try {
                    const msg = JSON.parse(e.data||'{}');
                    if (!msg || msg.type === 'connected') return;
                    // Ignore updates we originated (evaluate at message time)
                    const myUserIdNow = this.currentUser && this.currentUser.id ? String(this.currentUser.id) : null;
                    const byUserId = msg && msg.data && msg.data.byUserId ? String(msg.data.byUserId) : null;
                    if (myUserIdNow && byUserId && byUserId === myUserIdNow) return;
                    // Show toast for any raidlogs-scoped update
                    showToast();
                } catch {}
            };
            
            es.onerror = () => {
                console.warn(`❌ [SSE] Connection error (attempt ${this._sseReconnectAttempts + 1})`);
                es.close();
                this.scheduleSSEReconnection();
            };
        } catch (e) { 
            console.warn('SSE init failed', e);
            this.scheduleSSEReconnection();
        }
    }
    
    scheduleSSEReconnection() {
        // Clear any existing reconnection timer
        if (this._sseReconnectTimer) {
            clearTimeout(this._sseReconnectTimer);
        }
        
        // Don't reconnect if user has navigated away
        if (!this.activeEventId) {
            console.log(`🚫 [SSE] No active event, skipping reconnection`);
            return;
        }
        
        // Increment attempt counter
        this._sseReconnectAttempts++;
        
        // Max 8 attempts with exponential backoff
        if (this._sseReconnectAttempts > 8) {
            console.error(`🚫 [SSE] Max reconnection attempts reached, giving up`);
            return;
        }
        
        // Calculate delay with exponential backoff + jitter
        const baseDelay = this._sseBaseDelay;
        const exponentialDelay = baseDelay * Math.pow(2, Math.min(this._sseReconnectAttempts - 1, 5));
        const jitter = Math.random() * 2000; // Add up to 2 seconds of jitter
        const totalDelay = Math.min(exponentialDelay + jitter, 60000); // Cap at 60 seconds
        
        console.log(`⏳ [SSE] Scheduling reconnection in ${Math.round(totalDelay)}ms (attempt ${this._sseReconnectAttempts}/8)`);
        
        this._sseReconnectTimer = setTimeout(() => {
            this.initializeLiveUpdates();
        }, totalDelay);
    }

    cleanupSSEConnection() {
        console.log(`🧹 [SSE] Cleaning up connection...`);
        
        // Clear reconnection timer
        if (this._sseReconnectTimer) {
            clearTimeout(this._sseReconnectTimer);
            this._sseReconnectTimer = null;
        }
        
        // Close existing SSE connection
        if (this._es) {
            this._es.close();
            this._es = null;
        }
        
        // Reset connection state
        this._sseReconnectAttempts = 0;
    }

    setupPageNavigationButtons() {
        // Guild Members page button
        const guildMembersButton = document.getElementById('guild-members-page-button');
        if (guildMembersButton) {
            guildMembersButton.onclick = () => {
                window.location.href = '/guild-members';
            };
            guildMembersButton.title = 'View full Guild Members page';
        }

        // Regular Attendance page button
        const attendanceButton = document.getElementById('attendance-page-button');
        if (attendanceButton) {
            attendanceButton.onclick = () => {
                window.location.href = '/attendance';
            };
            attendanceButton.title = 'View full Regular Attendance page';
        }
    }

    setupStatsPanelToggle() {
        // Set up toggle functionality for stats panel
        const toggleButtons = document.querySelectorAll('.stats-toggle-btn');
        const dashboardPanel = document.getElementById('dashboard-panel');
        const shamePanel = document.getElementById('shame-panel');
        const goldPanel = document.getElementById('gold-panel');

        toggleButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetPanel = button.getAttribute('data-panel');
                
                // Remove active class from all buttons
                toggleButtons.forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                button.classList.add('active');
                
                // Hide all panels
                if (dashboardPanel) dashboardPanel.style.display = 'none';
                if (shamePanel) shamePanel.style.display = 'none';
                if (goldPanel) goldPanel.style.display = 'none';
                // Hide dynamic player panels
                document.querySelectorAll('.stats-dashboard.player-panel').forEach(p => p.style.display = 'none');
                
                // Show the selected panel
                if (targetPanel === 'dashboard' && dashboardPanel) {
                    dashboardPanel.style.display = 'grid';
                } else if (targetPanel === 'shame' && shamePanel) {
                    shamePanel.style.display = 'grid';
                } else if (targetPanel === 'gold' && goldPanel) {
                    goldPanel.style.display = 'grid';
                    // Refresh gold cards when opening the tab
                    this.updateGoldCards();
                } else if (targetPanel && targetPanel.startsWith('player:')) {
                    const id = targetPanel.split(':')[1];
                    const panel = document.getElementById(`player-panel-${id}`);
                    if (panel) {
                        panel.style.display = 'grid';
                        // Ensure My Points / My Gold reflect latest values
                        this.updateGoldCards();
                    }
                }
            });
        });
    }

    initializeFloatingNavigation() {
        this.floatingNav = document.getElementById('floating-nav');
        if (!this.floatingNav) return;

        // Setup navigation button click handlers
        const navButtons = this.floatingNav.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = button.getAttribute('data-target');
                this.scrollToSection(targetId);
            });
        });

        // Setup scroll listener for active highlighting only
        this.setupScrollListener();
        
        // Setup intersection observer for section highlighting
        this.setupSectionObserver();
        
        // Initialize highlight position
        this.initializeHighlight();
        
        // Store the original position
        this.storeOriginalPosition();
    }
    setupScrollListener() {
        let lastScrollTime = 0;
        
        // Handle manual scroll interruption during programmatic scrolling
        const handleManualScroll = () => {
            const now = Date.now();
            
            // Only set isScrolling flag if we're actually in a programmatic scroll
            if (this.isScrolling && (now - lastScrollTime) > 50) {
                // Manual scroll detected during programmatic scroll
                this.isScrolling = false;
                if (this.scrollTimeout) {
                    clearTimeout(this.scrollTimeout);
                    this.scrollTimeout = null;
                }
            }
            lastScrollTime = now;
        };

        // Listen for scroll events (for manual scroll detection)
        window.addEventListener('scroll', handleManualScroll, { passive: true });
    }

    setupSectionObserver() {
        // Clean up existing observer
        if (this.sectionObserver) {
            this.sectionObserver.disconnect();
        }

        const options = {
            root: null,
            rootMargin: '-20% 0px -60% 0px',
            threshold: 0.1
        };

        this.sectionObserver = new IntersectionObserver((entries) => {
            // Don't update during programmatic scrolling
            if (this.isScrolling) return;

            // Pick the entry with the largest intersection ratio to reduce churn
            let bestEntry = null;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
                    bestEntry = entry;
                }
            }
            if (bestEntry) {
                this.updateActiveNavButton(bestEntry.target.id);
            }
        }, options);

        // Observe all scroll target sections
        const sections = document.querySelectorAll('.scroll-target');
        sections.forEach(section => {
            this.sectionObserver.observe(section);
        });
    }

    updateActiveNavButton(sectionId) {
        if (this.currentActiveSectionId === sectionId) return;
        this.currentActiveSectionId = sectionId;
        const navButtons = this.floatingNav.querySelectorAll('.nav-btn');
        let activeButton = null;
        
        navButtons.forEach(button => {
            const targetId = button.getAttribute('data-target');
            if (targetId === sectionId) {
                button.classList.add('active');
                activeButton = button;
            } else {
                button.classList.remove('active');
            }
        });
        
        if (activeButton) {
            // Use synchronized animation during scrolling
            const duration = this.isScrolling ? 800 : null;
            this.animateHighlight(activeButton, duration);
        }
    }

    animateHighlight(activeButton, duration = null) {
        const navButtonsContainer = this.floatingNav.querySelector('.nav-buttons');
        
        // Get button position and dimensions
        const buttonRect = activeButton.getBoundingClientRect();
        const containerRect = navButtonsContainer.getBoundingClientRect();
        
        const leftOffset = buttonRect.left - containerRect.left;
        const width = buttonRect.width;
        
        // Temporarily override transition duration if specified
        if (duration) {
            navButtonsContainer.style.setProperty('--highlight-transition-duration', `${duration}ms`);
        }
        
        // Use CSS custom properties to animate the highlight
        navButtonsContainer.style.setProperty('--highlight-left', `${leftOffset}px`);
        navButtonsContainer.style.setProperty('--highlight-width', `${width}px`);
        
        // Update the pseudo-element styles
        if (!navButtonsContainer.dataset.hasHighlight) {
            navButtonsContainer.dataset.hasHighlight = 'true';
            // Add dynamic styles for the highlight
            const style = document.createElement('style');
            style.textContent = `
                .nav-buttons[data-has-highlight="true"]::before {
                    opacity: 1;
                    left: var(--highlight-left, 8px);
                    width: var(--highlight-width, 0px);
                    transition: all var(--highlight-transition-duration, 0.8s) cubic-bezier(0.4, 0, 0.2, 1);
                }
            `;
            document.head.appendChild(style);
        }
        
        // Reset duration override after animation
        if (duration) {
            setTimeout(() => {
                navButtonsContainer.style.removeProperty('--highlight-transition-duration');
            }, duration + 100);
        }
    }

    scrollToSection(targetId) {
        const targetSection = document.getElementById(targetId);
        if (!targetSection) return;

        let scrollTarget = targetSection;

        // Handle special case for DPS/HPS button
        if (targetId === 'god-gamer-container') {
            const dpsSection = document.querySelector('.god-gamer-dps-section');
            const healerSection = document.querySelector('.god-gamer-healer-section');
            
            // Check if God Gamer sections are visible
            const godGamerVisible = (dpsSection && dpsSection.style.display !== 'none') || 
                                   (healerSection && healerSection.style.display !== 'none');
            
            // If God Gamer sections are not visible, scroll to main DPS/Healers section instead
            if (!godGamerVisible) {
                const mainRankingsContainer = document.querySelector('.rankings-container:not([class*="-container"])');
                if (mainRankingsContainer) {
                    scrollTarget = mainRankingsContainer;
                }
            }
        }

        // Calculate target position accounting for nav height
        const targetRect = scrollTarget.getBoundingClientRect();
        const currentScroll = window.pageYOffset;
        const navHeight = this.floatingNav.offsetHeight;
        const offset = 120; // Additional offset for spacing (100px more than before)
        
        const targetPosition = currentScroll + targetRect.top - navHeight - offset;
        
        // Update active button immediately with synchronized animation
        this.updateActiveNavButton(targetId);
        
        // Smooth scroll with custom easing
        this.smoothScrollTo(targetPosition, 800);
    }
    smoothScrollTo(targetPosition, duration = 800) {
        const startPosition = window.pageYOffset;
        const distance = targetPosition - startPosition;
        let start = null;

        // Set scrolling state to prevent intersection observer interference
        this.isScrolling = true;
        
        // Clear any existing scroll timeout
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
        }

        // Easing function (ease-in-out cubic)
        const easeInOutCubic = (t) => {
            return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
        };

        const step = (timestamp) => {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            const easedProgress = easeInOutCubic(progress);
            
            window.scrollTo(0, startPosition + distance * easedProgress);
            
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                // Scroll complete - re-enable intersection observer after a small delay
                this.scrollTimeout = setTimeout(() => {
                    this.isScrolling = false;
                }, 200);
            }
        };

        requestAnimationFrame(step);
    }

    initializeHighlight() {
        // Find the initially active button and set up highlight
        const activeButton = this.floatingNav.querySelector('.nav-btn.active');
        if (activeButton) {
            this.animateHighlight(activeButton);
        }
    }

    storeOriginalPosition() {
        // Store the original Y position of the nav for scroll calculations
        // Make sure the nav is in its static position first
        this.floatingNav.classList.remove('floating', 'attached');
        this.floatingNav.style.top = '';
        
        // Force a reflow to ensure proper positioning
        this.floatingNav.offsetHeight;
        
        const rect = this.floatingNav.getBoundingClientRect();
        this.navOriginalTop = rect.top + window.pageYOffset;
        
        console.log('Stored nav original position:', this.navOriginalTop);
    }
    async loadRaidLogsData() {
        if (this._loadingRaid) return;
        this._loadingRaid = true;
        // Prefer URL param /event/:eventId/raidlogs; fallback to localStorage
        let eventIdFromUrl = null;
        try {
            const parts = window.location.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('event');
            if (idx >= 0 && parts[idx + 1]) {
                eventIdFromUrl = parts[idx + 1];
            }
        } catch {}

        const prevEventId = this.activeEventId;
        this.activeEventId = eventIdFromUrl || localStorage.getItem('activeEventSession');

        // Normalize URL without hard reload; add guard to avoid redirect loops
        try {
            const parts = window.location.pathname.split('/').filter(Boolean);
            const isEventScoped = parts.includes('event') && parts[parts.indexOf('event') + 1];
            const isRaidLogsPage = parts.includes('raidlogs');
            const currentPath = window.location.pathname;
            const triedKey = `rl_norm_${this.activeEventId}`;
            if (!isEventScoped && isRaidLogsPage && this.activeEventId) {
                if (!sessionStorage.getItem(triedKey)) {
                    sessionStorage.setItem(triedKey, '1');
                    try {
                        history.replaceState({}, '', `/event/${this.activeEventId}/raidlogs`);
                        if (typeof updateRaidBar === 'function') setTimeout(() => updateRaidBar(), 0);
                    } catch (_) {
                        // As a last resort, only hard redirect once from the unscoped page
                        if (currentPath === '/raidlogs') {
                            window.location.replace(`/event/${this.activeEventId}/raidlogs`);
                            return;
                        }
                    }
                }
            }
        } catch {}

        if (eventIdFromUrl) {
            localStorage.setItem('activeEventSession', eventIdFromUrl);
            if (typeof updateRaidBar === 'function') {
                setTimeout(() => updateRaidBar(), 0);
            }
        }
        
        // Ensure live updates stream is connected once eventId is known; resubscribe if changed
        try {
            if (this.activeEventId && this._esEventId !== this.activeEventId) {
                if (this._es) { try { this._es.close(); } catch {} }
                this._esEventId = this.activeEventId;
                this.initializeLiveUpdates();
            }
        } catch {}

        if (!this.activeEventId) {
            this.showNoData('No active raid session found');
            return;
        }

        console.log(`📊 Loading raid logs data for event: ${this.activeEventId}`);
        
        this.showLoading();
        
        try {
            // First, check snapshot/lock status
            await this.fetchSnapshotStatus();
            // Try canonical rewards engine
            try {
                const resp = await fetch(`/api/rewards/${this.activeEventId}/effective`).catch(()=>null);
                if (resp && resp.ok) {
                    const eff = await resp.json();
                    if (eff && eff.success) {
                        this.engineResult = eff;
                        if (eff.mode === 'manual') {
                            // Sync UI to manual if engine reports snapshot materialized
                            this.snapshotLocked = true;
                        }
                        this.updateModeBadge();
                    }
                }
            } catch {}

            // To avoid exhausting browser/Heroku resources, fetch in small batches instead of all-at-once
            // Batch 1: core datasets and light endpoints
            await Promise.all([
                this.fetchLogData(),
                this.fetchRaidStats(),
                this.fetchRewardSettings(),
                this.fetchCurrentUser()
            ]);
            
            // Load primary roles before filtering players (critical timing)
            this.primaryRoles = await this.fetchPrimaryRoles();

            // Batch 2: combat/points datasets
            await Promise.all([
                this.fetchAbilitiesData(),
                this.fetchManaPotionsData(),
                this.fetchRunesData(),
                this.fetchInterruptsData(),
                this.fetchDisarmsData(),
                this.fetchConfirmedAssignmentsData(),
                this.fetchSunderData(),
                this.fetchCurseData(),
                this.fetchCurseShadowData(),
                this.fetchCurseElementsData(),
                this.fetchFaerieFireData(),
                this.fetchScorchData(),
                this.fetchDemoShoutData(),
                this.fetchPolymorphData(),
                this.fetchPowerInfusionData(),
                this.fetchDecursesData(),
                this.fetchVoidDamageData(),
                this.fetchWindfuryData()
            ]);

            // Batch 3: auxiliary datasets and archives
            await Promise.all([
                this.fetchShameData(),
                this.fetchPlayerStreaksData(),
                this.fetchGuildMembersData(),
                this.fetchWeeklyNaxRaidsData(),
                this.fetchWorldBuffsData(),
                this.fetchFrostResistanceData(),
                this.fetchWorldBuffsArchiveUrl(),
                this.fetchFrostResistanceArchiveUrl(),
                this.fetchManualRewardsData(),
                this.fetchRocketHelmetData(),
                this.fetchGoldPot(),
                this.fetchBigBuyerData()
            ]);
            // Build dynamic player tabs/panels for current user before render
            this.buildPlayerPanels();
            // Remove non-player entities across datasets
            this.sanitizeDatasets();
            this.displayRaidLogs();
            // Display player mismatch warnings (roster vs logs comparison)
            this.displayPlayerMismatchWarnings();
            this.renderPlayerPanelsContent();
            try { if (typeof this.displayManualRewards === 'function') this.displayManualRewards(); } catch {}
            // Recompute totals with all data loaded
            this.updateTotalPointsCard();
            // Update gold cards after primary render
            this.updateGoldCards();
            // Points breakdown debug table removed
            
            // Highlight user's own character names with animation
            this.highlightMyCharacters();
            
            // Update the original position now that content is loaded
            setTimeout(() => {
                this.storeOriginalPosition();
            }, 100);
        } catch (error) {
            console.error('Error loading raid logs data:', error);
            this.showError('Failed to load raid logs data');
        } finally {
            this._loadingRaid = false;
        }
    }

    async fetchLogData() {
        console.log(`📖 Fetching log data for event: ${this.activeEventId}`);
        
        const response = await fetch(`/api/log-data/${this.activeEventId}`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch log data: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch log data');
        }
        
        this.logData = result.data || [];
        console.log(`📊 Loaded ${this.logData.length} log entries (enhanced with roster data)`);
    }

    async fetchRaidStats() {
        console.log(`📊 Fetching raid statistics for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/raid-stats/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch raid stats: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch raid stats');
            }
            
            this.raidStats = result.data || {};
            console.log(`📊 Loaded raid statistics:`, this.raidStats);
            
            // Update stat cards immediately
            this.updateStatCards();
            
        } catch (error) {
            console.error('Error fetching raid statistics:', error);
            // Don't fail the whole page if stats fail - just show default values
            this.raidStats = {};
            this.updateStatCards();
        }
    }

    async fetchAbilitiesData() {
        console.log(`💣 Fetching abilities data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/abilities-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch abilities data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch abilities data');
            }
            
            this.abilitiesData = result.data || [];
            this.abilitiesSettings = result.settings || { calculation_divisor: 10, max_points: 20 };
            console.log(`💣 Loaded abilities data:`, this.abilitiesData);
            console.log(`💣 Loaded abilities settings:`, this.abilitiesSettings);
            
        } catch (error) {
            console.error('Error fetching abilities data:', error);
            // Don't fail the whole page if abilities fail - just show empty data
            this.abilitiesData = [];
            this.abilitiesSettings = { calculation_divisor: 10, max_points: 20 }; // fallback
        }
    }

    async fetchRewardSettings() {
        console.log(`🏆 Fetching reward settings...`);
        
        try {
            const response = await fetch(`/api/reward-settings`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch reward settings: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch reward settings');
            }
            
            this.rewardSettings = result.settings || {};
            console.log(`🏆 Loaded reward settings:`, this.rewardSettings);
            
        } catch (error) {
            console.error('Error fetching reward settings:', error);
            // Don't fail the whole page if settings fail - use fallback values
            this.rewardSettings = {
                damage: { points_array: [80, 70, 55, 40, 35, 30, 25, 20, 15, 10, 8, 6, 5, 4, 3] },
                healing: { points_array: [80, 65, 60, 55, 40, 35, 30, 20, 15, 10] },
                abilities: { calculation_divisor: 10, max_points: 20 }
            };
        }
    }
    async fetchSnapshotStatus() {
        if (!this.activeEventId) return;
        try {
            const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/status`);
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.success) {
                this.snapshotLocked = !!data.locked;
                this.snapshotLockedAt = data.lockedAt || null;
                this.snapshotLockedBy = data.lockedByName || null;
                console.log(`[SNAPSHOT] Mode: ${this.snapshotLocked ? 'Manual' : 'Computed'}`, { at: this.snapshotLockedAt, by: this.snapshotLockedBy });
                this.updateModeBadge();
                if (this.snapshotLocked) {
                    await this.fetchSnapshotData();
                    // Fix: if marked locked but no entries exist, treat as not locked to force full lock on first save
                    if (!this.snapshotEntries || this.snapshotEntries.length === 0) {
                        console.warn('[SNAPSHOT] Locked status with zero entries; treating as computed until full lock');
                        this.snapshotLocked = false;
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ [SNAPSHOT] Failed to get status', e);
        }
    }
    async fetchSnapshotData() {
        try {
            const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}`);
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success) return;
            this.snapshotEntries = data.data || [];
            console.log(`📦 [SNAPSHOT] Loaded ${this.snapshotEntries.length} entries`);
        } catch (e) {
            console.warn('⚠️ [SNAPSHOT] Failed to fetch snapshot entries', e);
        }
    }

    updateModeBadge() {
        const badge = document.getElementById('computed-manual-badge');
        if (!badge) return;
        
        // Determine current states
        const isComputedMode = !this.snapshotLocked;
        const isManualMode = this.snapshotLocked;
        const isPublished = !!(this.snapshotHeader && this.snapshotHeader.published);
        
        // Update badge
        if (this.snapshotLocked) {
            badge.innerHTML = '<i class="fas fa-user-edit" style="margin-right:6px"></i> Manual mode';
            const by = this.snapshotLockedBy ? ` by ${this.snapshotLockedBy}` : '';
            const at = this.snapshotLockedAt ? ` at ${new Date(this.snapshotLockedAt).toLocaleString()}` : '';
            badge.title = `View audit: locked${by}${at}`.trim();
            badge.classList.add('manual');
            badge.classList.remove('computed');

            // Ensure top controls revert button is visible and wired
            try {
                const revertBtn = document.getElementById('mode-revert-btn');
                if (revertBtn) {
                    revertBtn.style.display = 'inline-flex';
                    if (!revertBtn._wired) {
                        revertBtn.addEventListener('click', async () => {
                            const ok = confirm('Are you sure you want to reset all manual edits and revert to computed mode?');
                            if (!ok) return;
                            try {
                                const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/unlock`, { method: 'POST' });
                                if (res.ok) {
                                    this.snapshotLocked = false;
                                    this.snapshotEntries = [];
                                    this.updateModeBadge();
                                    window.location.reload();
                                }
                            } catch (e) { console.error('❌ [SNAPSHOT] Revert failed', e); }
                        });
                        revertBtn._wired = true;
                    }
                }
            } catch {}
        } else {
            badge.innerHTML = '<i class="fas fa-microchip" style="margin-right:6px"></i> Computed mode';
            badge.title = 'Live computed from logs and data sources';
            badge.classList.add('computed');
            badge.classList.remove('manual');
            const revertBtn = document.getElementById('mode-revert-btn');
            if (revertBtn) revertBtn.style.display = 'none';
        }

        // Update top banner with clear status indicators
        try {
            const top = document.getElementById('engineBannerTop');
            if (top) {
                const statusHTML = `
                    <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: 600;">Status:</span>
                            <span style="padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; background: ${isComputedMode ? '#22c55e' : '#ef4444'}; color: white;">
                                Computed Mode: ${isComputedMode ? 'TRUE' : 'FALSE'}
                            </span>
                            <span style="padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; background: ${isManualMode ? '#22c55e' : '#ef4444'}; color: white;">
                                Manual Mode: ${isManualMode ? 'TRUE' : 'FALSE'}
                            </span>
                            <span style="padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; background: ${isPublished ? '#22c55e' : '#ef4444'}; color: white;">
                                Published: ${isPublished ? 'TRUE' : 'FALSE'}
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <a href="/event/${this.activeEventId}/debug-table" target="_blank" rel="noopener noreferrer" 
                               style="padding: 4px 12px; background: #3b82f6; color: white; border-radius: 4px; text-decoration: none; font-size: 13px; font-weight: 600;">
                                📊 View Database Table
                            </a>
                        </div>
                    </div>
                `;
                top.innerHTML = statusHTML;
                top.style.display = 'flex';
                top.style.padding = '12px 20px';
                top.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                top.style.borderRadius = '8px';
                top.style.marginBottom = '20px';
            }
        } catch (e) {
            console.error('Error updating status banner:', e);
        }
    }

    async fetchWorldBuffsData() {
        console.log(`🌍 Fetching world buffs data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/world-buffs-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch world buffs data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch world buffs data');
            }
            
            this.worldBuffsData = result.data || [];
            this.worldBuffsRequiredBuffs = result.requiredBuffs || 6;
            this.worldBuffsChannelId = result.channelId;
            this.worldBuffsIncludeDMF = result.includeDMF || false;
            console.log(`🌍 Loaded world buffs data:`, this.worldBuffsData);
            console.log(`🌍 Required buffs for this event: ${this.worldBuffsRequiredBuffs}`);
            console.log(`🌍 Include DMF in missing buffs: ${this.worldBuffsIncludeDMF}`);
            
        } catch (error) {
            console.error('Error fetching world buffs data:', error);
            // Don't fail the whole page if world buffs fail - just show empty data
            this.worldBuffsData = [];
            this.worldBuffsRequiredBuffs = 6;
            this.worldBuffsIncludeDMF = false;
        }
    }

    async fetchFrostResistanceData() {
        console.log(`🧊 Fetching frost resistance data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/frost-resistance-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch frost resistance data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch frost resistance data');
            }
            
            this.frostResistanceData = result.data || [];
            this.maxFrostResistance = result.maxFrostResistance || 0;
            console.log(`🧊 Loaded frost resistance data:`, this.frostResistanceData);
            console.log(`🧊 Max frost resistance: ${this.maxFrostResistance}`);
            
        } catch (error) {
            console.error('Error fetching frost resistance data:', error);
            // Don't fail the whole page if frost resistance fails - just show empty data
            this.frostResistanceData = [];
            this.maxFrostResistance = 0;
        }
    }

    async fetchWorldBuffsArchiveUrl() {
        console.log(`🌍 Fetching world buffs archive URL for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/rpb-tracking/${this.activeEventId}?analysisType=world_buffs`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch world buffs archive URL: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.hasData && result.archiveUrl) {
                this.worldBuffsArchiveUrl = result.archiveUrl;
                console.log(`🌍 Loaded world buffs archive URL: ${this.worldBuffsArchiveUrl}`);
            } else {
                console.log(`🌍 No world buffs archive URL found for event: ${this.activeEventId}`);
                this.worldBuffsArchiveUrl = null;
            }
            
        } catch (error) {
            console.error('Error fetching world buffs archive URL:', error);
            this.worldBuffsArchiveUrl = null;
        }
    }

    async fetchFrostResistanceArchiveUrl() {
        console.log(`🧊 Fetching frost resistance archive URL for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/rpb-tracking/${this.activeEventId}?analysisType=frost_resistance`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch frost resistance archive URL: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.hasData && result.archiveUrl) {
                this.frostResistanceArchiveUrl = result.archiveUrl;
                console.log(`🧊 Loaded frost resistance archive URL: ${this.frostResistanceArchiveUrl}`);
            } else {
                console.log(`🧊 No frost resistance archive URL found for event: ${this.activeEventId}`);
                this.frostResistanceArchiveUrl = null;
            }
            
        } catch (error) {
            console.error('Error fetching frost resistance archive URL:', error);
            this.frostResistanceArchiveUrl = null;
        }
    }

    async fetchManaPotionsData() {
        console.log(`🧪 Fetching mana potions data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/mana-potions-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch mana potions data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch mana potions data');
            }
            
            this.manaPotionsData = result.data || [];
            this.manaPotionsSettings = result.settings || { threshold: 10, potions_per_point: 3, max_points: 10 };
            console.log(`🧪 Loaded mana potions data:`, this.manaPotionsData);
            console.log(`🧪 Loaded mana potions settings:`, this.manaPotionsSettings);
            
        } catch (error) {
            console.error('Error fetching mana potions data:', error);
            // Don't fail the whole page if mana potions fail - just show empty data
            this.manaPotionsData = [];
            this.manaPotionsSettings = { threshold: 10, potions_per_point: 3, max_points: 10 }; // fallback
        }
    }

    async fetchRocketHelmetData() {
        console.log(`🚀 Fetching Rocket Helmet data for event: ${this.activeEventId}`);
        try {
            const resp = await fetch(`/api/event-endpoints-json/${this.activeEventId}`);
            if (!resp.ok) throw new Error(`Failed to fetch event endpoints json: ${resp.status}`);
            const body = await resp.json();
            const d = body && body.data;
            const w = d && d.wcl_summary_json;
            const users = new Set();
            const wanted = 'Goblin Rocket Helmet';
            function walk(node){
                if(!node||typeof node!=='object') return;
                if(node.combatantInfo && Array.isArray(node.combatantInfo.gear) && (node.name||node.playerName||node.characterName)){
                    const gear = node.combatantInfo.gear;
                    if(gear.some(it=>it&&it.name===wanted)){
                        users.add(String(node.name||node.playerName||node.characterName));
                    }
                }
                if(Array.isArray(node)){
                    node.forEach(walk);
                } else {
                    Object.values(node).forEach(walk);
                }
            }
            walk(w);
            // Normalize into ranking objects with fixed +5 points; attach class from friendlies list if available
            const fightsJson = d && d.fights_json;
            const friendlies = (fightsJson && Array.isArray(fightsJson.friendlies)) ? fightsJson.friendlies : [];
            const nameToClass = new Map();
            if (Array.isArray(friendlies)) {
                friendlies.forEach(f => {
                    if (f && f.name && f.type) nameToClass.set(String(f.name), String(f.type));
                });
            }
            this.rocketHelmetData = Array.from(users).map(name => ({ character_name: name, character_class: nameToClass.get(name) || 'Unknown', points: 5 }));
            console.log('🚀 Rocket Helmet users:', this.rocketHelmetData);
        } catch (err) {
            console.error('Error fetching Rocket Helmet data:', err);
            this.rocketHelmetData = [];
        }
    }

    async fetchRunesData() {
        console.log(`🔮 Fetching runes data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/runes-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch runes data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch runes data');
            }
            
            this.runesData = result.data || [];
            this.runesSettings = result.settings || { usage_divisor: 2, points_per_division: 1 };
            console.log(`🔮 Loaded runes data:`, this.runesData);
            console.log(`🔮 Loaded runes settings:`, this.runesSettings);
            
        } catch (error) {
            console.error('Error fetching runes data:', error);
            // Don't fail the whole page if runes fail - just show empty data
            this.runesData = [];
            this.runesSettings = { usage_divisor: 2, points_per_division: 1 }; // fallback
        }
    }
    async fetchInterruptsData() {
        console.log(`⚡ Fetching interrupts data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/interrupts-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch interrupts data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch interrupts data');
            }
            
            this.interruptsData = result.data || [];
            this.interruptsSettings = result.settings || { points_per_interrupt: 1, interrupts_needed: 1, max_points: 5 };
            console.log(`⚡ Loaded interrupts data:`, this.interruptsData);
            console.log(`⚡ Loaded interrupts settings:`, this.interruptsSettings);
            
        } catch (error) {
            console.error('Error fetching interrupts data:', error);
            // Don't fail the whole page if interrupts fail - just show empty data
            this.interruptsData = [];
            this.interruptsSettings = { points_per_interrupt: 1, interrupts_needed: 1, max_points: 5 }; // fallback
        }
    }

    async fetchDisarmsData() {
        console.log(`🛡️ Fetching disarms data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/disarms-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch disarms data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch disarms data');
            }
            
            this.disarmsData = result.data || [];
            this.disarmsSettings = result.settings || { points_per_disarm: 1, disarms_needed: 1, max_points: 5 };
            console.log(`🛡️ Loaded disarms data:`, this.disarmsData);
            console.log(`🛡️ Loaded disarms settings:`, this.disarmsSettings);
            
        } catch (error) {
            console.error('Error fetching disarms data:', error);
            // Don't fail the whole page if disarms fail - just show empty data
            this.disarmsData = [];
            this.disarmsSettings = { points_per_disarm: 1, disarms_needed: 1, max_points: 5 }; // fallback
        }
    }
    
    async fetchConfirmedAssignmentsData() {
        console.log(`📝 [CONFIRMED ASSIGNMENTS] Fetching data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/confirmed-assignments/${this.activeEventId}`);
            
            if (!response.ok) {
                console.error(`📝 [CONFIRMED ASSIGNMENTS] API returned status: ${response.status}`);
                throw new Error(`Failed to fetch confirmed assignments data: ${response.status}`);
            }
            
            const result = await response.json();
            console.log(`📝 [CONFIRMED ASSIGNMENTS] API response:`, result);
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch confirmed assignments data');
            }
            
            this.confirmedAssignmentsData = result.data || [];
            console.log(`📝 [CONFIRMED ASSIGNMENTS] Loaded ${this.confirmedAssignmentsData.length} players who confirmed all assignments:`, this.confirmedAssignmentsData);
            
        } catch (error) {
            console.error('📝 [CONFIRMED ASSIGNMENTS] Error fetching data:', error);
            // Don't fail the whole page if confirmed assignments fail - just show empty data
            this.confirmedAssignmentsData = [];
        }
    }
    
    async fetchSunderData() {
        console.log(`⚔️ Fetching sunder armor data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/sunder-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch sunder data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch sunder data');
            }
            
            this.sunderData = result.data || [];
            this.sunderSettings = result.settings || { point_ranges: [] };
            console.log(`⚔️ Loaded sunder data:`, this.sunderData);
            console.log(`⚔️ Loaded sunder settings:`, this.sunderSettings);
            
        } catch (error) {
            console.error('Error fetching sunder data:', error);
            // Don't fail the whole page if sunder fails - just show empty data
            this.sunderData = [];
            this.sunderSettings = { point_ranges: [] }; // fallback
        }
    }
    async fetchCurseData() {
        console.log(`🔮 Fetching curse of recklessness data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/curse-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch curse data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch curse data');
            }
            
            this.curseData = result.data || [];
            this.curseSettings = result.settings || { uptime_threshold: 85, points: 10 };
            console.log(`🔮 Loaded curse data:`, this.curseData);
            console.log(`🔮 Loaded curse settings:`, this.curseSettings);
            
        } catch (error) {
            console.error('Error fetching curse data:', error);
            // Don't fail the whole page if curse fails - just show empty data
            this.curseData = [];
            this.curseSettings = { uptime_threshold: 85, points: 10 }; // fallback
        }
    }

    async fetchCurseShadowData() {
        console.log(`🌑 Fetching curse of shadow data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/curse-shadow-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch curse shadow data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch curse shadow data');
            }
            
            this.curseShadowData = result.data || [];
            this.curseShadowSettings = result.settings || { uptime_threshold: 85, points: 10 };
            console.log(`🌑 Loaded curse shadow data:`, this.curseShadowData);
            console.log(`🌑 Loaded curse shadow settings:`, this.curseShadowSettings);
            
        } catch (error) {
            console.error('Error fetching curse shadow data:', error);
            // Don't fail the whole page if curse shadow fails - just show empty data
            this.curseShadowData = [];
            this.curseShadowSettings = { uptime_threshold: 85, points: 10 }; // fallback
        }
    }

    async fetchCurseElementsData() {
        console.log(`❄️ Fetching curse of elements data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/curse-elements-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch curse elements data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch curse elements data');
            }
            
            this.curseElementsData = result.data || [];
            this.curseElementsSettings = result.settings || { uptime_threshold: 85, points: 10 };
            console.log(`❄️ Loaded curse elements data:`, this.curseElementsData);
            console.log(`❄️ Loaded curse elements settings:`, this.curseElementsSettings);
            
        } catch (error) {
            console.error('Error fetching curse elements data:', error);
            // Don't fail the whole page if curse elements fails - just show empty data
            this.curseElementsData = [];
            this.curseElementsSettings = { uptime_threshold: 85, points: 10 }; // fallback
        }
    }
    async fetchFaerieFireData() {
        console.log(`🌟 Fetching faerie fire data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/faerie-fire-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch faerie fire data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch faerie fire data');
            }
            
            this.faerieFireData = result.data || [];
            this.faerieFireSettings = result.settings || { uptime_threshold: 85, points: 10 };
            console.log(`🌟 Loaded faerie fire data:`, this.faerieFireData);
            console.log(`🌟 Loaded faerie fire settings:`, this.faerieFireSettings);
            
        } catch (error) {
            console.error('Error fetching faerie fire data:', error);
            // Don't fail the whole page if faerie fire fails - just show empty data
            this.faerieFireData = [];
            this.faerieFireSettings = { uptime_threshold: 85, points: 10 }; // fallback
        }
    }

    async fetchScorchData() {
        console.log(`🔥 Fetching scorch data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/scorch-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch scorch data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch scorch data');
            }
            
            this.scorchData = result.data || [];
            this.scorchSettings = result.settings || { tier1_max: 99, tier1_points: 0, tier2_max: 199, tier2_points: 5, tier3_points: 10 };
            console.log(`🔥 Loaded scorch data:`, this.scorchData);
            console.log(`🔥 Loaded scorch settings:`, this.scorchSettings);
            
        } catch (error) {
            console.error('Error fetching scorch data:', error);
            // Don't fail the whole page if scorch fails - just show empty data
            this.scorchData = [];
            this.scorchSettings = { tier1_max: 99, tier1_points: 0, tier2_max: 199, tier2_points: 5, tier3_points: 10 }; // fallback
        }
    }

    async fetchDemoShoutData() {
        console.log(`⚔️ Fetching demoralizing shout data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/demo-shout-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch demoralizing shout data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch demoralizing shout data');
            }
            
            this.demoShoutData = result.data || [];
            this.demoShoutSettings = result.settings || { tier1_max: 99, tier1_points: 0, tier2_max: 199, tier2_points: 5, tier3_points: 10 };
            console.log(`⚔️ Loaded demoralizing shout data:`, this.demoShoutData);
            console.log(`⚔️ Loaded demoralizing shout settings:`, this.demoShoutSettings);
            
        } catch (error) {
            console.error('Error fetching demoralizing shout data:', error);
            // Don't fail the whole page if demoralizing shout fails - just show empty data
            this.demoShoutData = [];
            this.demoShoutSettings = { tier1_max: 99, tier1_points: 0, tier2_max: 199, tier2_points: 5, tier3_points: 10 }; // fallback
        }
    }

    async fetchPolymorphData() {
        console.log(`🔮 Fetching polymorph data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/polymorph-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch polymorph data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch polymorph data');
            }
            
            this.polymorphData = result.data || [];
            this.polymorphSettings = result.settings || { points_per_division: 1, polymorphs_needed: 2, max_points: 5 };
            console.log(`🔮 Loaded polymorph data:`, this.polymorphData);
            console.log(`🔮 Loaded polymorph settings:`, this.polymorphSettings);
            
        } catch (error) {
            console.error('Error fetching polymorph data:', error);
            // Don't fail the whole page if polymorph fails - just show empty data
            this.polymorphData = [];
            this.polymorphSettings = { points_per_division: 1, polymorphs_needed: 2, max_points: 5 }; // fallback
        }
    }

    async fetchPowerInfusionData() {
        console.log(`💫 Fetching power infusion data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/power-infusion-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch power infusion data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch power infusion data');
            }
            
            this.powerInfusionData = result.data || [];
            this.powerInfusionSettings = result.settings || { points_per_division: 1, infusions_needed: 2, max_points: 10 };
            console.log(`💫 Loaded power infusion data:`, this.powerInfusionData);
            console.log(`💫 Loaded power infusion settings:`, this.powerInfusionSettings);
            
        } catch (error) {
            console.error('Error fetching power infusion data:', error);
            // Don't fail the whole page if power infusion fails - just show empty data
            this.powerInfusionData = [];
            this.powerInfusionSettings = { points_per_division: 1, infusions_needed: 2, max_points: 10 }; // fallback
        }
    }

    async fetchDecursesData() {
        console.log(`🪄 Fetching decurses data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/decurses-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch decurses data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch decurses data');
            }
            
            this.decursesData = result.data || [];
            this.decursesSettings = result.settings || { points_per_division: 1, decurses_needed: 3, max_points: 10, min_points: -10, average_decurses: 0 };
            console.log(`🪄 Loaded decurses data:`, this.decursesData);
            console.log(`🪄 Loaded decurses settings:`, this.decursesSettings);
            
        } catch (error) {
            console.error('Error fetching decurses data:', error);
            // Don't fail the whole page if decurses fails - just show empty data
            this.decursesData = [];
            this.decursesSettings = { points_per_division: 1, decurses_needed: 3, max_points: 10, min_points: -10, average_decurses: 0 }; // fallback
        }
    }

    async fetchPrimaryRoles() {
        if (!this.activeEventId) {
            console.log('🎯 [PRIMARY ROLES] No active event ID');
            return null;
        }

        try {
            console.log(`🎯 [PRIMARY ROLES] Fetching primary roles for event: ${this.activeEventId}`);
            const response = await fetch(`/api/player-role-mapping/${this.activeEventId}/primary-roles`);
            
            if (!response.ok) {
                console.log(`🎯 [PRIMARY ROLES] No primary roles data available (${response.status})`);
                return null;
            }
            
            const data = await response.json();
            
            if (data.success && data.primaryRoles) {
                console.log(`✅ [PRIMARY ROLES] Loaded ${data.count} primary roles`);
                return data.primaryRoles;
            } else {
                console.log('🎯 [PRIMARY ROLES] No primary roles in response');
                return null;
            }
        } catch (error) {
            console.error('❌ [PRIMARY ROLES] Error fetching primary roles:', error);
            return null;
        }
    }
    async fetchVoidDamageData() {
        if (!this.activeEventId) {
            console.log('💜 [VOID DAMAGE] No active event ID');
            return;
        }

        try {
            console.log(`💜 [VOID DAMAGE] Fetching void damage data for event: ${this.activeEventId}`);
            const response = await fetch(`/api/void-damage/${this.activeEventId}`);
            
            if (!response.ok) {
                console.log(`💜 [VOID DAMAGE] No void damage data available (${response.status})`);
                this.voidDamageData = [];
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.voidDamageData = data.data || [];
                if (data.settings) {
                    this.voidDamageSettings = { ...this.voidDamageSettings, ...data.settings };
                }
                console.log(`✅ [VOID DAMAGE] Loaded ${this.voidDamageData.length} players with void damage`);
            } else {
                console.log('💜 [VOID DAMAGE] Failed to load void damage data');
                this.voidDamageData = [];
            }
        } catch (error) {
            console.error('❌ [VOID DAMAGE] Error fetching void damage data:', error);
            this.voidDamageData = [];
        }
    }

    async fetchWindfuryData() {
        console.log(`🌀 Fetching Windfury Totem data for event: ${this.activeEventId}`);
        try {
            const response = await fetch(`/api/windfury-data/${this.activeEventId}`);
            if (!response.ok) throw new Error(`Failed to fetch windfury data: ${response.status}`);
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Failed to fetch windfury data');
            this.windfuryData = result.data || [];
            this.windfurySettings = result.settings || { threshold: 10, points_per_totem: 1, max_points: 10 };
            console.log(`🌀 Loaded windfury data:`, this.windfuryData);
        } catch (error) {
            console.error('Error fetching windfury data:', error);
            this.windfuryData = [];
            this.windfurySettings = { threshold: 10, points_per_totem: 1, max_points: 10 };
        }
    }

    async fetchBigBuyerData() {
        if (!this.activeEventId) return;
        try {
            const res = await fetch(`/api/big-buyer/${this.activeEventId}`);
            if (!res.ok) { this.bigBuyerData = []; return; }
            const data = await res.json();
            if (data && data.success) {
                this.bigBuyerData = data.data || [];
            } else {
                this.bigBuyerData = [];
            }
        } catch (e) {
            console.error('❌ [BIG BUYER] Fetch failed', e);
            this.bigBuyerData = [];
        }
    }

    async fetchShameData() {
        console.log(`💀 Fetching shame data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/shame-data/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch shame data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch shame data');
            }
            
            this.shameData = result.data || {};
            console.log(`💀 Loaded shame data:`, this.shameData);
            
        } catch (error) {
            console.error('Error fetching shame data:', error);
            // Don't fail the whole page if shame data fails - just show empty data
            this.shameData = {};
        }
    }

    async fetchPlayerStreaksData() {
        console.log(`🔥 Fetching player streaks data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/player-streaks/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch player streaks data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch player streaks data');
            }
            
            this.playerStreaksData = result.data || [];
            console.log(`🔥 Loaded player streaks data:`, this.playerStreaksData);
            console.log(`🔥 Found ${this.playerStreaksData.length} players with streak >= 4`);
            
        } catch (error) {
            console.error('Error fetching player streaks data:', error);
            // Don't fail the whole page if player streaks fails - just show empty data
            this.playerStreaksData = [];
        }
    }

    async fetchGuildMembersData() {
        console.log(`🏰 Fetching guild members data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/guild-members/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch guild members data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch guild members data');
            }
            
            this.guildMembersData = result.data || [];
            console.log(`🏰 Loaded guild members data:`, this.guildMembersData);
            console.log(`🏰 Found ${this.guildMembersData.length} guild members in raid`);
            
        } catch (error) {
            console.error('Error fetching guild members data:', error);
            // Don't fail the whole page if guild members fails - just show empty data
            this.guildMembersData = [];
        }
    }

    async fetchWeeklyNaxRaidsData() {
        console.log(`🏆 Fetching weekly NAX raids data for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/weekly-nax-raids/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch weekly NAX raids data: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch weekly NAX raids data');
            }
            
            this.weeklyNaxRaidsData = result.data || [];
            console.log(`🏆 Loaded weekly NAX raids data:`, this.weeklyNaxRaidsData);
            console.log(`🏆 Found ${this.weeklyNaxRaidsData.length} players with 2+ NAX raids this week`);
            
        } catch (error) {
            console.error('Error fetching weekly NAX raids data:', error);
            // Don't fail the whole page if weekly NAX fails - just show empty data
            this.weeklyNaxRaidsData = [];
        }
    }

    updateStatCards() {
        // Update RPB Archive card
        this.updateRPBArchiveCard();
        
        // Update Raid Duration card
        this.updateRaidDurationCard();
        
        // Update Bosses Killed card
        this.updateBossesKilledCard();
        
        // Update Last Boss card
        this.updateLastBossCard();
        
        // Update WoW Logs card
        this.updateWoWLogsCard();
        
        // Update Total Points card
        this.updateTotalPointsCard();
    }

    updateRPBArchiveCard() {
        const button = document.getElementById('rpb-archive-button');
        const detail = document.getElementById('rpb-archive-detail');
        
        if (this.raidStats.rpb && this.raidStats.rpb.archiveUrl) {
            // Enable button and set URL
            button.disabled = false;
            button.onclick = () => window.open(this.raidStats.rpb.archiveUrl, '_blank');
            
            // Update detail text
            if (this.raidStats.rpb.archiveName) {
                detail.textContent = this.raidStats.rpb.archiveName;
            } else {
                detail.textContent = 'Archive available';
            }
        } else {
            // Keep button disabled
            button.disabled = true;
            detail.textContent = 'No archive available';
        }
    }

    updateRaidDurationCard() {
        const valueElement = document.getElementById('raid-duration-value');
        const detailElement = document.getElementById('raid-duration-detail');
        const refreshBtn = document.getElementById('refresh-duration-btn');
        
        if (this.raidStats.stats && this.raidStats.stats.totalTime) {
            const hours = Math.floor(this.raidStats.stats.totalTime / 60);
            const minutes = this.raidStats.stats.totalTime % 60;
            
            // Format as "2h 35m" for values over 60 minutes, otherwise just "89m"
            if (hours > 0) {
                valueElement.textContent = `${hours}h ${minutes}m`;
            } else {
                valueElement.textContent = `${this.raidStats.stats.totalTime}m`;
            }
            
            // Show source in detail
            if (this.raidStats.stats.durationSource === 'rpb') {
                detailElement.textContent = 'From RPB sheet';
            } else if (this.raidStats.stats.activeFightTime) {
                detailElement.textContent = `${this.raidStats.stats.activeFightTime}m active fight time`;
            } else {
                detailElement.textContent = 'Total raid duration';
            }
        } else {
            valueElement.textContent = '--';
            detailElement.textContent = 'Minutes';
        }
        
        // Show refresh button if there's an RPB archive URL (can refresh duration from sheet)
        if (refreshBtn && this.raidStats.rpb && this.raidStats.rpb.archiveUrl) {
            refreshBtn.style.display = 'block';
            refreshBtn.onclick = () => this.refreshDurationFromRPB();
        } else if (refreshBtn) {
            refreshBtn.style.display = 'none';
        }
    }
    
    async refreshDurationFromRPB() {
        const refreshBtn = document.getElementById('refresh-duration-btn');
        const detailElement = document.getElementById('raid-duration-detail');
        
        if (!this.activeEventId) {
            console.warn('No active event ID for duration refresh');
            return;
        }
        
        try {
            // Show loading state
            refreshBtn.disabled = true;
            refreshBtn.classList.add('spinning');
            detailElement.textContent = 'Refreshing...';
            
            const response = await fetch(`/api/refresh-rpb-duration/${this.activeEventId}`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Update the display with the new duration
                const valueElement = document.getElementById('raid-duration-value');
                const hours = Math.floor(result.durationMinutes / 60);
                const minutes = result.durationMinutes % 60;
                
                if (hours > 0) {
                    valueElement.textContent = `${hours}h ${minutes}m`;
                } else {
                    valueElement.textContent = `${result.durationMinutes}m`;
                }
                
                detailElement.textContent = 'From RPB sheet (refreshed)';
                
                // Update the internal state
                if (this.raidStats.stats) {
                    this.raidStats.stats.totalTime = result.durationMinutes;
                    this.raidStats.stats.durationSource = 'rpb';
                }
                
                console.log(`✅ Duration refreshed: ${result.durationString} (${result.durationMinutes}m)`);
            } else {
                detailElement.textContent = result.error || 'Refresh failed';
                console.warn('Duration refresh failed:', result.error);
            }
        } catch (error) {
            console.error('Error refreshing duration:', error);
            detailElement.textContent = 'Refresh error';
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('spinning');
        }
    }

    updateBossesKilledCard() {
        const valueElement = document.getElementById('bosses-killed-value');
        
        if (this.raidStats.stats && this.raidStats.stats.bossesKilled !== undefined) {
            valueElement.textContent = this.raidStats.stats.bossesKilled;
        } else {
            valueElement.textContent = '--';
        }
    }

    updateLastBossCard() {
        const valueElement = document.getElementById('last-boss-value');
        const detailElement = document.getElementById('last-boss-detail');
        
        if (this.raidStats.stats && this.raidStats.stats.lastBoss) {
            valueElement.textContent = this.raidStats.stats.lastBoss;
            detailElement.textContent = 'Final boss defeated';
        } else {
            valueElement.textContent = '--';
            detailElement.textContent = 'No boss data';
        }
    }

    updateWoWLogsCard() {
        const button = document.getElementById('wow-logs-button');
        const detail = document.getElementById('wow-logs-detail');
        
        if (this.raidStats.stats && this.raidStats.stats.logUrl) {
            // Enable button and set URL
            button.disabled = false;
            button.onclick = () => window.open(this.raidStats.stats.logUrl, '_blank');
            detail.textContent = 'View detailed logs';
        } else {
            // Keep button disabled
            button.disabled = true;
            detail.textContent = 'No logs available';
        }
    }
    updateTotalPointsCard() {
        const valueElement = document.getElementById('total-points-value');
        
        if (!valueElement) return;
        
        // Prefer canonical engine totals when available
        try {
            if (this.engineResult && this.engineResult.meta && typeof this.engineResult.meta.totalPointsAll === 'number') {
                valueElement.textContent = Number(this.engineResult.meta.totalPointsAll).toLocaleString();
                return;
            }
        } catch {}
        
        // If we already computed a per-player capped total elsewhere (e.g., breakdown table), prefer it
        if (typeof this.totalPointsComputed === 'number') {
            valueElement.textContent = Number(this.totalPointsComputed).toLocaleString();
            return;
        }

        try {
            // Calculate total points using the formula:
            // (Number of players in raid) × 100 + (all positive values) - (all negative values)
            
            // Get number of players from log data (exclude non-player entities)
            const numberOfPlayers = (this.logData || []).filter(p => !this.shouldIgnorePlayer(p.character_name)).length;
            
            // Base points = number of players × 100
            const basePoints = numberOfPlayers * 100;
            
            // Calculate points from all rankings on the page
            let positivePoints = 0;
            let negativePoints = 0;

            // Restrict all contributions to confirmed raiders (from logData) and exclude non-players
            const confirmedPlayersFiltered = (this.logData || []).filter(p => !this.shouldIgnorePlayer(p.character_name));
            const confirmedNameSet = new Set(confirmedPlayersFiltered.map(p => String(p.character_name || '').toLowerCase()));
            const confirmedDiscordSet = new Set(confirmedPlayersFiltered.map(p => String(p.discord_id || '')));
            
            // Add points from damage rankings (eligible DPS/Tank only, exclude ignored)
            if (this.logData && this.rewardSettings.damage && this.rewardSettings.damage.points_array) {
                const damagePoints = this.rewardSettings.damage.points_array;
                const eligibleDamage = (this.logData || [])
                    .filter(player => {
                        const role = (player.role_detected || '').toLowerCase();
                        const damage = parseInt(player.damage_amount) || 0;
                        const name = String(player.character_name || '');
                        return (role === 'dps' || role === 'tank') && damage > 0 && !this.shouldIgnorePlayer(name);
                    });
                const count = Math.min(eligibleDamage.length, damagePoints.length);
                for (let i = 0; i < count; i++) positivePoints += damagePoints[i];
            }
            
            // Add points from healing rankings (healers only, exclude ignored)
            if (this.logData && this.rewardSettings.healing && this.rewardSettings.healing.points_array) {
                const healingPoints = this.rewardSettings.healing.points_array;
                const healers = (this.logData || [])
                    .filter(player => {
                        const role = (player.role_detected || '').toLowerCase();
                        const healing = parseInt(player.healing_amount) || 0;
                        const name = String(player.character_name || '');
                        return role === 'healer' && healing > 0 && !this.shouldIgnorePlayer(name);
                    });
                const count = Math.min(healers.length, healingPoints.length);
                for (let i = 0; i < count; i++) positivePoints += healingPoints[i];
            }
            
            // Add points from abilities
            if (this.abilitiesData && this.abilitiesSettings) {
                this.abilitiesData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                    else if (player.points < 0) negativePoints += Math.abs(player.points);
                });
            }
            
            // Add points from mana potions
            if (this.manaPotionsData && this.manaPotionsSettings) {
                this.manaPotionsData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }

            // Add points from Windfury Totems
            if (this.windfuryData && Array.isArray(this.windfuryData)) {
                this.windfuryData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    const pts = Number(player.points) || 0;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }
            // Add points from Goblin Rocket Helmet (fixed +5)
            if (this.rocketHelmetData && Array.isArray(this.rocketHelmetData)) {
                this.rocketHelmetData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    const pts = 5;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }
            
            // Add points from runes
            if (this.runesData && this.runesSettings) {
                this.runesData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from interrupts
            if (this.interruptsData && this.interruptsSettings) {
                this.interruptsData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from disarms
            if (this.disarmsData && this.disarmsSettings) {
                this.disarmsData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from sunder armor (exclude tanks when primaryRoles available), computed vs average
            if (Array.isArray(this.sunderData)) {
                const eligible = this.sunderData.filter(row => {
                    const nm = String(row.character_name || '').toLowerCase();
                    if (this.primaryRoles) {
                        const role = String(this.primaryRoles[nm] || '').toLowerCase();
                        if (role === 'tank') return false;
                    }
                    return true;
                });
                const sum = eligible.reduce((acc, r) => acc + (Number(r.sunder_count) || 0), 0);
                const avg = eligible.length ? (sum / eligible.length) : 0;
                const computePts = (count) => {
                    if (!(avg > 0)) return 0;
                    const pct = (Number(count) || 0) / avg * 100;
                    if (pct < 25) return -20;
                    if (pct < 50) return -15;
                    if (pct < 75) return -10;
                    if (pct < 90) return -5;
                    if (pct <= 109) return 0;
                    if (pct <= 124) return 5;
                    return 10;
                };
                this.sunderData.forEach(row => {
                    const nm = String(row.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (this.primaryRoles) {
                        const role = String(this.primaryRoles[nm] || '').toLowerCase();
                        if (role === 'tank') return;
                    }
                    const pts = computePts(row.sunder_count);
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }
            
            // Add points from curses
            if (this.curseData && this.curseSettings) {
                this.curseData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from curse shadow
            if (this.curseShadowData && this.curseShadowSettings) {
                this.curseShadowData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from curse elements
            if (this.curseElementsData && this.curseElementsSettings) {
                this.curseElementsData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from faerie fire
            if (this.faerieFireData && this.faerieFireSettings) {
                this.faerieFireData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from scorch
            if (this.scorchData && this.scorchSettings) {
                this.scorchData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from demoralizing shout
            if (this.demoShoutData && this.demoShoutSettings) {
                this.demoShoutData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from polymorph
            if (this.polymorphData && this.polymorphSettings) {
                this.polymorphData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from power infusion
            if (this.powerInfusionData && this.powerInfusionSettings) {
                this.powerInfusionData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                });
            }
            
            // Add points from decurses
            if (this.decursesData && this.decursesSettings) {
                this.decursesData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    if (player.points > 0) positivePoints += player.points;
                    else if (player.points < 0) negativePoints += Math.abs(player.points);
                });
            }

            // Include frost resistance (DPS-only) — require primaryRoles
            if (this.frostResistanceData && Array.isArray(this.frostResistanceData) && this.primaryRoles) {
                this.frostResistanceData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    const pr = String(this.primaryRoles[nm] || '').toLowerCase();
                    if (pr !== 'dps') return; // DPS only
                    const pts = Number(player.points) || 0;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }

            // Include world buffs copy penalties
            if (this.worldBuffsData && Array.isArray(this.worldBuffsData)) {
                this.worldBuffsData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm) || this.shouldIgnorePlayer(player.character_name)) return;
                    const pts = Number(player.points) || 0;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }

            // Include void damage penalties
            if (this.voidDamageData && Array.isArray(this.voidDamageData)) {
                this.voidDamageData.forEach(player => {
                    const nm = String(player.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm) || this.shouldIgnorePlayer(player.character_name)) return;
                    const pts = Number(player.points) || 0;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }

            // Attendance streaks
            if (this.playerStreaksData && Array.isArray(this.playerStreaksData)) {
                this.playerStreaksData.forEach(row => {
                    const nm = String(row.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    const s = Number(row.player_streak) || 0;
                    let pts = 0; if (s>=8) pts=15; else if (s===7) pts=12; else if (s===6) pts=9; else if (s===5) pts=6; else if (s===4) pts=3;
                    if (pts > 0) positivePoints += pts;
                });
            }

            // Guild members points (variable: 10 for direct, 5 for alts)
            if (this.guildMembersData && Array.isArray(this.guildMembersData)) {
                this.guildMembersData.forEach(row => {
                    const nm = String(row.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    const pts = Number(row.points) || 0;
                    positivePoints += pts;
                });
            }

            // Weekly NAX raids (2nd raid: 5pts, 3rd+ raid: 10pts)
            if (this.weeklyNaxRaidsData && Array.isArray(this.weeklyNaxRaidsData)) {
                this.weeklyNaxRaidsData.forEach(row => {
                    const nm = String(row.character_name || '').toLowerCase();
                    if (!confirmedNameSet.has(nm)) return;
                    const pts = Number(row.points) || 0;
                    positivePoints += pts;
                });
            }

            // Include Big Buyer Bonus
            if (this.bigBuyerData && Array.isArray(this.bigBuyerData)) {
                this.bigBuyerData.forEach(player => {
                    const pts = Number(player.points) || 0;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
            }
            
            // Add points from manual rewards/deductions (skip gold-mode)
            if (this.manualRewardsData) {
                this.manualRewardsData.forEach(entry => {
                    if (entry && (entry.is_gold || /\[GOLD\]/i.test(String(entry.description||'')))) return;
                    const nm = String(entry.player_name || '').toLowerCase();
                    const did = String(entry.discord_id || '');
                    if (!confirmedNameSet.has(nm) && !confirmedDiscordSet.has(did)) return;
                    const points = Number(entry.points) || 0;
                    if (points > 0) positivePoints += points;
                    else if (points < 0) negativePoints += Math.abs(points);
                });
            }
            
            // Mode: if snapshot locked, use snapshot totals; else use computed
            if (this.snapshotLocked && Array.isArray(this.snapshotEntries) && this.snapshotEntries.length > 0) {
                positivePoints = 0;
                negativePoints = 0;
                this.snapshotEntries.forEach(row => {
                    const nm = String(row.character_name || '').toLowerCase();
                    const did = String(row.discord_user_id || '');
                    if (!confirmedNameSet.has(nm) && !confirmedDiscordSet.has(did)) return;
                    const pts = Number(row.point_value_edited != null ? row.point_value_edited : row.point_value_original) || 0;
                    if (pts > 0) positivePoints += pts; else if (pts < 0) negativePoints += Math.abs(pts);
                });
                // Manual rewards are separate; add them as stored when in manual mode (skip gold-mode)
                if (this.manualRewardsData) {
                    this.manualRewardsData.forEach(entry => {
                        if (entry && (entry.is_gold || /\[GOLD\]/i.test(String(entry.description||'')))) return;
                        const nm = String(entry.player_name || '').toLowerCase();
                        const did = String(entry.discord_id || '');
                        if (!confirmedNameSet.has(nm) && !confirmedDiscordSet.has(did)) return;
                        const points = Number(entry.points) || 0;
                        if (points > 0) positivePoints += points; else if (points < 0) negativePoints += Math.abs(points);
                    });
                }
            }

            // Calculate final total
            // In computed mode, include special frontend-computed awards that aren't in datasets
            if (!(this.snapshotLocked && Array.isArray(this.snapshotEntries) && this.snapshotEntries.length > 0)) {
              try {
                // Build sorted arrays
                const damageDealer = (this.logData || [])
                    .filter(p => !this.shouldIgnorePlayer(p.character_name) && (((p.role_detected||'').toLowerCase()==='dps' || (p.role_detected||'').toLowerCase()==='tank') && (parseInt(p.damage_amount)||0) > 0))
                    .sort((a,b)=>(parseInt(b.damage_amount)||0)-(parseInt(a.damage_amount)||0));
                const healers = (this.logData || [])
                    .filter(p => !this.shouldIgnorePlayer(p.character_name) && ((p.role_detected||'').toLowerCase()==='healer') && (parseInt(p.healing_amount)||0) > 0)
                    .sort((a,b)=>(parseInt(b.healing_amount)||0)-(parseInt(a.healing_amount)||0));

                // God Gamer DPS
                if (damageDealer.length >= 2) {
                    const first = parseInt(damageDealer[0].damage_amount)||0;
                    const second = parseInt(damageDealer[1].damage_amount)||0;
                    const diff = first - second;
                    let pts = 0; if (diff >= 250000) pts = 30; else if (diff >= 150000) pts = 20;
                    if (pts) positivePoints += pts;
                }
                // God Gamer Healer
                if (healers.length >= 2) {
                    const first = parseInt(healers[0].healing_amount)||0;
                    const second = parseInt(healers[1].healing_amount)||0;
                    const diff = first - second;
                    let pts = 0; if (diff >= 250000) pts = 20; else if (diff >= 150000) pts = 15;
                    if (pts) positivePoints += pts;
                }

                // Class-specific healer awards
                const byClass = (arr, cls) => arr.filter(p => (String(p.character_class||'').toLowerCase().includes(cls)));
                const shamans = byClass(healers, 'shaman').slice(0,3); // 25/20/15
                const priests = byClass(healers, 'priest').slice(0,2); // 20/15
                const druids = byClass(healers, 'druid').slice(0,1); // 15
                const addAward = (players, ptsArray) => {
                    players.forEach((p, idx) => { const nm = String(p.character_name||'').toLowerCase(); if (!confirmedNameSet.has(nm)) return; positivePoints += (ptsArray[idx]||0); });
                };
                addAward(shamans, [25,20,15]);
                addAward(priests, [20,15]);
                addAward(druids, [15]);

                // Too Low Damage / Healing penalties
                const aftMin = this.raidStats?.stats?.activeFightTime;
                if (aftMin && this.primaryRoles) {
                    const totalSec = aftMin * 60;
                    // DPS
                    (this.logData || []).forEach(p => {
                        if (this.shouldIgnorePlayer(p.character_name)) return;
                        const role = this.primaryRoles[String(p.character_name||'').toLowerCase()];
                        if (role !== 'dps') return;
                        const dmg = parseFloat(p.damage_amount)||0; const dps = dmg / totalSec;
                        let pts = 0; if (dps < 150) pts = -100; else if (dps < 200) pts = -50; else if (dps < 250) pts = -25;
                        if (pts < 0) negativePoints += Math.abs(pts);
                    });
                    // Healers
                    (this.logData || []).forEach(p => {
                        if (this.shouldIgnorePlayer(p.character_name)) return;
                        const role = this.primaryRoles[String(p.character_name||'').toLowerCase()];
                        if (role !== 'healer') return;
                        const heal = parseFloat(p.healing_amount)||0; const hps = heal / totalSec;
                        let pts = 0; if (hps < 85) pts = -100; else if (hps < 100) pts = -50; else if (hps < 125) pts = -25;
                        if (pts < 0) negativePoints += Math.abs(pts);
                    });
                }
              } catch {}
            }

            // Cap negative contributions per player at 0 when summing across the raid.
            // We approximate by capping total negative net effect at the raid level:
            const rawTotal = basePoints + positivePoints - negativePoints;
            const totalPoints = Math.max(0, rawTotal);
            
            // Display the result (full number)
            valueElement.textContent = Number(totalPoints).toLocaleString();
            // Store for gold calculations
            this.totalPointsComputed = totalPoints;
            
            console.log(`📊 [TOTAL POINTS] Base: ${basePoints}, Positive: ${positivePoints}, Negative: ${negativePoints}, Total: ${totalPoints}`);
            
        } catch (error) {
            console.error('❌ [TOTAL POINTS] Error calculating total points:', error);
            valueElement.textContent = '--';
        }
    }
    async fetchGoldPot() {
        if (!this.activeEventId) return;
        try {
            const res = await fetch(`/api/event-goldpot/${this.activeEventId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data && data.success) {
                this.totalGoldPot = Number(data.goldPot) || 0;
                // Precompute shared and management cuts
                this.sharedGoldPot = Math.floor(this.totalGoldPot * 0.85);
                const mgmt = Math.floor(this.totalGoldPot * 0.15);

                // Dynamic raidleader percentage from event metadata
                let rlPct = 4;
                try {
                    const meta = await fetch(`/api/events/${this.activeEventId}/raidleader`).then(r => r.ok ? r.json() : null);
                    if (meta && meta.success && meta.raidleaderCut != null) rlPct = Number(meta.raidleaderCut);
                } catch {}
                rlPct = Math.max(0, Math.min(10, isNaN(rlPct) ? 4 : rlPct));
                const helperPct = 3;
                const foundersPct = 2;
                const organizerBasePct = 6;
                let guildbankPct = 0;
                let organizerPct = organizerBasePct;
                if (rlPct < 4) {
                    guildbankPct = 4 - rlPct;
                } else if (rlPct > 4) {
                    const over = rlPct - 4;
                    organizerPct = Math.max(0, organizerBasePct - over);
                }
                const amt = pct => Math.floor(this.totalGoldPot * (pct / 100));
                let raidleader = amt(rlPct);
                let helper = amt(helperPct);
                let founder = amt(foundersPct);
                let organizer = amt(organizerPct);
                let guildbank = amt(guildbankPct);
                // Fix rounding to match mgmt
                let sumParts = raidleader + helper + founder + organizer + guildbank;
                let diff = mgmt - sumParts;
                if (diff !== 0) {
                    if (organizerPct > 0) organizer += diff;
                    else if (guildbankPct > 0) guildbank += diff;
                    else raidleader += diff;
                }
                this.managementCuts = { management: mgmt, organizer, raidleader, helper, founder, guildbank, percents: { organizerPct, rlPct, helperPct, foundersPct, guildbankPct } };
            } else {
                this.totalGoldPot = 0;
                this.sharedGoldPot = 0;
                this.managementCuts = { management: 0, organizer: 0, raidleader: 0, helper: 0, founder: 0, guildbank: 0, percents: { organizerPct: 0, rlPct: 0, helperPct: 0, foundersPct: 0, guildbankPct: 0 } };
            }
        } catch (e) {
            console.error('❌ [GOLDPOT] Failed to fetch gold pot', e);
            this.totalGoldPot = 0;
            this.sharedGoldPot = 0;
            this.managementCuts = { management: 0, organizer: 0, raidleader: 0, helper: 0, founder: 0, guildbank: 0, percents: { organizerPct: 0, rlPct: 0, helperPct: 0, foundersPct: 0, guildbankPct: 0 } };
        }
    }
    updateGoldCards() {
        // Update Total Gold
        const totalGoldEl = document.getElementById('gold-total-value');
        if (totalGoldEl) {
            totalGoldEl.textContent = (this.totalGoldPot || 0).toLocaleString();
        }
        // Shared Gold
        const sharedGoldEl = document.getElementById('gold-shared-value');
        if (sharedGoldEl) {
            const baseShared = this.sharedGoldPot || Math.floor((this.totalGoldPot || 0) * 0.85);
            const payout = Number(this.manualGoldPayoutTotal) || 0;
            const adjusted = Math.max(0, baseShared - payout);
            sharedGoldEl.textContent = adjusted.toLocaleString();
            // Bracketed deduction below value
            let det = document.getElementById('gold-shared-deduction');
            if (!det) {
                const card = sharedGoldEl.closest('.stat-card.gold-shared');
                if (card) {
                    det = document.createElement('div');
                    det.id = 'gold-shared-deduction';
                    det.className = 'stat-detail';
                    card.appendChild(det);
                }
            }
            if (det) {
                det.textContent = payout > 0 ? `(-${payout.toLocaleString()} gold)` : '';
            }
            this.sharedGoldPotAdjusted = adjusted;
        }
        // Management Gold
        const mgmtVal = document.getElementById('gold-management-value');
        const mgmtDetail = document.getElementById('gold-management-detail');
        if (mgmtVal && mgmtDetail) {
            const c = this.managementCuts || { management: 0, organizer: 0, raidleader: 0, helper: 0, founder: 0, guildbank: 0, percents: { organizerPct: 0, rlPct: 0, helperPct: 0, foundersPct: 0, guildbankPct: 0 } };
            const fmtInt = (n) => Math.round(Number(n || 0)).toLocaleString();
            mgmtVal.textContent = fmtInt(c.management);
            // Keep styling; extend detail to include helper
            const gbStr = c.guildbank && c.guildbank > 0 ? ` | Guildbank: ${fmtInt(c.guildbank)}` : '';
            mgmtDetail.textContent = `Organizer: ${fmtInt(c.organizer)} | Raidleader: ${fmtInt(c.raidleader)} | Helper: ${fmtInt(c.helper)} | Founders: ${fmtInt(c.founder)}${gbStr}`;
            this.setupManagementTooltip(c);
        }
        // My Points and My Gold
        this.computeMyPointsAndGold();
        // Ensure tooltips are wired for all my-gold cards (gold tab + player panels)
        document.querySelectorAll('.stat-card.my-gold').forEach(card => {
            if (this._myGoldTooltipCards && this._myGoldTooltipCards.has(card)) return;
            this.setupMyGoldTooltip(card);
            if (this._myGoldTooltipCards) this._myGoldTooltipCards.add(card);
        });
    }

    setupManagementTooltip(cuts) {
        if (this._mgmtTooltipSetup) return;
        const card = document.querySelector('.stat-card.gold-management');
        if (!card) return;

        let hoverTimer = null;
        let shown = false;
        let lastPos = { x: 0, y: 0 };
        let tooltipEl = null;

        const removeTooltip = () => {
            if (tooltipEl && tooltipEl.parentNode) {
                tooltipEl.parentNode.removeChild(tooltipEl);
            }
            tooltipEl = null;
            shown = false;
        };

        const buildTooltip = () => {
            const fmtInt = (n) => Math.round(Number(n || 0)).toLocaleString();
            const el = document.createElement('div');
            el.className = 'mgmt-tooltip';
            const p = cuts.percents || { organizerPct: 6, rlPct: 4, helperPct: 3, foundersPct: 2, guildbankPct: 0 };
            el.innerHTML = `
                <div class="mgmt-grid">
                    <div class="mgmt-key"><strong>Total management cut (15%):</strong></div><div class="mgmt-val"><strong>${fmtInt(cuts.management)} Gold</strong></div>
                    <div class="mgmt-key">Organizer cut (${p.organizerPct}%):</div><div class="mgmt-val">${fmtInt(cuts.organizer)} Gold</div>
                    <div class="mgmt-key">Raidleader cut (${p.rlPct}%):</div><div class="mgmt-val">${fmtInt(cuts.raidleader)} Gold</div>
                    ${p.guildbankPct>0?`<div class="mgmt-key">Guildbank cut (${p.guildbankPct}%):</div><div class="mgmt-val">${fmtInt(cuts.guildbank||0)} Gold</div>`:''}
                    <div class="mgmt-key">Helper cut (${p.helperPct}%):</div><div class="mgmt-val">${fmtInt(cuts.helper)} Gold</div>
                    <div class="mgmt-key">Founders cut (2 x 1%):</div><div class="mgmt-val">${fmtInt(cuts.founder)} Gold</div>
                </div>
            `;
            document.body.appendChild(el);
            // position near cursor
            el.style.left = Math.max(8, lastPos.x + 12) + 'px';
            el.style.top = Math.max(8, lastPos.y + 12) + 'px';
            // trigger fade-in
            requestAnimationFrame(() => { el.classList.add('show'); });
            return el;
        };

        const scheduleShow = () => {
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
                tooltipEl = buildTooltip();
                shown = true;
            }, 1000);
        };

        const onMouseEnter = (e) => {
            lastPos = { x: e.clientX, y: e.clientY };
            scheduleShow();
        };
        const onMouseMove = (e) => {
            if (!shown) {
                // Any move resets the 1s hover-intent
                lastPos = { x: e.clientX, y: e.clientY };
                scheduleShow();
            } else {
                // If shown, hide immediately on any movement
                clearTimeout(hoverTimer);
                removeTooltip();
            }
        };
        const onMouseLeave = () => {
            clearTimeout(hoverTimer);
            removeTooltip();
        };

        card.addEventListener('mouseenter', onMouseEnter);
        card.addEventListener('mousemove', onMouseMove);
        card.addEventListener('mouseleave', onMouseLeave);

        this._mgmtTooltipSetup = true;
    }
    setupMyGoldTooltip(card = null) {
        if (!card) card = document.querySelector('.stat-card.my-gold');
        if (!card) return;

        let hoverTimer = null;
        let shown = false;
        let lastPos = { x: 0, y: 0 };
        let tooltipEl = null;

        const removeTooltip = () => {
            if (tooltipEl && tooltipEl.parentNode) {
                tooltipEl.parentNode.removeChild(tooltipEl);
            }
            tooltipEl = null;
            shown = false;
        };

        const buildContributions = () => {
            const userId = this.currentUser?.id;
            const contribs = [];
            if (!userId) return contribs;
            const myNames = new Set((this.logData || [])
                .filter(p => String(p.discord_id || '') === String(userId))
                .map(p => String(p.character_name || '').toLowerCase())
            );
            const myNamesArr = Array.from(myNames);

            // Base
            const basePoints = myNames.size * 100;
            if (basePoints > 0) {
                contribs.push({ panel: 'Base', points: basePoints });
            }

            // For each rankings section, capture single entry for my name
            const sections = document.querySelectorAll('#raid-logs-container .rankings-section');
            sections.forEach(section => {
                const header = section.querySelector('.section-header h2');
                const title = header ? header.textContent.trim() : 'Panel';
                const list = section.querySelector('.rankings-list');
                if (!list) return;
                const items = list.querySelectorAll('.ranking-item');
                for (const item of items) {
                    const nameEl = item.querySelector('.character-name');
                    const pointsEl = item.querySelector('.performance-amount .amount-value');
                    if (!nameEl || !pointsEl) continue;
                    const nameText = String(nameEl.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
                    const isMine = myNamesArr.some(nm => nameText.endsWith(nm));
                    if (!isMine) continue;
                    const raw = String(pointsEl.textContent || '').replace('+','').trim();
                    const val = Number(raw);
                    if (isNaN(val) || val === 0) continue;
                    contribs.push({ panel: title, points: Math.round(val) });
                    break; // only one contribution per panel
                }
            });

            return contribs;
        };

        const buildTooltip = () => {
            const fmtInt = (n) => Math.round(Number(n || 0)).toLocaleString();
            const gpp = this.goldPerPoint || 0;
            const el = document.createElement('div');
            el.className = 'mygold-tooltip';

            const rows = buildContributions();
            const rowsHtml = rows.length > 0 ? rows.map(r => {
                const gold = Math.round((Number(r.points) || 0) * gpp);
                const pts = Number(r.points) || 0;
                const signedPts = pts > 0 ? `+${fmtInt(pts)}` : `${fmtInt(pts)}`;
                return `<div class="mygold-key">${r.panel}:</div><div class="mygold-val">${signedPts} pts | ${fmtInt(gold)} Gold</div>`;
            }).join('') : `<div class="mygold-key">No contributions</div><div class="mygold-val">--</div>`;

            el.innerHTML = `
                <div class="mygold-grid">
                    ${rowsHtml}
                </div>
            `;
            document.body.appendChild(el);
            el.style.left = Math.max(8, lastPos.x + 12) + 'px';
            el.style.top = Math.max(8, lastPos.y + 12) + 'px';
            requestAnimationFrame(() => { el.classList.add('show'); });
            return el;
        };

        const scheduleShow = () => {
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
                tooltipEl = buildTooltip();
                shown = true;
            }, 1000);
        };

        const onMouseEnter = (e) => {
            lastPos = { x: e.clientX, y: e.clientY };
            scheduleShow();
        };
        const onMouseMove = (e) => {
            if (!shown) {
                lastPos = { x: e.clientX, y: e.clientY };
                scheduleShow();
            } else {
                clearTimeout(hoverTimer);
                removeTooltip();
            }
        };
        const onMouseLeave = () => {
            clearTimeout(hoverTimer);
            removeTooltip();
        };

        card.addEventListener('mouseenter', onMouseEnter);
        card.addEventListener('mousemove', onMouseMove);
        card.addEventListener('mouseleave', onMouseLeave);
    }
    computeMyPointsAndGold() {
        const pointsEls = document.querySelectorAll('#gold-panel #my-points-value, .player-panel #my-points-value');
        const pointsDetailEls = document.querySelectorAll('#gold-panel #my-points-detail, .player-panel #my-points-detail');
        const goldEls = document.querySelectorAll('#gold-panel #my-gold-value, .player-panel #my-gold-value');
        const goldDetailEls = document.querySelectorAll('#gold-panel #my-gold-detail, .player-panel #my-gold-detail');

        if (goldEls.length === 0 || pointsEls.length === 0) return;

        const userId = this.currentUser?.id;
        if (!userId) {
            pointsEls.forEach(el=> el.textContent = '--');
            pointsDetailEls.forEach(el=> el && (el.textContent = 'Sign in to see your share'));
            goldEls.forEach(el=> el.textContent = '--');
            goldDetailEls.forEach(el=> el && (el.textContent = 'Each point = -- gold'));
            return;
        }

        const myNames = new Set((this.logData || [])
            .filter(p => String(p.discord_id || '') === String(userId))
            .map(p => String(p.character_name || '').toLowerCase())
        );

        let myPoints = 0;
        let myGold = 0;
        let gpp = this.goldPerPoint || 0;

        if (this.engineResult && this.engineResult.success) {
            const totals = this.engineResult.totals || {};
            const manualGold = Array.isArray(this.engineResult.manual_gold) ? this.engineResult.manual_gold : [];
            const manualGoldByName = new Map(manualGold.map(e => [String(e.name||'').toLowerCase(), Number(e.gold)||0]));
            gpp = Number(this.engineResult.meta?.goldPerPoint || this.goldPerPoint || 0);
            myNames.forEach(nm => {
                const row = totals[nm];
                if (row) {
                    myPoints += Math.max(0, Number(row.points)||0);
                    myGold += Math.max(0, Number(row.gold)||0);
                }
                const extra = manualGoldByName.get(nm) || 0;
                if (extra > 0) myGold += extra;
            });
        } else {
            // Legacy fallback using DOM
            const basePoints = myNames.size * 100;
            let sumVisible = 0;
            try {
                const lists = document.querySelectorAll('#raid-logs-container .rankings-list');
                const myNamesArr = Array.from(myNames);
                lists.forEach(list => {
                    const items = list.querySelectorAll('.ranking-item');
                    items.forEach(item => {
                        if (item && item.dataset && item.dataset.isGold === 'true') return;
                        const nameEl = item.querySelector('.character-name');
                        const pointsEl = item.querySelector('.performance-amount .amount-value');
                        if (!nameEl || !pointsEl) return;
                        const rawNameText = String(nameEl.textContent || '').trim();
                        if (this.shouldIgnorePlayer(rawNameText)) return;
                        const nameText = rawNameText.toLowerCase().replace(/\s+/g, ' ');
                        const isMine = myNamesArr.some(nm => nameText.endsWith(nm));
                        if (!isMine) return;
                        const raw = String(pointsEl.textContent || '').replace('+','').trim();
                        const val = Number(raw);
                        if (!isNaN(val)) sumVisible += val;
                    });
                });
            } catch {}
            myPoints = Math.max(0, basePoints + sumVisible);
            const totalPts = Math.max(0, Number(this.totalPointsComputed) || 0);
            const shared = Number(this.sharedGoldPotAdjusted != null ? this.sharedGoldPotAdjusted : this.sharedGoldPot) || Math.floor((this.totalGoldPot || 0) * 0.85);
            gpp = (totalPts > 0 && shared > 0) ? (shared / totalPts) : (this.goldPerPoint || 0);
            myGold = Math.floor(myPoints * gpp);
        }

        this.myPoints = myPoints;
        pointsEls.forEach(el=> el.textContent = this.formatNumber(Math.round(myPoints)));
        pointsDetailEls.forEach(el=>{
            if (!el) return;
            const list = Array.from(myNames).filter(Boolean);
            el.textContent = list.length > 0 ? `Chars: ${list.join(', ')}` : 'Character not matched yet';
        });
        this.myGold = myGold;
        goldEls.forEach(el=> el.textContent = Math.round(myGold).toLocaleString());
        goldDetailEls.forEach(el=> el && (el.textContent = `Each point = ${Math.round(gpp).toLocaleString()} gold`));
    }
    displayRaidLogs() {
        if (!this.logData || this.logData.length === 0) {
            console.log(`❌ No log data found for event: ${this.activeEventId}`);
            this.showNoData(`No raid logs data available for event: ${this.activeEventId}`);
            return;
        }

        // Debug: Log all role_detected values (enhanced by backend)
        console.log('🔍 [DEBUG] All role_detected values (backend enhanced):', this.logData.map(p => ({
            name: p.character_name,
            role: p.role_detected,
            spec: p.spec_name,
            source: p.role_source,
            damage: p.damage_amount,
            healing: p.healing_amount
        })));

        // Filter and sort damage dealers (DPS and Tank roles that do damage)
        // If engine auto available, build damage/healing lists from engine panels
        let damageDealer;
        if (!this.snapshotLocked && this.engineResult && Array.isArray(this.engineResult.panels)) {
            const dmgRows = (this.engineResult.panels.find(p=>p.panel_key==='damage')||{}).rows||[];
            damageDealer = dmgRows.map((r, idx)=>({ character_name:r.name, character_class:(this.logData.find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}).character_class||'Unknown', damage_amount: (this.logData.find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}).damage_amount||0, role_detected:'dps', _enginePos: idx+1 }));
        } else {
            damageDealer = this.logData
            .filter(player => {
                const nameKey = String(player.character_name || '').trim().toLowerCase();
                const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
                const fallbackRole = (player.role_detected || '').toLowerCase();
                const role = primaryRole || fallbackRole;
                const damage = parseInt(player.damage_amount) || 0;
                const name = String(player.character_name || '');
                return (role === 'dps' || role === 'tank') && damage > 0 && !this.shouldIgnorePlayer(name);
            })
            .sort((a, b) => (parseInt(b.damage_amount) || 0) - (parseInt(a.damage_amount) || 0));
        }

        // Filter and sort healers
        let healers;
        if (!this.snapshotLocked && this.engineResult && Array.isArray(this.engineResult.panels)) {
            const healRows = (this.engineResult.panels.find(p=>p.panel_key==='healing')||{}).rows||[];
            healers = healRows.map((r, idx)=>({ character_name:r.name, character_class:(this.logData.find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}).character_class||'Unknown', healing_amount: (this.logData.find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}).healing_amount||0, role_detected:'healer', _enginePos: idx+1 }));
        } else {
            healers = this.logData
            .filter(player => {
                const nameKey = String(player.character_name || '').trim().toLowerCase();
                const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
                const fallbackRole = (player.role_detected || '').toLowerCase();
                const role = primaryRole || fallbackRole;
                const healing = parseInt(player.healing_amount) || 0;
                const name = String(player.character_name || '');
                return role === 'healer' && healing > 0 && !this.shouldIgnorePlayer(name);
            })
            .sort((a, b) => (parseInt(b.healing_amount) || 0) - (parseInt(a.healing_amount) || 0));
        }

        console.log(`📊 Found ${damageDealer.length} damage dealers and ${healers.length} healers`);
        console.log('🔍 [DEBUG] Damage dealers:', damageDealer.map(p => `${p.character_name} (${p.role_detected})`));
        console.log('🔍 [DEBUG] Healers:', healers.map(p => `${p.character_name} (${p.role_detected})`));
        
        // Debug primary roles usage
        if (this.primaryRoles) {
            console.log('🔍 [DEBUG] Primary roles mapping sample:', Object.entries(this.primaryRoles).slice(0, 10));
            console.log('🔍 [DEBUG] Role resolution for first 5 players:', this.logData.slice(0, 5).map(p => {
                const nameKey = String(p.character_name || '').trim().toLowerCase();
                const primaryRole = String(this.primaryRoles[nameKey] || '').toLowerCase();
                const fallbackRole = (p.role_detected || '').toLowerCase();
                return {
                    name: p.character_name,
                    nameKey,
                    primaryRole,
                    fallbackRole,
                    finalRole: primaryRole || fallbackRole,
                    damage: p.damage_amount,
                    healing: p.healing_amount
                };
            }));
        } else {
            console.log('⚠️ [DEBUG] No primary roles mapping available!');
        }

        // Calculate God Gamer awards
        const godGamerDPS = (!this.snapshotLocked && this.engineResult) ? null : this.calculateGodGamerDPS(damageDealer);
        const godGamerHealer = (!this.snapshotLocked && this.engineResult) ? null : this.calculateGodGamerHealer(healers);

        // Display the rankings (use engine auto result if available and not locked)
        if (!this.snapshotLocked && this.engineResult) {
            try {
                // Build panel maps for quick lookup
                const panelMap = new Map((this.engineResult.panels||[]).map(p=>[p.panel_key, p.rows||[]]));
                const get = (k)=> panelMap.get(k) || [];
                // God Gamer DPS from engine panel + logData for display details
                try {
                    const dpsRows = get('god_gamer_dps');
                    const awardRow = dpsRows.find(r => Number(r.points)||0) || dpsRows[0];
                    if (awardRow) {
                        const dmgSorted = (this.logData||[]).filter(p=>!this.shouldIgnorePlayer(p.character_name)).filter(p=>{ const role=(p.role_detected||'').toLowerCase(); return (role==='dps'||role==='tank') && (parseInt(p.damage_amount)||0)>0; }).sort((a,b)=>(parseInt(b.damage_amount)||0)-(parseInt(a.damage_amount)||0));
                        const top1 = dmgSorted[0]||{}; const top2 = dmgSorted[1]||{};
                        const winnerName = awardRow.name || top1.character_name;
                        const winnerLog = dmgSorted.find(p=>String(p.character_name).toLowerCase()===String(winnerName).toLowerCase()) || top1;
                        const diff = (parseInt(top1.damage_amount)||0) - (parseInt(top2.damage_amount)||0);
                        const points = Number(awardRow.points)||0;
                        const ggDps = { character_name: winnerLog.character_name||winnerName, character_class: winnerLog.character_class||'Unknown', damage_amount: winnerLog.damage_amount||0, difference: diff, trophy: points>=30?'gold':'silver', points, spec_name: winnerLog.spec_name||'', title:'God Gamer DPS', secondPlace:{ character_name: top2.character_name||'' } };
                        this.displayGodGamerDPS(ggDps);
                    }
                } catch {}
                // God Gamer Healer from engine panel + logData
                try {
                    const hRows = get('god_gamer_healer');
                    const awardRow = hRows.find(r => Number(r.points)||0) || hRows[0];
                    if (awardRow) {
                        const healSorted = (this.logData||[]).filter(p=>!this.shouldIgnorePlayer(p.character_name)).filter(p=>{ const role=(p.role_detected||'').toLowerCase(); return role==='healer' && (parseInt(p.healing_amount)||0)>0; }).sort((a,b)=>(parseInt(b.healing_amount)||0)-(parseInt(a.healing_amount)||0));
                        const top1 = healSorted[0]||{}; const top2 = healSorted[1]||{};
                        const winnerName = awardRow.name || top1.character_name;
                        const winnerLog = healSorted.find(p=>String(p.character_name).toLowerCase()===String(winnerName).toLowerCase()) || top1;
                        const diff = (parseInt(top1.healing_amount)||0) - (parseInt(top2.healing_amount)||0);
                        const points = Number(awardRow.points)||0;
                        const ggHealer = { character_name: winnerLog.character_name||winnerName, character_class: winnerLog.character_class||'Unknown', healing_amount: winnerLog.healing_amount||0, difference: diff, trophy: points>=20?'gold':'silver', points, spec_name: winnerLog.spec_name||'', title:'God Gamer Healer', secondPlace:{ character_name: top2.character_name||'' } };
                        this.displayGodGamerHealer(ggHealer);
                    }
                } catch {}
            } catch {}
        }
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const lower = s=>String(s||'').toLowerCase();
                const clsFor=n=> (this.logData||[]).find(p=>lower(p.character_name)===lower(n))?.character_class || this.resolveClassForName(n) || 'Unknown';
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='attendance_streaks');
                const rows = (panel&&panel.rows)||[];
                const streakMap = new Map((this.playerStreaksData||[]).map(d=>[lower(d.character_name), Number(d.player_streak)||0]));
                const enriched = rows.map(r=>({ character_name:r.name, character_class:clsFor(r.name), player_streak: streakMap.get(lower(r.name))||0, points_override: Number(r.points)||0 }));
                this.displayPlayerStreaksRankings(enriched);
                const sec=document.querySelector('.streak-section'); if(sec) sec.classList.add('engine-synced');
            } catch { this.displayPlayerStreaksRankings(this.playerStreaksData); }
        } else {
        this.displayPlayerStreaksRankings(this.playerStreaksData);
        }
        this.displayGuildMembersRankings(this.guildMembersData);
        this.displayWeeklyNaxRaidsRankings(this.weeklyNaxRaidsData);
        if (!this.snapshotLocked && this.engineResult) {
            // Render damage/healing directly from engine rows
            try { this.displayDamageRankings(damageDealer); } catch {}
            try { this.displayHealerRankings(healers); } catch {}
        } else {
        this.displayGodGamerDPS(godGamerDPS);
        this.displayGodGamerHealer(godGamerHealer);
        this.displayDamageRankings(damageDealer);
        this.displayHealerRankings(healers);
        }
        // Too Low panels should consider the full roster stats, not just top rankings
        this.displayTooLowDamageRankings(this.logData || []);
        this.displayTooLowHealingRankings(this.logData || []);
        // Mark as engine-synced when using engine auto
        if (!this.snapshotLocked && this.engineResult) {
            try { const sec=document.querySelector('.too-low-damage-section'); if(sec) sec.classList.add('engine-synced'); } catch {}
            try { const sec=document.querySelector('.too-low-healing-section'); if(sec) sec.classList.add('engine-synced'); } catch {}
        }
        this.displayShamanHealers(healers);
        this.displayPriestHealers(healers);
        this.displayDruidHealers(healers);
        this.displayWorldBuffsRankings(this.frostResistanceData);
        this.displayWorldBuffsCopyRankings(this.worldBuffsData);
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='abilities');
                const rows = (panel&&panel.rows)||[];
                const enriched = rows.map((r,idx)=>{
                    const log = (this.abilitiesData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{};
                    return { character_name:r.name, character_class: log.character_class||'Unknown', total_used: Number(log.total_used||0), avg_targets_hit: Number(log.avg_targets_hit||1), points: Number(r.points)||0, dense_dynamite:Number(log.dense_dynamite||0), goblin_sapper_charge:Number(log.goblin_sapper_charge||0), stratholme_holy_water:Number(log.stratholme_holy_water||0), dense_dynamite_targets:Number(log.dense_dynamite_targets||0), goblin_sapper_targets:Number(log.goblin_sapper_targets||0), stratholme_targets:Number(log.stratholme_targets||0) };
                });
                this.displayAbilitiesRankings(enriched);
                try { const sec=document.querySelector('.abilities-section'); if (sec) sec.classList.add('engine-synced'); } catch {}
            } catch { this.displayAbilitiesRankings(this.abilitiesData); }
        } else {
        this.displayAbilitiesRankings(this.abilitiesData);
        }
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='mana_potions');
                const rows = (panel&&panel.rows)||[];
                const enriched = rows.map(r=>{ const log=(this.manaPotionsData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}; return { character_name:r.name, character_class: (this.logData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())?.character_class||log.character_class||'Unknown', points:Number(r.points)||0, potions_used:Number(log.potions_used||0) }; });
                this.displayManaPotionsRankings(enriched);
                try { const sec=document.querySelector('.mana-potions-section'); if (sec) sec.classList.add('engine-synced'); } catch {}
            } catch { this.displayManaPotionsRankings(this.manaPotionsData); }
        } else {
        this.displayManaPotionsRankings(this.manaPotionsData);
        }
        this.displayRocketHelmetRankings(this.rocketHelmetData);
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='runes');
                const rows = (panel&&panel.rows)||[];
                const enriched = rows.map(r=>{ const log=(this.runesData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}; return { character_name:r.name, character_class: (this.logData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())?.character_class||log.character_class||'Unknown', points:Number(r.points)||0, total_runes:Number(log.total_runes||log.runes_used||0), dark_runes:Number(log.dark_runes||0), demonic_runes:Number(log.demonic_runes||0) }; });
                this.displayRunesRankings(enriched);
                try { const sec=document.querySelector('.runes-section'); if (sec) sec.classList.add('engine-synced'); } catch {}
            } catch { this.displayRunesRankings(this.runesData); }
        } else {
        this.displayRunesRankings(this.runesData);
        }
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='interrupts');
                const rows = (panel&&panel.rows)||[];
                const enriched = rows.map(r=>{ const log=(this.interruptsData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}; return { character_name:r.name, character_class: (this.logData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())?.character_class||log.character_class||'Unknown', points:Number(r.points)||0, interrupts_used:Number(log.interrupts_used||log.interrupts||0) }; });
                this.displayInterruptsRankings(enriched);
                try { const sec=document.querySelector('.interrupts-section'); if (sec) sec.classList.add('engine-synced'); } catch {}
            } catch { this.displayInterruptsRankings(this.interruptsData); }
        } else {
        this.displayInterruptsRankings(this.interruptsData);
        }
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='disarms');
                const rows = (panel&&panel.rows)||[];
                const enriched = rows.map(r=>{ const log=(this.disarmsData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}; return { character_name:r.name, character_class: (this.logData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())?.character_class||log.character_class||'Unknown', points:Number(r.points)||0, disarms_used:Number(log.disarms_used||log.disarms||0) }; });
                this.displayDisarmsRankings(enriched);
                try { const sec=document.querySelector('.disarms-section'); if (sec) sec.classList.add('engine-synced'); } catch {}
            } catch { this.displayDisarmsRankings(this.disarmsData); }
        } else {
        this.displayDisarmsRankings(this.disarmsData);
        }
        // Confirmed assignments display - always use raw API data (not from engine)
        this.displayConfirmedAssignmentsRankings(this.confirmedAssignmentsData);
        if (!this.snapshotLocked && this.engineResult) {
            try {
                const panel = (this.engineResult.panels||[]).find(p=>p.panel_key==='sunder');
                const rows = (panel&&panel.rows)||[];
                const enriched = rows.map(r=>{ const log=(this.sunderData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())||{}; return { character_name:r.name, character_class: (this.logData||[]).find(p=>String(p.character_name).toLowerCase()===String(r.name).toLowerCase())?.character_class||log.character_class||'Unknown', points:Number(r.points)||0, sunder_count:Number(log.sunder_count||0) }; });
                this.displaySunderRankings(enriched);
                try { const sec=document.querySelector('.sunder-section'); if (sec) sec.classList.add('engine-synced'); } catch {}
            } catch { this.displaySunderRankings(this.sunderData); }
        } else {
        this.displaySunderRankings(this.sunderData);
        }
        if (!this.snapshotLocked && this.engineResult) {
            const lower = s=>String(s||'').toLowerCase(); const clsFor=n=> (this.logData||[]).find(p=>lower(p.character_name)===lower(n))?.character_class || this.resolveClassForName(n) || 'Unknown';
            try {
                const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='curse_recklessness');
                const rows=(p&&p.rows)||[];
                const rowsMap=new Map(rows.map(r=>[lower(r.name), r]));
                const enriched=(this.curseData||[]).map(d=>{const row=rowsMap.get(lower(d.character_name)); const uptimePct = row?.character_details ? parseFloat(String(row.character_details).match(/(\d+(?:\.\d+)?)\s*%/)?.[1] || '0') : Number(d.uptime_percentage||d.uptime||0); return { character_name:d.character_name, character_class:clsFor(d.character_name), uptime_percentage:uptimePct, points: row ? Number(row.points)||0 : 0 };});
                this.displayCurseRankings(enriched);
                const sec=document.querySelector('.curse-recklessness-section'); if(sec) sec.classList.add('engine-synced');
            } catch (err) { 
                console.error('[CURSE RECK] Error in enrichment:', err);
                this.displayCurseRankings(this.curseData); 
            }
            try {
                const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='curse_shadow');
                const rows=(p&&p.rows)||[];
                const rowsMap=new Map(rows.map(r=>[lower(r.name), r]));
                const enriched=(this.curseShadowData||[]).map(d=>{const row=rowsMap.get(lower(d.character_name)); const uptimePct = row?.character_details ? parseFloat(String(row.character_details).match(/(\d+(?:\.\d+)?)\s*%/)?.[1] || '0') : Number(d.uptime_percentage||d.uptime||0); return { character_name:d.character_name, character_class:clsFor(d.character_name), uptime_percentage:uptimePct, points: row ? Number(row.points)||0 : 0 };});
                this.displayCurseShadowRankings(enriched);
                const sec=document.querySelector('.curse-shadow-section'); if(sec) sec.classList.add('engine-synced');
            } catch (err) { 
                console.error('[CURSE SHADOW] Error in enrichment:', err);
                this.displayCurseShadowRankings(this.curseShadowData); 
            }
            try {
                const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='curse_elements');
                const rows=(p&&p.rows)||[];
                const rowsMap=new Map(rows.map(r=>[lower(r.name), r]));
                const enriched=(this.curseElementsData||[]).map(d=>{const row=rowsMap.get(lower(d.character_name)); const uptimePct = row?.character_details ? parseFloat(String(row.character_details).match(/(\d+(?:\.\d+)?)\s*%/)?.[1] || '0') : Number(d.uptime_percentage||d.uptime||0); return { character_name:d.character_name, character_class:clsFor(d.character_name), uptime_percentage:uptimePct, points: row ? Number(row.points)||0 : 0 };});
                this.displayCurseElementsRankings(enriched);
                const sec=document.querySelector('.curse-elements-section'); if(sec) sec.classList.add('engine-synced');
            } catch (err) { 
                console.error('[CURSE ELEMENTS] Error in enrichment:', err);
                this.displayCurseElementsRankings(this.curseElementsData); 
            }
            try { 
                const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='faerie_fire'); 
                const rows=(p&&p.rows)||[];
                const map=new Map((this.faerieFireData||[]).map(d=>[lower(d.character_name), d])); 
                const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; const uptimePct = r.character_details ? parseFloat(String(r.character_details).match(/(\d+(?:\.\d+)?)\s*%/)?.[1] || '0') : (Number(d.uptime_percentage)||0); return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0, uptime_percentage:uptimePct};}); 
                this.displayFaerieFireRankings(enriched); 
                const sec=document.querySelector('.faerie-fire-section'); if(sec) sec.classList.add('engine-synced');
            } catch (err) { 
                console.error('[FAERIE FIRE] Error in enrichment:', err);
                this.displayFaerieFireRankings(this.faerieFireData); 
            }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='scorch'); const rows=(p&&p.rows)||[]; const map=new Map((this.scorchData||[]).map(d=>[lower(d.character_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayScorchRankings(enriched); const sec=document.querySelector('.scorch-section'); if(sec) sec.classList.add('engine-synced'); } catch { this.displayScorchRankings(this.scorchData); }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='demo_shout'); const rows=(p&&p.rows)||[]; const map=new Map((this.demoShoutData||[]).map(d=>[lower(d.character_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayDemoShoutRankings(enriched); const sec=document.querySelector('.demo-shout-section'); if(sec) sec.classList.add('engine-synced'); } catch { this.displayDemoShoutRankings(this.demoShoutData); }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='polymorph'); const rows=(p&&p.rows)||[]; const map=new Map((this.polymorphData||[]).map(d=>[lower(d.character_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayPolymorphRankings(enriched); const sec=document.querySelector('.polymorph-section'); if(sec) sec.classList.add('engine-synced'); } catch { this.displayPolymorphRankings(this.polymorphData); }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='power_infusion'); const rows=(p&&p.rows)||[]; const map=new Map((this.powerInfusionData||[]).map(d=>[lower(d.character_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayPowerInfusionRankings(enriched); const sec=document.querySelector('.power-infusion-section'); if(sec) sec.classList.add('engine-synced'); } catch { this.displayPowerInfusionRankings(this.powerInfusionData); }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='decurses'); const rows=(p&&p.rows)||[]; const map=new Map((this.decursesData||[]).map(d=>[lower(d.character_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayDecursesRankings(enriched); const sec=document.querySelector('.decurses-section'); if(sec) sec.classList.add('engine-synced'); } catch { this.displayDecursesRankings(this.decursesData); }
            try {
                const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='void_damage');
                const rows=(p&&p.rows)||[]; const pts=new Map(rows.map(r=>[lower(r.name), Number(r.points)||0]));
                const enriched=(this.voidDamageData||[]).map(d=>({ character_name:d.character_name, character_class:clsFor(d.character_name), void_zone:Number(d.void_zone||d.void_zone_hits||0), void_blast:Number(d.void_blast||d.void_blast_hits||0), points: pts.get(lower(d.character_name))||0 }));
                this.displayVoidDamageRankings(enriched);
                const sec=document.querySelector('.void-damage-section'); if(sec) sec.classList.add('engine-synced');
            } catch { this.displayVoidDamageRankings(this.voidDamageData); }
            try {
                const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='windfury_totems');
                const rows=(p&&p.rows)||[];
                // Build full display from dataset so all four sections render, and use per-type points from dataset caps
                const enriched=(this.windfuryData||[]).map(d=>({
                    character_name: d.character_name,
                    character_class: 'Shaman',
                    totem_type: d.totem_type || 'Windfury Totem',
                    group_attacks_avg: Number(d.group_attacks_avg||0),
                    group_attacks_total: Number(d.group_attacks_total||0),
                    group_attacks_members: d.group_attacks_members||[],
                    totems_used: Number(d.totems_used||0),
                    party_id: d.party_id,
                    points: Number(d.points||0)
                }));
                this.displayWindfuryRankings(enriched);
                const sec=document.querySelector('.windfury-section'); if(sec) sec.classList.add('engine-synced');
            } catch { this.displayWindfuryRankings(this.windfuryData); }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='frost_resistance'); const rows=(p&&p.rows)||[]; const map=new Map((this.frostResistanceData||[]).map(d=>[lower(d.character_name||d.player_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayWorldBuffsRankings(enriched); const sec=document.querySelector('.frost-resistance-section'); if(sec) sec.classList.add('engine-synced'); } catch {}
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='world_buffs_copy'); const rows=(p&&p.rows)||[]; const map=new Map((this.worldBuffsData||[]).map(d=>[lower(d.character_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return {...d, character_name:r.name, character_class:clsFor(r.name), points:Number(r.points)||0};}); this.displayWorldBuffsCopyRankings(enriched); const sec=document.querySelectorAll('.world-buffs-section'); if(sec&&sec[1]) sec[1].classList.add('engine-synced'); } catch { this.displayWorldBuffsCopyRankings(this.worldBuffsData); }
            try { const p=(this.engineResult.panels||[]).find(x=>x.panel_key==='big_buyer'); const rows=(p&&p.rows)||[]; const map=new Map((this.bigBuyerData||[]).map(d=>[lower(d.character_name||d.player_name), d])); const enriched=rows.map(r=>{const d=map.get(lower(r.name))||{}; return { character_name:r.name, character_class:clsFor(r.name), spent_gold:Number(d.spent_gold||d.gold_spent||0), points:Number(r.points)||0 };}); this.displayBigBuyerRankings(enriched); const sec=document.querySelector('.big-buyer-section'); if(sec) sec.classList.add('engine-synced'); } catch { this.displayBigBuyerRankings(this.bigBuyerData); }
        } else {
        this.displayCurseRankings(this.curseData);
        this.displayCurseShadowRankings(this.curseShadowData);
        this.displayCurseElementsRankings(this.curseElementsData);
        this.displayFaerieFireRankings(this.faerieFireData);
        this.displayScorchRankings(this.scorchData);
        this.displayDemoShoutRankings(this.demoShoutData);
        this.displayPolymorphRankings(this.polymorphData);
        this.displayPowerInfusionRankings(this.powerInfusionData);
        this.displayDecursesRankings(this.decursesData);
        this.displayVoidDamageRankings(this.voidDamageData);
            // Totems in manual mode: render from snapshot rows when available, enriched with dataset details
            (function renderTotemsManual(self){
                if (!self.snapshotLocked || !Array.isArray(self.snapshotEntries) || self.snapshotEntries.length === 0) {
                    self.displayWindfuryRankings(self.windfuryData);
                    return;
                }
                const entries = self.snapshotEntries.filter(r => String(r.panel_key) === 'windfury_totems');
                if (!entries.length) { self.displayWindfuryRankings(self.windfuryData); return; }
                const lower = s => String(s||'').toLowerCase();
                // Build lookup by name+type to keep per-type metrics (a shaman can appear in multiple types)
                const typeKeyOfDatasetRow = (t)=>{
                    const k = lower(t||'');
                    if (k.includes('grace')) return 'grace_of_air';
                    if (k.includes('strength')) return 'strength_of_earth';
                    if (k.includes('tranq')) return 'tranquil_air';
                    return 'windfury';
                };
                const byNameType = new Map();
                (self.windfuryData||[]).forEach(d => {
                    const tk = typeKeyOfDatasetRow(d.totem_type);
                    byNameType.set(`${lower(d.character_name)}::${tk}`, d);
                });
                const resolveType = (itemKey) => {
                    const k = lower(itemKey||'');
                    if (k.includes('windfury')) return 'Windfury Totem';
                    if (k.includes('grace')) return 'Grace of Air Totem';
                    if (k.includes('strength')) return 'Strength of Earth Totem';
                    if (k.includes('tranq')) return 'Tranquil Air Totem';
                    return 'Windfury Totem';
                };
                const canonicalKey = (label)=>{
                    const k = lower(label||'');
                    if (k.includes('grace')) return 'grace_of_air';
                    if (k.includes('strength')) return 'strength_of_earth';
                    if (k.includes('tranq')) return 'tranquil_air';
                    return 'windfury';
                };
                const enriched = entries.map(e => {
                    const itemKey = (e.aux_json && (e.aux_json.item_key || e.aux_json['item_key'] || e.aux_json.itemKeyAttr || e.aux_json['itemKeyAttr'])) || '';
                    const resolvedType = resolveType(itemKey);
                    const tk = canonicalKey(resolvedType);
                    const d = byNameType.get(`${lower(e.character_name)}::${tk}`) || {};
                    const pts = Number(e.point_value_edited != null ? e.point_value_edited : e.point_value_original) || 0;
                    return {
                        character_name: e.character_name,
                        character_class: 'Shaman',
                        // Prefer snapshot-declared type to avoid cross-type label pollution from dataset mapping
                        totem_type: resolvedType || d.totem_type || 'Windfury Totem',
                        // carry icon_url through so published viewer can render spell icons
                        aux_json: { icon_url: (e.aux_json && (e.aux_json.icon_url || e.aux_json['icon_url'])) || undefined },
                        group_attacks_avg: Number(d.group_attacks_avg||0),
                        group_attacks_total: Number(d.group_attacks_total||0),
                        group_attacks_members: d.group_attacks_members || [],
                        totems_used: Number(d.totems_used||0),
                        party_id: d.party_id,
                        points: pts
                    };
                });
                self.displayWindfuryRankings(enriched);
            })(this);
        this.displayBigBuyerRankings(this.bigBuyerData);
        }
        // Ensure player tabs exists/updated after core render
        this.buildPlayerPanels();
        this.updateAbilitiesHeader();
        this.updateManaPotionsHeader();
        this.updateRunesHeader();
        this.updateInterruptsHeader();
        this.updateDisarmsHeader();
        this.updateSunderHeader();
        this.updateCurseHeader();
        this.updateCurseShadowHeader();
        this.updateCurseElementsHeader();
        this.updateFaerieFireHeader();
        this.updateScorchHeader();
        this.updateDemoShoutHeader();
        this.updatePolymorphHeader();
        this.updatePowerInfusionHeader();
        this.updateDecursesHeader();
        this.updateVoidDamageHeader();
        this.updateWindfuryHeader();
        this.updateBigBuyerHeader();
        this.updateArchiveButtons();
        this.displayWallOfShame();
        
        this.hideLoading();
        this.showContent();

        // Debug and parity UI removed

        // After rendering, apply snapshot overlay if in manual mode
        if (this.snapshotLocked && this.snapshotEntries && this.snapshotEntries.length > 0) {
            this.applySnapshotOverlay();
        }
    }
    // --- Snapshot/Editing Helpers ---
    initializePanelEditing() {
        // Map panel_key to container element IDs and friendly names
        this.panelConfigs = [
            { key: 'damage', name: 'Damage Dealers', containerId: 'damage-dealers-list' },
            { key: 'healing', name: 'Healers', containerId: 'healers-list' },
            { key: 'god_gamer_dps', name: 'God Gamer DPS', containerId: 'god-gamer-dps-list' },
            { key: 'god_gamer_healer', name: 'God Gamer Healer', containerId: 'god-gamer-healer-list' },
            { key: 'abilities', name: 'Engineering & Holywater', containerId: 'abilities-list' },
            { key: 'mana_potions', name: 'Major Mana Potions', containerId: 'mana-potions-list' },
            { key: 'runes', name: 'Dark or Demonic runes', containerId: 'runes-list' },
            { key: 'windfury_totems', name: 'Totems', containerId: 'windfury-list' },
            { key: 'interrupts', name: 'Interrupted spells', containerId: 'interrupts-list' },
            { key: 'disarms', name: 'Disarmed enemies', containerId: 'disarms-list' },
            { key: 'sunder', name: 'Sunder Armor', containerId: 'sunder-list' },
            { key: 'curse_recklessness', name: 'Curse of Recklessness', containerId: 'curse-recklessness-list' },
            { key: 'curse_shadow', name: 'Curse of Shadow', containerId: 'curse-shadow-list' },
            { key: 'curse_elements', name: 'Curse of the Elements', containerId: 'curse-elements-list' },
            { key: 'faerie_fire', name: 'Faerie Fire', containerId: 'faerie-fire-list' },
            { key: 'scorch', name: 'Scorch', containerId: 'scorch-list' },
            { key: 'demo_shout', name: 'Demoralizing Shout', containerId: 'demo-shout-list' },
            { key: 'polymorph', name: 'Polymorph', containerId: 'polymorph-list' },
            { key: 'power_infusion', name: 'Power Infusion', containerId: 'power-infusion-list' },
            { key: 'decurses', name: 'Decurses', containerId: 'decurses-list' },
            { key: 'rocket_helmet', name: 'Goblin Rocket Helmet', containerId: 'rocket-helmet-list' },
            { key: 'frost_resistance', name: 'Frost Resistance', containerId: 'world-buffs-list' },
            { key: 'world_buffs_copy', name: 'World Buffs', containerId: 'world-buffs-copy-list' },
            { key: 'void_damage', name: 'Avoidable Void Damage', containerId: 'void-damage-list' },
            { key: 'shaman_healers', name: 'Top Shaman Healers', containerId: 'shaman-healers-list' },
            { key: 'priest_healers', name: 'Top Priest Healers', containerId: 'priest-healers-list' },
            { key: 'druid_healers', name: 'Top Druid Healer', containerId: 'druid-healers-list' },
            { key: 'too_low_damage', name: 'Too Low Damage', containerId: 'too-low-damage-list' },
            { key: 'too_low_healing', name: 'Too Low Healing', containerId: 'too-low-healing-list' },
            { key: 'attendance_streaks', name: 'Attendance Streak Champions', containerId: 'player-streaks-list' },
            { key: 'guild_members', name: 'Guild Members', containerId: 'guild-members-list' },
            { key: 'weekly_nax_raids', name: 'Weekly Streak Champions', containerId: 'weekly-nax-raids-list' },
            { key: 'confirmed_assignments', name: 'Confirmed assignments', containerId: 'confirmed-assignments-list' },
            { key: 'big_buyer', name: 'Big Buyer Bonus', containerId: 'big-buyer-list' }
        ];

        // Add Edit/Save buttons to each panel header
        this.panelConfigs.forEach(cfg => {
            const list = document.getElementById(cfg.containerId);
            if (!list) return;
            const section = list.closest('.rankings-section');
            const header = section ? section.querySelector('.section-header') : null;
            if (!header) return;

            // Actions container
            const buttonsWrap = document.createElement('div');
            buttonsWrap.className = 'panel-actions';
            buttonsWrap.style.marginLeft = 'auto';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-edit';
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => this.onEditPanel(cfg);

            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn-save';
            saveBtn.textContent = 'Save';
            saveBtn.style.display = 'none';
            saveBtn.onclick = () => this.onSavePanel(cfg, saveBtn);

            buttonsWrap.appendChild(editBtn);
            buttonsWrap.appendChild(saveBtn);
            header.appendChild(buttonsWrap);

            cfg._editBtn = editBtn;
            cfg._saveBtn = saveBtn;
        });
    }

    updatePanelButtonsVisibility() {
        const hasManagementRole = this.currentUser?.hasManagementRole || false;
        this.panelConfigs.forEach(cfg => {
            if (!cfg._editBtn || !cfg._saveBtn) return;
            // Only management can see edit/save; otherwise both hidden
            const displayStyle = hasManagementRole ? 'inline-flex' : 'none';
            // Respect current edit state: if save visible keep it; otherwise show edit
            if (cfg._saveBtn.style.display !== 'none') {
                cfg._saveBtn.style.display = hasManagementRole ? 'inline-flex' : 'none';
                cfg._editBtn.style.display = 'none';
            } else {
                cfg._editBtn.style.display = displayStyle;
                cfg._saveBtn.style.display = 'none';
            }
        });
        // Also gate revert button
        const revertBtn = document.getElementById('mode-revert-btn');
        if (revertBtn) {
            revertBtn.style.display = (this.currentUser?.hasManagementRole ? 'inline-flex' : 'none');
        }
        // Gate Debug: Toggle breakdown button
        const debugToggle = document.getElementById('rl-debug-toggle');
        const debugPanel = document.getElementById('rl-debug-panel');
        if (debugToggle) {
            debugToggle.style.display = hasManagementRole ? 'inline-flex' : 'none';
        }
        if (!hasManagementRole && debugPanel) {
            debugPanel.style.display = 'none';
        }

        // Remove any temporary diagnostic lock button if present
        const tmpLock = document.getElementById('mode-lock-btn');
        if (tmpLock && tmpLock.parentElement) tmpLock.parentElement.removeChild(tmpLock);
    }
    async onEditPanel(cfg) {
        // Only enter edit UI; confirmation and locking will happen on Save
        if (!this.snapshotLocked) {
            console.log('[SNAPSHOT] Entering edit mode; will confirm and lock on Save');
        }

        // Enable inline edits for this panel
        const list = document.getElementById(cfg.containerId);
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.ranking-item'));
        items.forEach(item => {
            const pointsEl = item.querySelector('.performance-amount .amount-value');
            const detailsEl = item.querySelector('.character-details');
            if (pointsEl && !pointsEl.querySelector('input')) {
                const val = pointsEl.textContent.trim();
                const inp = document.createElement('input');
                inp.type = 'number';
                inp.step = '0.01';
                inp.value = val.replace('+','');
                inp.style.width = '80px';
                pointsEl.innerHTML = '';
                pointsEl.appendChild(inp);
            }
            if (detailsEl && !detailsEl.querySelector('input')) {
                const txt = detailsEl.textContent.trim();
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.value = txt;
                inp.style.width = '100%';
                detailsEl.innerHTML = '';
                detailsEl.appendChild(inp);
            }
        });
        if (cfg._saveBtn && cfg._editBtn) {
            cfg._editBtn.style.display = 'none';
            cfg._saveBtn.style.display = 'inline-flex';
        }
    }
    async onSavePanel(cfg, saveBtn) {
        // If not yet locked, confirm and lock now (FIRST EDIT - AUTO-SAVE ALL PANELS)
        if (!this.snapshotLocked || !this.snapshotEntries || this.snapshotEntries.length === 0) {
            const confirmed = confirm('This is your first edit. All panel data will be saved to the database and switched to Manual Mode.\n\nOnce in Manual Mode, data no longer auto-updates from logs.\n\nContinue?');
            if (!confirmed) return;
            
            // Show progress overlay
            this.showSavingProgress('Saving all panels to database...');
            
            try {
                // Collect current edits before locking because snapshot will re-render
                const pendingUpdates = this.collectPanelEdits(cfg);
                
                // Save ALL panels to database
                await this.lockSnapshotFromCurrentView();
                
                // After locking, immediately persist the previously collected edits
                await this.persistUpdates(pendingUpdates);
                
                // Switch UI to manual mode
                this.snapshotLocked = true;
                this.updateModeBadge();
                
                this.hideSavingProgress();
                alert('Successfully saved all panels! Now in Manual Mode.');
            } catch (error) {
                this.hideSavingProgress();
                console.error('Error saving panels:', error);
                alert('Error saving panels. Please try again.');
                return;
            }
        }
        const list = document.getElementById(cfg.containerId);
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.ranking-item'));

        // Build updates from inputs
        const updates = [];
        items.forEach((item, idx) => {
            const nameEl = item.querySelector('.character-name');
            const playerName = nameEl ? nameEl.textContent.trim() : null;
            if (!playerName) return;
            const itemKey = (cfg.key === 'windfury_totems') ? (item.getAttribute('data-item-key') || null) : null;
            const pointsInp = item.querySelector('.performance-amount .amount-value input');
            const detailsInp = item.querySelector('.character-details input');
            const pointsVal = pointsInp ? pointsInp.value : null;
            const detailsVal = detailsInp ? detailsInp.value : null;

            // Lookup existing snapshot row to compare
            const snap = (this.snapshotEntries || []).find(r => {
                if (r.panel_key !== cfg.key) return false;
                if (r.character_name !== playerName) return false;
                if (cfg.key === 'windfury_totems') {
                    const rk = r.aux_json && (r.aux_json.item_key || r.aux_json['item_key']);
                    return String(rk || '') === String(itemKey || '');
                }
                return true;
            });
            const currentEdited = snap ? snap.point_value_edited : null;
            const currentDetailsEdited = snap ? snap.character_details_edited : null;

            const numericVal = pointsVal !== null && pointsVal !== '' ? Math.round(Number(pointsVal)) : null;
            const detailsOut = detailsVal !== null ? detailsVal : null;

            const changed = (numericVal !== null && numericVal !== (snap ? (snap.point_value_edited ?? Number(snap.point_value_original)) : null)) ||
                            (detailsOut !== null && detailsOut !== (snap ? (snap.character_details_edited ?? snap.character_details_original) : null));
            if (!changed) return;

            updates.push({
                panel_key: cfg.key,
                character_name: playerName,
                discord_user_id: snap ? snap.discord_user_id : null,
                ranking_number_original: snap ? snap.ranking_number_original : (idx + 1),
                point_value_edited: numericVal,
                character_details_edited: detailsOut
                , aux_json: (cfg.key === 'windfury_totems' && itemKey) ? { item_key: itemKey } : undefined
            });
        });

        await this.persistUpdates(updates);

        // Exit edit mode: replace inputs with values and color edited points
        this.applySnapshotOverlayForPanel(cfg.key, cfg.containerId);
        if (cfg._saveBtn && cfg._editBtn) {
            cfg._saveBtn.style.display = 'none';
            cfg._editBtn.style.display = 'inline-flex';
        }
        // Re-render totals and table so changes are reflected immediately
        this.updateTotalPointsCard();
        this.renderPointsBreakdownTable();
        this.updateGoldCards();
    }

    collectPanelEdits(cfg) {
        const list = document.getElementById(cfg.containerId);
        if (!list) return [];
        const items = Array.from(list.querySelectorAll('.ranking-item'));
        const updates = [];
        items.forEach((item, idx) => {
            const nameEl = item.querySelector('.character-name');
            const playerName = nameEl ? nameEl.textContent.trim() : null;
            if (!playerName) return;
            const pointsInp = item.querySelector('.performance-amount .amount-value input');
            const detailsInp = item.querySelector('.character-details input');
            const pointsVal = pointsInp ? pointsInp.value : null;
            const detailsVal = detailsInp ? detailsInp.value : null;
            const snap = (this.snapshotEntries || []).find(r => r.panel_key === cfg.key && r.character_name === playerName);
            const numericVal = pointsVal !== null && pointsVal !== '' ? Math.round(Number(pointsVal)) : null;
            const detailsOut = detailsVal !== null ? detailsVal : null;
            if (numericVal === null && (detailsOut === null)) {
                return;
            }
            updates.push({
                panel_key: cfg.key,
                character_name: playerName,
                discord_user_id: snap ? snap.discord_user_id : null,
                ranking_number_original: snap ? snap.ranking_number_original : (idx + 1),
                point_value_edited: numericVal,
                character_details_edited: detailsOut
            });
        });
        return updates;
    }
    async persistUpdates(updates) {
        for (const u of updates) {
            try {
                const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/entry`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(u)
                });
                if (res.ok) {
                    const data = await res.json();
                    const ix = this.snapshotEntries.findIndex(r => r.panel_key === u.panel_key && r.character_name === u.character_name);
                    if (ix >= 0) this.snapshotEntries[ix] = data.entry; else this.snapshotEntries.push(data.entry);
                    continue;
                }

                // Fallback for any non-OK result: perform a full relock and retry once; never single-row backfill.
                try { await fetch(`/api/rewards-snapshot/${this.activeEventId}/unlock`, { method: 'POST' }); } catch {}
                await this.lockSnapshotFromCurrentView();
                const resRetry = await fetch(`/api/rewards-snapshot/${this.activeEventId}/entry`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u) });
                if (resRetry.ok) {
                    const dataRetry = await resRetry.json();
                    const ixRetry = this.snapshotEntries.findIndex(r => r.panel_key === u.panel_key && r.character_name === u.character_name);
                    if (ixRetry >= 0) this.snapshotEntries[ixRetry] = dataRetry.entry; else this.snapshotEntries.push(dataRetry.entry);
                                continue;
                            }
                console.warn('[SNAPSHOT] PUT failed after full relock; skipping update for', u.panel_key, u.character_name);
                continue;

                // As a last resort, rebuild the entire snapshot from the current view.
                // This path helps when the backend returns 500 for per-entry updates due to row drift.
                try {
                    await fetch(`/api/rewards-snapshot/${this.activeEventId}/unlock`, { method: 'POST' });
                    await this.lockSnapshotFromCurrentView();
                    // Refresh local cache and overlay so UI reflects saved values immediately
                    await this.fetchSnapshotStatus();
                    await this.fetchSnapshotData();
                    this.applySnapshotOverlay();
                } catch (e2) {
                    console.warn('⚠️ [SNAPSHOT] Fallback unlock+relock failed', e2);
                }
            } catch (e) {
                console.warn('⚠️ [SNAPSHOT] Update failed', e);
            }
        }
    }

    showSavingProgress(message = 'Saving...') {
        // Create or show progress overlay
        let overlay = document.getElementById('saving-progress-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'saving-progress-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            const progressBox = document.createElement('div');
            progressBox.style.cssText = `
                background: white;
                padding: 30px 40px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                text-align: center;
                min-width: 300px;
            `;
            
            const spinner = document.createElement('div');
            spinner.innerHTML = '<div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>';
            
            const messageEl = document.createElement('div');
            messageEl.id = 'saving-progress-message';
            messageEl.style.cssText = 'font-size: 16px; color: #333; font-weight: 500;';
            messageEl.textContent = message;
            
            progressBox.appendChild(spinner);
            progressBox.appendChild(messageEl);
            overlay.appendChild(progressBox);
            document.body.appendChild(overlay);
            
            // Add spinner animation
            const style = document.createElement('style');
            style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        } else {
            overlay.style.display = 'flex';
            const messageEl = document.getElementById('saving-progress-message');
            if (messageEl) messageEl.textContent = message;
        }
    }

    hideSavingProgress() {
        const overlay = document.getElementById('saving-progress-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    async lockSnapshotFromCurrentView() {
        // Lock snapshot from the currently rendered view to preserve exact texts/icons
        try {
            // Ensure panels have rendered (either populated or empty-state) before scraping
            const waitForPanelsReady = async (timeoutMs = 6000) => {
                const start = Date.now();
                const containerIds = (this.panelConfigs || []).map(c => c.containerId).filter(Boolean);
                const isReady = () => containerIds.every(id => {
                    const el = document.getElementById(id);
                    if (!el) return true; // if panel not present, don't block
                    return !!(el.querySelector('.ranking-item') || el.querySelector('.rankings-empty'));
                });
                while ((Date.now() - start) < timeoutMs) {
                    if (isReady()) return true;
                    await new Promise(r => setTimeout(r, 150));
                }
                return false;
            };
            try { await waitForPanelsReady(); } catch {}

            const header = (()=>{
                try{
                    const stats = this.raidStats && this.raidStats.stats ? this.raidStats.stats : null;
                    const rpb = this.raidStats && this.raidStats.rpb ? this.raidStats.rpb : null;
                    return {
                        raidDurationMinutes: (stats && typeof stats.totalTime === 'number') ? stats.totalTime : null,
                        bossesKilled: (stats && typeof stats.bossesKilled === 'number') ? stats.bossesKilled : null,
                        lastBoss: (stats && stats.lastBoss) ? String(stats.lastBoss) : null,
                        wowLogsUrl: (stats && stats.logUrl) ? String(stats.logUrl) : null,
                        rpbArchiveUrl: (rpb && rpb.archiveUrl) ? String(rpb.archiveUrl) : null
                    };
                } catch { return null; }
            })();
            const entries = [];
            const norm = (s)=> String(s||'').trim();
            const normClass = (cls)=> this.normalizeClassName ? this.normalizeClassName(cls) : String(cls||'').toLowerCase();
            const lower = (s)=> String(s||'').toLowerCase();
            (this.panelConfigs||[]).forEach(cfg => {
                const list = document.getElementById(cfg.containerId);
                if (!list) return;
                const items = Array.from(list.querySelectorAll('.ranking-item'));
                items.forEach((item, idx) => {
                    const nameEl = item.querySelector('.character-name');
                    const infoEl = item.querySelector('.character-info');
                    const detailsEl = item.querySelector('.character-details');
                    const pointsEl = item.querySelector('.performance-amount .amount-value');
                    if (!nameEl) return;
                    const img = (infoEl && infoEl.querySelector) ? infoEl.querySelector('img') : (nameEl ? nameEl.querySelector('img') : null);
                    const itemKeyAttr = (cfg.key === 'windfury_totems' && item && item.getAttribute) ? (item.getAttribute('data-item-key') || null) : null;
                    // Class resolution: prefer DOM class on character-info, then nameEl, then logData, then fallback
                    let domClass = '';
                    try {
                        const c1 = infoEl ? Array.from(infoEl.classList).find(c => c.startsWith('class-')) : '';
                        const c2 = Array.from(nameEl.classList).find(c => c.startsWith('class-')) || '';
                        domClass = (c1 || c2 || '').replace('class-','');
                    } catch {}
                    let character_name = norm(nameEl.textContent || '').replace(/^[\s\S]*?\s{2,}/,'').trim();
                    if (!character_name && nameEl.childNodes && nameEl.childNodes.length) {
                        try { character_name = norm(Array.from(nameEl.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ')); } catch {}
                    }
                    let characterClass = domClass;
                    if (!characterClass && character_name) {
                        const row = (this.logData||[]).find(p => lower(p.character_name) === lower(character_name));
                        characterClass = row?.character_class || this.resolveClassForName && this.resolveClassForName(character_name) || '';
                    }
                    const normalizedClass = this.normalizeClassName ? this.normalizeClassName(characterClass) : String(characterClass||'').toLowerCase();
                    // Apply normalized class back to DOM so styling stays consistent
                    try {
                        if (infoEl && normalizedClass) {
                            // Remove any existing class-*
                            Array.from(infoEl.classList).filter(c=>c.startsWith('class-')).forEach(c=>infoEl.classList.remove(c));
                            infoEl.classList.add(`class-${normalizedClass}`);
                        }
                        if (nameEl && normalizedClass) {
                            Array.from(nameEl.classList).filter(c=>c.startsWith('class-')).forEach(c=>nameEl.classList.remove(c));
                            nameEl.classList.add(`class-${normalizedClass}`);
                        }
                    } catch {}
                    const details = detailsEl ? norm(detailsEl.textContent||'') : '';
                    const pts = pointsEl ? Math.round(Number(pointsEl.textContent||0)) : 0;
                    // Capture wf_tooltip attribute if present
                    const wfTooltip = detailsEl && detailsEl.getAttribute ? detailsEl.getAttribute('data-wf-tooltip') : null;
                    // Capture assignments_count for confirmed_assignments panel
                    const assignmentsCount = (cfg.key === 'confirmed_assignments' && item && item.getAttribute) ? (item.getAttribute('data-assignments-count') || null) : null;
                    entries.push({
                        panel_key: cfg.key,
                        panel_name: cfg.name,
                        discord_user_id: null,
                        character_name,
                        character_class: normalizedClass || null,
                        ranking_number_original: Number.isFinite(idx+1) ? (idx+1) : null,
                        point_value_original: pts,
                        character_details_original: details || null,
                        primary_numeric_original: null,
                        aux_json: (function(){ 
                            const o = {}; 
                            if (img && img.src) o.icon_url = img.src; 
                            if (itemKeyAttr) o.item_key = itemKeyAttr; 
                            if (wfTooltip) o.wf_tooltip = wfTooltip;
                            if (assignmentsCount) o.assignments_count = parseInt(assignmentsCount, 10);
                            return o; 
                        })()
                    });
                });
            });
            const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/lock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries, header })
            });
            if (res.ok) {
                await this.fetchSnapshotStatus();
                await this.fetchSnapshotData();
                this.applySnapshotOverlay();
                this.updateTotalPointsCard();
                this.updateGoldCards();
            }
        } catch (e) {
            console.error('❌ [SNAPSHOT] Lock failed', e);
        }
    }

    applySnapshotOverlay() {
        if (!this.snapshotEntries) return;
        const grouped = this.snapshotEntries.reduce((acc, row) => {
            (acc[row.panel_key] = acc[row.panel_key] || []).push(row);
            return acc;
        }, {});
        this.panelConfigs.forEach(cfg => {
            this.applySnapshotOverlayForPanel(cfg.key, cfg.containerId, grouped[cfg.key] || []);
        });
    }

    applySnapshotOverlayForPanel(panelKey, containerId, rows = null) {
        const list = document.getElementById(containerId);
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.ranking-item'));
        const entries = rows || (this.snapshotEntries || []).filter(r => r.panel_key === panelKey);

        // Map by character name (and item_key for multi-row panels like Totems) for matching
        // Prefer matching by discord_user_id when present to avoid name collisions (still include item_key when available)
        const isTotems = (panelKey === 'windfury_totems');
        const byDiscord = new Map(entries.filter(r => r.discord_user_id).map(r => {
            const itemKey = isTotems ? String((r.aux_json && (r.aux_json.item_key || (r.aux_json['item_key']))) || '') : '';
            const k = itemKey ? `${String(r.discord_user_id)}::${itemKey}` : String(r.discord_user_id);
            return [k, r];
        }));
        const byName = new Map(entries.map(r => {
            const itemKey = isTotems ? String((r.aux_json && (r.aux_json.item_key || (r.aux_json['item_key']))) || '') : '';
            const k = itemKey ? `${String(r.character_name)}::${itemKey}` : String(r.character_name);
            return [k, r];
        }));
        items.forEach((item, idx) => {
            const nameEl = item.querySelector('.character-name');
            const pointsEl = item.querySelector('.performance-amount .amount-value');
            const detailsEl = item.querySelector('.character-details');
            const rankEl = item.querySelector('.ranking-number');
            const playerName = nameEl ? nameEl.textContent.trim() : null;
            const rowItemKey = isTotems ? (item.getAttribute('data-item-key') || '') : '';
            let snap = playerName ? byName.get(rowItemKey ? `${playerName}::${rowItemKey}` : playerName) : null;
            if (!snap) {
                // Try to resolve via logData (has discord_id) and then map to snapshot by discord_user_id
                const lower = (playerName || '').toLowerCase();
                const row = (this.logData || []).find(p => String(p.character_name).toLowerCase() === lower);
                if (row && row.discord_id) {
                    const k1 = String(row.discord_id);
                    const k2 = rowItemKey ? `${k1}::${rowItemKey}` : k1;
                    snap = byDiscord.get(k2) || byDiscord.get(k1) || null;
                }
            }
            if (!snap) return;
            const effPoints = (snap.point_value_edited != null) ? snap.point_value_edited : snap.point_value_original;
            const effDetails = (snap.character_details_edited != null && snap.character_details_edited !== '') ? snap.character_details_edited : (snap.character_details_original || (detailsEl ? detailsEl.textContent : ''));
            if (pointsEl) {
                const intVal = Math.round(Number(effPoints) || 0);
                pointsEl.textContent = intVal;
                if (snap.point_value_edited != null) {
                    try { pointsEl.style.setProperty('color', '#ff00ff', 'important'); } catch {}
                    pointsEl.style.color = '#ff00ff';
                }
            }
            if (detailsEl) {
                detailsEl.textContent = effDetails;
            }
            if (rankEl && Number.isFinite(snap.ranking_number_original)) {
                rankEl.textContent = `#${snap.ranking_number_original}`;
            }
        });
    }

    displayPlayerStreaksRankings(players) {
        const container = document.getElementById('player-streaks-list');
        const section = container.closest('.rankings-section');
        section.classList.add('streak-section');

        if (!players || players.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-fire"></i>
                    <p>No players with 4+ week attendance streak in this raid</p>
                </div>
            `;
            return;
        }

        console.log(`🔥 Displaying ${players.length} players with streaks >= 4`);

        // Calculate points for each player based on streak
        const calculatePoints = (streak) => {
            if (streak <= 3) return 0;
            if (streak === 4) return 3;
            if (streak === 5) return 6;
            if (streak === 6) return 9;
            if (streak === 7) return 12;
            return 15; // 8+ weeks
        };

        // Get max streak for percentage calculation
        const maxStreak = Math.max(...players.map(p => p.player_streak));

        container.innerHTML = players.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const points = calculatePoints(player.player_streak);
            const fillPercentage = Math.round((player.player_streak / maxStreak) * 100);
            
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%">
                        <div class="character-name">${this.getClassIconHtml(player.character_class)}${player.character_name}</div>
                        <div class="character-details" title="${player.player_streak} consecutive weeks">
                            ${player.player_streak} weeks
                        </div>
                    </div>
                    <div class="performance-amount">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayGuildMembersRankings(players) {
        const container = document.getElementById('guild-members-list');
        const section = container.closest('.rankings-section');
        section.classList.add('guild-section');

        if (!players || players.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-shield-alt"></i>
                    <p>No guild members found in this raid</p>
                </div>
            `;
            return;
        }

        console.log(`🏰 Displaying ${players.length} guild members`);

        // Sort by points (10pt first, then 5pt) then alphabetically
        const sortedPlayers = [...players].sort((a, b) => {
            const ptsA = Number(a.points) || 0;
            const ptsB = Number(b.points) || 0;
            if (ptsB !== ptsA) return ptsB - ptsA;
            return String(a.character_name).localeCompare(String(b.character_name));
        });

        container.innerHTML = sortedPlayers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const points = Number(player.points) || 10;
            const isAlt = points === 5 || !player.is_raid_char_in_guild;
            const fillPercentage = (points / 10) * 100; // 10pts = 100%, 5pts = 50%
            
            // Build details text
            let detailsText = 'Guild Member';
            if (isAlt && player.guild_character_name && 
                String(player.guild_character_name).toLowerCase() !== String(player.character_name).toLowerCase()) {
                detailsText += ' (But on another character)';
            }
            
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%">
                        <div class="character-name">${this.getClassIconHtml(player.character_class)}${player.character_name}</div>
                        <div class="character-details" title="Guild member: ${player.guild_character_name}">
                            ${detailsText}
                        </div>
                    </div>
                    <div class="performance-amount ${points === 5 ? 'partial-points' : ''}">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayWeeklyNaxRaidsRankings(players) {
        const container = document.getElementById('weekly-nax-raids-list');
        const section = container ? container.closest('.rankings-section') : null;
        if (section) section.classList.add('weekly-nax-section');

        if (!container) {
            console.warn('⚠️ Weekly NAX raids container not found');
            return;
        }

        if (!players || players.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-calendar-week"></i>
                    <p>No players with 2+ NAX raids this week</p>
                </div>
            `;
            return;
        }

        console.log(`🏆 Displaying ${players.length} weekly NAX raid champions`);

        // Sort by raid count (highest first), then by points, then alphabetically
        const sortedPlayers = [...players].sort((a, b) => {
            const countA = Number(a.raid_count) || 0;
            const countB = Number(b.raid_count) || 0;
            if (countB !== countA) return countB - countA;
            const ptsA = Number(a.points) || 0;
            const ptsB = Number(b.points) || 0;
            if (ptsB !== ptsA) return ptsB - ptsA;
            return String(a.character_name).localeCompare(String(b.character_name));
        });

        const maxRaidCount = Math.max(...sortedPlayers.map(p => p.raid_count));

        container.innerHTML = sortedPlayers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const points = Number(player.points) || 0;
            const raidCount = Number(player.raid_count) || 0;
            const fillPercentage = Math.min(100, Math.round((raidCount / maxRaidCount) * 100));
            
            // Build details text showing which raid # this is
            const ordinal = raidCount === 2 ? '2nd' : raidCount === 3 ? '3rd' : `${raidCount}th`;
            const detailsText = `${ordinal} raid this week`;
            
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%">
                        <div class="character-name">${this.getClassIconHtml(player.character_class)}${player.character_name}</div>
                        <div class="character-details" title="${raidCount} NAX raids this week">
                            ${detailsText}
                        </div>
                    </div>
                    <div class="performance-amount">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    calculateGodGamerDPS(players) {
        if (players.length < 2) {
            return null; // Need at least 2 players to compare
        }

        const firstPlace = parseInt(players[0].damage_amount) || 0;
        const secondPlace = parseInt(players[1].damage_amount) || 0;
        const difference = firstPlace - secondPlace;

        console.log(`⚔️ [GOD GAMER DPS] #1: ${players[0].character_name} (${firstPlace.toLocaleString()}) vs #2: ${players[1].character_name} (${secondPlace.toLocaleString()}) = ${difference.toLocaleString()} difference`);

        if (difference >= 250000) {
            return {
                ...players[0],
                title: "God Gamer DPS",
                points: 30,
                trophy: "gold",
                difference: difference,
                secondPlace: players[1]
            };
        } else if (difference >= 150000) {
            return {
                ...players[0],
                title: "Demi God DPS",
                points: 20,
                trophy: "silver",
                difference: difference,
                secondPlace: players[1]
            };
        }

        return null; // Difference not large enough
    }

    calculateGodGamerHealer(players) {
        if (players.length < 2) {
            return null; // Need at least 2 players to compare
        }

        const firstPlace = parseInt(players[0].healing_amount) || 0;
        const secondPlace = parseInt(players[1].healing_amount) || 0;
        const difference = firstPlace - secondPlace;

        console.log(`❤️ [GOD GAMER HEALER] #1: ${players[0].character_name} (${firstPlace.toLocaleString()}) vs #2: ${players[1].character_name} (${secondPlace.toLocaleString()}) = ${difference.toLocaleString()} difference`);

        if (difference >= 250000) {
            return {
                ...players[0],
                title: "God Gamer Healer",
                points: 20,
                trophy: "gold",
                difference: difference,
                secondPlace: players[1]
            };
        } else if (difference >= 150000) {
            return {
                ...players[0],
                title: "Demi God Healer",
                points: 15,
                trophy: "silver",
                difference: difference,
                secondPlace: players[1]
            };
        }

        return null; // Difference not large enough
    }

    displayGodGamerDPS(godGamer) {
        const container = document.getElementById('god-gamer-dps-list');
        const section = container.closest('.rankings-section');
        
        if (!godGamer) {
            // Hide the entire section if no god gamer
            section.style.display = 'none';
            return;
        }

        // Show the section
        section.style.display = 'block';
        section.classList.add('god-gamer-dps');

        const characterClass = this.normalizeClassName(godGamer.character_class);
        const formattedDamage = this.formatNumber(parseInt(godGamer.damage_amount) || 0);
        const formattedDifference = this.formatNumber(godGamer.difference);
        const trophyIcon = godGamer.trophy === 'gold' ? 
            '<i class="fas fa-trophy trophy-icon gold"></i>' : 
            '<i class="fas fa-trophy trophy-icon silver"></i>';

        container.innerHTML = `
            <div class="ranking-item">
                <div class="ranking-position">
                    ${trophyIcon}
                </div>
                <div class="character-info class-${characterClass}" style="--fill-percentage: 100%;">
                    <div class="character-name">
                        ${this.getSpecIconHtml(godGamer.spec_name, godGamer.character_class)}${godGamer.character_name}
                    </div>
                    <div class="character-details" title="${formattedDamage} damage (+${formattedDifference} over #2)">
                        ${formattedDamage} damage (+${formattedDifference} ahead)
                    </div>
                </div>
                <div class="performance-amount" title="${godGamer.title}: ${formattedDifference} more damage than ${godGamer.secondPlace.character_name}">
                    <div class="amount-value">${godGamer.points}</div>
                    <div class="points-label">points</div>
                </div>
            </div>
        `;
    }
    displayGodGamerHealer(godGamer) {
        const container = document.getElementById('god-gamer-healer-list');
        const section = container.closest('.rankings-section');
        
        if (!godGamer) {
            // Hide the entire section if no god gamer
            section.style.display = 'none';
            return;
        }

        // Show the section
        section.style.display = 'block';
        section.classList.add('god-gamer-healer');

        const characterClass = this.normalizeClassName(godGamer.character_class);
        const formattedHealing = this.formatNumber(parseInt(godGamer.healing_amount) || 0);
        const formattedDifference = this.formatNumber(godGamer.difference);
        const trophyIcon = godGamer.trophy === 'gold' ? 
            '<i class="fas fa-trophy trophy-icon gold"></i>' : 
            '<i class="fas fa-trophy trophy-icon silver"></i>';

        container.innerHTML = `
            <div class="ranking-item">
                <div class="ranking-position">
                    ${trophyIcon}
                </div>
                <div class="character-info class-${characterClass}" style="--fill-percentage: 100%;">
                    <div class="character-name">
                        ${this.getSpecIconHtml(godGamer.spec_name, godGamer.character_class)}${godGamer.character_name}
                    </div>
                    <div class="character-details" title="${formattedHealing} healing (+${formattedDifference} over #2)">
                        ${formattedHealing} healing (+${formattedDifference} ahead)
                    </div>
                </div>
                <div class="performance-amount" title="${godGamer.title}: ${formattedDifference} more healing than ${godGamer.secondPlace.character_name}">
                    <div class="amount-value">${godGamer.points}</div>
                    <div class="points-label">points</div>
                </div>
            </div>
        `;
    }
    displayDamageRankings(players) {
        const container = document.getElementById('damage-dealers-list');
        const section = container.closest('.rankings-section');
        section.classList.add('damage');

        // Get dynamic damage points array
        const damagePoints = this.rewardSettings.damage?.points_array || [80, 70, 55, 40, 35, 30, 25, 20, 15, 10, 8, 6, 5, 4, 3];

        // Filter out players with 0 points and preserve original position
        const playersWithPoints = players.map((player, index) => ({
            ...player,
            originalPosition: index + 1
        })).filter(player => {
            const points = player.originalPosition <= damagePoints.length ? damagePoints[player.originalPosition - 1] : 0;
            return points > 0;
        });

        if (playersWithPoints.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-sword"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max damage for percentage calculation
        const maxDamage = parseInt(playersWithPoints[0].damage_amount) || 1;

        container.innerHTML = playersWithPoints.map((player, index) => {
            const position = player.originalPosition;
            const trophyHtml = this.getTrophyHtml(position);
            const characterClass = this.normalizeClassName(player.character_class);
            const formattedDamage = this.formatNumber(parseInt(player.damage_amount) || 0);
            const playerDamage = parseInt(player.damage_amount) || 0;
            const fillPercentage = Math.max(5, (playerDamage / maxDamage) * 100); // Minimum 5% for visibility
            
            // Calculate points (based on array length, rest get 0)
            const points = position <= damagePoints.length ? damagePoints[position - 1] : 0;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        ${trophyHtml}
                        ${position <= 3 ? '' : `<span class="ranking-number">#${position}</span>`}
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedDamage} damage">
                            ${this.truncateWithTooltip(`${formattedDamage} damage`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${(parseInt(player.damage_amount) || 0).toLocaleString()} damage">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    displayHealerRankings(players) {
        const container = document.getElementById('healers-list');
        const section = container.closest('.rankings-section');
        section.classList.add('healing');

        // Get dynamic healing points array
        const healingPoints = this.rewardSettings.healing?.points_array || [80, 65, 60, 55, 40, 35, 30, 20, 15, 10];

        // Filter out players with 0 points and preserve original position
        const playersWithPoints = players.map((player, index) => ({
            ...player,
            originalPosition: index + 1
        })).filter(player => {
            const points = player.originalPosition <= healingPoints.length ? healingPoints[player.originalPosition - 1] : 0;
            return points > 0;
        });

        if (playersWithPoints.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-heart"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max healing for percentage calculation
        const maxHealing = parseInt(playersWithPoints[0].healing_amount) || 1;

        container.innerHTML = playersWithPoints.map((player, index) => {
            const position = player.originalPosition;
            const trophyHtml = this.getTrophyHtml(position);
            const characterClass = this.normalizeClassName(player.character_class);
            const formattedHealing = this.formatNumber(parseInt(player.healing_amount) || 0);
            const playerHealing = parseInt(player.healing_amount) || 0;
            const fillPercentage = Math.max(5, (playerHealing / maxHealing) * 100); // Minimum 5% for visibility
            
            // Calculate points (based on array length, rest get 0)
            const points = position <= healingPoints.length ? healingPoints[position - 1] : 0;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        ${trophyHtml}
                        ${position <= 3 ? '' : `<span class="ranking-number">#${position}</span>`}
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedHealing} healing">
                            ${this.truncateWithTooltip(`${formattedHealing} healing`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${(parseInt(player.healing_amount) || 0).toLocaleString()} healing">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayTooLowDamageRankings(players) {
        const container = document.getElementById('too-low-damage-list');
        const section = container.closest('.rankings-section');
        section.classList.add('too-low-damage');

        // Get active fight time in seconds (convert from minutes)
        const activeFightTimeSeconds = (this.raidStats.stats && this.raidStats.stats.activeFightTime) 
            ? this.raidStats.stats.activeFightTime * 60 
            : null;

        if (!activeFightTimeSeconds) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Active fight time not available</p>
                </div>
            `;
            return;
        }

        // Filter players by primary role - only show DPS players
        let filteredPlayers = players;
        if (this.primaryRoles) {
            console.log(`🎯 [TOO LOW DAMAGE] Filtering ${players.length} players by primary role`);
            filteredPlayers = players.filter(player => {
                const playerName = player.character_name.toLowerCase();
                const primaryRole = this.primaryRoles[playerName];
                const isDPS = primaryRole === 'dps';
                
                if (!isDPS && primaryRole) {
                    console.log(`🚫 [TOO LOW DAMAGE] Excluding ${player.character_name} (primary role: ${primaryRole})`);
                }
                
                return isDPS;
            });
            console.log(`✅ [TOO LOW DAMAGE] Filtered to ${filteredPlayers.length} DPS players`);
        } else {
            console.log('⚠️ [TOO LOW DAMAGE] No primary roles data available, showing all players');
        }

        // Calculate DPS and filter players with penalty points
        const playersWithPenalties = filteredPlayers.map(player => {
            const damage = parseFloat(player.damage_amount) || 0;
            const dps = damage / activeFightTimeSeconds;
            
            let points = 0;
            if (dps < 150) {
                points = -100;
            } else if (dps < 200) {
                points = -50;
            } else if (dps < 250) {
                points = -25;
            }

            return {
                ...player,
                dps: dps,
                points: points
            };
        }).filter(player => player.points < 0) // Only show players with penalties
          .sort((a, b) => a.dps - b.dps); // Sort by DPS ascending (worst first)

        if (playersWithPenalties.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-thumbs-up"></i>
                    <p>All damage dealers have adequate DPS!</p>
                </div>
            `;
            return;
        }
        // Get max DPS for percentage calculation (use highest DPS even if it's low)
        const maxDPS = Math.max(...playersWithPenalties.map(p => p.dps), 1);

        container.innerHTML = playersWithPenalties.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const formattedDamage = this.formatNumber(parseInt(player.damage_amount) || 0);
            const fillPercentage = Math.max(5, (player.dps / maxDPS) * 100); // Minimum 5% for visibility
            
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedDamage} damage (${player.dps.toFixed(1)} DPS)">
                            ${this.truncateWithTooltip(`${player.dps.toFixed(1)} DPS`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.dps.toFixed(1)} damage per second">
                        <div class="amount-value negative">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayTooLowHealingRankings(players) {
        const container = document.getElementById('too-low-healing-list');
        const section = container.closest('.rankings-section');
        section.classList.add('too-low-healing');

        // Get active fight time in seconds (convert from minutes)
        const activeFightTimeSeconds = (this.raidStats.stats && this.raidStats.stats.activeFightTime) 
            ? this.raidStats.stats.activeFightTime * 60 
            : null;

        if (!activeFightTimeSeconds) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Active fight time not available</p>
                </div>
            `;
            return;
        }

        // Filter players by primary role - only show healer players
        let filteredPlayers = players;
        if (this.primaryRoles) {
            console.log(`🎯 [TOO LOW HEALING] Filtering ${players.length} players by primary role`);
            filteredPlayers = players.filter(player => {
                const playerName = player.character_name.toLowerCase();
                const primaryRole = this.primaryRoles[playerName];
                const isHealer = primaryRole === 'healer';
                
                if (!isHealer && primaryRole) {
                    console.log(`🚫 [TOO LOW HEALING] Excluding ${player.character_name} (primary role: ${primaryRole})`);
                }
                
                return isHealer;
            });
            console.log(`✅ [TOO LOW HEALING] Filtered to ${filteredPlayers.length} healer players`);
        } else {
            console.log('⚠️ [TOO LOW HEALING] No primary roles data available, showing all players');
        }

        // Calculate HPS and filter players with penalty points
        const playersWithPenalties = filteredPlayers.map(player => {
            const healing = parseFloat(player.healing_amount) || 0;
            const hps = healing / activeFightTimeSeconds;
            
            let points = 0;
            if (hps < 85) {
                points = -100;
            } else if (hps < 100) {
                points = -50;
            } else if (hps < 125) {
                points = -25;
            }

            return {
                ...player,
                hps: hps,
                points: points
            };
        }).filter(player => player.points < 0) // Only show players with penalties
          .sort((a, b) => a.hps - b.hps); // Sort by HPS ascending (worst first)

        if (playersWithPenalties.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-thumbs-up"></i>
                    <p>All healers have adequate HPS!</p>
                </div>
            `;
            return;
        }

        // Get max HPS for percentage calculation (use highest HPS even if it's low)
        const maxHPS = Math.max(...playersWithPenalties.map(p => p.hps), 1);

        container.innerHTML = playersWithPenalties.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const formattedHealing = this.formatNumber(parseInt(player.healing_amount) || 0);
            const fillPercentage = Math.max(5, (player.hps / maxHPS) * 100); // Minimum 5% for visibility
            
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedHealing} healing (${player.hps.toFixed(1)} HPS)">
                            ${this.truncateWithTooltip(`${player.hps.toFixed(1)} HPS`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.hps.toFixed(1)} healing per second">
                        <div class="amount-value negative">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayShamanHealers(healers) {
        const container = document.getElementById('shaman-healers-list');
        const section = container.closest('.rankings-section');
        
        // When not in snapshot mode, use full logData to catch all shamans with healer role
        const sourceList = !this.snapshotLocked ? 
            (this.logData || []).filter(p => {
                const nameKey = String(p.character_name || '').trim().toLowerCase();
                const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
                return primaryRole === 'healer' && !this.shouldIgnorePlayer(p.character_name);
            }).sort((a, b) => (parseInt(b.healing_amount) || 0) - (parseInt(a.healing_amount) || 0)) :
            healers;
        
        // Filter shamans and take top 3 (sorted by healing desc)
        const toNum = (v)=> {
            const raw = String(v==null?0:v).trim().toLowerCase();
            const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/);
            if (m) {
                let n = parseFloat(m[1]);
                const suf = m[2];
                if (suf === 'k') n *= 1e3; else if (suf === 'm') n *= 1e6; else if (suf === 'b') n *= 1e9;
                return Number.isFinite(n)?n:0;
            }
            const digits = raw.replace(/[^0-9.]/g, '');
            const n = Number(digits);
            return Number.isFinite(n)?n:0;
        };
        const shamanHealers = sourceList
            .filter(player => {
                const className = (player.character_class || '').toLowerCase();
                return className.includes('shaman');
            })
            .sort((a,b)=> toNum(b.healing_amount) - toNum(a.healing_amount))
            .slice(0, 3); // Top 3 shamans

        if (shamanHealers.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        section.classList.add('shaman-healers');

        const pointsArray = [25, 20, 15]; // Points for positions 1, 2, 3
        const maxHealing = Math.max(1, toNum(shamanHealers[0]?.healing_amount));

        container.innerHTML = shamanHealers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const rawHeal = toNum(player.healing_amount);
            const formattedHealing = this.formatNumber(rawHeal || 0);
            const playerHealing = rawHeal;
            let fillPercentage = (playerHealing / maxHealing) * 100;
            if (index === 0) fillPercentage = 100; // ensure #1 is full width
            fillPercentage = Math.max(5, Math.min(100, Math.round(fillPercentage)));
            const points = pointsArray[index] || 0;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedHealing} healing">
                            ${this.truncateWithTooltip(`${formattedHealing} healing`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${(parseInt(player.healing_amount) || 0).toLocaleString()} healing">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayPriestHealers(healers) {
        const container = document.getElementById('priest-healers-list');
        const section = container.closest('.rankings-section');
        
        // When not in snapshot mode, use full logData to catch all priests with healer role
        const sourceList = !this.snapshotLocked ? 
            (this.logData || []).filter(p => {
                const nameKey = String(p.character_name || '').trim().toLowerCase();
                const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
                return primaryRole === 'healer' && !this.shouldIgnorePlayer(p.character_name);
            }).sort((a, b) => (parseInt(b.healing_amount) || 0) - (parseInt(a.healing_amount) || 0)) :
            healers;
        
        // Filter priests and take top 2 (sorted by healing desc)
        const toNum = (v)=> {
            const raw = String(v==null?0:v).trim().toLowerCase();
            const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/);
            if (m) {
                let n = parseFloat(m[1]);
                const suf = m[2];
                if (suf === 'k') n *= 1e3; else if (suf === 'm') n *= 1e6; else if (suf === 'b') n *= 1e9;
                return Number.isFinite(n)?n:0;
            }
            const digits = raw.replace(/[^0-9.]/g, '');
            const n = Number(digits);
            return Number.isFinite(n)?n:0;
        };
        const priestHealers = sourceList
            .filter(player => {
                const className = (player.character_class || '').toLowerCase();
                return className.includes('priest');
            })
            .sort((a,b)=> toNum(b.healing_amount) - toNum(a.healing_amount))
            .slice(0, 2); // Top 2 priests

        if (priestHealers.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        section.classList.add('priest-healers');

        const pointsArray = [20, 15]; // Points for positions 1, 2
        const maxHealing = Math.max(1, toNum(priestHealers[0]?.healing_amount));

        container.innerHTML = priestHealers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const rawHeal = toNum(player.healing_amount);
            const formattedHealing = this.formatNumber(rawHeal || 0);
            const playerHealing = rawHeal;
            let fillPercentage = (playerHealing / maxHealing) * 100;
            if (index === 0) fillPercentage = 100;
            fillPercentage = Math.max(5, Math.min(100, Math.round(fillPercentage)));
            const points = pointsArray[index] || 0;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedHealing} healing">
                            ${this.truncateWithTooltip(`${formattedHealing} healing`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${(parseInt(player.healing_amount) || 0).toLocaleString()} healing">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    displayDruidHealers(healers) {
        const container = document.getElementById('druid-healers-list');
        const section = container.closest('.rankings-section');
        
        // Filter druids - when not in snapshot mode, use full logData to catch all druids with healer role
        const sourceList = !this.snapshotLocked ? 
            (this.logData || []).filter(p => {
                const nameKey = String(p.character_name || '').trim().toLowerCase();
                const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
                return primaryRole === 'healer' && !this.shouldIgnorePlayer(p.character_name);
            }).sort((a, b) => (parseInt(b.healing_amount) || 0) - (parseInt(a.healing_amount) || 0)) :
            healers;
        
        const druidHealers = sourceList
            .filter(player => {
                const className = (player.character_class || '').toLowerCase();
                return className.includes('druid');
            })
            .slice(0, 1); // Top 1 druid

        if (druidHealers.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        section.classList.add('druid-healers');

        const pointsArray = [15]; // Points for position 1
        const toNum = (v)=> { const s=String(v==null?0:v).replace(/[\,\s]/g,''); const n=Number(s); return Number.isFinite(n)?n:0; };
        const maxHealing = Math.max(1, toNum(druidHealers[0].healing_amount));

        container.innerHTML = druidHealers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const rawHeal = toNum(player.healing_amount);
            const formattedHealing = this.formatNumber(rawHeal || 0);
            const playerHealing = rawHeal;
            const fillPercentage = 100; // Single row, keep at 100%
            const points = pointsArray[index] || 0;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedHealing} healing">
                            ${this.truncateWithTooltip(`${formattedHealing} healing`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${(parseInt(player.healing_amount) || 0).toLocaleString()} healing">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayAbilitiesRankings(players) {
        const container = document.getElementById('abilities-list');
        const section = container.closest('.rankings-section');
        section.classList.add('abilities');

        // Filter out players with 0 abilities used and sort by total_used (highest first)
        const playersWithAbilities = players.filter(player => player.total_used > 0)
            .sort((a, b) => b.total_used - a.total_used);

        if (playersWithAbilities.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-bomb"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }
        // Get max abilities used for percentage calculation
        const maxAbilities = Math.max(...playersWithAbilities.map(p => p.total_used)) || 1;

        container.innerHTML = playersWithAbilities.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            let fillPercentage = (player.total_used / maxAbilities) * 100;
            if (index === 0) fillPercentage = 100;
            fillPercentage = Math.max(5, Math.min(100, Math.round(fillPercentage)));

            // Create breakdown of abilities used
            const abilities = [];
            if (player.dense_dynamite > 0) abilities.push(`${player.dense_dynamite} Dynamite`);
            if (player.goblin_sapper_charge > 0) abilities.push(`${player.goblin_sapper_charge} Sappers`);
            if (player.stratholme_holy_water > 0) abilities.push(`${player.stratholme_holy_water} Holy Water`);
            
            const abilitiesText = abilities.join(', ') || 'No abilities used';

            // Build calculation tooltip
            const divisor = Number(this.abilitiesSettings?.calculation_divisor || 10);
            const maxPts = Number(this.abilitiesSettings?.max_points || 20);
            const rawCalc = Math.floor((Number(player.total_used||0) * Number(player.avg_targets_hit||0)) / divisor);
            const finalPts = Math.min(maxPts, rawCalc);
            const dd = Number(player.dense_dynamite||0), ddt = Number(player.dense_dynamite_targets||0);
            const gs = Number(player.goblin_sapper_charge||0), gst = Number(player.goblin_sapper_targets||0);
            const hw = Number(player.stratholme_holy_water||0), hwt = Number(player.stratholme_targets||0);
            const calcTooltip = [
                `Dense Dynamite: ${dd} (avg ${ddt})`,
                `Goblin Sapper: ${gs} (avg ${gst})`,
                `Holy Water: ${hw} (avg ${hwt})`,
                `Total used: ${player.total_used}`,
                `Weighted avg targets: ${Number(player.avg_targets_hit||0).toFixed(1)}`,
                `Formula: floor((Total × Avg) ÷ ${divisor}) = ${rawCalc}`,
                maxPts !== finalPts ? `Capped at max ${maxPts} → ${finalPts}` : `Points: ${finalPts}`
            ].join('\n');

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${calcTooltip}">
                            ${this.truncateWithTooltip(abilitiesText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="Total: ${player.total_used} abilities, Avg targets: ${player.avg_targets_hit.toFixed(1)}">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateAbilitiesHeader() {
        const headerElement = document.querySelector('.abilities-section .section-header p');
        if (headerElement && this.abilitiesSettings) {
            const { calculation_divisor, max_points } = this.abilitiesSettings;
            headerElement.textContent = `Ranked by calculated points (abilities used × avg targets ÷ ${calculation_divisor}, max ${max_points})`;
        }
    }
    displayWorldBuffsRankings(players) {
        const container = document.getElementById('world-buffs-list');
        if (!container) return;
        
        const section = container.closest('.rankings-section');
        section.classList.add('world-buffs');

        // Filter players by primary role - only show DPS players (for frost resistance)
        let filteredPlayers = players;
        if (this.primaryRoles) {
            console.log(`🧊 [FROST RESISTANCE] Filtering ${players.length} players by primary role`);
            filteredPlayers = players.filter(player => {
                const playerName = player.character_name.toLowerCase();
                const primaryRole = this.primaryRoles[playerName];
                const isDPS = primaryRole === 'dps';
                
                if (!isDPS && primaryRole) {
                    console.log(`🚫 [FROST RESISTANCE] Excluding ${player.character_name} (primary role: ${primaryRole})`);
                }
                
                return isDPS;
            });
            console.log(`✅ [FROST RESISTANCE] Filtered to ${filteredPlayers.length} DPS players`);
        } else {
            console.log('⚠️ [FROST RESISTANCE] No primary roles data available, showing all players');
        }

        // Filter out players with 0 points for display, but keep all players for progress calculations
        const playersToDisplay = filteredPlayers.filter(player => player.points !== 0);
        
        // Use all filtered players (including 0-point players) to calculate max frost resistance for progress bars
        const maxFrostResForProgress = Math.max(...filteredPlayers.map(p => p.frost_resistance), 1);
        
        console.log(`🧊 [FROST RESISTANCE] Total DPS players: ${filteredPlayers.length}, Displaying: ${playersToDisplay.length} (excluding 0-point players)`);
        console.log(`🧊 [FROST RESISTANCE] Max frost resistance for progress bars: ${maxFrostResForProgress}`);
        
        if (playersToDisplay.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-snowflake"></i>
                    <p>All DPS players have adequate frost resistance!</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = playersToDisplay.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class || 'unknown');
            
            // Recalculate progress percentage using all players' max frost resistance (including 0-point players)
            const fillPercentage = Math.max(5, maxFrostResForProgress > 0 ? Math.round((player.frost_resistance / maxFrostResForProgress) * 100) : 0);
            
            console.log(`🧊 [FROST RESISTANCE] ${player.character_name}: class=${player.character_class} -> normalized=${characterClass}, frost_res=${player.frost_resistance}, fill=${fillPercentage}%, type=${player.dps_type}`);
            
            // Determine frost resistance status for styling
            let frostResClass = 'buff-count';
            const isPhysical = player.dps_type === 'physical';
            const isCaster = player.dps_type === 'caster';
            
            if (isPhysical) {
                if (player.frost_resistance < 80) {
                    frostResClass += ' low';
                } else if (player.frost_resistance < 130) {
                    frostResClass += ' medium';
                } else {
                    frostResClass += ' high';
                }
            } else if (isCaster) {
                if (player.frost_resistance < 80) {
                    frostResClass += ' low';
                } else if (player.frost_resistance < 150) {
                    frostResClass += ' medium';
                } else {
                    frostResClass += ' high';
                }
            }

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name class-${characterClass}">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                    <div class="character-details">
                            <div class="${frostResClass}">${player.frost_resistance} frost resistance</div>
                        </div>
                    </div>
                    <div class="performance-amount" title="Points: ${player.points} (${player.dps_type} DPS)">
                        <div class="amount-value ${player.points < 0 ? 'negative' : ''}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateWorldBuffsHeader() {
        const headerElement = document.getElementById('world-buffs-header-text');
        if (headerElement) {
            headerElement.textContent = `Points for frost resistance (Physical: -5 <130, -10 <80 | Caster: -5 <150, -10 <80)`;
        }
    }
    displayWorldBuffsCopyRankings(players) {
        const container = document.getElementById('world-buffs-copy-list');
        const section = container.closest('.rankings-section');
        section.classList.add('world-buffs');

        // Filter to only show players with fewer than required buffs
        const required = this.worldBuffsRequiredBuffs || 6;
        const playersWithMissingBuffs = players.filter(player => 
            player.total_buffs < required
        );

        // Sort players by points (highest first, least negative), then by total buffs
        const sortedPlayers = [...playersWithMissingBuffs].sort((a, b) => {
            if (b.points !== a.points) {
                return b.points - a.points; // Higher points first (less negative)
            }
            return b.total_buffs - a.total_buffs; // Then by total buffs
        });

        // Calculate max buffs for progress bar (highest buff count in the raid)
        const maxBuffsInRaid = Math.max(...players.map(p => p.total_buffs), 1);

        if (sortedPlayers.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>All players meet the required buffs (${required}+)</p>
                </div>
            `;
            return;
        }

        // Update header text based on required buffs
        this.updateWorldBuffsCopyHeader();

        console.log(`🌍 [WORLD BUFFS COPY] Displaying ${sortedPlayers.length} players with missing buffs (max buffs in raid: ${maxBuffsInRaid})`);
        
        container.innerHTML = sortedPlayers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class || 'unknown');
            
            // Calculate fill percentage based on buff count vs max in raid (for progress bar)
            const fillPercentage = Math.max(5, (player.total_buffs / maxBuffsInRaid) * 100);
            
            console.log(`🌍 [WORLD BUFFS COPY] ${player.character_name}: class=${player.character_class} -> normalized=${characterClass}, buffs=${player.total_buffs}/${maxBuffsInRaid}, fill=${fillPercentage}%`);
            
            // Determine buff count status for styling
            let buffCountClass = 'buff-count';
            if (player.total_buffs < this.worldBuffsRequiredBuffs - 2) {
                buffCountClass += ' low';
            } else if (player.total_buffs < this.worldBuffsRequiredBuffs) {
                buffCountClass += ' medium';
            } else {
                buffCountClass += ' high';
            }

            // Create missing buffs text
            let missingBuffsText = '';
            if (player.missing_buffs && player.missing_buffs.length > 0) {
                console.log(`🌍 [FRONTEND] ${player.character_name} has missing_buffs:`, player.missing_buffs, 'includeDMF:', this.worldBuffsIncludeDMF);
                const shortNames = player.missing_buffs
                    .filter(buff => {
                        // Only show DMF as missing if at least 10 players have it
                        if (buff === 'DMF') {
                            console.log(`🌍 [FRONTEND] Player ${player.character_name} missing DMF, includeDMF: ${this.worldBuffsIncludeDMF}`);
                            return this.worldBuffsIncludeDMF;
                        }
                        return true;
                    })
                    .map(buff => {
                        // Map category names to display names
                        switch(buff) {
                            case 'Ony': return 'Ony';
                            case 'Rend': return 'Rend';
                            case 'ZG': return 'ZG';
                            case 'Songflower': return 'Songflower';
                            case 'DM Tribute': return 'DM Tribute';
                            case 'DMF': return 'DMF';
                            default: return buff;
                        }
                    });
                
                if (shortNames.length > 0) {
                    missingBuffsText = `Missing: ${shortNames.join(', ')}`;
                }
            }

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name class-${characterClass}">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                    <div class="character-details">
                            <div class="${buffCountClass}">${player.total_buffs} buffs</div>
                        </div>
                    </div>
                    <div class="performance-amount" title="Points: ${player.points} (${player.points < 0 ? player.points / -10 : 0} missing buffs)">
                        <div class="amount-value ${player.points < 0 ? 'negative' : ''}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateWorldBuffsCopyHeader() {
        const headerElement = document.getElementById('world-buffs-copy-header-text');
        if (headerElement && this.worldBuffsRequiredBuffs) {
            headerElement.textContent = `Points for missing world buffs (-10 per buff below ${this.worldBuffsRequiredBuffs})`;
        }
        // Also update the title if present (ensure it reads "World Buffs")
        const section = document.getElementById('world-buffs-copy-list')?.closest('.rankings-section');
        const h2 = section ? section.querySelector('.section-header h2') : null;
        if (h2) {
            h2.innerHTML = `<img src="https://wow.zamimg.com/images/wow/icons/large/spell_arcane_teleportorgrimmar.jpg" alt="World Buffs" style="width: 24px; height: 24px; margin-right: 8px;"> World Buffs`;
        }
    }



    updateArchiveButtons() {
        // Update World Buffs archive button (now shows Frost Resistance data)
        const worldBuffsButton = document.getElementById('world-buffs-archive-button');
        if (worldBuffsButton) {
            if (this.frostResistanceArchiveUrl) {
                worldBuffsButton.classList.remove('disabled');
                worldBuffsButton.onclick = () => window.open(this.frostResistanceArchiveUrl, '_blank');
                worldBuffsButton.title = 'View archived Frost Resistance sheet';
                console.log(`🧊 Frost Resistance archive button enabled with URL: ${this.frostResistanceArchiveUrl}`);
            } else {
                worldBuffsButton.classList.add('disabled');
                worldBuffsButton.onclick = null;
                worldBuffsButton.title = 'No archived Frost Resistance sheet found for this event';
                console.log(`🧊 Frost Resistance archive button disabled - no URL found`);
            }
        }

        // Update World Buffs archive button
        const worldBuffsCopyButton = document.getElementById('world-buffs-copy-archive-button');
        if (worldBuffsCopyButton) {
            if (this.worldBuffsArchiveUrl) {
                worldBuffsCopyButton.classList.remove('disabled');
                worldBuffsCopyButton.onclick = () => window.open(this.worldBuffsArchiveUrl, '_blank');
                worldBuffsCopyButton.title = 'View archived World Buffs sheet';
                console.log(`🌍 World Buffs archive button enabled with URL: ${this.worldBuffsArchiveUrl}`);
            } else {
                worldBuffsCopyButton.classList.add('disabled');
                worldBuffsCopyButton.onclick = null;
                worldBuffsCopyButton.title = 'No archived World Buffs sheet found for this event';
                console.log(`🌍 World Buffs archive button disabled - no URL found`);
            }
        }
    }
    displayManaPotionsRankings(players) {
        const container = document.getElementById('mana-potions-list');
        const section = container.closest('.rankings-section');
        section.classList.add('mana-potions');

        // Show only players who earned points, ranked by points (then potions used)
        const playersWithPotions = players
            .filter(player => (Number(player.points) || 0) > 0)
            .sort((a, b) => (Number(b.points) - Number(a.points)) || (Number(b.potions_used) - Number(a.potions_used)));

        if (playersWithPotions.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-flask"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max potions used for percentage calculation
        const maxPotions = Math.max(...playersWithPotions.map(p => p.potions_used)) || 1;

        container.innerHTML = playersWithPotions.map((player, index) => {
            const position = index + 1;
            const resolvedClass = player.character_class || this.resolveClassForName(player.character_name) || 'Unknown';
            const characterClass = this.normalizeClassName(resolvedClass);
            const fillPercentage = Math.max(5, (player.potions_used / maxPotions) * 100); // Minimum 5% for visibility

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(resolvedClass)}${player.character_name}
                        </div>
                        <div class="character-details" title="${player.potions_used} potions used (${player.extra_potions} above threshold)">
                            ${this.truncateWithTooltip(`${player.potions_used} potions used (${player.extra_potions} above threshold)`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.potions_used} potions used, ${player.extra_potions} above threshold of ${this.manaPotionsSettings.threshold}">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    displayRocketHelmetRankings(players) {
        const container = document.getElementById('rocket-helmet-list');
        if (!container) return;
        const section = container.closest('.rankings-section');
        if (section) section.classList.add('rocket-helmet-section');

        const users = (players || []).slice().sort((a, b) => a.character_name.localeCompare(b.character_name));
        if (users.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-helmet-safety"></i>
                    <p>No Rocket Helmet users detected</p>
                </div>
            `;
            return;
        }

        container.innerHTML = users.map((player, idx) => {
            const position = idx + 1;
            const name = player.character_name;
            const cls = this.normalizeClassName(player.character_class || 'unknown');
            const fillPercentage = 100; // fixed points; full bar
            const points = 5;
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${cls}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${name}
                        </div>
                        <div class="character-details" title="Used Goblin Rocket Helmet">
                            Goblin Rocket Helmet
                        </div>
                    </div>
                    <div class="performance-amount" title="Fixed award for Rocket Helmet usage">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    updateManaPotionsHeader() {
        const headerElement = document.querySelector('.mana-potions-section .section-header p');
        if (headerElement && this.manaPotionsSettings) {
            const { threshold, potions_per_point, points_per_potion, max_points } = this.manaPotionsSettings;
            const ppp = Number(potions_per_point || 0) || Number(points_per_potion || 0) || 3;
            headerElement.textContent = `Ranked by points (1 pt per ${ppp} potions above ${threshold}, max ${max_points})`;
        }
    }
    displayRunesRankings(players) {
        const container = document.getElementById('runes-list');
        const section = container.closest('.rankings-section');
        section.classList.add('runes');

        // Filter out players with 0 runes used and sort by total_runes (highest first)
        const playersWithRunes = players.filter(player => player.total_runes > 0)
            .sort((a, b) => b.total_runes - a.total_runes);

        if (playersWithRunes.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max runes used for percentage calculation
        const maxRunes = Math.max(...playersWithRunes.map(p => p.total_runes)) || 1;

        container.innerHTML = playersWithRunes.map((player, index) => {
            const position = index + 1;
            const resolvedClass = player.character_class || this.resolveClassForName(player.character_name) || 'Unknown';
            const characterClass = this.normalizeClassName(resolvedClass);
            let fillPercentage = (player.total_runes / maxRunes) * 100;
            if (index === 0) fillPercentage = 100;
            fillPercentage = Math.max(5, Math.min(100, Math.round(fillPercentage)));

            // Create breakdown of runes used
            const runes = [];
            if (player.dark_runes > 0) runes.push(`${player.dark_runes} Dark`);
            if (player.demonic_runes > 0) runes.push(`${player.demonic_runes} Demonic`);
            
            const runesText = runes.join(', ') || 'No runes used';

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(resolvedClass)}${player.character_name}
                        </div>
                        <div class="character-details" title="${runesText} (${player.total_runes} total)">
                            ${this.truncateWithTooltip(`${runesText} (${player.total_runes} total)`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.total_runes} runes used (${Math.floor(player.total_runes / this.runesSettings.usage_divisor)} divisions)">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateRunesHeader() {
        const headerElement = document.querySelector('.runes-section .section-header p');
        if (headerElement && this.runesSettings) {
            const { usage_divisor, points_per_division, max_points } = this.runesSettings;
            const pointsText = points_per_division === 1 ? 'pt' : 'pts';
            const runesText = usage_divisor === 1 ? 'rune' : 'runes';
            if (max_points) {
                headerElement.textContent = `Ranked by points (${points_per_division} ${pointsText} per ${usage_divisor} ${runesText}, max ${max_points})`;
            } else {
                headerElement.textContent = `Ranked by points (${points_per_division} ${pointsText} per ${usage_divisor} ${runesText})`;
            }
        }
    }

    displayWindfuryRankings(players) {
        const container = document.getElementById('windfury-list');
        if (!container) return;
        const section = container.closest('.rankings-section');
        if (section) section.classList.add('windfury-section');

        const rows = (players || []).slice();
        if (!rows.length) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-wind"></i>
                    <p>No Windfury data available</p>
                </div>
            `;
            return;
        }

        // Precompute max average across all for safety (group-specific max used below)
        const maxAvgAll = Math.max(...rows.map(r => Number(r.group_attacks_avg) || 0)) || 1;
        this.ensureTotemInfoTooltipSetup();
        this.ensureWindfuryMemberTooltipSetup();

        // Group rows by totem type
        const grouped = { windfury: [], grace: [], strength: [], tranquil: [] };
        rows.forEach(r => {
            const t = String(r.totem_type || '').toLowerCase();
            if (t.includes('windfury')) grouped.windfury.push(r);
            else if (t.includes('grace of air')) grouped.grace.push(r);
            else if (t.includes('strength of earth')) grouped.strength.push(r);
            else if (t.includes('tranquil air') || t.includes('tranq')) grouped.tranquil.push(r);
            else grouped.windfury.push(r);
        });

        const renderGroup = (title, iconUrl, groupRows, typeKey) => {
            if (!groupRows.length) return { html: '', count: 0 };
            const header = `
                <div class="totem-subheader">
                    <div class="left"><img src="${iconUrl}" alt="${title}" width="20" height="20"> <span>${title}</span></div>
                    <div class="right"><span class="totem-info-icon" data-info-key="${typeKey}" aria-label="Info" role="button" tabindex="0">?</span></div>
                </div>
            `;
            const keyLower = String(typeKey||'').toLowerCase();
            const isByTotems = (keyLower === 'grace') || (keyLower === 'strength') || (keyLower === 'tranquil');
            // Sort all groups by points (desc). Tie-breakers vary per type.
            const sorted = groupRows.slice().sort((a,b)=> {
                const byPts = (Number(b.points||0) - Number(a.points||0));
                if (byPts !== 0) return byPts;
                if (isByTotems) {
                    return (Number(b.totems_used||0) - Number(a.totems_used||0)) || String(a.character_name||'').localeCompare(String(b.character_name||''));
                }
                return (Number(b.group_attacks_avg||0) - Number(a.group_attacks_avg||0)) || (Number(b.totems_used||0) - Number(a.totems_used||0)) || String(a.character_name||'').localeCompare(String(b.character_name||''));
            });
            const groupMaxAvg = Math.max(...groupRows.map(r=>Number(r.group_attacks_avg)||0), maxAvgAll) || 1;
            const groupMaxTotems = Math.max(...groupRows.map(r=>Number(r.totems_used)||0), 1) || 1;
            const html = sorted.map((player, idx) => {
                const position = idx + 1;
                const resolvedClass = 'Shaman';
                const characterClass = this.normalizeClassName(resolvedClass);
                const fillBase = isByTotems ? (Number(player.totems_used||0) / groupMaxTotems) : (Number(player.group_attacks_avg||0) / groupMaxAvg);
                const fillPercentage = Math.max(5, fillBase * 100);
                const typeText = player.totem_type || 'Totems';
                const details = isByTotems
                    ? `${player.totems_used} totems`
                    : (() => {
                        const avg = Number(player.group_attacks_avg||0);
                        const total = Number(player.group_attacks_total||0) || (Array.isArray(player.group_attacks_members) ? player.group_attacks_members.reduce((s,m)=> s + (Number(m.extra_attacks)||0), 0) : 0);
                        return `${avg} avg extra attacks (${total} total)`;
                    })();
                const totemIcon = this.getTotemIconHtml(typeText) || this.getClassIconHtml(resolvedClass);
                const isTankGrp = (player.party_id === 1 || String(player.party_id) === '1');
                const groupText = isTankGrp ? 'tank grp' : `Group ${Number(player.party_id)}`;
                const groupLabel = (player.party_id != null && player.party_id !== undefined) ? ` <span class="group-label" style="color:#9aa0a6; font-weight:500;">(${groupText})</span>` : '';
                // For Windfury rows, use custom tooltip; for others, no legacy title tooltip
                const detailsAttr = isByTotems ? '' : ` data-wf-tooltip="${this._escapeAttr(this.buildWindfuryTooltipHtml(player))}"`;
                return `
                    <div class="ranking-item" data-item-key="${keyLower}" data-character-name="${player.character_name}">
                        <div class="ranking-position">
                            <span class="ranking-number">#${position}</span>
                        </div>
                        <div class="character-info class-${characterClass}${isTankGrp ? ' tank-border' : ''}" style="--fill-percentage: ${fillPercentage}%;">
                            <div class="character-name">
                                ${totemIcon}${player.character_name}${groupLabel}
                            </div>
                            <div class="character-details"${detailsAttr}>
                                ${this.truncateWithTooltip(details).displayText}
                            </div>
                        </div>
                        <div class="performance-amount" title="${details}">
                            <div class="amount-value">${player.points}</div>
                            <div class="points-label">points</div>
                        </div>
                    </div>
                `;
            }).join('');
            return { html: header + html, count: groupRows.length };
        };

        let fragments = [];
        const grp1 = renderGroup('Windfury Totem', 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_windfury.jpg', grouped.windfury, 'windfury');
        if (grp1.count) { fragments.push(grp1.html); }
        const grp2 = renderGroup('Grace of Air Totem', 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_invisibilitytotem.jpg', grouped.grace, 'grace');
        if (grp2.count) { if (fragments.length) fragments.push('<div class="totem-separator"></div>'); fragments.push(grp2.html); }
        const grpStrength = renderGroup('Strength of Earth Totem', 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_earthbindtotem.jpg', grouped.strength, 'strength');
        if (grpStrength.count) { if (fragments.length) fragments.push('<div class="totem-separator"></div>'); fragments.push(grpStrength.html); }
        const grp3 = renderGroup('Tranquil Air Totem', 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_brilliance.jpg', grouped.tranquil, 'tranquil');
        if (grp3.count) { if (fragments.length) fragments.push('<div class="totem-separator"></div>'); fragments.push(grp3.html); }

        container.innerHTML = fragments.join('');
    }

    updateWindfuryHeader() {
        const headerElement = document.querySelector('.windfury-section .section-header p');
        if (headerElement) {
            headerElement.textContent = `It's complicated. Mouse over the question mark icons`;
        }
    }

    ensureTotemInfoTooltipSetup() {
        if (this._totemInfoSetup) return;
        this._totemInfoSetup = true;
        const tip = document.createElement('div');
        tip.id = 'totem-info-tooltip';
        tip.className = 'totem-info-tooltip';
        tip.style.display = 'none';
        document.body.appendChild(tip);

        const getText = (key) => {
            const k = String(key||'').toLowerCase();
            if (k === 'windfury') {
                return (
`Windfury Totem – how to earn points\n\n` +
`We compare how many "extra Windfury attacks" your party gets on average to the overall baseline for the raid.\n` +
`Your points depend on how your party's average stacks up against that baseline:\n` +
`- Less than 75% of the baseline: 0 points\n` +
`- 75% to 99% of the baseline: 10 points\n` +
`- 100% to 125% of the baseline: 15 points\n` +
`- Above 125% of the baseline: 20 points\n\n` +
`In plain terms: keep Windfury up where your party can use it and make sure your melee are close enough to benefit. The better your party's extra attacks compared to everyone else, the more points you earn.`
                );
            }
            if (k === 'grace') {
                return (
`Grace of Air Totem – how to earn points\n\n` +
`First, you must meet BOTH conditions:\n` +
`- Use at least 10 Grace of Air totems in the raid.\n` +
`- Your party's average extra Windfury attacks is at least 75% of the Windfury baseline (same baseline used above).\n\n` +
`If you meet those two, you earn points based on how many Grace of Air totems you placed:\n` +
`- Every 10 totems = 1 point\n` +
`- Capped at 20 points (so 200+ totems = 20 points)\n\n` +
`In plain terms: make sure your Windfury performance is solid (at least the 75% minimum), then drop lots of Grace of Air to climb the point ladder.`
                );
            }
            if (k === 'strength') {
                return (
`Strength of Earth Totem – how to earn points\n\n` +
`First, you must meet BOTH conditions:\n` +
`- Use at least 10 Strength of Earth totems in the raid.\n` +
`- Your party's average extra Windfury attacks is at least 75% of the Windfury baseline (same baseline used above).\n\n` +
`If you meet those two, you earn points based on how many Strength of Earth totems you placed:\n` +
`- Every 10 totems = 1 point\n` +
`- Capped at 10 points (so 100+ totems = 10 points)\n\n` +
`In plain terms: qualify via Windfury baseline, then drop Strength of Earth consistently to rack up points.`
                );
            }
            if (k === 'tranquil') {
                return (
`Tranquil Air Totem – how to earn points\n\n` +
`Points here are purely about how many Tranquil Air totems you use.\n` +
`- Every 10 totems = 1 point, up to a maximum of 5 points (so 50+ totems = 5 points).\n` +
`- No Windfury performance check applies to Tranquil Air.`
                );
            }
            return '';
        };

        let active = null;
        const show = (el, e) => {
            const key = el.getAttribute('data-info-key');
            tip.innerHTML = `<pre>${getText(key)}</pre>`;
            tip.style.display = 'block';
            move(e);
        };
        const hide = () => { tip.style.display = 'none'; };
        const move = (e) => {
            const x = (e.pageX || (e.clientX + window.scrollX)) + 14;
            const y = (e.pageY || (e.clientY + window.scrollY)) + 14;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        };

        document.addEventListener('mouseover', (e) => {
            const t = e.target.closest('.totem-info-icon');
            if (!t) return;
            active = t;
            show(t, e);
        });
        document.addEventListener('mousemove', (e) => { if (active) move(e); });
        document.addEventListener('mouseout', (e) => {
            if (e.target.closest('.totem-info-icon') !== active) return;
            active = null;
            hide();
        });
        document.addEventListener('focusin', (e) => {
            const t = e.target.closest('.totem-info-icon');
            if (!t) return;
            active = t;
            const rect = t.getBoundingClientRect();
            show(t, { pageX: rect.right + window.scrollX, pageY: rect.bottom + window.scrollY });
        });
        document.addEventListener('focusout', (e) => {
            if (!active) return;
            const related = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.totem-info-icon');
            if (related === active) return;
            active = null;
            hide();
        });
    }

    displayBigBuyerRankings(players) {
        const container = document.getElementById('big-buyer-list');
        if (!container) return;
        const section = container.closest('.rankings-section');
        section.classList.add('big-buyer');

        if (!players || players.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-coins"></i>
                    <p>No eligible big buyers (≥25,000 gold)</p>
                </div>
            `;
            return;
        }

        const maxSpent = Math.max(...players.map(p => p.spent_gold), 1);

        container.innerHTML = players.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.spent_gold / maxSpent) * 100);
            const points = Number(player.points) || 0;
            const trophyHtml = this.getTrophyHtml(position);
            const spentText = `${player.spent_gold.toLocaleString()} gold`;
            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        ${trophyHtml}
                        ${position <= 3 ? '' : `<span class="ranking-number">#${position}</span>`}
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${spentText}">
                            ${this.truncateWithTooltip(spentText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="Spent ${player.spent_gold.toLocaleString()} gold">
                        <div class="amount-value">${points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateBigBuyerHeader() {
        // Nothing dynamic for now; keep static descriptor
    }

    displayInterruptsRankings(players) {
        const container = document.getElementById('interrupts-list');
        const section = container.closest('.rankings-section');
        section.classList.add('interrupts');

        // Filter out players with 0 interrupts and sort by interrupts_used (highest first)
        const playersWithInterrupts = players.filter(player => player.interrupts_used > 0)
            .sort((a, b) => b.interrupts_used - a.interrupts_used);

        if (playersWithInterrupts.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-hand-paper"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max interrupts for percentage calculation
        const maxInterrupts = Math.max(...playersWithInterrupts.map(p => p.interrupts_used)) || 1;

        container.innerHTML = playersWithInterrupts.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.interrupts_used / maxInterrupts) * 100); // Minimum 5% for visibility

            const interruptsText = `${player.interrupts_used} interrupts`;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${interruptsText}">
                            ${this.truncateWithTooltip(interruptsText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.interrupts_used} interrupts (max ${this.interruptsSettings.max_points} points)">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateInterruptsHeader() {
        const headerElement = document.querySelector('.interrupts-section .section-header p');
        if (headerElement && this.interruptsSettings) {
            const { points_per_interrupt, interrupts_needed, max_points } = this.interruptsSettings;
            const pointsText = points_per_interrupt === 1 ? 'pt' : 'pts';
            const interruptsText = interrupts_needed === 1 ? 'interrupt' : 'interrupts';
            headerElement.textContent = `Ranked by points (${points_per_interrupt} ${pointsText} per ${interrupts_needed} ${interruptsText}, max ${max_points})`;
        }
    }

    displayDisarmsRankings(players) {
        const container = document.getElementById('disarms-list');
        const section = container.closest('.rankings-section');
        section.classList.add('disarms');

        // Filter out players with 0 disarms and sort by points (highest first), then disarms_used
        const playersWithDisarms = players.filter(player => player.disarms_used > 0)
            .sort((a, b) => (b.points - a.points) || (b.disarms_used - a.disarms_used));

        if (playersWithDisarms.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-shield-alt"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max disarms for percentage calculation
        const maxDisarms = Math.max(...playersWithDisarms.map(p => p.disarms_used)) || 1;

        container.innerHTML = playersWithDisarms.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.disarms_used / maxDisarms) * 100); // Minimum 5% for visibility

            const disarmsText = `${player.disarms_used} disarms`;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${disarmsText}">
                            ${this.truncateWithTooltip(disarmsText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.disarms_used} disarms (1 pt per ${this.disarmsSettings.disarms_needed} disarms, max ${this.disarmsSettings.max_points} points)">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateDisarmsHeader() {
        const headerElement = document.querySelector('.disarms-section .section-header p');
        if (headerElement && this.disarmsSettings) {
            const { points_per_disarm, disarms_needed, max_points } = this.disarmsSettings;
            const pointsText = points_per_disarm === 1 ? 'pt' : 'pts';
            const disarmsText = disarms_needed === 1 ? 'disarm' : 'disarms';
            headerElement.textContent = `Ranked by points (${points_per_disarm} ${pointsText} per ${disarms_needed} ${disarmsText}, max ${max_points})`;
        }
    }

    displayConfirmedAssignmentsRankings(players) {
        console.log(`📝 [CONFIRMED ASSIGNMENTS] Displaying panel with ${players ? players.length : 0} players:`, players);
        
        const container = document.getElementById('confirmed-assignments-list');
        if (!container) {
            console.error(`📝 [CONFIRMED ASSIGNMENTS] Container 'confirmed-assignments-list' not found!`);
            return;
        }
        
        const section = container.closest('.rankings-section');
        if (section) {
            section.classList.add('confirmed-assignments');
        }

        if (!players || players.length === 0) {
            console.log(`📝 [CONFIRMED ASSIGNMENTS] No players to display, showing empty state`);
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-clipboard-check"></i>
                    <p>No players confirmed their assignments</p>
                </div>
            `;
            return;
        }

        // Sort by assignments count (desc), then name (asc)
        const sortedPlayers = [...players].sort((a, b) => {
            const countA = Number(a.assignments_count) || 0;
            const countB = Number(b.assignments_count) || 0;
            if (countB !== countA) return countB - countA;
            return String(a.character_name).localeCompare(String(b.character_name));
        });

        // Get max assignments for percentage calculation
        const maxAssignments = Math.max(...sortedPlayers.map(p => p.assignments_count)) || 1;

        container.innerHTML = sortedPlayers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.assignments_count / maxAssignments) * 100);
            const assignmentsText = `${player.assignments_count} assignment${player.assignments_count !== 1 ? 's' : ''} confirmed`;

            return `
                <div class="ranking-item" data-assignments-count="${player.assignments_count}">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${assignmentsText}">
                            ${assignmentsText}
                        </div>
                    </div>
                    <div class="performance-amount">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    populateManualRewardsTable() {
        const rewardsCol = document.getElementById('manual-rewards-list-rewards');
        const dedsCol = document.getElementById('manual-rewards-list-deductions');
        if (!rewardsCol || !dedsCol) return;
        const entries = Array.isArray(this.manualRewardsData) ? this.manualRewardsData : [];
        rewardsCol.innerHTML = '';
        dedsCol.innerHTML = '';
        if (entries.length === 0) return;
        const normalized = (cls)=> String(cls||'').toLowerCase();
        entries.forEach((e)=>{
            const item = document.createElement('div');
            const cls = normalized(e.player_class);
            const val = Number(e.points)||0;
            const amtClass = val>0 ? 'positive' : val<0 ? 'negative' : 'zero';
            item.className = 'ranking-item';
            item.innerHTML = `
                <div class="ranking-number"></div>
                <div class="character-info ${cls?('class-'+cls):'class-unknown'}">
                  <div class="character-name ${cls?('class-'+cls):''}">${e.player_name||''}</div>
                  <div class="character-details">${e.description||''}</div>
                </div>
                <div class="performance-amount"><span class="amount-value ${amtClass} ${e.is_gold ? 'gold-amount' : ''}">${Math.round(val)}</span></div>
                <div class="entry-actions" style="display:${this.currentUser?.hasManagementRole?'inline-flex':'none'}">
                  <button class="entry-action entry-action-edit" title="Edit"><i class="fas fa-pen"></i></button>
                  <button class="entry-action entry-action-delete" title="Delete"><i class="fas fa-trash"></i></button>
                </div>`;
            const editBtn = item.querySelector('.entry-action-edit');
            const delBtn = item.querySelector('.entry-action-delete');
            if (editBtn) editBtn.addEventListener('click', ()=> this.editEntry(e));
            if (delBtn) delBtn.addEventListener('click', ()=> this.deleteEntry(e));
            if (val >= 0 || e.is_gold) rewardsCol.appendChild(item); else dedsCol.appendChild(item);
        });
        
        // Re-highlight user's characters after manual rewards are rendered
        setTimeout(() => {
            this.highlightMyCharacters();
        }, 50);
    }
    displaySunderRankings(players) {
        const container = document.getElementById('sunder-list');
        const section = container.closest('.rankings-section');
        section.classList.add('sunder');

        // Exclude tanks based on primary roles if available
        let eligiblePlayers = players;
        if (this.primaryRoles) {
            console.log(`⚔️ [SUNDER] Filtering ${players.length} players by primary role`);
            eligiblePlayers = players.filter(player => {
                const nm = String(player.character_name || '').toLowerCase();
                const role = String(this.primaryRoles[nm] || '').toLowerCase();
                const isTank = role === 'tank';
                if (isTank) {
                    console.log(`🚫 [SUNDER] Excluding ${player.character_name} (primary role: ${role})`);
                }
                return !isTank;
            });
            console.log(`✅ [SUNDER] Players after filtering: ${eligiblePlayers.length}`);
        }

        // Compute average sunders among eligible and include zero-point rows
        if (!eligiblePlayers.length) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-shield-virus"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Compute average and max for visuals
        const counts = eligiblePlayers.map(p => Number(p.sunder_count) || 0);
        const sumCounts = counts.reduce((a,b)=>a+b,0);
        const avgCount = eligiblePlayers.length ? (sumCounts / eligiblePlayers.length) : 0;
        const maxSunderCount = Math.max(...counts) || 1;
        const computePts = (count) => {
            if (!(avgCount > 0)) return 0;
            const pct = (Number(count)||0) / avgCount * 100;
            if (pct < 25) return -20;
            if (pct < 50) return -15;
            if (pct < 75) return -10;
            if (pct < 90) return -5;
            if (pct <= 109) return 0;
            if (pct <= 124) return 5;
            return 10;
        };

        container.innerHTML = eligiblePlayers.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.sunder_count / maxSunderCount) * 100); // Minimum 5% for visibility

            const pctOfAvg = (avgCount > 0) ? Math.round(((Number(player.sunder_count)||0) / avgCount) * 100) : 0;
            const sunderText = `${player.sunder_count} sunders (${pctOfAvg}% of avg.)`;
            const pts = computePts(player.sunder_count);
            
            // Color by points: negative red, zero gray, positive green
            let pointColor = '#6c757d';
            if (pts > 0) pointColor = '#28a745';
            else if (pts < 0) pointColor = '#dc3545';

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${sunderText}">
                            ${this.truncateWithTooltip(sunderText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.sunder_count} sunders (${pctOfAvg}% of avg.)">
                        <div class="amount-value" style="color: ${pointColor}">${pts}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateSunderHeader() {
        const headerElement = document.querySelector('.sunder-section .section-header p');
        if (headerElement) {
            headerElement.textContent = 'Points are distribured based on your effective sunders compared to the player average.';
        }
        // Ensure the info icon and overlay exist for Sunder panel
        this.ensureSunderInfoOverlay();
        // Also ensure generic overlays for other panels
        this.initializeGenericInfoOverlays();
    }

    // Generic overlay for all other panels
    initializeGenericInfoOverlays() {
        const sections = Array.from(document.querySelectorAll('.rankings-section'));
        sections.forEach(section => {
            if (section.classList.contains('sunder')) return; // handled by custom sunder overlay
            this.ensureGenericInfoOverlayForSection(section);
        });
    }
    ensureGenericInfoOverlayForSection(section) {
        if (!section || section.__panelInfoAttached) return;
        section.__panelInfoAttached = true;
        try { section.style.position = section.style.position || 'relative'; } catch {}

        const overlay = document.createElement('div');
        overlay.className = 'panel-info-overlay';
        // Determine custom content per panel
        let infoTitle = 'Panel Details';
        let infoSubtitle = '';
        let infoBody = 'Detailed explanation is missing for this panel';
        let infoList = null;

        // Identify Frost Resistance vs World Buffs by inner list IDs to avoid cross-contamination
        const isFrostResistance = !!section.querySelector('#world-buffs-list');
        const isWorldBuffs = !!section.querySelector('#world-buffs-copy-list');

        if (isFrostResistance) {
            // Frost Resistance panel (uses world-buffs-list container ID)
            infoTitle = 'Frost Resistance';
            infoSubtitle = 'This rule applies to Sapphiron and affects DPS players only. Insufficient frost resistance results in penalties:';
            infoBody = '';
            infoList = [
                '<strong>Warriors, Rogues, Hunters</strong>',
                '30 frost resistance',
                '-10 points if below 80 frost resistance',
                '',
                '<strong>Mages, Warlocks</strong>',
                '-5 points if below 150 frost resistance',
                '-10 points if below 80 frost resistance',
                '',
                'Only frost resistance from items and enchants is counted. Class abilities, racial abilities, buffs, and consumables are not included — you are expected to use those in addition to the required gear.'
            ];
        } else if (isWorldBuffs) {
            // Keep default or provide brief generic text for World Buffs panel
            infoTitle = 'World Buffs';
            infoSubtitle = '';
            infoBody = 'Detailed explanation is missing for this panel';
            infoList = null;
        } else if (section.classList.contains('windfury-section')) {
            infoTitle = 'Totems Points — How this panel works';
            infoSubtitle = 'We know this is complicated, but the short version is: keep Windfury up, weave in Grace of Air, and cast Strength of Earth when it helps — do that and you\'ll earn lots of points.' + '<br><br>' + 'Below is a quick overview of how each totem earns points. For details per player, hover the text under a name to see who contributed to the average, who was excluded, and the exact numbers.';
            infoBody = '<strong>Party average</strong>: Warriors only; anyone below 50% of the top Warrior in your party is excluded from the average and shown in red in the hover list. The Tank group is labeled "(Tank group)".';
            infoList = [
                '<strong>Windfury Totem (WF)</strong>: Your party\'s average "extra WF attacks" (Warriors only) is compared to the raid baseline. Tiers: <em><75%</em>=0 pts, <em>75–99%</em>=10 pts, <em>100–125%</em>=15 pts, <em>>125%</em>=20 pts. Tank group has half the normal requirement; very low Warriors (below 50% of the party\'s top Warrior) are excluded from the average (still shown in red).',
                '<strong>Grace of Air Totem</strong>: To qualify, drop ≥10 totems and have party WF average ≥75% of baseline (Tank group: half requirement). Points = +1 per 10 totems, up to 20.',
                '<strong>Strength of Earth Totem</strong>: To qualify, drop ≥10 totems and have party WF average ≥75% of baseline (Tank group: half requirement). Points = +1 per 10 totems, up to 10.',
                '<strong>Tranquil Air Totem</strong>: No WF requirement. Points = +1 per 10 totems, up to 5.'
            ];
        } else if (section.classList.contains('rocket-helmet-section')) {
            infoTitle = 'Goblin Rocket Helmet';
            infoSubtitle = '';
            infoBody = 'On Kel\'Thuzad in Naxxramas, you can earn 5 bonus points by using a Goblin Rocket Helmet to stun an add during Phase 3.';
        } else if (section.classList.contains('interrupts-section')) {
            infoTitle = 'Interrupted spells';
            infoSubtitle = 'Ranked by points (1 pt per 2 interrupts, max 5)';
            infoBody = 'We count how many enemy casts you interrupted. Every 2 interrupts = 1 point, capped at 5 points. Tooltip shows your total interrupts.';
        } else if (section.classList.contains('disarms-section')) {
            infoTitle = 'Disarmed enemies';
            infoSubtitle = 'Ranked by points (1 pt per 3 disarms, max 5)';
            infoBody = 'We count how many Disarms you used. Every 3 disarms = 1 point, capped at 5 points. Tooltip shows your total disarms.';
        } else if (section.classList.contains('abilities-section')) {
            infoTitle = 'Engineering & Holywater';
            infoSubtitle = 'Ranked by calculated points (abilities used × average targets ÷ 10, max 20)';
            infoBody = 'We track Dense Dynamite, Goblin Sapper Charges and Stratholme Holy Water. Your points are floor((Total used × Avg targets) ÷ 10), capped at 20. Use these on packs to hit more targets and score higher. Hover a name to see your exact breakdown and calculation.';
        } else if (section.classList.contains('runes-section')) {
            infoTitle = 'Dark or Demonic runes';
            infoSubtitle = '';
            infoBody = 'Points are awarded by usage: you gain points for every set of runes used based on the division in the header (e.g., 1 point per 2 runes), up to the panel\'s maximum. Hover a name to see your total Dark/Demonic runes and divisions.';
        } else if (section.classList.contains('mana-potions-section')) {
            infoTitle = 'Major Mana Potions';
            infoSubtitle = '';
            infoBody = 'Points are awarded for potions used above the threshold shown in the header. Every N potions above the threshold = 1 point (see header for N), capped at the maximum. Hover a name to see your total potions and how many counted for points.';
        } else if (section.classList.contains('streak-section')) {
            infoTitle = 'Attendance Streak Champions';
            infoSubtitle = '';
            infoBody = 'Points are awarded for consistent weekly attendance: 4 weeks = 3 pts, 5 = 6 pts, 6 = 9 pts, 7 = 12 pts, and 8+ weeks = 15 pts.';
        } else if (section.classList.contains('guild-section')) {
            infoTitle = 'Guild Members';
            infoSubtitle = '';
            infoBody = 'Every confirmed guild member present in the raid earns a flat +10 points.';
        } else if (section.classList.contains('god-gamer-dps') || section.classList.contains('god-gamer-dps-section')) {
            infoTitle = 'God Gamer DPS';
            infoSubtitle = 'Exceptional damage performance is rewarded as follows:';
            infoBody = '';
            infoList = [
                '30 points if you are #1 on damage and exceed #2 by at least 250,000 damage.',
                '20 points if you are #1 on damage and exceed #2 by at least 150,000 damage.'
            ];
        } else if (section.classList.contains('god-gamer-healer') || section.classList.contains('god-gamer-healer-section')) {
            infoTitle = 'God Gamer HPS';
            infoSubtitle = 'Exceptional healing performance is rewarded as follows:';
            infoBody = '';
            infoList = [
                '20 points if you are #1 on healing and exceed #2 by at least 250,000 healing.',
                '15 points if you are #1 on healing and exceed #2 by at least 150,000 healing.'
            ];
        } else if (section.classList.contains('curse-recklessness-section')) {
            infoTitle = 'Curse of Recklessness';
            infoSubtitle = 'Ranked by points (>70% uptime earns points)';
            infoBody = 'We measure how long your Curse of Recklessness was active when it mattered. Maintain high uptime to earn points; below the threshold earns 0.';
        } else if (section.classList.contains('curse-shadow-section')) {
            infoTitle = 'Curse of Shadow';
            infoSubtitle = 'Ranked by points (>70% uptime earns points)';
            infoBody = 'Warlocks are credited when Curse of Shadow is maintained. Keep it up for most of the fight to earn points; low uptime earns 0.';
        } else if (section.classList.contains('curse-elements-section')) {
            infoTitle = 'Curse of the Elements';
            infoSubtitle = 'Ranked by points (>70% uptime earns points)';
            infoBody = 'We credit uptime for Curse of the Elements. Aim for strong, consistent uptime across encounters to earn points.';
        } else if (section.classList.contains('faerie-fire-section')) {
            infoTitle = 'Faerie Fire';
            infoSubtitle = 'Ranked by points (>70% uptime earns points)';
            infoBody = 'Druids (or other valid sources) earn points for keeping Faerie Fire up. The higher the uptime, the better.';
        } else if (section.classList.contains('scorch-section')) {
            infoTitle = 'Scorch';
            infoSubtitle = 'Ranked by tiers (0–99: 0 pts, 100–199: 5 pts, 200+: 10 pts)';
            infoBody = 'We count total Scorches applied. Hitting 100 grants points; 200+ grants the maximum.';
        } else if (section.classList.contains('demo-shout-section')) {
            infoTitle = 'Demoralizing Shout';
            infoSubtitle = 'Ranked by tiers (0–99: 0 pts, 100–199: 5 pts, 200+: 10 pts)';
            infoBody = 'We count the number of Demo Shouts used. Reach the thresholds to earn 5 or 10 points.';
        } else if (section.classList.contains('polymorph-section')) {
            infoTitle = 'Polymorph';
            infoSubtitle = 'Ranked by points (1 pt per 2 polymorphs, max 5)';
            infoBody = 'Polymorphs help crowd control. Every two successful casts award a point, up to five points total.';
        } else if (section.classList.contains('power-infusion-section')) {
            infoTitle = 'Power Infusion';
            infoSubtitle = 'Ranked by points (1 pt per 2 infusions, max 10, excludes self-casts)';
            infoBody = 'Priests earn points for buffing teammates with Power Infusion. Self-casts do not count.';
        } else if (section.classList.contains('decurses-section')) {
            infoTitle = 'Decurses';
            infoSubtitle = 'Ranked by average-based points (vs raid average, -10 to +10)';
            infoBody = 'We compare your decurse count against the raid average: every 3 above average adds points, every 3 below average deducts, within the -10 to +10 range.';
        } else if (section.classList.contains('void-damage-section')) {
            infoTitle = 'Avoidable Void Damage';
            infoSubtitle = 'Penalties for standing in bad';
            infoBody = 'Taking damage from Void Blast or Void Zone costs points. Avoid the effects to keep your score clean. The panel shows totals and a breakdown by source.';
        } else if (section.classList.contains('big-buyer-section')) {
            infoTitle = 'Big Buyer Bonus';
            infoSubtitle = 'Top 3 spenders (≥25,000 gold) earn bonus points';
            infoBody = 'The highest spenders receive extra points, up to 20, based on gold spent thresholds. Only purchases ≥ 25,000 gold qualify.';
        } else if (section.classList.contains('damage') || section.classList.contains('damage-dealers-section')) {
            infoTitle = 'Damage Dealers';
            infoSubtitle = 'Total damage points are awarded by rank:';
            infoBody = '';
            infoList = [
                'Ranks 1–15 receive between 80 and 3 points, decreasing by rank position.',
                'Players outside the top 15 receive 0 points.'
            ];
        } else if (section.classList.contains('healing') || section.classList.contains('healers-section')) {
            infoTitle = 'Healers';
            infoSubtitle = 'Total healing points are awarded by rank:';
            infoBody = '';
            infoList = [
                'Ranks 1–10 receive between 80 and 10 points, decreasing by rank position.',
                'Players outside the top 10 receive 0 points.'
            ];
        } else if (section.classList.contains('priest-healers') || section.classList.contains('priest-healers-section')) {
            infoTitle = 'Top Priest Healers';
            infoSubtitle = 'The top 2 Priest healers earn additional points:';
            infoBody = '';
            infoList = [
                '1st place: 20 points',
                '2nd place: 15 points'
            ];
        } else if (section.classList.contains('druid-healers') || section.classList.contains('druid-healers-section')) {
            infoTitle = 'Top Druid Healer';
            infoSubtitle = 'The top Druid healer earns additional points:';
            infoList = [
                '1st place: 15 points'
            ];
            infoBody = 'Yes, we know there\'s probably only one Druid in the raid, and their healing output might not be impressive, but hey, give the cows a little break!';
        } else if (section.classList.contains('too-low-damage') || section.classList.contains('too-low-damage-section')) {
            infoTitle = 'Too Low Damage';
            infoSubtitle = '';
            infoBody = 'If you are a naked buyer or otherwise not contributing, you will receive a significant deduction in your gold cut.<br><br>Reductions may be discounted if you had a supportive role such as tanking on the Twin Emperors, pulling, looting, resurrecting, or another dedicated assignment that limited your DPS.';
        } else if (section.classList.contains('too-low-healing') || section.classList.contains('too-low-healing-section')) {
            infoTitle = 'Too Low Healing';
            infoSubtitle = '';
            infoBody = 'If you are a naked buyer or otherwise not contributing, you will receive a significant deduction in your gold cut.<br><br>Reductions may be discounted if you had a supportive role such as tanking on the Twin Emperors, pulling, looting, resurrecting, or another dedicated assignment that limited your HPS.';
        }
        {
            const parts = [];
            parts.push('<div class="panel-info-overlay-content">');
            parts.push(`<h4 class="panel-info-title">${infoTitle}</h4>`);
            if (infoSubtitle) parts.push(`<p class="panel-info-subtitle">${infoSubtitle}</p>`);
            if (Array.isArray(infoList) && infoList.length) {
                parts.push('<ul class="panel-info-list">');
                infoList.forEach(item => parts.push(`<li>${item}</li>`));
                parts.push('</ul>');
            }
            if (infoBody) parts.push(`<p class="panel-info-body">${infoBody}</p>`);
            parts.push('</div>');
            overlay.innerHTML = parts.join('');
        }
        section.appendChild(overlay);

        const closeX = document.createElement('div');
        closeX.className = 'panel-info-close-x';
        closeX.innerHTML = '<i class="fas fa-times-circle" aria-hidden="true"></i>';
        try { closeX.setAttribute('title', 'Close'); } catch {}
        overlay.appendChild(closeX);

        const header = section.querySelector('.section-header');
        if (!header) return;
        header.style.position = header.style.position || 'relative';
        const icon = document.createElement('div');
        icon.className = 'panel-info-icon';
        icon.textContent = '?';
        header.appendChild(icon);

        let timerId = null;
        let lastX = 0, lastY = 0;
        let isLocked = false;
        const threshold = 3;
        const delayMs = 1000;

        const clearTimer = () => { if (timerId) { clearTimeout(timerId); timerId = null; } };
        const showOverlayLocked = (locked) => {
            if (locked) overlay.classList.add('locked'); else overlay.classList.remove('locked');
            overlay.classList.add('show');
        };
        const startTimer = () => {
            clearTimer();
            timerId = setTimeout(() => { showOverlayLocked(false); }, delayMs);
        };
        const onEnter = (e) => {
            if (isLocked) return;
            lastX = e.clientX; lastY = e.clientY;
            startTimer();
        };
        const onMove = (e) => {
            if (isLocked) return;
            const dx = Math.abs(e.clientX - lastX);
            const dy = Math.abs(e.clientY - lastY);
            if (dx > threshold || dy > threshold) {
                lastX = e.clientX; lastY = e.clientY;
                startTimer();
            }
        };
        const hideOverlay = () => { overlay.classList.remove('show'); overlay.classList.remove('locked'); };

        icon.addEventListener('mouseenter', onEnter);
        icon.addEventListener('mousemove', onMove);
        icon.addEventListener('mouseleave', () => { clearTimer(); if (!isLocked) hideOverlay(); });
        icon.addEventListener('click', () => { clearTimer(); isLocked = true; showOverlayLocked(true); });
        overlay.addEventListener('mouseleave', () => { if (!isLocked) hideOverlay(); });
        overlay.addEventListener('click', () => { if (!isLocked) hideOverlay(); });
        closeX.addEventListener('click', (e) => { e.stopPropagation(); isLocked = false; hideOverlay(); });
    }
    ensureSunderInfoOverlay() {
        const container = document.getElementById('sunder-list');
        if (!container) return;
        const section = container.closest('.rankings-section');
        if (!section) return;
        // Add a guard so we only attach once
        if (section.__sunderInfoAttached) return;
        section.__sunderInfoAttached = true;

        // Make section relative for overlay positioning
        try { section.style.position = section.style.position || 'relative'; } catch {}

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'panel-info-overlay';
        overlay.innerHTML = `
            <div class="panel-info-overlay-content">
                <h4 class="panel-info-title">Sunder Armor Points</h4>
                <p class="panel-info-subtitle">Points are awarded based on each DPS warrior's use of Sunder Armor compared to the raid average.</p>
                <p class="panel-info-body">The average number of effective Sunder Armors used by all DPS warriors is calculated.</p>
                <p class="panel-info-body">Each warrior's count is compared to this average.</p>
                <p class="panel-info-body">Points are then assigned according to the following scale:</p>
                <ul class="panel-info-list">
                    <li><strong>Less than 25% of the average</strong>: -20 points</li>
                    <li><strong>25–49% of the average</strong>: -15 points</li>
                    <li><strong>50–74% of the average</strong>: -10 points</li>
                    <li><strong>75–89% of the average</strong>: -5 points</li>
                    <li><strong>90–109% of the average</strong>: 0 points</li>
                    <li><strong>110–124% of the average</strong>: +5 points</li>
                    <li><strong>125% or more of the average</strong>: +10 points</li>
                </ul>
                <div class="panel-info-close">Click the X to close (or move mouse away if opened by hover)</div>
            </div>
        `;
        section.appendChild(overlay);

        // Close X aligned to the ? icon location (only shown when click-locked)
        const closeX = document.createElement('div');
        closeX.className = 'panel-info-close-x';
        closeX.innerHTML = '<i class="fas fa-times-circle" aria-hidden="true"></i>';
        try { closeX.setAttribute('title', 'Close'); } catch {}
        overlay.appendChild(closeX);

        // Create small info icon in top-right of header
        const header = section.querySelector('.section-header');
        if (!header) return;
        header.style.position = header.style.position || 'relative';
        const icon = document.createElement('div');
        icon.className = 'panel-info-icon';
        icon.textContent = '?';
        header.appendChild(icon);

        // Hover-hold behavior: show overlay after 1s of stillness
        let timerId = null;
        let lastX = 0, lastY = 0;
        let isLocked = false; // click-locked state keeps overlay open
        const threshold = 3; // px movement allowed
        const delayMs = 1000;

        const clearTimer = () => { if (timerId) { clearTimeout(timerId); timerId = null; } };
        const showOverlayLocked = (locked) => {
            if (locked) overlay.classList.add('locked'); else overlay.classList.remove('locked');
            overlay.classList.add('show');
        };
        const startTimer = () => {
            clearTimer();
            timerId = setTimeout(() => { showOverlayLocked(false); }, delayMs);
        };

        const onEnter = (e) => {
            if (isLocked) return;
            lastX = e.clientX; lastY = e.clientY;
            startTimer();
        };
        const onMove = (e) => {
            if (isLocked) return;
            const dx = Math.abs(e.clientX - lastX);
            const dy = Math.abs(e.clientY - lastY);
            if (dx > threshold || dy > threshold) {
                lastX = e.clientX; lastY = e.clientY;
                startTimer();
            }
        };
        const hideOverlay = () => { overlay.classList.remove('show'); overlay.classList.remove('locked'); };

        icon.addEventListener('mouseenter', onEnter);
        icon.addEventListener('mousemove', onMove);
        icon.addEventListener('mouseleave', () => { clearTimer(); if (!isLocked) hideOverlay(); });
        icon.addEventListener('click', () => { clearTimer(); isLocked = true; showOverlayLocked(true); });
        overlay.addEventListener('mouseleave', () => { if (!isLocked) hideOverlay(); });
        overlay.addEventListener('click', () => { if (!isLocked) hideOverlay(); });
        closeX.addEventListener('click', (e) => { e.stopPropagation(); isLocked = false; hideOverlay(); });
    }
    displayCurseRankings(players) {
        const container = document.getElementById('curse-recklessness-list');
        const section = container.closest('.rankings-section');
        section.classList.add('curse', 'curse-recklessness');

        // Filter out players with 0 points and sort by uptime percentage (highest first)
        const playersWithUptime = players.filter(player => (Number(player.uptime_percentage||player.uptime||0) >= 0))
            .sort((a, b) => (Number(b.uptime_percentage||b.uptime||0)) - (Number(a.uptime_percentage||a.uptime||0)));

        if (playersWithUptime.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Use 100% as the max for uptime-based fill (not relative to highest player)
        const maxUptime = 100;

        container.innerHTML = playersWithUptime.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const up = Number(player.uptime_percentage||player.uptime||0);
            const fillPercentage = Math.max(5, Math.min(100, Math.round(up))); // Use actual uptime % (5-100%)

            const uptimeText = `${up.toFixed(1)}% uptime`;
            
            // Determine point color based on uptime threshold
            let pointColor = '#ff6b35'; // default
            if (player.points > 0) pointColor = '#28a745'; // green for points earned
            else pointColor = '#dc3545'; // red for no points

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${uptimeText}">
                            ${this.truncateWithTooltip(uptimeText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${up.toFixed(1)}% uptime (threshold: ${this.curseSettings.uptime_threshold}%)">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateCurseHeader() {
        const headerElement = document.querySelector('.curse-recklessness-section .section-header p');
        if (headerElement && this.curseSettings) {
            const { points } = this.curseSettings;
            headerElement.textContent = `Ranked by points (>70% uptime: ${points}pts)`;
        }
    }

    displayCurseShadowRankings(players) {
        const container = document.getElementById('curse-shadow-list');
        const section = container.closest('.rankings-section');
        section.classList.add('curse', 'curse-shadow');

        // Filter out players with 0 points and sort by uptime percentage (highest first)
        const playersWithUptime = players.filter(player => (Number(player.uptime_percentage||player.uptime||0) >= 0))
            .sort((a, b) => (Number(b.uptime_percentage||b.uptime||0)) - (Number(a.uptime_percentage||a.uptime||0)));

        if (playersWithUptime.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Use 100% as the max for uptime-based fill (not relative to highest player)
        const maxUptime = 100;

        container.innerHTML = playersWithUptime.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const up = Number(player.uptime_percentage||player.uptime||0);
            const fillPercentage = Math.max(5, Math.min(100, Math.round(up))); // Use actual uptime % (5-100%)

            const uptimeText = `${up.toFixed(1)}% uptime`;
            
            // Determine point color based on uptime threshold
            let pointColor = '#ff6b35'; // default
            if (player.points > 0) pointColor = '#28a745'; // green for points earned
            else pointColor = '#dc3545'; // red for no points

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${uptimeText}">
                            ${this.truncateWithTooltip(uptimeText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${up.toFixed(1)}% uptime (threshold: ${this.curseShadowSettings.uptime_threshold}%)">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateCurseShadowHeader() {
        const headerElement = document.querySelector('.curse-shadow-section .section-header p');
        if (headerElement && this.curseShadowSettings) {
            const { points } = this.curseShadowSettings;
            headerElement.textContent = `Ranked by points (>70% uptime: ${points}pts)`;
        }
    }

    displayCurseElementsRankings(players) {
        const container = document.getElementById('curse-elements-list');
        const section = container.closest('.rankings-section');
        section.classList.add('curse', 'curse-elements');

        // Filter out players with 0 points and sort by uptime percentage (highest first)
        const playersWithUptime = players.filter(player => (Number(player.uptime_percentage||player.uptime||0) >= 0))
            .sort((a, b) => (Number(b.uptime_percentage||b.uptime||0)) - (Number(a.uptime_percentage||a.uptime||0)));

        if (playersWithUptime.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Use 100% as the max for uptime-based fill (not relative to highest player)
        const maxUptime = 100;

        container.innerHTML = playersWithUptime.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const up = Number(player.uptime_percentage||player.uptime||0);
            const fillPercentage = Math.max(5, Math.min(100, Math.round(up))); // Use actual uptime % (5-100%)

            const uptimeText = `${up.toFixed(1)}% uptime`;
            
            // Determine point color based on uptime threshold
            let pointColor = '#ff6b35'; // default
            if (player.points > 0) pointColor = '#28a745'; // green for points earned
            else pointColor = '#dc3545'; // red for no points

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${uptimeText}">
                            ${this.truncateWithTooltip(uptimeText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${up.toFixed(1)}% uptime (threshold: ${this.curseElementsSettings.uptime_threshold}%)">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateCurseElementsHeader() {
        const headerElement = document.querySelector('.curse-elements-section .section-header p');
        if (headerElement && this.curseElementsSettings) {
            const { points } = this.curseElementsSettings;
            headerElement.textContent = `Ranked by points (>70% uptime: ${points}pts)`;
        }
    }

    displayFaerieFireRankings(players) {
        const container = document.getElementById('faerie-fire-list');
        const section = container.closest('.rankings-section');
        section.classList.add('curse', 'faerie-fire');

        // Filter out players with 0 points and sort by uptime percentage (highest first)
        const playersWithUptime = players.filter(player => player.uptime_percentage >= 0)
            .sort((a, b) => b.uptime_percentage - a.uptime_percentage);

        if (playersWithUptime.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Use 100% as the max for uptime-based fill (not relative to highest player)
        const maxUptime = 100;

        container.innerHTML = playersWithUptime.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, Math.min(100, player.uptime_percentage)); // Use actual uptime % (5-100%)

            const uptimeText = `${player.uptime_percentage.toFixed(1)}% uptime`;
            
            // Determine point color based on uptime threshold
            let pointColor = '#ff6b35'; // default
            if (player.points > 0) pointColor = '#28a745'; // green for points earned
            else pointColor = '#dc3545'; // red for no points

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${uptimeText}">
                            ${this.truncateWithTooltip(uptimeText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.uptime_percentage.toFixed(1)}% uptime (threshold: ${this.faerieFireSettings.uptime_threshold}%)">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateFaerieFireHeader() {
        const headerElement = document.querySelector('.faerie-fire-section .section-header p');
        if (headerElement && this.faerieFireSettings) {
            const { points } = this.faerieFireSettings;
            headerElement.textContent = `Ranked by points (>70% uptime: ${points}pts)`;
        }
    }

    displayScorchRankings(players) {
        const container = document.getElementById('scorch-list');
        const section = container.closest('.rankings-section');
        section.classList.add('scorch');

        // Filter out players with negative scorch count and sort by scorch count (highest first)
        const playersWithScorch = players.filter(player => player.scorch_count >= 0)
            .sort((a, b) => b.scorch_count - a.scorch_count);

        if (playersWithScorch.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-fire"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max scorch count for percentage calculation
        const maxScorch = Math.max(...playersWithScorch.map(p => p.scorch_count)) || 1;

        container.innerHTML = playersWithScorch.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.scorch_count / maxScorch) * 100); // Minimum 5% for visibility

            const scorchText = `${player.scorch_count} scorches`;
            
            // Determine point color based on scorch tiers
            let pointColor = '#dc3545'; // red for 0 points
            if (player.points > 5) pointColor = '#28a745'; // green for 10pts
            else if (player.points > 0) pointColor = '#ffc107'; // yellow for 5pts

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${scorchText}">
                            ${this.truncateWithTooltip(scorchText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.scorch_count} scorches (tiers: 0-${this.scorchSettings.tier1_max}: ${this.scorchSettings.tier1_points}pts, ${this.scorchSettings.tier1_max + 1}-${this.scorchSettings.tier2_max}: ${this.scorchSettings.tier2_points}pts, ${this.scorchSettings.tier2_max + 1}+: ${this.scorchSettings.tier3_points}pts)">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateScorchHeader() {
        const headerElement = document.querySelector('.scorch-section .section-header p');
        if (headerElement && this.scorchSettings) {
            const { tier1_max, tier1_points, tier2_max, tier2_points, tier3_points } = this.scorchSettings;
            headerElement.textContent = `Ranked by points (0-${tier1_max}: ${tier1_points}pts, ${tier1_max + 1}-${tier2_max}: ${tier2_points}pts, ${tier2_max + 1}+: ${tier3_points}pts)`;
        }
    }
    displayDemoShoutRankings(players) {
        const container = document.getElementById('demo-shout-list');
        const section = container.closest('.rankings-section');
        section.classList.add('demo-shout');

        // Filter out players with less than 10 demo shouts and sort by demo shout count (highest first)
        const playersWithDemoShout = players.filter(player => player.demo_shout_count >= 10)
            .sort((a, b) => b.demo_shout_count - a.demo_shout_count);

        if (playersWithDemoShout.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-shield-alt"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max demo shout count for percentage calculation
        const maxDemoShout = Math.max(...playersWithDemoShout.map(p => p.demo_shout_count)) || 1;

        container.innerHTML = playersWithDemoShout.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            let fillPercentage = (player.demo_shout_count / maxDemoShout) * 100;
            if (index === 0) fillPercentage = 100;
            fillPercentage = Math.max(5, Math.min(100, Math.round(fillPercentage)));

            const demoShoutText = `${player.demo_shout_count} demo shouts`;
            
            // Determine point color based on demo shout tiers
            let pointColor = '#dc3545'; // red for 0 points
            if (player.points > 5) pointColor = '#28a745'; // green for 10pts
            else if (player.points > 0) pointColor = '#ffc107'; // yellow for 5pts

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${demoShoutText}">
                            ${this.truncateWithTooltip(demoShoutText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.demo_shout_count} demoralizing shouts (tiers: 0-${this.demoShoutSettings.tier1_max}: ${this.demoShoutSettings.tier1_points}pts, ${this.demoShoutSettings.tier1_max + 1}-${this.demoShoutSettings.tier2_max}: ${this.demoShoutSettings.tier2_points}pts, ${this.demoShoutSettings.tier2_max + 1}+: ${this.demoShoutSettings.tier3_points}pts)">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateDemoShoutHeader() {
        const headerElement = document.querySelector('.demo-shout-section .section-header p');
        if (headerElement && this.demoShoutSettings) {
            const { tier1_max, tier1_points, tier2_max, tier2_points, tier3_points } = this.demoShoutSettings;
            headerElement.textContent = `Ranked by points (0-${tier1_max}: ${tier1_points}pts, ${tier1_max + 1}-${tier2_max}: ${tier2_points}pts, ${tier2_max + 1}+: ${tier3_points}pts)`;
        }
    }

    displayPolymorphRankings(players) {
        const container = document.getElementById('polymorph-list');
        const section = container.closest('.rankings-section');
        section.classList.add('polymorph');

        // Filter out players with 0 polymorphs and sort by polymorphs used (highest first)
        const playersWithPolymorphs = players.filter(player => player.polymorphs_used > 0)
            .sort((a, b) => b.polymorphs_used - a.polymorphs_used);

        if (playersWithPolymorphs.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max polymorphs for percentage calculation
        const maxPolymorphs = Math.max(...playersWithPolymorphs.map(p => p.polymorphs_used)) || 1;

        container.innerHTML = playersWithPolymorphs.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            let fillPercentage = (player.polymorphs_used / maxPolymorphs) * 100;
            if (index === 0) fillPercentage = 100;
            fillPercentage = Math.max(5, Math.min(100, Math.round(fillPercentage)));

            const polymorphText = `${player.polymorphs_used} polymorphs`;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${polymorphText}">
                            ${this.truncateWithTooltip(polymorphText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.polymorphs_used} polymorphs (${Math.floor(player.polymorphs_used / this.polymorphSettings.polymorphs_needed)} divisions, max ${this.polymorphSettings.max_points} points)">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updatePolymorphHeader() {
        const headerElement = document.querySelector('.polymorph-section .section-header p');
        if (headerElement && this.polymorphSettings) {
            const { points_per_division, polymorphs_needed, max_points } = this.polymorphSettings;
            const pointsText = points_per_division === 1 ? 'pt' : 'pts';
            const polymorphsText = polymorphs_needed === 1 ? 'polymorph' : 'polymorphs';
            headerElement.textContent = `Ranked by points (${points_per_division} ${pointsText} per ${polymorphs_needed} ${polymorphsText}, max ${max_points})`;
        }
    }
    displayPowerInfusionRankings(players) {
        const container = document.getElementById('power-infusion-list');
        const section = container.closest('.rankings-section');
        section.classList.add('power-infusion');

        // Filter out players with 0 infusions and sort by total infusions (highest first)
        const playersWithInfusions = players.filter(player => player.total_infusions > 0)
            .sort((a, b) => b.total_infusions - a.total_infusions);

        if (playersWithInfusions.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-bolt"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max infusions for percentage calculation
        const maxInfusions = Math.max(...playersWithInfusions.map(p => p.total_infusions)) || 1;

        container.innerHTML = playersWithInfusions.map((player, index) => {
            const position = index + 1;
            const resolvedClass = player.character_class || this.resolveClassForName(player.character_name) || 'Unknown';
            const characterClass = this.normalizeClassName(resolvedClass);
            const fillPercentage = Math.max(5, (player.total_infusions / maxInfusions) * 100); // Minimum 5% for visibility

            // Create breakdown showing boss and trash separately
            const infusionBreakdown = [];
            if (player.boss_infusions > 0) infusionBreakdown.push(`${player.boss_infusions} on bosses`);
            if (player.trash_infusions > 0) infusionBreakdown.push(`${player.trash_infusions} on trash`);
            
            const infusionText = `${player.total_infusions} total (${infusionBreakdown.join(', ')})`;
            
            // Show raw values in tooltip for debugging
            const rawBreakdown = [];
            if (player.boss_raw) rawBreakdown.push(`Bosses: ${player.boss_raw}`);
            if (player.trash_raw) rawBreakdown.push(`Trash: ${player.trash_raw}`);
            const tooltipText = rawBreakdown.length > 0 ? `${infusionText} - Raw: ${rawBreakdown.join(', ')}` : infusionText;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(resolvedClass)}${player.character_name}
                        </div>
                        <div class="character-details" title="${tooltipText}">
                            ${this.truncateWithTooltip(infusionText).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${tooltipText}">
                        <div class="amount-value">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updatePowerInfusionHeader() {
        const headerElement = document.querySelector('.power-infusion-section .section-header p');
        if (headerElement && this.powerInfusionSettings) {
            const { points_per_division, infusions_needed, max_points } = this.powerInfusionSettings;
            const pointsText = points_per_division === 1 ? 'pt' : 'pts';
            const infusionsText = infusions_needed === 1 ? 'infusion' : 'infusions';
            headerElement.textContent = `Ranked by points (${points_per_division} ${pointsText} per ${infusions_needed} ${infusionsText}, max ${max_points}, excludes self-casts)`;
        }
    }
    displayDecursesRankings(players) {
        const container = document.getElementById('decurses-list');
        const section = container.closest('.rankings-section');
        section.classList.add('decurses');

        // Filter out players with 0 decurses and sort by decurses used (highest first)
        const playersWithDecurses = players.filter(player => player.decurses_used > 0)
            .sort((a, b) => b.decurses_used - a.decurses_used);

        if (playersWithDecurses.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-magic"></i>
                    <p>Nothing to see, move along</p>
                </div>
            `;
            return;
        }

        // Get max decurses for percentage calculation
        const maxDecurses = Math.max(...playersWithDecurses.map(p => p.decurses_used)) || 1;

        container.innerHTML = playersWithDecurses.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const fillPercentage = Math.max(5, (player.decurses_used / maxDecurses) * 100); // Minimum 5% for visibility

            const decursesText = `${player.decurses_used} decurses`;
            const differenceText = player.difference_from_average >= 0 ? 
                `+${player.difference_from_average.toFixed(1)} vs avg` : 
                `${player.difference_from_average.toFixed(1)} vs avg`;
            
            // Color points based on positive/negative
            let pointColor = '#ff6b35'; // default
            if (player.points > 0) pointColor = '#28a745'; // green for positive
            else if (player.points < 0) pointColor = '#dc3545'; // red for negative

            const tooltipText = `${decursesText} (${differenceText}, avg: ${this.decursesSettings.average_decurses.toFixed(1)})`;

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getClassIconHtml(player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${tooltipText}">
                            ${this.truncateWithTooltip(`${decursesText} (${differenceText})`).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${tooltipText}">
                        <div class="amount-value" style="color: ${pointColor}">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateDecursesHeader() {
        const headerElement = document.querySelector('.decurses-section .section-header p');
        if (headerElement && this.decursesSettings) {
            const { points_per_division, decurses_needed, max_points, min_points } = this.decursesSettings;
            const pointsText = points_per_division === 1 ? 'pt' : 'pts';
            const decursesText = decurses_needed === 1 ? 'decurse' : 'decurses';
            headerElement.textContent = `Ranked by average-based points (${points_per_division} ${pointsText} per ${decurses_needed} ${decursesText} vs avg, ${min_points} to +${max_points})`;
        }
    }

    displayVoidDamageRankings(players) {
        const container = document.getElementById('void-damage-list');
        const section = container.closest('.rankings-section');
        section.classList.add('void-damage');

        if (!players || players.length === 0) {
            container.innerHTML = `
                <div class="rankings-empty">
                    <i class="fas fa-shield-alt"></i>
                    <p>No players took avoidable void damage!</p>
                </div>
            `;
            return;
        }

        // Get max void damage for percentage calculation
        const maxVoidDamage = Math.max(...players.map(p => p.total_void_damage), 1);

        container.innerHTML = players.map((player, index) => {
            const position = index + 1;
            const characterClass = this.normalizeClassName(player.character_class);
            const formattedDamage = this.formatNumber(player.total_void_damage);
            const fillPercentage = Math.max(5, (player.total_void_damage / maxVoidDamage) * 100);
            
            // Show breakdown of void damage types
            const damageBreakdown = [];
            if (player.void_blast_damage > 0) {
                damageBreakdown.push(`Void Blast: ${this.formatNumber(player.void_blast_damage)}`);
            }
            if (player.void_zone_damage > 0) {
                damageBreakdown.push(`Void Zone: ${this.formatNumber(player.void_zone_damage)}`);
            }
            const breakdownText = damageBreakdown.join(', ');

            return `
                <div class="ranking-item">
                    <div class="ranking-position">
                        <span class="ranking-number">#${position}</span>
                    </div>
                    <div class="character-info class-${characterClass}" style="--fill-percentage: ${fillPercentage}%;">
                        <div class="character-name">
                            ${this.getSpecIconHtml(player.spec_name, player.character_class)}${player.character_name}
                        </div>
                        <div class="character-details" title="${formattedDamage} void damage">
                            ${formattedDamage} damage
                        </div>
                        <div class="void-details" title="${breakdownText}">
                            ${this.truncateWithTooltip(breakdownText, 30).displayText}
                        </div>
                    </div>
                    <div class="performance-amount" title="${player.total_void_damage.toLocaleString()} void damage taken">
                        <div class="amount-value negative">${player.points}</div>
                        <div class="points-label">points</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateVoidDamageHeader() {
        const headerElement = document.querySelector('.void-damage-section .section-header p');
        if (headerElement && this.voidDamageSettings) {
            const { void_blast_penalty, void_zone_penalty } = this.voidDamageSettings;
            headerElement.textContent = `Players who took damage from Void Blast (${void_blast_penalty} pts) or Void Zone (${void_zone_penalty} pts)`;
        }
    }
    normalizeClassName(className) {
        if (!className) return 'unknown';
        
        // Convert to lowercase and replace spaces with dashes
        let normalized = className.toLowerCase().replace(/\s+/g, '-');
        
        // Fix common typos
        const typoFixes = {
            'priets': 'priest',
            'preist': 'priest',
            'mge': 'mage',
            'warior': 'warrior',
            'shamn': 'shaman',
            'huntter': 'hunter',
            'druid': 'druid',
            'roge': 'rogue',
            'paldin': 'paladin',
            'warlok': 'warlock'
        };
        
        // Apply typo fixes
        if (typoFixes[normalized]) {
            normalized = typoFixes[normalized];
        }
        
        return normalized;
    }

    truncateWithTooltip(text, maxLength = 20) {
        if (!text || text.length <= maxLength) {
            return {
                displayText: text || '',
                titleText: text || ''
            };
        }
        
        return {
            displayText: text.substring(0, maxLength) + '...',
            titleText: text
        };
    }

    getTrophyHtml(position) {
        switch (position) {
            case 1:
                return '<i class="fas fa-trophy trophy-icon gold"></i>';
            case 2:
                return '<i class="fas fa-trophy trophy-icon silver"></i>';
            case 3:
                return '<i class="fas fa-trophy trophy-icon bronze"></i>';
            default:
                return '';
        }
    }

    formatNumber(num) {
        if (num === 0) return '0';
        
        // Convert to millions/thousands for readability
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        } else {
            return num.toLocaleString();
        }
    }

    renderRaidlogsDebugPanel() {
        const panel = document.getElementById('rl-debug-panel');
        if (!panel) return;
        const lower = s=>String(s||'').toLowerCase();
        const confirmed = (this.logData||[])
            .map(p=>String(p.character_name||''))
            .filter(n => !this.shouldIgnorePlayer(n));
        let html = `<div style="margin-bottom:10px; font-weight:700;">Players included (${confirmed.length}): ${confirmed.join(', ')}</div>`;
        html += `<div style="margin-bottom:6px;">Total Points (card): ${(this.totalPointsComputed||0).toLocaleString()}</div>`;
        panel.innerHTML = html;
    }

    renderPointsBreakdownTable() {
        const pbContainer = document.getElementById('points-breakdown-table-container');
        if (!container) return;
        const lower = s=>String(s||'').toLowerCase();
        const confirmedPlayers = (this.logData||[]).filter(p=>!this.shouldIgnorePlayer(p.character_name));
        const nameList = confirmedPlayers.map(p=>p.character_name);
        const uniqNames = Array.from(new Set(nameList));

        // Columns definition – order matches panels on page
        const columns = [
            { key:'base', label:'Base' },
            { key:'manual', label:'Manual Rewards and Deductions' },
            { key:'godDps', label:'God Gamer Damage' },
            { key:'godHeal', label:'God Gamer Healer' },
            { key:'damage', label:'Damage Dealers' },
            { key:'healing', label:'Healers' },
            { key:'shamanHealers', label:'Top Shaman Healers' },
            { key:'priestHealers', label:'Top Priest Healers' },
            { key:'druidHealers', label:'Top Druid Healer' },
            { key:'rocketHelmet', label:'Rocket Helmet' },
            { key:'abilities', label:'Engineering & Holywater' },
            { key:'mana', label:'Major Mana Potions' },
            { key:'runes', label:'Dark/Demonic Runes' },
            { key:'interrupts', label:'Interrupted spells' },
            { key:'disarms', label:'Disarmed enemies' },
            { key:'sunder', label:'Sunder Armor' },
            { key:'curse', label:'Curse of Recklessness' },
            { key:'curseShadow', label:'Curse of Shadow' },
            { key:'curseElements', label:'Curse of the Elements' },
            { key:'faerie', label:'Faerie Fire' },
            { key:'scorch', label:'Scorch' },
            { key:'demo', label:'Demoralizing Shout' },
            { key:'polymorph', label:'Polymorph' },
            { key:'powerInfusion', label:'Power Infusion' },
            { key:'decurses', label:'Decurses' },
            { key:'windfury', label:'Totems' },
            { key:'worldBuffs', label:'World Buffs' },
            { key:'frostRes', label:'Frost Resistance' },
            { key:'void', label:'Avoidable Void Damage' },
            { key:'streak', label:'Attendance Streak' },
            { key:'guild', label:'Guild Members' },
            { key:'bigBuyer', label:'Big Buyer Bonus' },
            { key:'tooLowDps', label:'Too Low Damage' },
            { key:'tooLowHps', label:'Too Low Healing' },
            { key:'total', label:'Total' },
        ];

        // Helpers to map dataset points by name
        const nameKey = x=>lower(x.character_name||x.player_name||'');
        const collectMap = (arr)=>{ const m=new Map(); (arr||[]).forEach(r=>{ const k=nameKey(r); const v=Number(r.points)||0; if(!k||!v) return; m.set(k,(m.get(k)||0)+v); }); return m; };
        // Snapshot index and mapper shared in this function scope
        let snapByPanelAndName = null;
        const buildSnapshotIndex = () => {
            if (snapByPanelAndName) return;
            snapByPanelAndName = new Map();
            (this.snapshotEntries||[]).forEach(r=>{
                const pts = Number(r.point_value_edited != null ? r.point_value_edited : r.point_value_original) || 0;
                if (!pts) return;
                const key = `${r.panel_key}__${lower(r.character_name)}`;
                snapByPanelAndName.set(key, (snapByPanelAndName.get(key)||0) + pts);
            });
        };
        const mapFromPanel = (panelKey) => {
            if (!snapByPanelAndName) return new Map();
            const m = new Map();
            snapByPanelAndName.forEach((v, k) => {
                const [pk, nm] = k.split('__');
                if (pk === panelKey) m.set(nm, v);
            });
            return m;
        };
        let abilitiesMap = collectMap(this.abilitiesData);
        let rocketHelmetMap = collectMap(this.rocketHelmetData);
        let manaMap = collectMap(this.manaPotionsData);
        let runesMap = collectMap(this.runesData);
        let interruptsMap = collectMap(this.interruptsData);
        let disarmsMap = collectMap(this.disarmsData);
        // Build sunder map excluding tanks when primaryRoles available, computed vs average
        let sunderMap = new Map();
        if (Array.isArray(this.sunderData)) {
            const eligibleRows = this.sunderData.filter(row => {
                const nm = String(row.character_name || '').toLowerCase();
                if (this.primaryRoles) {
                    const role = String(this.primaryRoles[nm] || '').toLowerCase();
                    if (role === 'tank') return false; // exclude tanks
                }
                return true;
            });
            const sum = eligibleRows.reduce((acc, r) => acc + (Number(r.sunder_count) || 0), 0);
            const avg = eligibleRows.length ? (sum / eligibleRows.length) : 0;
            const computePts = (count) => {
                if (!(avg > 0)) return 0;
                const pct = (Number(count)||0) / avg * 100;
                if (pct < 25) return -20;
                if (pct < 50) return -15;
                if (pct < 75) return -10;
                if (pct < 90) return -5;
                if (pct <= 109) return 0;
                if (pct <= 124) return 5;
                return 10;
            };
            eligibleRows.forEach(row => {
                const nm = String(row.character_name || '').toLowerCase();
                const pts = computePts(row.sunder_count);
                if (!pts) return;
                sunderMap.set(nm, (sunderMap.get(nm) || 0) + pts);
            });
        }
        let curseMap = collectMap(this.curseData);
        let curseShadowMap = collectMap(this.curseShadowData);
        let curseElementsMap = collectMap(this.curseElementsData);
        let faerieMap = collectMap(this.faerieFireData);
        let scorchMap = collectMap(this.scorchData);
        let demoMap = collectMap(this.demoShoutData);
        let polymorphMap = collectMap(this.polymorphData);
        let powerInfusionMap = collectMap(this.powerInfusionData);
        let decursesMap = collectMap(this.decursesData);
        let worldBuffsMap = collectMap(this.worldBuffsData);
        let frostResMap = collectMap(this.frostResistanceData);
        let voidMap = collectMap(this.voidDamageData);
        let windfuryMap = collectMap(this.windfuryData);
        let bigBuyerMap = collectMap(this.bigBuyerData);

        // Decide whether to use snapshot maps or computed
        let useSnapshot = this.snapshotLocked && Array.isArray(this.snapshotEntries) && this.snapshotEntries.length > 0;
        if (useSnapshot) {
            buildSnapshotIndex();
            // Sanity check: if snapshot healing is missing any current healer rankers, fall back to computed
            const hpsPointsChk = this.rewardSettings?.healing?.points_array||[];
            const hSortedChk = (this.logData||[])
                .filter(p=>!this.shouldIgnorePlayer(p.character_name))
                .filter(p=>{
                    const nm = String(p.character_name||'').trim().toLowerCase();
                    const pr = this.primaryRoles ? String(this.primaryRoles[nm]||'').toLowerCase() : '';
                    const detected = String(p.role_detected||'').toLowerCase();
                    return ((pr==='healer') || (detected==='healer')) && (parseInt(p.healing_amount)||0)>0;
                })
                .sort((a,b)=>(parseInt(b.healing_amount)||0)-(parseInt(a.healing_amount)||0))
                .slice(0, Math.max(0, hpsPointsChk.length));
            const healSnap = mapFromPanel('healing');
            for (const p of hSortedChk) { if (!healSnap.has(nameKey(p))) { useSnapshot = false; break; } }
        }

        if (useSnapshot) {
            // Replace maps per known panel_key identifiers used by snapshot
            abilitiesMap = mapFromPanel('abilities');
            // No explicit snapshot panel for Rocket Helmet; keep computed map (zeros if not present)
            manaMap = mapFromPanel('mana_potions');
            runesMap = mapFromPanel('runes');
            interruptsMap = mapFromPanel('interrupts');
            disarmsMap = mapFromPanel('disarms');
            sunderMap = mapFromPanel('sunder');
            // Snapshot uses specific key for Curse of Recklessness
            curseMap = mapFromPanel('curse_recklessness');
            curseShadowMap = mapFromPanel('curse_shadow');
            curseElementsMap = mapFromPanel('curse_elements');
            faerieMap = mapFromPanel('faerie_fire');
            scorchMap = mapFromPanel('scorch');
            demoMap = mapFromPanel('demo_shout');
            polymorphMap = mapFromPanel('polymorph');
            powerInfusionMap = mapFromPanel('power_infusion');
            decursesMap = mapFromPanel('decurses');
            worldBuffsMap = mapFromPanel('world_buffs_copy');
            frostResMap = mapFromPanel('frost_resistance');
            voidMap = mapFromPanel('void_damage');
            windfuryMap = mapFromPanel('windfury_totems');
            // Fallback: if snapshot lacks Windfury/Totems data, use computed dataset
            if (!windfuryMap || windfuryMap.size === 0) {
                const computedWindfury = collectMap(this.windfuryData);
                if (computedWindfury && computedWindfury.size > 0) {
                    windfuryMap = computedWindfury;
                }
            }
            bigBuyerMap = mapFromPanel('big_buyer');
        } else {
            // Computed mode: gate Frost Resistance to DPS only (require primaryRoles)
            if (Array.isArray(this.frostResistanceData) && this.primaryRoles) {
                const filtered = new Map();
                (this.frostResistanceData || []).forEach(row => {
                    const nm = String(row.character_name || row.player_name || '').toLowerCase();
                    const role = String(this.primaryRoles[nm] || '').toLowerCase();
                    if (role !== 'dps') return;
                    const pts = Number(row.points) || 0;
                    if (!pts) return;
                    filtered.set(nm, (filtered.get(nm) || 0) + pts);
                });
                frostResMap = filtered;
            } else {
                // If no primaryRoles mapping, exclude Frost contributions to match card behavior
                frostResMap = new Map();
            }
        }

        // Manual rewards aggregated canonically to avoid double-counting when both name and discord_id exist
        const manualByCanonical = new Map(); // key: 'd:<discordId>' or 'n:<lowerName>'
        (this.manualRewardsData||[]).forEach(e=>{
            const v = Number(e.points)||0; if(!v) return;
            const did = String(e.discord_id||'').trim();
            const nm = lower(e.player_name||'');
            const key = did ? `d:${did}` : `n:${nm}`;
            manualByCanonical.set(key, (manualByCanonical.get(key)||0) + v);
        });
        // Damage & healing ranking arrays
        let damageMap=new Map(), healingMap=new Map(), godDpsMap=new Map(), godHealMap=new Map();
        let shamanMap=new Map(), priestMap=new Map(), druidMap=new Map();
        let tooLowDpsMap=new Map(), tooLowHpsMap=new Map();
        let streakMap=new Map(), guildMap=new Map(), weeklyNaxMap=new Map();

        if (this.snapshotLocked && Array.isArray(this.snapshotEntries) && this.snapshotEntries.length > 0) {
            buildSnapshotIndex();
            damageMap = mapFromPanel('damage');
            healingMap = mapFromPanel('healing');
            godDpsMap = mapFromPanel('god_gamer_dps');
            godHealMap = mapFromPanel('god_gamer_healer');
            shamanMap = mapFromPanel('shaman_healers');
            priestMap = mapFromPanel('priest_healers');
            druidMap = mapFromPanel('druid_healers');
            tooLowDpsMap = mapFromPanel('too_low_damage');
            tooLowHpsMap = mapFromPanel('too_low_healing');
            streakMap = mapFromPanel('attendance_streaks');
            guildMap = mapFromPanel('guild_members');
        } else {
            const dpsPoints = this.rewardSettings?.damage?.points_array||[];
            const hpsPoints = this.rewardSettings?.healing?.points_array||[];
            const dpsSorted = (this.logData||[])
                .filter(p=>!this.shouldIgnorePlayer(p.character_name)
                    && ((((p.role_detected||'').toLowerCase()==='dps')||((p.role_detected||'').toLowerCase()==='tank')))
                    && (parseInt(p.damage_amount)||0)>0)
                .sort((a,b)=>(parseInt(b.damage_amount)||0)-(parseInt(a.damage_amount)||0));
            const hSorted = (this.logData||[])
                .filter(p=>!this.shouldIgnorePlayer(p.character_name))
                .filter(p=>{
                    const nm = String(p.character_name||'').trim().toLowerCase();
                    const pr = this.primaryRoles ? String(this.primaryRoles[nm]||'').toLowerCase() : '';
                    const detected = String(p.role_detected||'').toLowerCase();
                    const isHealer = (pr==='healer') || (detected==='healer');
                    return isHealer && (parseInt(p.healing_amount)||0)>0;
                })
                .sort((a,b)=>(parseInt(b.healing_amount)||0)-(parseInt(a.healing_amount)||0));
            damageMap = new Map(); dpsSorted.forEach((p,i)=>{ if(i<dpsPoints.length){ const pts=dpsPoints[i]||0; if(pts) damageMap.set(nameKey(p),pts); }});
            healingMap = new Map(); hSorted.forEach((p,i)=>{ if(i<hpsPoints.length){ const pts=hpsPoints[i]||0; if(pts) healingMap.set(nameKey(p),pts); }});

            // God gamer
            godDpsMap = new Map(); if(dpsSorted.length>=2){ const diff=(parseInt(dpsSorted[0].damage_amount)||0)-(parseInt(dpsSorted[1].damage_amount)||0); let pts=0; if(diff>=250000)pts=30; else if(diff>=150000)pts=20; if(pts){ godDpsMap.set(nameKey(dpsSorted[0]),pts); }}
            godHealMap = new Map(); if(hSorted.length>=2){ const diff=(parseInt(hSorted[0].healing_amount)||0)-(parseInt(hSorted[1].healing_amount)||0); let pts=0; if(diff>=250000)pts=20; else if(diff>=150000)pts=15; if(pts){ godHealMap.set(nameKey(hSorted[0]),pts); }}

            // Class healer awards
            const byClass=(arr,cls)=>arr.filter(p=>String(p.character_class||'').toLowerCase().includes(cls));
            const sh=byClass(hSorted,'shaman').slice(0,3), pr=byClass(hSorted,'priest').slice(0,2), dr=byClass(hSorted,'druid').slice(0,1);
            shamanMap=new Map(); sh.forEach((p,i)=>{ const pts=[25,20,15][i]||0; if(pts) shamanMap.set(nameKey(p),pts); });
            priestMap=new Map(); pr.forEach((p,i)=>{ const pts=[20,15][i]||0; if(pts) priestMap.set(nameKey(p),pts); });
            druidMap=new Map(); dr.forEach((p)=>{ const pts=15; druidMap.set(nameKey(p),pts); });

            // Too low DPS/HPS
            tooLowDpsMap=new Map(); tooLowHpsMap=new Map();
            const aftMin=this.raidStats?.stats?.activeFightTime; if(aftMin&&this.primaryRoles){ const sec=aftMin*60; (this.logData||[]).forEach(p=>{ if(this.shouldIgnorePlayer(p.character_name)) return; const role=this.primaryRoles[lower(p.character_name)]; if(role==='dps'){ const dps=(parseFloat(p.damage_amount)||0)/sec; let pts=0; if(dps<150)pts=-100; else if(dps<200)pts=-50; else if(dps<250)pts=-25; if(pts) tooLowDpsMap.set(nameKey(p),pts); } else if(role==='healer'){ const hps=(parseFloat(p.healing_amount)||0)/sec; let pts=0; if(hps<85)pts=-100; else if(hps<100)pts=-50; else if(hps<125)pts=-25; if(pts) tooLowHpsMap.set(nameKey(p),pts); }}); }

            // Streaks & guild
            streakMap=new Map(); (this.playerStreaksData||[]).forEach(r=>{ const s=Number(r.player_streak)||0; let pts=0; if(s>=8)pts=15; else if(s===7)pts=12; else if(s===6)pts=9; else if(s===5)pts=6; else if(s===4)pts=3; if(pts) streakMap.set(nameKey(r),pts); });
            guildMap=new Map(); (this.guildMembersData||[]).forEach(r=>{ const pts=Number(r.points)||0; if(pts) guildMap.set(nameKey(r),pts); });
            weeklyNaxMap=new Map(); (this.weeklyNaxRaidsData||[]).forEach(r=>{ const pts=Number(r.points)||0; if(pts) weeklyNaxMap.set(nameKey(r),pts); });
        }

        // Debug table removed; keep totals computation for internal consistency if container exists
        const container = document.getElementById('points-breakdown-table-container');
        const header = ['#', 'Name', ...columns.map(c=>c.label)];
        const rows = [];
        const totals = new Map(); columns.forEach(c=>totals.set(c.key,0));
        uniqNames.sort((a,b)=>a.localeCompare(b));
        uniqNames.forEach(nm=>{
            const key = lower(nm);
            const playerRow = { name: nm };
            const base = 100;
            const discordId = (this.logData||[]).find(p=>lower(p.character_name)===key)?.discord_id || '';
            const val = (k)=>{
                switch(k){
                    case 'base': return base;
                    case 'manual': {
                        // Exclude gold payouts from points table manual column
                        const goldSet = new Set((this.manualRewardsData||[])
                            .filter(e=>!!(e.is_gold)||/\[GOLD\]/i.test(String(e.description||'')))
                            .map(e=>{
                                const did = String(e.discord_id||''); const nm = lower(e.player_name||'');
                                return did ? `d:${did}` : `n:${nm}`;
                            }));
                        const byDidKey = discordId ? `d:${String(discordId)}` : null;
                        const byDid = (byDidKey && !goldSet.has(byDidKey)) ? (manualByCanonical.get(byDidKey)||0) : 0;
                        const byNameKey = `n:${key}`;
                        const byName = (!goldSet.has(byNameKey)) ? (manualByCanonical.get(byNameKey)||0) : 0;
                        return byDid + byName;
                    }
                    case 'godDps': return godDpsMap.get(key)||0;
                    case 'godHeal': return godHealMap.get(key)||0;
                    case 'damage': return damageMap.get(key)||0;
                    case 'healing': return healingMap.get(key)||0;
                    case 'shamanHealers': return shamanMap.get(key)||0;
                    case 'priestHealers': return priestMap.get(key)||0;
                    case 'druidHealers': return druidMap.get(key)||0;
                    case 'abilities': return abilitiesMap.get(key)||0;
                    case 'rocketHelmet': return rocketHelmetMap.get(key)||0;
                    case 'mana': return manaMap.get(key)||0;
                    case 'runes': return runesMap.get(key)||0;
                    case 'interrupts': return interruptsMap.get(key)||0;
                    case 'disarms': return disarmsMap.get(key)||0;
                    case 'sunder': return sunderMap.get(key)||0;
                    case 'curse': return curseMap.get(key)||0;
                    case 'curseShadow': return curseShadowMap.get(key)||0;
                    case 'curseElements': return curseElementsMap.get(key)||0;
                    case 'faerie': return faerieMap.get(key)||0;
                    case 'scorch': return scorchMap.get(key)||0;
                    case 'demo': return demoMap.get(key)||0;
                    case 'polymorph': return polymorphMap.get(key)||0;
                    case 'powerInfusion': return powerInfusionMap.get(key)||0;
                    case 'decurses': return decursesMap.get(key)||0;
                    case 'windfury': return windfuryMap.get(key)||0;
                    case 'worldBuffs': return worldBuffsMap.get(key)||0;
                    case 'frostRes': return frostResMap.get(key)||0;
                    case 'void': return voidMap.get(key)||0;
                    case 'streak': return streakMap.get(key)||0;
                    case 'guild': return guildMap.get(key)||0;
                    case 'bigBuyer': return bigBuyerMap.get(key)||0;
                    case 'tooLowDps': return tooLowDpsMap.get(key)||0;
                    case 'tooLowHps': return tooLowHpsMap.get(key)||0;
                    default: return 0;
                }
            };
            let rowTotal = 0;
            columns.forEach(c=>{ const v=Number(val(c.key))||0; playerRow[c.key]=v; if(c.key!=='total') rowTotal+=v; });
            // Total column bottoms out at 0
            playerRow.total = Math.max(0, rowTotal);
            columns.forEach(c=>{ totals.set(c.key,(totals.get(c.key)||0)+(playerRow[c.key]||0)); });
            rows.push(playerRow);
        });

        if (!pbContainer) {
            const newRaidTotal = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
            this.totalPointsComputed = this.engineResult?.meta?.totalPointsAll ?? newRaidTotal;
            this.updateTotalPointsCard();
            return;
        }
        const table = document.createElement('table');
        table.className = 'points-breakdown-table';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        header.forEach((h, idx)=>{ const th=document.createElement('th'); const full=String(h); const short=full.length>3?full.slice(0,3):full; th.textContent=short; th.title=full; if(idx===0) th.className='rownum-cell'; if(idx===1) th.className='name-cell'; trh.appendChild(th); });
        thead.appendChild(trh); table.appendChild(thead);
        const tbody=document.createElement('tbody');
        rows.forEach((r, i)=>{
            const tr=document.createElement('tr');
            const idxTd=document.createElement('td'); idxTd.className='rownum-cell'; idxTd.textContent=String(i+1); tr.appendChild(idxTd);
            const nameTd=document.createElement('td'); nameTd.className='name-cell'; nameTd.textContent=r.name; tr.appendChild(nameTd);
            columns.forEach(c=>{ const td=document.createElement('td'); const v=Number(r[c.key])||0; const shown = (c.key==='total')? Math.max(0,v) : v; td.textContent=(shown>0?`+${shown}`:shown); td.className = shown===0?'zero':(shown>0?'positive':'negative'); tr.appendChild(td); });
            tbody.appendChild(tr);
        });
        // Summary row
        const trSum=document.createElement('tr'); trSum.className='points-breakdown-summary';
        const sumIdx=document.createElement('td'); sumIdx.className='rownum-cell'; sumIdx.textContent=''; trSum.appendChild(sumIdx);
        const sumName=document.createElement('td'); sumName.className='name-cell'; sumName.textContent='Sum'; trSum.appendChild(sumName);
        columns.forEach(c=>{ const td=document.createElement('td'); let v=Number(totals.get(c.key)||0); if(c.key==='total') v=Math.max(0,v); td.textContent=(v>0?`+${v}`:v); td.className = v===0?'zero':(v>0?'positive':'negative'); trSum.appendChild(td); });
        tbody.appendChild(trSum);
        // Bracketed gold payouts row under Sum (affects only shared gold, not points)
        try {
            const payout = Number(this.manualGoldPayoutTotal)||0;
            if (payout>0) {
                const trGold=document.createElement('tr'); trGold.className='points-breakdown-summary';
                const gIdx=document.createElement('td'); gIdx.className='rownum-cell'; gIdx.textContent=''; trGold.appendChild(gIdx);
                const gName=document.createElement('td'); gName.className='name-cell'; gName.textContent='Gold payouts'; trGold.appendChild(gName);
                columns.forEach(c=>{ const td=document.createElement('td'); td.textContent = (c.key==='total')? `(-${payout.toLocaleString()})` : ''; td.className='negative'; trGold.appendChild(td); });
                tbody.appendChild(trGold);
            }
        } catch {}
        table.appendChild(tbody);
        pbContainer.innerHTML='';
        pbContainer.appendChild(table);

        // Compute raid total from rows (per-player totals already capped at 0)
        let newRaidTotal = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
        // In engine modes (auto/manual), trust the canonical total from the engine to avoid drift
        try {
            if (this.engineResult && this.engineResult.meta && typeof this.engineResult.meta.totalPointsAll === 'number') {
                newRaidTotal = Number(this.engineResult.meta.totalPointsAll) || newRaidTotal;
            }
        } catch {}
        this.totalPointsComputed = newRaidTotal;
        // Also keep the Total Points card in sync after edits or recompute
        this.updateTotalPointsCard();
    }

    showLoading() {
        document.getElementById('loading-indicator').style.display = 'flex';
        document.getElementById('raid-logs-container').style.display = 'none';
        document.getElementById('no-data-message').style.display = 'none';
        document.getElementById('error-display').style.display = 'none';
    }

    hideLoading() {
        document.getElementById('loading-indicator').style.display = 'none';
    }

    showContent() {
        document.getElementById('raid-logs-container').style.display = 'block';
        document.getElementById('no-data-message').style.display = 'none';
        document.getElementById('error-display').style.display = 'none';
    }

    showNoData(message) {
        document.getElementById('loading-indicator').style.display = 'none';
        // Keep the main container visible so manual-rewards remains usable before logs
        document.getElementById('raid-logs-container').style.display = 'block';
        document.getElementById('error-display').style.display = 'none';
        
        const noDataMessage = document.getElementById('no-data-message');
        noDataMessage.style.display = 'flex';
        
        // Ensure manual rewards section is visible
        try {
            const manualSection = document.getElementById('manual-rewards-section');
            if (manualSection) manualSection.style.display = 'block';
        } catch {}
        
        // Update the message if provided
        if (message) {
            const messageElement = noDataMessage.querySelector('.no-data-content p');
            if (messageElement) {
                messageElement.textContent = message;
            }
        }
    }
    showError(message) {
        document.getElementById('loading-indicator').style.display = 'none';
        document.getElementById('raid-logs-container').style.display = 'none';
        document.getElementById('no-data-message').style.display = 'none';
        
        const errorDisplay = document.getElementById('error-display');
        errorDisplay.style.display = 'flex';
        
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
    }
    async loadSpecData() {
        try {
            const response = await fetch('/api/specs');
            this.specData = await response.json();
            console.log('📋 Loaded spec data:', this.specData);
        } catch (error) {
            console.error('Failed to load spec data:', error);
        }
    }

    getSpecIconUrl(specName, characterClass) {
        if (!this.specData || !specName || !characterClass) return null;
        
        // Normalize class name to match the spec data structure
        const canonicalClass = this.getCanonicalClass(characterClass);
        const specsForClass = this.specData[canonicalClass] || [];
        
        // Find the spec with matching name (try exact match first, then case-insensitive)
        let spec = specsForClass.find(s => s.name === specName);
        if (!spec) {
            spec = specsForClass.find(s => s.name.toLowerCase() === specName.toLowerCase());
        }
        
        // Special handling for "Restoration1" (Shaman) -> "Restoration"
        if (!spec && specName === 'Restoration1' && canonicalClass === 'shaman') {
            spec = specsForClass.find(s => s.name === 'Restoration');
        }
        
        if (spec && spec.emote) {
            return `https://cdn.discordapp.com/emojis/${spec.emote}.png`;
        }
        
        return null;
    }

    getCanonicalClass(className) {
        if (!className) return 'unknown';
        const lower = className.toLowerCase();
        if (lower.includes('death knight')) return 'death knight';
        if (lower.includes('druid')) return 'druid';
        if (lower.includes('hunter')) return 'hunter';
        if (lower.includes('mage')) return 'mage';
        if (lower.includes('paladin')) return 'paladin';
        if (lower.includes('priest')) return 'priest';
        if (lower.includes('rogue')) return 'rogue';
        if (lower.includes('shaman')) return 'shaman';
        if (lower.includes('warlock')) return 'warlock';
        if (lower.includes('warrior')) return 'warrior';
        return 'unknown';
    }

    // Build player tabs and panels dynamically based on current user and raid data
    buildPlayerPanels() {
        try {
            const userId = this.currentUser?.id;
            if (!userId || !Array.isArray(this.logData) || this.logData.length === 0) return;
            // Collect names linked to user from multiple sources (logData, playersData, manualRewards)
            const unique = [];
            const seen = new Set();
            const addName = (name, className) => {
                if (!name) return;
                const key = String(name).trim().toLowerCase();
                if (!key || seen.has(key)) return;
                seen.add(key);
                unique.push({ name: String(name).trim(), className: className || this.resolveClassForName(name) || 'unknown' });
            };
            // From logData
            (this.logData||[]).forEach(r => { if (String(r.discord_id||'')===String(userId)) addName(r.character_name, r.character_class); });
            // From playersData (dropdown players), often has discord_id
            (this.playersData||[]).forEach(p => { if (String(p.discord_id||'')===String(userId)) addName(p.player_name, p.player_class); });
            // From manual rewards entries (if any rows recorded for this user)
            (this.manualRewardsData||[]).forEach(e => { if (String(e.discord_id||'')===String(userId)) addName(e.player_name, e.player_class); });
            // Fallback (tighter): manual rewards with no discord_id, but players table confirms (name+class) belongs to my discord
            try {
                const isVerifiedAlt = (nm, cls) => {
                    if (!nm) return false;
                    const clsResolved = cls || this.resolveClassForName(nm) || '';
                    const want = this.getCanonicalClass(clsResolved);
                    const lowerNm = String(nm).trim().toLowerCase();
                    return (this.playersData || []).some(p =>
                        String(p.player_name || '').trim().toLowerCase() === lowerNm &&
                        this.getCanonicalClass(p.player_class || '') === want &&
                        String(p.discord_id || '') === String(userId)
                    );
                };
                (this.manualRewardsData||[]).forEach(e => {
                    const did = String(e && e.discord_id || '');
                    const nm = String(e && e.player_name || '').trim();
                    const cls = e && e.player_class;
                    if (did || !nm) return;
                    if (isVerifiedAlt(nm, cls)) addName(nm, cls);
                });
            } catch {}
            // From snapshot entries (manual mode) — they include discord_user_id and character_name
            (this.snapshotEntries||[]).forEach(r => { if (String(r.discord_user_id||'')===String(userId)) addName(r.character_name, r.class_name || null); });
            // If nothing collected yet, fall back to names seen anywhere in datasets matching this user id
            if (unique.length === 0) {
                try {
                    const datasets = [this.abilitiesData,this.manaPotionsData,this.runesData,this.interruptsData,this.disarmsData,this.sunderData,this.curseData,this.curseShadowData,this.curseElementsData,this.faerieFireData,this.scorchData,this.demoShoutData,this.polymorphData,this.powerInfusionData,this.decursesData,this.frostResistanceData,this.worldBuffsData,this.voidDamageData,this.bigBuyerData];
                    datasets.forEach(arr => (arr||[]).forEach(row => { if (String(row.discord_id||'')===String(userId)) addName(row.character_name||row.player_name, row.character_class||row.player_class); }));
                } catch {}
            }
            // Debug
            try { console.log('[PLAYER TABS] Names for user', userId, unique.map(u=>u.name)); } catch {}
            // Insert toggle buttons next to Gold
            const toggleBar = document.querySelector('.stats-panel-toggle');
            if (!toggleBar) return;
            const goldBtn = toggleBar.querySelector('button[data-panel="gold"]');
            unique.forEach(({ name, className }) => {
                const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                if (this.playerPanels.has(id)) return; // already built
                // Button
                const btn = document.createElement('button');
                btn.className = 'stats-toggle-btn';
                btn.setAttribute('data-panel', `player:${id}`);
                const canonical = this.getCanonicalClass(className);
                const iconUrl = this.getClassIconUrl(canonical);
                const color = this.classColors[canonical] || '#e5e7eb';
                const img = iconUrl ? `<img src="${iconUrl}" alt="${canonical}" width="18" height="18" style="vertical-align:middle; margin-right:6px; border-radius:3px;">` : `<i class="fas fa-user" style="margin-right:6px;"></i>`;
                btn.innerHTML = `${img}<span class="player-name" style="color:${color};">${name}</span>`;
                if (goldBtn && goldBtn.nextSibling) toggleBar.insertBefore(btn, goldBtn.nextSibling); else toggleBar.appendChild(btn);
                // Panel
                const statsSection = document.getElementById('stats-dashboard');
                if (statsSection) {
                    const panel = document.createElement('div');
                    panel.className = 'stats-dashboard player-panel';
                    panel.id = `player-panel-${id}`;
                    panel.style.display = 'none';
                    panel.innerHTML = `
                        <div class="stat-card player-left" id="player-left-${id}">
                            <div class="stat-label">Rewards</div>
                            <div class="rankings-list" id="player-rewards-list-${id}"></div>
                        </div>
                        <div class="stat-card player-middle" id="player-middle-${id}">
                            <div class="stat-label">Deductions</div>
                            <div class="rankings-list" id="player-deductions-list-${id}"></div>
                        </div>
                        <div class="stat-card my-points">
                            <i class="fas fa-star stat-icon"></i>
                            <div class="stat-label">My Points</div>
                            <div class="stat-value" id="my-points-value">--</div>
                            <div class="stat-detail" id="my-points-detail">Based on your character in this raid</div>
                        </div>
                        <div class="stat-card my-gold">
                            <i class="fas fa-coins stat-icon"></i>
                            <div class="stat-label">My Gold</div>
                            <div class="stat-value" id="my-gold-value">--</div>
                            <div class="stat-detail" id="my-gold-detail">Each point = -- gold</div>
                        </div>
                    `;
                    statsSection.appendChild(panel);
                }
                this.playerPanels.set(id, { slug: id, name, className });
                // Rebind toggle listeners for new button
                btn.addEventListener('click', () => {
                    const allBtns = document.querySelectorAll('.stats-toggle-btn');
                    allBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const panels = document.querySelectorAll('#dashboard-panel,#shame-panel,#gold-panel,.player-panel');
                    panels.forEach(p => p && (p.style.display = 'none'));
                    const target = document.getElementById(`player-panel-${id}`);
                    if (target) {
                        target.style.display = 'grid';
                        this.updateGoldCards();
                        this.renderPlayerPanelsContent();
                    }
                });
            });
        } catch (e) {
            console.warn('⚠️ buildPlayerPanels failed', e);
        }
    }
    // Build rows like /gold player-card and render split lists (Rewards/Deductions)
    renderPlayerPanelsContent() {
        try {
            if (!this.currentUser?.id) return;
            const gpp = Math.max(0, Number(this.engineResult?.meta?.goldPerPoint || this.goldPerPoint) || 0);
            const lower = s => String(s||'').toLowerCase();
            const sumFrom = (arr, nameKey)=> (arr||[]).reduce((acc,row)=> acc + (lower(row.character_name||row.player_name||'')===nameKey ? (Number(row.points)||0) : 0), 0);
            const getItems = (nameKey) => {
                const role = String(this.primaryRoles?.[nameKey] || '').toLowerCase();
                const items = [];
                const push = (title, pts)=>{ if(!pts) return; const goldVal = Math.floor(pts * gpp); items.push({ title, pts, gold: goldVal }); };
                // Base
                if (this.engineResult && this.engineResult.success) {
                    const basePanel = (this.engineResult?.panels || []).find(p => p.panel_key === 'base');
                    const row = basePanel && Array.isArray(basePanel.rows) ? basePanel.rows.find(r => lower(r.name) === nameKey) : null;
                    if (row && row.points) push('Base', Number(row.points) || 0);
                } else {
                    push('Base', 100);
                }
                // Datasets
                push('Sappers', sumFrom(this.abilitiesData, nameKey));
                push('Totems', sumFrom(this.windfuryData, nameKey));
                push('RocketHelm', sumFrom(this.rocketHelmetData, nameKey));
                push('Mana pots', sumFrom(this.manaPotionsData, nameKey));
                push('Runes', sumFrom(this.runesData, nameKey));
                push('Interrupts', sumFrom(this.interruptsData, nameKey));
                push('Disarms', sumFrom(this.disarmsData, nameKey));
                if (role !== 'tank') push('Sunder', sumFrom(this.sunderData, nameKey));
                push('Curse Reck', sumFrom(this.curseData, nameKey));
                push('Curse Shad', sumFrom(this.curseShadowData, nameKey));
                push('Curse Elem', sumFrom(this.curseElementsData, nameKey));
                push('Faerie Fir', sumFrom(this.faerieFireData, nameKey));
                push('Scorch', sumFrom(this.scorchData, nameKey));
                push('Demo Shout', sumFrom(this.demoShoutData, nameKey));
                push('Polymorph', sumFrom(this.polymorphData, nameKey));
                push('Power Inf', sumFrom(this.powerInfusionData, nameKey));
                push('Decurses', sumFrom(this.decursesData, nameKey));
                // Frost Res only DPS
                if (role === 'dps') push('Frost Res', sumFrom(this.frostResistanceData, nameKey));
                push('WorldBuffs', sumFrom(this.worldBuffsData, nameKey));
                push('Void Dmg', sumFrom(this.voidDamageData, nameKey));
                // Awards based on ranking or snapshot
                if (this.snapshotLocked && Array.isArray(this.snapshotEntries) && this.snapshotEntries.length>0) {
                    const sumSnap = (panelKey) => (this.snapshotEntries||[]).reduce((acc, r) => {
                        if (String(r.panel_key) === panelKey && lower(r.character_name) === nameKey) {
                            const pts = Number(r.point_value_edited != null ? r.point_value_edited : r.point_value_original) || 0; return acc + pts;
                        }
                        return acc;
                    }, 0);
                    push('Dmg Rank', sumSnap('damage'));
                    push('Heal Rank', sumSnap('healing'));
                    push('God Gamer DPS', sumSnap('god_gamer_dps'));
                    push('God Gamer Heal', sumSnap('god_gamer_healer'));
                    push('Shaman Healer', sumSnap('shaman_healers'));
                    push('Priest Healer', sumSnap('priest_healers'));
                    push('Druid Healer', sumSnap('druid_healers'));
                    push('Too Low Dmg', sumSnap('too_low_damage'));
                    push('Too Low Heal', sumSnap('too_low_healing'));
                } else {
                    try {
                        const damagePoints = this.rewardSettings?.damage?.points_array || [];
                        const damageSorted = (this.logData || [])
                            .filter(p => !this.shouldIgnorePlayer(p.character_name))
                            .filter(p => ((p.role_detected||'').toLowerCase()==='dps' || (p.role_detected||'').toLowerCase()==='tank') && (parseInt(p.damage_amount)||0) > 0)
                            .sort((a,b)=>(parseInt(b.damage_amount)||0)-(parseInt(a.damage_amount)||0));
                        const healers = (this.logData || [])
                            .filter(p => !this.shouldIgnorePlayer(p.character_name))
                            .filter(p => (p.role_detected||'').toLowerCase()==='healer' && (parseInt(p.healing_amount)||0) > 0)
                            .sort((a,b)=>(parseInt(b.healing_amount)||0)-(parseInt(a.healing_amount)||0));
                        const idxDamage = damageSorted.findIndex(p => lower(p.character_name) === nameKey);
                        if (idxDamage >= 0 && idxDamage < damagePoints.length) push('Dmg Rank', damagePoints[idxDamage] || 0);
                        const healingPoints = this.rewardSettings?.healing?.points_array || [];
                        const idxHeal = healers.findIndex(p => lower(p.character_name) === nameKey);
                        if (idxHeal >= 0 && idxHeal < healingPoints.length) push('Heal Rank', healingPoints[idxHeal] || 0);
                        if (damageSorted.length >= 2) {
                            const first = parseInt(damageSorted[0].damage_amount)||0; const second = parseInt(damageSorted[1].damage_amount)||0;
                            const diff = first-second; let pts=0; if(diff>=250000) pts=30; else if(diff>=150000) pts=20; if (pts && lower(damageSorted[0].character_name)===nameKey) push('God Gamer DPS', pts);
                        }
                        if (healers.length >= 2) {
                            const first = parseInt(healers[0].healing_amount)||0; const second = parseInt(healers[1].healing_amount)||0;
                            const diff = first-second; let pts=0; if(diff>=250000) pts=20; else if(diff>=150000) pts=15; if (pts && lower(healers[0].character_name)===nameKey) push('God Gamer Heal', pts);
                        }
                        const byClass=(arr,cls)=>arr.filter(p=>String(p.character_class||'').toLowerCase().includes(cls));
                        const h=healers; const shamans=byClass(h,'shaman').slice(0,3); const priests=byClass(h,'priest').slice(0,2); const druids=byClass(h,'druid').slice(0,1);
                        const addAward=(label,arr,ptsArr)=>{ const i=arr.findIndex(p=>lower(p.character_name)===nameKey); if(i>=0 && i<ptsArr.length){ const pts=ptsArr[i]||0; if(pts) push(label, pts); } };
                        addAward('Shaman Healer', shamans, [25,20,15]); addAward('Priest Healer', priests, [20,15]); addAward('Druid Healer', druids, [15]);
                        // Too Low DPS/HPS
                        const aftMin = this.raidStats?.stats?.activeFightTime; if (aftMin) { const sec=aftMin*60; const row=(this.logData||[]).find(p=>lower(p.character_name)===nameKey); if(row){ if(role==='dps'||role==='tank'){ const dps=(parseFloat(row.damage_amount)||0)/sec; let pts=0; if(dps<150)pts=-100; else if(dps<200)pts=-50; else if(dps<250)pts=-25; if(pts) push('Too Low Dmg', pts);} else if(role==='healer'){ const hps=(parseFloat(row.healing_amount)||0)/sec; let pts=0; if(hps<85)pts=-100; else if(hps<100)pts=-50; else if(hps<125)pts=-25; if(pts) push('Too Low Heal', pts);} } }
                    } catch {}
                }
                // Streaks/Guild
                try { const row=(this.playerStreaksData||[]).find(r=> lower(r.character_name)===nameKey); if(row){ const s=Number(row.player_streak)||0; let pts=0; if(s>=8)pts=15; else if(s===7)pts=12; else if(s===6)pts=9; else if(s===5)pts=6; else if(s===4)pts=3; push('Streak', pts);} } catch {}
                try { const row=(this.guildMembersData||[]).find(r=> lower(r.character_name)===nameKey); if(row){ const pts=Number(row.points)||0; if(pts) push('Guild Mem', pts);} } catch {}
                try { const row=(this.weeklyNaxRaidsData||[]).find(r=> lower(r.character_name)===nameKey); if(row){ const pts=Number(row.points)||0; if(pts) push('Weekly NAX', pts);} } catch {}
                // Big Buyer
                push('Big Buyer', sumFrom(this.bigBuyerData, nameKey));
                // Manual rewards split
                const manualGold=(this.manualRewardsData||[]).reduce((acc,e)=>{ if(lower(e.player_name||'')!==nameKey) return acc; const isGold=!!(e&&(e.is_gold||/\[GOLD\]/i.test(String(e.description||'')))); return isGold? acc + (Number(e.points)||0) : acc; },0);
                const manualPts=(this.manualRewardsData||[]).reduce((acc,e)=>{ if(lower(e.player_name||'')!==nameKey) return acc; const isGold=!!(e&&(e.is_gold||/\[GOLD\]/i.test(String(e.description||'')))); return isGold? acc : acc + (Number(e.points)||0); },0);
                if (manualPts) push('Manual', manualPts);
                if (manualGold) items.push({ title:'Manual', pts:0, gold:manualGold, isGoldRow:true });
                return items;
            };

            const headerHtml = `
                <div style="display:grid; grid-template-columns: 1.6fr 60px 85px; gap:8px; font-size:14px; line-height:1.3; color:#e5e7eb; font-weight:700; border-bottom:1px solid rgba(255,255,255,.12); padding-bottom:6px; margin-bottom:8px;">
                    <div style="text-align:left;">Label</div>
                    <div style="text-align:right;">Points</div>
                    <div style="text-align:right;">Gold</div>
                </div>`;
            const rowHtml = (it)=> `
                <div style="display:grid; grid-template-columns: 1.6fr 60px 85px; gap:8px; font-size:15px; line-height:1.45; color:#e5e7eb;">
                    <div style="text-align:left;">${this._escapeAttr(it.title)}</div>
                    <div style="text-align:right;">${it.pts>0?`+${Math.round(it.pts)}`:Math.round(it.pts)}</div>
                    <div style="text-align:right;">${it.isGoldRow?`<i class=\"fas fa-coins\" style=\"margin-right:6px; color:#f59e0b;\"></i>`:''}${it.gold>0?`+${Math.round(it.gold)}`:Math.round(it.gold)}</div>
                </div>`;

            this.playerPanels.forEach(({ slug, name }) => {
                const rewardsEl = document.getElementById(`player-rewards-list-${slug}`);
                const dedsEl = document.getElementById(`player-deductions-list-${slug}`);
                if (!rewardsEl || !dedsEl) return;
                const key = name.toLowerCase();
                const items = getItems(key);
                const positives = items.filter(it => (Number(it.pts)||0) > 0 || it.isGoldRow);
                const negatives = items.filter(it => (Number(it.pts)||0) < 0);
                rewardsEl.innerHTML = headerHtml + (positives.length ? positives.map(rowHtml).join('') : '<div style="opacity:.8;">No rewards</div>');
                dedsEl.innerHTML = headerHtml + (negatives.length ? negatives.map(rowHtml).join('') : '<div style="opacity:.8;">No deductions</div>');
            });
        } catch (e) { console.warn('⚠️ renderPlayerPanelsContent failed', e); }
    }

    // Helpers to filter out non-player entities and resolve missing class
    // This MUST match the backend shouldIgnorePlayer function exactly
    shouldIgnorePlayer(name) {
        if (!name) return false;
        const n = String(name).trim();
        // Filter out names with spaces (e.g., "Windfury Totem", "Battle Chicken")
        if (n.includes(' ')) return true;
        // Exact match filter (case-insensitive)
        const lower = n.toLowerCase();
        const exactMatches = ['zzold', 'totem', 'trap', 'dummy', 'battlechicken'];
        return exactMatches.includes(lower);
    }

    resolveClassForName(characterName) {
        if (!characterName) return null;
        const lower = String(characterName).toLowerCase();
        // Prefer logData which usually has reliable classes
        const logRow = (this.logData || []).find(p => String(p.character_name || '').toLowerCase() === lower);
        if (logRow && logRow.character_class) return logRow.character_class;
        // Roster cache
        if (this.rosterMapByName && this.rosterMapByName.size > 0) {
            const cls = this.rosterMapByName.get(lower);
            if (cls) return cls;
        }
        // Players dropdown data
        const p = (this.playersData || []).find(x => String(x.player_name || '').toLowerCase() === lower);
        if (p && p.player_class) return p.player_class;
        return null;
    }

    filterOutIgnored(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.filter(p => !this.shouldIgnorePlayer(String(p.character_name || p.player_name || '')));
    }

    sanitizeDatasets() {
        const keys = [
            'abilitiesData','manaPotionsData','runesData','interruptsData','disarmsData','sunderData',
            'curseData','curseShadowData','curseElementsData','faerieFireData','scorchData','demoShoutData',
            'polymorphData','powerInfusionData','decursesData','frostResistanceData','worldBuffsData',
            'voidDamageData','bigBuyerData','playerStreaksData','guildMembersData'
        ];
        keys.forEach(k => { if (this[k]) this[k] = this.filterOutIgnored(this[k]); });
    }

    // Fallback: return class icon based on character class
    getClassIconHtml(characterClass) {
        const canonicalClass = this.getCanonicalClass(characterClass);
        const emoteId = this.classIconEmotes[canonicalClass];
        if (emoteId) {
            return `<img src="https://cdn.discordapp.com/emojis/${emoteId}.png" class="spec-icon" alt="${canonicalClass}" width="50" height="50" loading="lazy" decoding="async">`;
        }
        return `<i class="fas fa-user-circle spec-icon unknown-spec" style="color: #aaa;" title="${canonicalClass}"></i>`;
    }

    getClassIconUrl(characterClass) {
        const canonicalClass = this.getCanonicalClass(characterClass);
        const emoteId = this.classIconEmotes[canonicalClass];
        return emoteId ? `https://cdn.discordapp.com/emojis/${emoteId}.png` : null;
    }

    getSpecIconHtml(specName, characterClass) {
        // Priority 1: roster override spec emote if available
        if (specName && specName !== 'null') {
            const player = this.logData.find(p =>
                p.character_class === characterClass &&
                p.spec_name === specName &&
                p.roster_spec_emote
            );
            if (player && player.roster_spec_emote) {
                return `<img src="https://cdn.discordapp.com/emojis/${player.roster_spec_emote}.png" class="spec-icon" alt="${specName}" width="50" height="50" loading="lazy" decoding="async">`;
            }

            // Priority 2: spec icon from SPEC_DATA mapping
            const iconUrl = this.getSpecIconUrl(specName, characterClass);
            if (iconUrl) {
                return `<img src="${iconUrl}" class="spec-icon" alt="${specName}" width="50" height="50" loading="lazy" decoding="async">`;
            }
        }

        // Priority 3: fall back to class icon so every player has an icon
        return this.getClassIconHtml(characterClass);
    }

    buildWindfuryTooltip(player) {
        try {
            const members = Array.isArray(player.group_attacks_members) ? player.group_attacks_members : [];
            if (!members.length) return `No group member attack data`;
            const lines = members.map(m => `${m.character_name}: ${m.extra_attacks}`);
            return `Group extra attacks (avg ${Number(player.group_attacks_avg||0)}):\n` + lines.join('\n');
        } catch (_) {
            return '';
        }
    }

    _escapeAttr(html) {
        try {
            return String(html || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        } catch (_) { return ''; }
    }

    buildWindfuryTooltipHtml(player) {
        try {
            const members = Array.isArray(player.group_attacks_members) ? player.group_attacks_members : [];
            if (!members.length) return `<div class="wf-tip"><div class="wf-tip-title">Group extra attacks</div><div>No group member attack data</div></div>`;
            const avg = Number(player.group_attacks_avg||0);
            const rows = members.map(m => {
                const cls = String(m.character_class||'').toLowerCase();
                const isIncluded = !!m.included_in_avg;
                const nameHtml = isIncluded ? `<span class="wf-inc">${m.character_name}</span>` : `<span class="wf-exc">${m.character_name}</span>`;
                return `<div class="wf-row">${nameHtml}: <span class="wf-val">${Number(m.extra_attacks||0)}</span></div>`;
            }).join('');
            const tankNote = (player.party_id === 1 || String(player.party_id) === '1')
                ? `<div class=\"wf-note\">* For tank group, requirements for extra attacks is 75% of dps groups.</div>`
                : '';
            return `<div class="wf-tip"><div class="wf-tip-title">Group extra attacks (avg ${avg})</div>${rows}${tankNote}</div>`;
        } catch (_) {
            return '';
        }
    }

    ensureWindfuryMemberTooltipSetup() {
        if (this._wfMembersTipSetup) return;
        this._wfMembersTipSetup = true;
        const tip = document.createElement('div');
        tip.id = 'wf-members-tooltip';
        tip.className = 'wf-members-tooltip';
        tip.style.display = 'none';
        document.body.appendChild(tip);

        let active = null;
        const show = (el, e) => {
            const raw = el.getAttribute('data-wf-tooltip') || '';
            // raw stored escaped; decode entities for innerHTML
            tip.innerHTML = raw
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&');
            tip.style.display = 'block';
            move(e);
        };
        const hide = () => { tip.style.display = 'none'; };
        const move = (e) => {
            const x = (e.pageX || (e.clientX + window.scrollX)) + 14;
            const y = (e.pageY || (e.clientY + window.scrollY)) + 14;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        };

        document.addEventListener('mouseover', (e) => {
            const t = e.target.closest('.character-details[data-wf-tooltip]');
            if (!t) return;
            active = t;
            show(t, e);
        });
        document.addEventListener('mousemove', (e) => { if (active) move(e); });
        document.addEventListener('mouseout', (e) => {
            if (e.target.closest('.character-details[data-wf-tooltip]') !== active) return;
            active = null;
            hide();
        });
        document.addEventListener('focusin', (e) => {
            const t = e.target.closest('.character-details[data-wf-tooltip]');
            if (!t) return;
            active = t;
            const rect = t.getBoundingClientRect();
            show(t, { pageX: rect.right + window.scrollX, pageY: rect.bottom + window.scrollY });
        });
        document.addEventListener('focusout', (e) => {
            if (!active) return;
            const related = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.character-details[data-wf-tooltip]');
            if (related === active) return;
            active = null;
            hide();
        });
    }

    getTotemIconHtml(totemType) {
        if (!totemType) return null;
        const t = String(totemType).toLowerCase();
        if (t.includes('tranquil air')) {
            return `<img src="https://wow.zamimg.com/images/wow/icons/large/spell_nature_brilliance.jpg" class="spec-icon" alt="Tranquil Air Totem" width="50" height="50" loading="lazy" decoding="async">`;
        }
        if (t.includes('windfury')) {
            return `<img src="https://wow.zamimg.com/images/wow/icons/large/spell_nature_windfury.jpg" class="spec-icon" alt="Windfury Totem" width="50" height="50" loading="lazy" decoding="async">`;
        }
        if (t.includes('grace of air')) {
            return `<img src="https://wow.zamimg.com/images/wow/icons/large/spell_nature_invisibilitytotem.jpg" class="spec-icon" alt="Grace of Air Totem" width="50" height="50" loading="lazy" decoding="async">`;
        }
        if (t.includes('strength of earth')) {
            return `<img src="https://wow.zamimg.com/images/wow/icons/large/spell_nature_earthbindtotem.jpg" class="spec-icon" alt="Strength of Earth Totem" width="50" height="50" loading="lazy" decoding="async">`;
        }
        return null;
    }

    displayWallOfShame() {
        console.log('💀 Displaying Wall of Shame');
        
        // Update the shame data regardless - the toggle button will show/hide
        this.updateMostDeathsCard();
        this.updateMostTrashDeathsCard();
        this.updateMostAvoidableDamageCard();
        this.updateMostFriendlyDamageCard();
        
        // Show or hide the shame toggle button based on data availability
        const shameToggleBtn = document.querySelector('.stats-toggle-btn[data-panel="shame"]');
        if (this.shameData && Object.keys(this.shameData).length > 0) {
            if (shameToggleBtn) {
                shameToggleBtn.style.display = 'block';
            }
        } else {
            if (shameToggleBtn) {
                shameToggleBtn.style.display = 'none';
            }
        }
    }
    updateMostDeathsCard() {
        const valueElement = document.getElementById('most-deaths-value');
        const detailElement = document.getElementById('most-deaths-detail');
        
        if (this.shameData.most_deaths) {
            const player = this.shameData.most_deaths;
            const characterClass = this.normalizeClassName(player.character_class);
            
            valueElement.textContent = player.character_name;
            // Apply class color to the player name
            valueElement.className = `stat-value class-${characterClass}`;
            
            // Extract total deaths from the ability_value (format: "3 (1)")
            const totalDeaths = player.ability_value ? player.ability_value.split(' ')[0] : '0';
            detailElement.textContent = `${totalDeaths} total deaths`;
        } else {
            valueElement.textContent = '--';
            valueElement.className = 'stat-value';
            detailElement.textContent = 'No death data';
        }
    }

    updateMostTrashDeathsCard() {
        const valueElement = document.getElementById('most-trash-deaths-value');
        const detailElement = document.getElementById('most-trash-deaths-detail');
        
        if (this.shameData.most_deaths) {
            const player = this.shameData.most_deaths;
            const characterClass = this.normalizeClassName(player.character_class);
            
            valueElement.textContent = player.character_name;
            // Apply class color to the player name
            valueElement.className = `stat-value class-${characterClass}`;
            
            // Extract trash deaths from the ability_value (format: "3 (1)")
            const trashDeaths = player.ability_value ? player.ability_value.match(/\((\d+)\)/)?.[1] || '0' : '0';
            detailElement.textContent = `${trashDeaths} trash deaths`;
        } else {
            valueElement.textContent = '--';
            valueElement.className = 'stat-value';
            detailElement.textContent = 'No trash death data';
        }
    }

    updateMostAvoidableDamageCard() {
        const valueElement = document.getElementById('most-avoidable-damage-value');
        const detailElement = document.getElementById('most-avoidable-damage-detail');
        
        if (this.shameData.most_avoidable_damage) {
            const player = this.shameData.most_avoidable_damage;
            const characterClass = this.normalizeClassName(player.character_class);
            
            valueElement.textContent = player.character_name;
            // Apply class color to the player name
            valueElement.className = `stat-value class-${characterClass}`;
            
            const damage = this.formatNumber(player.ability_value || 0);
            detailElement.textContent = `${damage} avoidable damage`;
        } else {
            valueElement.textContent = '--';
            valueElement.className = 'stat-value';
            detailElement.textContent = 'No avoidable damage data';
        }
    }

    updateMostFriendlyDamageCard() {
        const valueElement = document.getElementById('most-friendly-damage-value');
        const detailElement = document.getElementById('most-friendly-damage-detail');
        
        if (this.shameData.most_friendly_damage) {
            const player = this.shameData.most_friendly_damage;
            const characterClass = this.normalizeClassName(player.character_class);
            
            valueElement.textContent = player.character_name;
            // Apply class color to the player name
            valueElement.className = `stat-value class-${characterClass}`;
            
            const damage = this.formatNumber(player.ability_value || 0);
            detailElement.textContent = `${damage} friendly damage`;
        } else {
            valueElement.textContent = '--';
            valueElement.className = 'stat-value';
            detailElement.textContent = 'No friendly damage data';
        }
    }

    // --- Manual Rewards and Deductions Methods ---
    
    displayManualRewards() {
        const hasManagement = !!(this.currentUser && this.currentUser.hasManagementRole);
        const templatesEl = document.getElementById('manual-rewards-templates');
        const formEl = document.getElementById('manual-rewards-form');
        const listEl = document.getElementById('manual-rewards-list');
        const noEntriesEl = document.getElementById('no-entries-message');
        const deniedEl = document.getElementById('access-denied-message');
        const loadingEl = document.getElementById('manual-rewards-loading');

        if (loadingEl) loadingEl.style.display = 'none';

        if (hasManagement) {
            if (templatesEl) templatesEl.style.display = 'block';
            if (formEl) formEl.style.display = 'block';
            if (deniedEl) deniedEl.style.display = 'none';
        } else {
            if (templatesEl) templatesEl.style.display = 'none';
            if (formEl) formEl.style.display = 'none';
            if (deniedEl) deniedEl.style.display = 'block';
        }

        // Populate list with any loaded entries
        try { this.populateManualRewardsTable(); } catch (e) { console.warn('⚠️ [MANUAL REWARDS] populate failed', e); }

        // Empty state when no entries
        try {
            const hasRows = Array.isArray(this.manualRewardsData) && this.manualRewardsData.length > 0;
            if (noEntriesEl) noEntriesEl.style.display = hasRows ? 'none' : 'block';
            if (listEl) listEl.style.display = 'block';
        } catch {}
    }

    initializeManualRewards() {
        console.log('⚖️ [MANUAL REWARDS] Initializing manual rewards functionality');
        
        // Preload roster data for autocomplete (fallback when logs aren't uploaded)
        if (!this.rosterPlayersData || this.rosterPlayersData.length === 0) {
            this.buildRosterCache().catch(e => console.warn('⚠️ [MANUAL REWARDS] Failed to preload roster for autocomplete', e));
        }
        
        // Initialize event listeners for the form
        this.setupManualRewardsEventListeners();
    }
    setupManualRewardsEventListeners() {
        // Player name input and dropdown
        const playerNameInput = document.getElementById('player-name-input');
        const playerDropdown = document.getElementById('player-dropdown');
        
        if (playerNameInput) {
            playerNameInput.addEventListener('input', (e) => {
                try { this.handlePlayerSearch(e.target.value); } catch (err) { console.warn('⚠️ handlePlayerSearch missing, adding fallback', err); if (typeof this.handlePlayerSearch !== 'function') { this.handlePlayerSearch = (s)=>{ const dd=document.getElementById('player-dropdown'); if(!dd) return; const term=String(s||'').trim().toLowerCase(); let src=Array.isArray(this.playersData)&&this.playersData.length>0?this.playersData:(Array.isArray(this.rosterPlayersData)?this.rosterPlayersData:[]); if(src.length===0&&(!this.rosterPlayersData||this.rosterPlayersData.length===0)){this.buildRosterCache().then(()=>{src=Array.isArray(this.rosterPlayersData)?this.rosterPlayersData:[];const matches=term?src.filter(p=>String(p.player_name||'').toLowerCase().includes(term)).slice(0,20):src.slice(0,20);this.populatePlayerDropdown(matches);dd.style.display=matches.length?'block':'none';});}else{const matches=term?src.filter(p=>String(p.player_name||'').toLowerCase().includes(term)).slice(0,20):src.slice(0,20); this.populatePlayerDropdown(matches); dd.style.display = matches.length ? 'block' : 'none';} }; this.handlePlayerSearch(e.target.value); } }
            });
            
            playerNameInput.addEventListener('keydown', (e) => {
                this.handlePlayerSearchKeydown(e);
            });
            
            // Reposition dropdown on focus to handle edit mode vs add mode differences
            // Also trigger search to show all players if input is empty
            playerNameInput.addEventListener('focus', () => {
                setTimeout(() => {
                    const dropdown = document.getElementById('player-dropdown');
                    if (dropdown && dropdown.style.display === 'block') {
                        this.positionDropdown();
                    }
                    // Trigger autocomplete to show all available players on focus
                    const currentValue = playerNameInput.value || '';
                    if (currentValue.trim() === '' || dropdown.style.display === 'none') {
                        try { 
                            this.handlePlayerSearch(currentValue); 
                        } catch (err) { 
                            console.warn('⚠️ handlePlayerSearch on focus failed', err); 
                        }
                    }
                }, 50); // Small delay to ensure any form transformations are applied
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.player-search-container')) {
                    playerDropdown.style.display = 'none';
                }
            });
        }
        
        // Add entry button
        const addEntryBtn = document.getElementById('add-entry-btn');
        if (addEntryBtn) {
            addEntryBtn.addEventListener('click', () => {
                this.handleAddEntry();
            });
        }
        
        // Cancel edit button
        const cancelEditBtn = document.getElementById('cancel-edit-btn');
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => {
                this.cancelEdit();
            });
        }

        // Tanks button (warrior-colored) — add MT/OT1/OT2/OT3 from main Tanking panel (ID1..ID4)
        const addTemplatesBtn = document.getElementById('add-templates-btn');
        if (addTemplatesBtn) {
            addTemplatesBtn.addEventListener('click', () => {
                this.autoAddMainTanks();
            });
        }

        // Grouped template buttons
        const add4HTanksBtn = document.getElementById('add-templates-4h-tanks-btn');
        if (add4HTanksBtn) {
            add4HTanksBtn.addEventListener('click', () => {
                this.autoAddFourHorsemenTanks();
            });
        }
        const addRazMcBtn = document.getElementById('add-templates-raz-mc-btn');
        if (addRazMcBtn) {
            addRazMcBtn.addEventListener('click', () => {
                this.autoAddRazMC();
            });
        }
        const addPullerBtn = document.getElementById('add-templates-puller-btn');
        if (addPullerBtn) {
            addPullerBtn.addEventListener('click', () => {
                this.autoAddPuller();
            });
        }
        const addGluthKiteBtn = document.getElementById('add-templates-gluth-kite-btn');
        if (addGluthKiteBtn) {
            addGluthKiteBtn.addEventListener('click', () => {
                this.autoAddGluthKite();
            });
        }
        const addSummonersBtn = document.getElementById('add-templates-summoners-btn');
        if (addSummonersBtn) {
            addSummonersBtn.addEventListener('click', () => {
                this.autoAddSummoners();
            });
        }
        
        // Form inputs for real-time validation
        const inputs = ['player-name-input', 'description-input', 'points-input'];
        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', () => {
                    this.validateForm();
                });
            }
        });
        
        // Reposition dropdown on scroll/resize to maintain correct position
        const repositionDropdown = () => {
            const dropdown = document.getElementById('player-dropdown');
            if (dropdown && dropdown.style.display === 'block') {
                this.positionDropdown();
            }
        };
        
        window.addEventListener('scroll', repositionDropdown);
        window.addEventListener('resize', repositionDropdown);
    }

    // Auto-add 4H tanks from Assignments: pick warriors in Horsemen grid excluding main-page Tanking ID1..ID4
    async autoAddFourHorsemenTanks() {
        if (!this.activeEventId) {
            console.error('❌ [4H TANKS] No active event ID');
            return;
        }
        try {
            // Fetch assignments for this event
            const res = await fetch(`/api/assignments/${this.activeEventId}`);
            const data = await res.json();
            if (!data || !data.success) throw new Error('Failed to load assignments');

            const panels = Array.isArray(data.panels) ? data.panels : [];
            // Main page: Tanking panel for ID1..ID4
            const tankingPanel = panels.find(p => String(p.boss || '').toLowerCase() === 'tanking' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'))
                               || panels.find(p => String(p.boss || '').toLowerCase() === 'tanking');
            const tankNames = [];
            if (tankingPanel && Array.isArray(tankingPanel.entries)) {
                const findByMarker = (markerSub) => {
                    const e = tankingPanel.entries.find(en => String(en.marker_icon_url || '').toLowerCase().includes(markerSub));
                    return e && e.character_name ? String(e.character_name) : null;
                };
                const id1 = findByMarker('skull');
                const id2 = findByMarker('cross');
                const id3 = findByMarker('square');
                const id4 = findByMarker('moon');
                [id1, id2, id3, id4].forEach(n => { if (n) tankNames.push(n.toLowerCase()); });
            }

            // Military -> The Four Horsemen panel and its persisted grid
            const horsePanel = panels.find(p => String(p.wing || '').toLowerCase().includes('military') && (String(p.boss || '').toLowerCase().includes('four') || String(p.boss || '').toLowerCase().includes('horse')));
            if (!horsePanel) throw new Error('Four Horsemen panel not found');

            // Collect up to 8 warrior names from hidden entries __HGRID__ or horsemen_tanks
            const horseNames = new Set();
            if (horsePanel.horsemen_tanks && typeof horsePanel.horsemen_tanks === 'object') {
                Object.values(horsePanel.horsemen_tanks).forEach(arr => {
                    const name = Array.isArray(arr) ? arr[0] : null;
                    if (name) horseNames.add(String(name));
                });
            }
            if (Array.isArray(horsePanel.entries)) {
                horsePanel.entries.forEach(en => {
                    const m = String(en.assignment || '').match(/^__HGRID__:(\d+):1$/);
                    if (m && en.character_name) horseNames.add(String(en.character_name));
                });
            }

            // Exclude main tanks (ID1..ID4)
            const candidates = Array.from(horseNames).filter(n => !tankNames.includes(String(n).toLowerCase()));

            // Limit to 4 and map to POST payloads
            const selected = candidates.slice(0, 4);
            if (selected.length === 0) {
                console.warn('⚠️ [4H TANKS] No eligible warriors found to add');
                return;
            }

            // Icon for warrior tank
            const iconUrl = 'https://wow.zamimg.com/images/wow/icons/large/ability_warrior_defensivestance.jpg';

            // Ensure players list present to resolve class/discord
            if (!this.playersData || !Array.isArray(this.playersData) || this.playersData.length === 0) {
                try { await this.fetchPlayersForDropdown(); } catch {}
            }

            // Send sequentially (simple and reliable)
            for (const name of selected) {
                // Try to find class/discord from dropdown cached players
                let playerClass = null, discordId = null;
                const m = (this.playersData || []).find(p => String(p.player_name || '').toLowerCase() === String(name).toLowerCase());
                if (m) { playerClass = m.player_class || null; discordId = m.discord_id || null; }
                await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        player_name: name,
                        player_class: playerClass,
                        discord_id: discordId,
                        description: '4 Horsemen tank assignment',
                        points: 15,
                        icon_url: iconUrl
                    })
                });
            }

            // Refresh list
            try { await this.fetchManualRewardsData(); } catch (e) { console.warn('⚠️ [MANUAL REWARDS] Skipping due to fetch error', e); }
            this.populateManualRewardsTable();
            this.updateTotalPointsCard();
        } catch (err) {
            console.error('❌ [4H TANKS] Failed to auto add 4H tanks:', err);
        }
    }
    // Auto-add Raz MC: add exactly the two priests assigned in the Razuvious panel on /assignments/military
    async autoAddRazMC() {
        if (!this.activeEventId) {
            console.error('❌ [RAZ MC] No active event ID');
            return;
        }
        try {
            const res = await fetch(`/api/assignments/${this.activeEventId}`);
            const data = await res.json();
            if (!data || !data.success) throw new Error('Failed to load assignments');

            const panels = Array.isArray(data.panels) ? data.panels : [];
            const razPanel = panels.find(p => String(p.wing || '').toLowerCase().includes('military') && String(p.boss || '').toLowerCase().includes('razu'));
            if (!razPanel) { console.warn('⚠️ [RAZ MC] Razuvious panel not found'); return; }

            // Gather priests from the panel entries (case-insensitive), dedupe by name
            const namesSet = new Set();
            const picks = [];
            (Array.isArray(razPanel.entries) ? razPanel.entries : []).forEach(en => {
                const cls = String(en.class_name || '').toLowerCase();
                const name = String(en.character_name || '');
                if (!name) return;
                if (cls === 'priest' && !namesSet.has(name.toLowerCase())) {
                    namesSet.add(name.toLowerCase());
                    picks.push(name);
                }
            });

            const selected = picks.slice(0, 2);
            if (selected.length === 0) { console.warn('⚠️ [RAZ MC] No priests found in Razuvious panel'); return; }

            // Ensure players and roster cache present for class/discord resolution
            if (!this.playersData || !Array.isArray(this.playersData) || this.playersData.length === 0) {
                try { await this.fetchPlayersForDropdown(); } catch {}
            }
            if (!this.rosterMapByName || this.rosterMapByName.size === 0) {
                try { await this.buildRosterCache(); } catch {}
            }

            const iconUrl = 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_shadowworddominate.jpg';

            for (const name of selected) {
                const lower = String(name).toLowerCase();
                let playerClass = 'Priest', discordId = null;
                const p = (this.playersData || []).find(pp => String(pp.player_name || '').toLowerCase() === lower);
                if (p) { playerClass = p.player_class || playerClass; discordId = p.discord_id || null; }
                if (!p && this.rosterMapByName) {
                    const cls = this.rosterMapByName.get(lower);
                    if (cls) playerClass = cls;
                }
                await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        player_name: name,
                        player_class: playerClass,
                        discord_id: discordId,
                        description: 'Razuvious mind control duty',
                        points: 15,
                        icon_url: iconUrl
                    })
                });
            }
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            this.updateTotalPointsCard();
        } catch (err) {
            console.error('❌ [RAZ MC] Failed to auto add Raz MC priests:', err);
        }
    }

    // Auto-add Puller: hunter with lowest (party_id, slot_id) in roster
    async autoAddPuller() {
        if (!this.activeEventId) return;
        try {
            if (!this.rosterMapByName || this.rosterMapByName.size === 0) {
                await this.buildRosterCache();
            }
            // Fetch roster to get party/slot
            const res = await fetch(`/api/assignments/${this.activeEventId}/roster`);
            const data = await res.json();
            const roster = (data && data.success && Array.isArray(data.roster)) ? data.roster : [];
            const hunters = roster.filter(r => String(r.class_name || '').toLowerCase() === 'hunter')
                                  .sort((a,b)=> (Number(a.party_id)||99)-(Number(b.party_id)||99) || (Number(a.slot_id)||99)-(Number(b.slot_id)||99));
            if (hunters.length === 0) { console.warn('⚠️ [PULLER] No hunters found'); return; }
            const h = hunters[0];
            const iconUrl = 'https://wow.zamimg.com/images/wow/icons/large/ability_hunter_snipershot.jpg';
            // Resolve discord via playersData
            if (!this.playersData || !Array.isArray(this.playersData) || this.playersData.length === 0) {
                try { await this.fetchPlayersForDropdown(); } catch {}
            }
            const p = (this.playersData || []).find(pp => String(pp.player_name || '').toLowerCase() === String(h.character_name || '').toLowerCase());
            const discordId = p?.discord_id || null;
            await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_name: h.character_name,
                    player_class: 'Hunter',
                    discord_id: discordId,
                    description: 'Hunter Pulling',
                    points: 20,
                    icon_url: iconUrl
                })
            });
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            this.updateTotalPointsCard();
        } catch (err) {
            console.error('❌ [PULLER] Failed to auto add hunter puller:', err);
        }
    }

    // Auto-add Gluth kite: druid assigned in Gluth panel on Abomination wing
    async autoAddGluthKite() {
        if (!this.activeEventId) return;
        try {
            const res = await fetch(`/api/assignments/${this.activeEventId}`);
            const data = await res.json();
            if (!data || !data.success) throw new Error('Failed to load assignments');
            const panels = Array.isArray(data.panels) ? data.panels : [];
            const gluthPanel = panels.find(p => String(p.wing || '').toLowerCase().includes('abomination') && String(p.boss || '').toLowerCase().includes('gluth'));
            if (!gluthPanel) { console.warn('⚠️ [GLUTH] Gluth panel not found'); return; }
            const druid = (Array.isArray(gluthPanel.entries) ? gluthPanel.entries : []).find(en => String(en.class_name || '').toLowerCase() === 'druid');
            if (!druid || !druid.character_name) { console.warn('⚠️ [GLUTH] No druid found in Gluth panel'); return; }
            // Resolve discord/class from players/roster
            if (!this.playersData || !Array.isArray(this.playersData) || this.playersData.length === 0) {
                try { await this.fetchPlayersForDropdown(); } catch {}
            }
            if (!this.rosterMapByName || this.rosterMapByName.size === 0) {
                try { await this.buildRosterCache(); } catch {}
            }
            const lower = String(druid.character_name).toLowerCase();
            let playerClass = 'Druid', discordId = null;
            const p = (this.playersData || []).find(pp => String(pp.player_name || '').toLowerCase() === lower);
            if (p) { playerClass = p.player_class || playerClass; discordId = p.discord_id || null; }
            const iconUrl = 'https://wow.zamimg.com/images/wow/icons/medium/classicon_druid.jpg';
            await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_name: druid.character_name,
                    player_class: playerClass,
                    discord_id: discordId,
                    description: 'Gluth skillington kiteing',
                    points: 10,
                    icon_url: iconUrl
                })
            });
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            this.updateTotalPointsCard();
        } catch (err) {
            console.error('❌ [GLUTH] Failed to auto add Gluth kite druid:', err);
        }
    }

    // Auto-add Summoners: warlock with lowest group/slot as Raid summoner; leave two clickers empty
    async autoAddSummoners() {
        if (!this.activeEventId) return;
        try {
            const res = await fetch(`/api/assignments/${this.activeEventId}/roster`);
            const data = await res.json();
            const roster = (data && data.success && Array.isArray(data.roster)) ? data.roster : [];
            const locks = roster.filter(r => String(r.class_name || '').toLowerCase() === 'warlock')
                                .sort((a,b)=> (Number(a.party_id)||99)-(Number(b.party_id)||99) || (Number(a.slot_id)||99)-(Number(b.slot_id)||99));
            if (locks.length === 0) { console.warn('⚠️ [SUMMON] No warlocks found'); return; }
            const lock = locks[0];
            // Resolve discord via playersData
            if (!this.playersData || !Array.isArray(this.playersData) || this.playersData.length === 0) {
                try { await this.fetchPlayersForDropdown(); } catch {}
            }
            const p = (this.playersData || []).find(pp => String(pp.player_name || '').toLowerCase() === String(lock.character_name || '').toLowerCase());
            const discordId = p?.discord_id || null;
            const iconUrl = 'https://static.wikia.nocookie.net/wowpedia/images/f/f4/Spell_shadow_twilight.png';
            // Add the primary summoner
            await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_name: lock.character_name,
                    player_class: 'Warlock',
                    discord_id: discordId,
                    description: 'Raid summoner',
                    points: 10,
                    icon_url: iconUrl
                })
            });
            // Add the two clicker slots empty (use non-empty placeholder name so DB constraint passes; UI shows template-entry styling)
            const emptyEntries = [
                { description: 'Raid summoner clicker #1', points: 5 },
                { description: 'Raid summoner clicker #2', points: 5 }
            ];
            for (const e of emptyEntries) {
                await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        player_name: '(unassigned)',
                        player_class: null,
                        discord_id: null,
                        description: e.description,
                        points: e.points,
                        icon_url: iconUrl
                    })
                });
            }
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            this.updateTotalPointsCard();
        } catch (err) {
            console.error('❌ [SUMMON] Failed to auto add summoners:', err);
        }
    }

    // Auto-add Tanks: MT, OT1, OT2, OT3 from main page Tanking panel (ID1..ID4 markers)
    async autoAddMainTanks() {
        if (!this.activeEventId) return;
        try {
            const res = await fetch(`/api/assignments/${this.activeEventId}`);
            const data = await res.json();
            if (!data || !data.success) throw new Error('Failed to load assignments');
            const panels = Array.isArray(data.panels) ? data.panels : [];
            const tankingPanel = panels.find(p => String(p.boss || '').toLowerCase() === 'tanking' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'))
                               || panels.find(p => String(p.boss || '').toLowerCase() === 'tanking');
            if (!tankingPanel || !Array.isArray(tankingPanel.entries)) { console.warn('⚠️ [TANKS] Tanking panel not found'); return; }
            const pickByMarker = (marker) => {
                const e = tankingPanel.entries.find(en => String(en.marker_icon_url || '').toLowerCase().includes(marker));
                return e?.character_name || null;
            };
            const order = [
                { marker: 'skull',  desc: 'Main Tank' },
                { marker: 'cross',  desc: 'Off Tank 1' },
                { marker: 'square', desc: 'Off Tank 2' },
                { marker: 'moon',   desc: 'Off Tank 3' }
            ];
            // Ensure players list present for discord/class
            if (!this.playersData || !Array.isArray(this.playersData) || this.playersData.length === 0) {
                try { await this.fetchPlayersForDropdown(); } catch {}
            }
            const iconUrl = 'https://wow.zamimg.com/images/wow/icons/large/ability_warrior_defensivestance.jpg';
            for (const { marker, desc } of order) {
                const name = pickByMarker(marker);
                if (!name) continue;
                const lower = String(name).toLowerCase();
                const p = (this.playersData || []).find(pp => String(pp.player_name || '').toLowerCase() === lower);
                const discordId = p?.discord_id || null;
                await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        player_name: name,
                        player_class: 'Warrior',
                        discord_id: discordId,
                        description: desc,
                        points: this.getTankPointsForDescription(desc),
                        icon_url: iconUrl
                    })
                });
            }
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            this.updateTotalPointsCard();
        } catch (err) {
            console.error('❌ [TANKS] Failed to auto add main tanks:', err);
        }
    }

    getTankPointsForDescription(desc) {
        // Map to template defaults; adjust as needed
        const map = {
            'Main Tank': 100,
            'Off Tank 1': 80,
            'Off Tank 2': 50,
            'Off Tank 3': 30
        };
        return map[desc] ?? 0;
    }
    async fetchCurrentUser() {
        console.log('👤 [MANUAL REWARDS] Fetching current user info');
        
        try {
            const response = await fetch('/user');
            if (response.ok) {
                this.currentUser = await response.json();
                console.log('👤 [MANUAL REWARDS] Current user:', this.currentUser);
                // Update visibility of edit/save and revert buttons based on role
                this.updatePanelButtonsVisibility();
                try {
                    const btn = document.getElementById('publish-snapshot-btn');
                    if (btn) btn.style.display = (this.currentUser?.hasManagementRole ? 'inline-flex' : 'none');
                } catch {}
            } else {
                console.log('👤 [MANUAL REWARDS] User not logged in');
                this.currentUser = null;
                this.updatePanelButtonsVisibility();
                try { const btn = document.getElementById('publish-snapshot-btn'); if (btn) btn.style.display = 'none'; } catch {}
            }
        } catch (error) {
            console.error('❌ [MANUAL REWARDS] Error fetching user:', error);
            this.currentUser = null;
            this.updatePanelButtonsVisibility();
            try { const btn = document.getElementById('publish-snapshot-btn'); if (btn) btn.style.display = 'none'; } catch {}
        }
    }
    
    async fetchManualRewardsData() {
        if (!this.activeEventId) {
            console.log('⚖️ [MANUAL REWARDS] No active event ID, skipping manual rewards fetch');
            return;
        }
        
        console.log(`⚖️ [MANUAL REWARDS] Fetching manual rewards for event: ${this.activeEventId}`);
        
        try {
            const response = await fetch(`/api/manual-rewards/${this.activeEventId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch manual rewards: ${response.status}`);
            }
            
            const result = await response.json();
            this.manualRewardsData = (result.data || []).map(e => {
                // Backward-compatible gold detection: prefer e.is_gold, else detect [GOLD] in description
                const isGold = !!(e.is_gold) || /\[GOLD\]/i.test(String(e.description||''));
                return { ...e, is_gold: isGold };
            });
            // Compute total gold payouts flagged as gold
            try {
                this.manualGoldPayoutTotal = (this.manualRewardsData || []).reduce((acc, e) => {
                    const isGold = !!(e.is_gold);
                    const val = Number(e.points) || 0;
                    return isGold && val > 0 ? acc + val : acc;
                }, 0);
            } catch { this.manualGoldPayoutTotal = 0; }
            
            console.log(`⚖️ [MANUAL REWARDS] Loaded ${this.manualRewardsData.length} manual entries`);
            
            // Also fetch player list and roster to resolve classes/icons reliably
            await this.fetchPlayersForDropdown();
            await this.buildRosterCache();
            
        } catch (error) {
            console.error('❌ [MANUAL REWARDS] Error fetching manual rewards:', error);
            this.manualRewardsData = [];
            this.manualGoldPayoutTotal = 0;
        }
    }
    async buildRosterCache() {
        try {
            const res = await fetch(`/api/assignments/${this.activeEventId}/roster`);
            const data = await res.json();
            if (!data || !data.success) { 
                this.rosterMapByName = new Map(); 
                this.rosterPlayersData = [];
                return; 
            }
            const roster = Array.isArray(data.roster) ? data.roster : [];
            this.rosterMapByName = new Map(roster.map(r => [String(r.character_name || '').toLowerCase(), r.class_name || null]));
            
            // Build roster-based player data for autocomplete (uses WoW character names, not Discord names)
            this.rosterPlayersData = roster
                .filter(r => r.character_name && String(r.character_name).trim())
                .map(r => ({
                    player_name: String(r.character_name).trim(),
                    player_class: r.class_name || null,
                    discord_id: r.discord_user_id || null,
                    source: 'roster' // Mark as coming from roster for debugging
                }));
            
            console.log('👥 [ROSTER] Built roster map for class lookup. Size:', this.rosterMapByName.size);
            console.log('👥 [ROSTER] Built roster players data for autocomplete. Count:', this.rosterPlayersData.length);
        } catch (e) {
            console.warn('⚠️ [ROSTER] Failed to build roster map', e);
            this.rosterMapByName = new Map();
            this.rosterPlayersData = [];
        }
    }

    // Lightweight players fetch used by manual rewards helpers
    async fetchPlayersForDropdown() {
        try {
            const response = await fetch(`/api/manual-rewards/${this.activeEventId}/players`);
            if (!response.ok) throw new Error('players fetch failed');
            const data = await response.json();
            this.playersData = Array.isArray(data.data) ? data.data : [];
            console.log('👤 [PLAYERS] Loaded players for dropdown:', this.playersData.length);
            return this.playersData;
        } catch (e) {
            console.warn('⚠️ [PLAYERS] Failed to fetch players for dropdown', e);
            this.playersData = [];
            return [];
        }
    }
    populatePlayerDropdown(players) {
        if (!Array.isArray(players)) return;
        const dropdown = document.getElementById('player-dropdown');
        if (!dropdown) return;
        
        dropdown.innerHTML = '';
        
        // Position the dropdown below the input field using fixed positioning
        this.positionDropdown();
        
        players.forEach((player, index) => {
            const item = document.createElement('div');
            item.className = `player-dropdown-item ${player.player_class ? `class-${this.normalizeClassName(player.player_class)}` : 'class-unknown'}`;
            if (index === 0) item.classList.add('selected');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.player_name;
            nameSpan.className = `player-name ${player.player_class ? `class-${this.normalizeClassName(player.player_class)}` : ''}`;
            
            const classSpan = document.createElement('span');
            classSpan.className = 'player-class';
            classSpan.textContent = player.player_class ? `(${player.player_class})` : '';
            
            item.appendChild(nameSpan);
            item.appendChild(classSpan);
            
            item.onclick = () => this.selectPlayer(player);
            
            dropdown.appendChild(item);
        });
    }
    
    positionDropdown() {
        // Let CSS handle positioning naturally with position: absolute
        console.log('🔍 [DROPDOWN] Using CSS positioning (position: absolute)');
    }
    
    handlePlayerSearchKeydown(e) {
        const dropdown = document.getElementById('player-dropdown');
        if (!dropdown || dropdown.style.display === 'none') return;
        
        const items = dropdown.querySelectorAll('.player-dropdown-item');
        const currentSelected = dropdown.querySelector('.player-dropdown-item.selected');
        let selectedIndex = Array.from(items).indexOf(currentSelected);
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                this.updateDropdownSelection(items, selectedIndex);
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                this.updateDropdownSelection(items, selectedIndex);
                break;
            case 'Enter':
                e.preventDefault();
                if (currentSelected) {
                    currentSelected.click();
                }
                break;
            case 'Escape':
                e.preventDefault();
                dropdown.style.display = 'none';
                break;
        }
    }
    
    updateDropdownSelection(items, selectedIndex) {
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }
    
    selectPlayer(player) {
        const playerNameInput = document.getElementById('player-name-input');
        const dropdown = document.getElementById('player-dropdown');
        
        if (playerNameInput) {
            playerNameInput.value = player.player_name;
            playerNameInput.dataset.selectedPlayerId = player.discord_id || '';
            playerNameInput.dataset.selectedPlayerClass = player.player_class || '';
        }
        
        if (dropdown) {
            dropdown.style.display = 'none';
        }
        
        this.validateForm();
    }
    
    validateForm() {
        const playerNameInput = document.getElementById('player-name-input');
        const descriptionInput = document.getElementById('description-input');
        const pointsInput = document.getElementById('points-input');
        const goldToggle = document.getElementById('points-as-gold');
        const addBtn = document.getElementById('add-entry-btn');
        
        if (!playerNameInput || !descriptionInput || !pointsInput || !addBtn) return;
        
        let isValid = 
            playerNameInput.value.trim() !== '' &&
            descriptionInput.value.trim() !== '' &&
            pointsInput.value !== '' &&
            !isNaN(parseFloat(pointsInput.value));
        // In gold mode, value must be positive
        if (isValid && goldToggle && goldToggle.checked) {
            isValid = parseFloat(pointsInput.value) > 0;
        }
        
        addBtn.disabled = !isValid;
        addBtn.textContent = this.isEditingEntry ? 'Update Entry' : 'Add Entry';
    }
    
    async handleAddEntry() {
        const playerNameInput = document.getElementById('player-name-input');
        const descriptionInput = document.getElementById('description-input');
        const pointsInput = document.getElementById('points-input');
        const goldToggle = document.getElementById('points-as-gold');
        
        if (!playerNameInput || !descriptionInput || !pointsInput) return;
        
        let desc = descriptionInput.value.trim();
        const goldMode = !!(goldToggle && goldToggle.checked);
        // Ensure description carries a marker so backend-agnostic detection works
        const GOLD_TAG = '[GOLD]';
        if (goldMode && !/\[GOLD\]/i.test(desc)) desc = desc ? `${desc} ${GOLD_TAG}` : GOLD_TAG;
        if (!goldMode && /\[GOLD\]/i.test(desc)) desc = desc.replace(/\s*\[GOLD\]/ig, '').trim();

        const entryData = {
            player_name: playerNameInput.value.trim(),
            player_class: playerNameInput.dataset.selectedPlayerClass || null,
            discord_id: playerNameInput.dataset.selectedPlayerId || null,
            description: desc,
            points: parseFloat(pointsInput.value),
            is_gold: goldMode
        };
        if (entryData.is_gold) {
            // Enforce positive value for gold payouts
            entryData.points = Math.abs(entryData.points);
        }
        
        console.log('⚖️ [MANUAL REWARDS] Adding/updating entry:', entryData);
        
        try {
            let response;
            if (this.isEditingEntry) {
                response = await fetch(`/api/manual-rewards/${this.activeEventId}/${this.editingEntryId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(entryData)
                });
            } else {
                response = await fetch(`/api/manual-rewards/${this.activeEventId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(entryData)
                });
            }
            
            if (!response.ok) {
                let txt = '';
                try { txt = await response.text(); } catch {}
                throw new Error(`Failed to save entry: ${response.status} ${txt}`);
            }
            
            const result = await response.json();
            console.log('✅ [MANUAL REWARDS] Entry saved successfully:', result);
            
            // Refresh data and display
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            this.clearForm();
            
            // Update total points card
            this.updateTotalPointsCard();
            // Also update gold cards when gold payouts affect shared pool
            this.updateGoldCards();
            
        } catch (error) {
            console.error('❌ [MANUAL REWARDS] Error saving entry:', error);
            alert('Failed to save entry. Please try again.');
        }
    }
    
    editEntry(entry) {
        console.log('✏️ [MANUAL REWARDS] Editing entry:', entry);
        
        const playerNameInput = document.getElementById('player-name-input');
        const descriptionInput = document.getElementById('description-input');
        const pointsInput = document.getElementById('points-input');
        const goldToggle = document.getElementById('points-as-gold');
        const addBtn = document.getElementById('add-entry-btn');
        const cancelBtn = document.getElementById('cancel-edit-btn');
        
        if (playerNameInput) {
            playerNameInput.value = entry.player_name;
            playerNameInput.dataset.selectedPlayerId = entry.discord_id || '';
            playerNameInput.dataset.selectedPlayerClass = entry.player_class || '';
        }
        if (descriptionInput) descriptionInput.value = entry.description;
        const isGold = !!(entry.is_gold) || /\[GOLD\]/i.test(String(entry.description||''));
        if (goldToggle) goldToggle.checked = isGold;
        if (pointsInput) pointsInput.value = entry.points;
        
        this.isEditingEntry = true;
        this.editingEntryId = entry.id;
        
        if (addBtn) addBtn.textContent = 'Update Entry';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        
        // Highlight form and scroll to it
        const form = document.getElementById('manual-rewards-form');
        if (form) {
            // Add highlight class
            form.classList.add('form-active');
            
            // Scroll to form
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Focus on player name input after scroll completes
            setTimeout(() => {
                if (playerNameInput) {
                    playerNameInput.focus();
                    // Select existing text for easy replacement if it's empty or placeholder text
                    if (!entry.player_name || entry.player_name.trim() === '') {
                        playerNameInput.select();
                    }
                    
                    // Reposition dropdown after form transformation settles
                    setTimeout(() => {
                        const dropdown = document.getElementById('player-dropdown');
                        if (dropdown && dropdown.style.display === 'block') {
                            this.positionDropdown();
                        }
                    }, 100);
                }
            }, 500); // Wait for scroll animation to complete
        }
    }
    
    async deleteEntry(entry) {
        // Instant delete without confirmation
        console.log('🗑️ [MANUAL REWARDS] Deleting entry:', entry);
        
        try {
            const response = await fetch(`/api/manual-rewards/${this.activeEventId}/${entry.id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete entry: ${response.status}`);
            }
            
            console.log('✅ [MANUAL REWARDS] Entry deleted successfully');
            
            // Refresh data and display
            await this.fetchManualRewardsData();
            this.populateManualRewardsTable();
            
            // Update total points card
            this.updateTotalPointsCard();
            
        } catch (error) {
            console.error('❌ [MANUAL REWARDS] Error deleting entry:', error);
            alert('Failed to delete entry. Please try again.');
        }
    }
    
    cancelEdit() {
        console.log('↩️ [MANUAL REWARDS] Cancelling edit');
        
        this.isEditingEntry = false;
        this.editingEntryId = null;
        
        const addBtn = document.getElementById('add-entry-btn');
        const cancelBtn = document.getElementById('cancel-edit-btn');
        const form = document.getElementById('manual-rewards-form');
        
        if (addBtn) addBtn.textContent = 'Add Entry';
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        // Remove form highlight
        if (form) {
            form.classList.remove('form-active');
        }
        
        this.clearForm();
    }
    
    clearForm() {
        const playerNameInput = document.getElementById('player-name-input');
        const descriptionInput = document.getElementById('description-input');
        const pointsInput = document.getElementById('points-input');
        const goldToggle = document.getElementById('points-as-gold');
        const dropdown = document.getElementById('player-dropdown');
        const form = document.getElementById('manual-rewards-form');
        
        if (playerNameInput) {
            playerNameInput.value = '';
            playerNameInput.dataset.selectedPlayerId = '';
            playerNameInput.dataset.selectedPlayerClass = '';
        }
        if (descriptionInput) descriptionInput.value = '';
        if (pointsInput) pointsInput.value = '';
        if (goldToggle) goldToggle.checked = false;
        if (dropdown) dropdown.style.display = 'none';
        
        // Remove form highlight when clearing
        if (form) {
            form.classList.remove('form-active');
        }
        
        // Reset editing state
        this.isEditingEntry = false;
        this.editingEntryId = null;
        
        // Reset button states
        const addBtn = document.getElementById('add-entry-btn');
        const cancelBtn = document.getElementById('cancel-edit-btn');
        if (addBtn) addBtn.textContent = 'Add Entry';
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        this.validateForm();
    }
    async handleAddFromTemplates(templateIds = null) {
        console.log('📋 [TEMPLATES] Adding entries from templates');
        
        if (!this.activeEventId) {
            console.error('❌ [TEMPLATES] No active event ID');
            alert('Please select an event first');
            return;
        }

        const addTemplatesBtn = document.getElementById('add-templates-btn');
        const groupButtons = [
            document.getElementById('add-templates-4h-tanks-btn'),
            document.getElementById('add-templates-raz-mc-btn'),
            document.getElementById('add-templates-puller-btn'),
            document.getElementById('add-templates-gluth-kite-btn'),
            document.getElementById('add-templates-summoners-btn')
        ].filter(Boolean);
        
        try {
            // Disable button during operation
            if (addTemplatesBtn) {
                addTemplatesBtn.disabled = true;
                addTemplatesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            groupButtons.forEach(btn => { btn.disabled = true; });

            console.log(`📋 [TEMPLATES] Fetching templates for event: ${this.activeEventId}`);
            
            const response = await fetch(`/api/manual-rewards/${this.activeEventId}/from-templates`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: templateIds && Array.isArray(templateIds) ? JSON.stringify({ templateIds }) : undefined
            });

            const result = await response.json();
            console.log('📋 [TEMPLATES] Templates response:', result);

            if (result.success) {
                console.log(`✅ [TEMPLATES] Successfully added ${result.templatesInserted} template entries`);
                
                // Show success message
                alert(`Successfully added ${result.templatesInserted} template entries! Click "Edit" on each entry to assign player names.`);
                
                // Refresh the manual rewards data
                await this.fetchManualRewardsData();
                this.populateManualRewardsTable();
                
            } else {
                console.error('❌ [TEMPLATES] Failed to add templates:', result.message);
                alert(`Failed to add templates: ${result.message}`);
            }

        } catch (error) {
            console.error('❌ [TEMPLATES] Error adding templates:', error);
            alert('Error adding templates. Please try again.');
        } finally {
            // Re-enable button
            if (addTemplatesBtn) {
                addTemplatesBtn.disabled = false;
                addTemplatesBtn.innerHTML = '<i class="fas fa-clipboard-list"></i> Add from templates';
            }
            groupButtons.forEach(btn => { btn.disabled = false; });
        }
    }
    // Temporary: diagnostic lock that logs per-panel harvest counts
    async lockSnapshotDiagnostic() {
        const entries = [];
        const counts = [];
        (this.panelConfigs || []).forEach(cfg => {
            const list = document.getElementById(cfg.containerId);
            if (!list) { counts.push({ key: cfg.key, name: cfg.name, items: 0, note: 'no container' }); return; }
            const items = Array.from(list.querySelectorAll('.ranking-item'));
            counts.push({ key: cfg.key, name: cfg.name, items: items.length });
            items.forEach((item, idx) => {
                const nameEl = item.querySelector('.character-name');
                const detailsEl = item.querySelector('.character-details');
                const pointsEl = item.querySelector('.performance-amount .amount-value');
                const playerName = nameEl ? nameEl.textContent.trim() : null;
                if (!playerName) return;
                const pointsInput = pointsEl ? pointsEl.querySelector('input') : null;
                const detailsInput = detailsEl ? detailsEl.querySelector('input') : null;
                const points = pointsInput
                    ? Math.round(Number(pointsInput.value || '0'))
                    : (pointsEl ? Math.round(Number((pointsEl.textContent || '0').replace('+','').trim())) : 0);
                const details = detailsInput
                    ? (detailsInput.value || '').trim()
                    : (detailsEl ? (detailsEl.textContent || '').trim() : '');
                let charClass = null;
                const info = item.querySelector('.character-info');
                if (info && info.className) {
                    const m = info.className.match(/class-([a-z\-]+)/);
                    if (m) {
                        const map = { 'warrior':'Warrior','paladin':'Paladin','hunter':'Hunter','rogue':'Rogue','priest':'Priest','shaman':'Shaman','mage':'Mage','warlock':'Warlock','druid':'Druid' };
                        charClass = map[m[1]] || null;
                    }
                }
                const lowerName = playerName.toLowerCase();
                const damageRow = (this.logData || []).find(p => String(p.character_name).toLowerCase() === lowerName);
                const discordId = damageRow?.discord_id || null;
                let auxJson = null;
                if (cfg.key === 'windfury_totems') {
                    const itemKey = item.getAttribute('data-item-key') || null;
                    if (itemKey) auxJson = { item_key: itemKey };
                }
                entries.push({
                    panel_key: cfg.key,
                    panel_name: cfg.name,
                    discord_user_id: discordId,
                    character_name: playerName,
                    character_class: charClass,
                    ranking_number_original: idx + 1,
                    point_value_original: points,
                    character_details_original: details,
                    primary_numeric_original: null,
                    aux_json: auxJson
                });
            });
        });
        console.log('[SNAPSHOT] Harvest counts by panel:', counts);
        console.log('[SNAPSHOT] Total harvested entries:', entries.length);
        try {
            const res = await fetch(`/api/rewards-snapshot/${this.activeEventId}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
            if (res.ok) {
                console.log('[SNAPSHOT] Lock succeeded with entries:', entries.length);
                await this.fetchSnapshotStatus();
                await this.fetchSnapshotData();
                this.applySnapshotOverlay();
                this.updateTotalPointsCard();
                this.updateGoldCards();
            } else {
                console.warn('[SNAPSHOT] Lock failed with status', res.status);
            }
        } catch (e) {
            console.error('[SNAPSHOT] Diagnostic lock error', e);
        }
    }

    // ===== Player Mismatch Detection =====
    
    /**
     * Collects all player names that appear on any panel (have points awarded or deducted).
     * This includes damage/healing rankings, abilities, consumables, curses, manual rewards, etc.
     */
    collectPlayersOnPage() {
        const normalizeName = (name) => String(name || '').toLowerCase().trim();
        const pagePlayerNames = new Set();
        
        // Helper to add names from an array with a name field
        const addFromArray = (arr, nameField = 'character_name') => {
            if (!Array.isArray(arr)) return;
            arr.forEach(item => {
                const name = normalizeName(item[nameField] || item.character_name || item.player_name);
                if (name && !this.shouldIgnorePlayer(name)) {
                    pagePlayerNames.add(name);
                }
            });
        };
        
        // Damage dealers (from logData filtered by role - those who appear in DPS panel)
        const damageDealer = (this.logData || []).filter(player => {
            const nameKey = String(player.character_name || '').trim().toLowerCase();
            const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
            const fallbackRole = (player.role_detected || '').toLowerCase();
            const role = primaryRole || fallbackRole;
            const damage = parseInt(player.damage_amount) || 0;
            return (role === 'dps' || role === 'tank') && damage > 0;
        });
        addFromArray(damageDealer);
        
        // Healers (from logData filtered by role)
        const healers = (this.logData || []).filter(player => {
            const nameKey = String(player.character_name || '').trim().toLowerCase();
            const primaryRole = this.primaryRoles ? String(this.primaryRoles[nameKey] || '').toLowerCase() : '';
            const fallbackRole = (player.role_detected || '').toLowerCase();
            const role = primaryRole || fallbackRole;
            const healing = parseInt(player.healing_amount) || 0;
            return role === 'healer' && healing > 0;
        });
        addFromArray(healers);
        
        // All the data panels that award points
        addFromArray(this.abilitiesData);
        addFromArray(this.manaPotionsData);
        addFromArray(this.runesData);
        addFromArray(this.interruptsData);
        addFromArray(this.disarmsData);
        addFromArray(this.sunderData);
        addFromArray(this.curseData);
        addFromArray(this.curseShadowData);
        addFromArray(this.curseElementsData);
        addFromArray(this.faerieFireData);
        addFromArray(this.scorchData);
        addFromArray(this.demoShoutData);
        addFromArray(this.polymorphData);
        addFromArray(this.powerInfusionData);
        addFromArray(this.decursesData);
        addFromArray(this.voidDamageData);
        addFromArray(this.windfuryData);
        addFromArray(this.worldBuffsData);
        addFromArray(this.frostResistanceData);
        addFromArray(this.playerStreaksData);
        addFromArray(this.guildMembersData);
        addFromArray(this.weeklyNaxRaidsData);
        addFromArray(this.rocketHelmetData);
        addFromArray(this.bigBuyerData);
        
        // Manual rewards (uses player_name)
        addFromArray(this.manualRewardsData, 'player_name');
        
        console.log(`📊 [MISMATCH] Players appearing on page: ${pagePlayerNames.size}`);
        return pagePlayerNames;
    }
    
    /**
     * Compares roster players vs combat log players vs page players to find mismatches.
     * Returns arrays of player names that are missing from each source.
     */
    compareRosterVsCombatLogs() {
        // Normalize name for comparison
        const normalizeName = (name) => String(name || '').toLowerCase().trim();
        
        // Get roster player names (from roster_overrides via buildRosterCache)
        const rosterNames = new Set(
            (this.rosterPlayersData || [])
                .map(p => normalizeName(p.player_name || p.character_name))
                .filter(n => n && n.length > 0)
        );
        
        // Get combat log player names (from log_data)
        const logNames = new Set(
            (this.logData || [])
                .map(p => normalizeName(p.character_name))
                .filter(n => n && n.length > 0 && !this.shouldIgnorePlayer(n))
        );
        
        // Get players who appear on the page (have points)
        const pageNames = this.collectPlayersOnPage();
        
        // Find mismatches
        const missingInLogs = [...rosterNames]
            .filter(name => !logNames.has(name))
            .map(name => this.getOriginalCaseName(name, 'roster'));
        
        const missingInRoster = [...logNames]
            .filter(name => !rosterNames.has(name))
            .map(name => this.getOriginalCaseName(name, 'logs'));
        
        // Players in logs but NOT on the page (no points awarded/deducted)
        const missingOnPage = [...logNames]
            .filter(name => !pageNames.has(name))
            .map(name => this.getOriginalCaseName(name, 'logs'));
        
        console.log(`🔍 [MISMATCH] Roster: ${rosterNames.size}, Logs: ${logNames.size}, Page: ${pageNames.size}`);
        console.log(`🔍 [MISMATCH] Missing in logs: ${missingInLogs.length}, Missing in roster: ${missingInRoster.length}, Missing on page: ${missingOnPage.length}`);
        
        return {
            missingInLogs,    // Players in roster but NOT in combat logs
            missingInRoster,  // Players in combat logs but NOT in roster
            missingOnPage,    // Players in combat logs but NOT on the page (no points)
            rosterCount: rosterNames.size,
            logCount: logNames.size,
            pageCount: pageNames.size
        };
    }
    
    /**
     * Get original case name from data source for display purposes.
     */
    getOriginalCaseName(normalizedName, source) {
        if (source === 'roster') {
            const found = (this.rosterPlayersData || []).find(
                p => String(p.player_name || p.character_name || '').toLowerCase().trim() === normalizedName
            );
            return found ? (found.player_name || found.character_name) : this.capitalizeFirstLetter(normalizedName);
        } else {
            const found = (this.logData || []).find(
                p => String(p.character_name || '').toLowerCase().trim() === normalizedName
            );
            return found ? found.character_name : this.capitalizeFirstLetter(normalizedName);
        }
    }
    
    /**
     * Displays the player mismatch warnings in the UI.
     */
    displayPlayerMismatchWarnings() {
        const container = document.getElementById('playerMismatchWarnings');
        const logsColumn = document.getElementById('missing-in-logs');
        const rosterColumn = document.getElementById('missing-in-roster');
        const pageColumn = document.getElementById('missing-on-page');
        const toggleBtn = document.getElementById('mismatch-toggle-btn');
        const content = document.getElementById('mismatch-content');
        
        if (!container || !logsColumn || !rosterColumn || !pageColumn) {
            console.warn('⚠️ [MISMATCH] Warning container elements not found');
            return;
        }
        
        // Make sure roster data is loaded before comparison
        if (!this.rosterPlayersData || this.rosterPlayersData.length === 0) {
            console.log('📋 [MISMATCH] Roster data not loaded yet, fetching...');
            this.buildRosterCache().then(() => {
                this._renderMismatchWarnings(container, logsColumn, rosterColumn, pageColumn, toggleBtn, content);
            });
        } else {
            this._renderMismatchWarnings(container, logsColumn, rosterColumn, pageColumn, toggleBtn, content);
        }
    }
    
    /**
     * Internal method to render the mismatch warnings after data is ready.
     */
    _renderMismatchWarnings(container, logsColumn, rosterColumn, pageColumn, toggleBtn, content) {
        const { missingInLogs, missingInRoster, missingOnPage, rosterCount, logCount, pageCount } = this.compareRosterVsCombatLogs();
        
        // Hide if no mismatches
        if (missingInLogs.length === 0 && missingInRoster.length === 0 && missingOnPage.length === 0) {
            container.style.display = 'none';
            console.log('✅ [MISMATCH] No mismatches found - all players match!');
            return;
        }
        
        container.style.display = 'block';
        
        // Update header with summary counts
        const header = container.querySelector('.mismatch-header');
        if (header) {
            // Remove old summary if exists
            const oldSummary = header.querySelector('.mismatch-summary');
            if (oldSummary) oldSummary.remove();
            
            // Add summary counts
            const summary = document.createElement('div');
            summary.className = 'mismatch-summary';
            summary.innerHTML = `
                <span class="mismatch-count logs">${missingInLogs.length} missing in logs</span>
                <span class="mismatch-count roster">${missingInRoster.length} missing in roster</span>
                <span class="mismatch-count page">${missingOnPage.length} missing on page</span>
            `;
            header.insertBefore(summary, toggleBtn);
        }
        
        // Missing in Logs (in roster but didn't show up in combat logs)
        if (missingInLogs.length > 0) {
            logsColumn.innerHTML = missingInLogs.map(name => `
                <div class="mismatch-tag missing-in-logs">
                    <span class="player-name">${this.escapeHtml(name)}</span>
                    <span class="mismatch-label">Not in Logs</span>
                </div>
            `).join('');
        } else {
            logsColumn.innerHTML = '<div class="no-mismatch">All roster players found in logs</div>';
        }
        
        // Missing in Roster (in combat logs but not in roster)
        if (missingInRoster.length > 0) {
            rosterColumn.innerHTML = missingInRoster.map(name => `
                <div class="mismatch-tag missing-in-roster">
                    <span class="player-name">${this.escapeHtml(name)}</span>
                    <span class="mismatch-label">Not in Roster</span>
                </div>
            `).join('');
        } else {
            rosterColumn.innerHTML = '<div class="no-mismatch">All log players found in roster</div>';
        }
        
        // Missing on Page (in combat logs but no points on the page)
        if (missingOnPage.length > 0) {
            pageColumn.innerHTML = missingOnPage.map(name => `
                <div class="mismatch-tag missing-on-page">
                    <span class="player-name">${this.escapeHtml(name)}</span>
                    <span class="mismatch-label">No Points</span>
                </div>
            `).join('');
        } else {
            pageColumn.innerHTML = '<div class="no-mismatch">All log players have points</div>';
        }
        
        // Setup toggle functionality
        if (toggleBtn && content) {
            toggleBtn.onclick = () => {
                const isCollapsed = content.classList.toggle('collapsed');
                toggleBtn.classList.toggle('collapsed', isCollapsed);
            };
        }
        
        console.log(`⚠️ [MISMATCH] Displayed warnings: ${missingInLogs.length} missing in logs, ${missingInRoster.length} missing in roster, ${missingOnPage.length} missing on page`);
    }
    
    /**
     * Helper to escape HTML for safe display.
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Highlights the logged-in user's character names across all panels with a pulse/zoom animation
     * Animation triggers on page load and also uses IntersectionObserver for scroll-based animations
     */
    async highlightMyCharacters() {
        try {
            // Fetch current user data if not already loaded
            if (!this.currentUser || !this.currentUser.characters) {
                const response = await fetch('/user');
                if (!response.ok) return;
                this.currentUser = await response.json();
            }

            // Check if user has any characters linked
            if (!this.currentUser || !this.currentUser.characters || this.currentUser.characters.length === 0) {
                console.log('👤 No characters linked to current user');
                return;
            }

            const myCharacterNames = this.currentUser.characters.map(c => c.name.toLowerCase());
            console.log(`👤 Highlighting user's characters: ${myCharacterNames.join(', ')}`);

            // Find all character-name elements across the page
            const characterNameElements = document.querySelectorAll('.character-name');
            const elementsToAnimate = [];

            characterNameElements.forEach(element => {
                const textContent = element.textContent.trim();
                
                // Check if this element contains one of the user's character names
                myCharacterNames.forEach(charName => {
                    if (textContent.toLowerCase().includes(charName)) {
                        element.classList.add('my-character');
                        elementsToAnimate.push(element);
                    }
                });
            });

            // Also check stat-value elements in dashboard cards (for Wall of Shame, etc.)
            const statValueElements = document.querySelectorAll('.stat-value');
            statValueElements.forEach(element => {
                const textContent = element.textContent.trim();
                
                myCharacterNames.forEach(charName => {
                    if (textContent.toLowerCase().includes(charName)) {
                        element.classList.add('my-character');
                        elementsToAnimate.push(element);
                    }
                });
            });

            console.log(`✨ Found ${elementsToAnimate.length} instances of user's characters`);

            // Show the self-centered toggle if user has characters
            if (elementsToAnimate.length > 0) {
                const toggle = document.getElementById('self-centered-toggle');
                if (toggle) toggle.style.display = 'block';
            }

            // Create an IntersectionObserver to trigger animations when elements come into view
            const animationObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        // Trigger animation every time element comes into view
                        const element = entry.target;
                        
                        // Remove the animation class to reset
                        element.classList.remove('my-character-animate');
                        element.classList.remove('animation-complete');
                        
                        // Force a reflow to ensure the animation restarts
                        void element.offsetWidth;
                        
                        // Re-add the animation class
                        element.classList.add('my-character-animate');
                        
                        // Add permanent glow after animation completes (2s duration)
                        setTimeout(() => {
                            element.classList.add('animation-complete');
                        }, 2000);
                    } else {
                        // When element leaves viewport, remove classes so it can re-trigger
                        entry.target.classList.remove('my-character-animate');
                        entry.target.classList.remove('animation-complete');
                    }
                });
            }, {
                threshold: 0.1, // Trigger when 10% of element is visible
                rootMargin: '50px' // Start animation slightly before element enters viewport
            });

            // Observe all elements that need animation
            elementsToAnimate.forEach(element => {
                animationObserver.observe(element);
            });

            // For elements already visible on page load, trigger animation immediately
            setTimeout(() => {
                elementsToAnimate.forEach(element => {
                    const rect = element.getBoundingClientRect();
                    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
                    
                    if (isVisible) {
                        // Trigger initial animation for visible elements
                        element.classList.add('my-character-animate');
                        
                        // Add permanent glow after animation completes
                        setTimeout(() => {
                            element.classList.add('animation-complete');
                        }, 2000);
                    }
                });
            }, 300); // Small delay to ensure DOM is fully rendered

            // Setup self-centered mode toggle
            this.setupSelfCenteredToggle();

        } catch (error) {
            console.error('❌ Error highlighting user characters:', error);
        }
    }

    /**
     * Setup self-centered mode toggle functionality
     * Allows users to fade out everyone else's rankings
     */
    setupSelfCenteredToggle() {
        const checkbox = document.getElementById('self-centered-checkbox');
        if (!checkbox) return;

        // Load saved preference
        const savedPreference = localStorage.getItem('selfCenteredMode');
        if (savedPreference === 'true') {
            checkbox.checked = true;
            document.body.classList.add('self-centered-mode');
        }

        // Handle checkbox change
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                document.body.classList.add('self-centered-mode');
                localStorage.setItem('selfCenteredMode', 'true');
                console.log('🎯 Self-centered mode: ENABLED - Focusing on your characters only');
            } else {
                document.body.classList.remove('self-centered-mode');
                localStorage.setItem('selfCenteredMode', 'false');
                console.log('👥 Self-centered mode: DISABLED - Showing everyone');
            }
        });
    }
}

// Initialize the raid logs manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Raid Logs Manager');
    new RaidLogsManager();
}); 