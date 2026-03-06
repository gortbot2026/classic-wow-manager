// public/script.js

// Global blur and darken settings
let globalBlurValue = 0;
let globalDarkenValue = 100;

// Function to load global blur setting
async function loadGlobalBlurSetting() {
    try {
        const response = await fetch('/api/ui/background-blur');
        const data = await response.json();
        
        if (data.success) {
            globalBlurValue = data.blurValue || 0;
        }
    } catch (error) {
        console.warn('Error loading blur setting:', error);
        globalBlurValue = 0;
    }
}

// Function to load global darken setting
async function loadGlobalDarkenSetting() {
    try {
        const response = await fetch('/api/ui/background-darken');
        const data = await response.json();
        
        if (data.success) {
            globalDarkenValue = data.darkenValue || 100;
        }
    } catch (error) {
        console.warn('Error loading darken setting:', error);
        globalDarkenValue = 100;
    }
}

// Function to apply channel-specific background images
async function applyChannelBackground(eventDiv, channelId, isGrayscale = false) {
    // Removed verbose debugging - keeping minimal logs
    
    try {
        const response = await fetch(`/api/channel-background/${channelId}`);
        const data = await response.json();
        
        let backgroundUrl = null;
        
        if (data.success && data.backgroundUrl) {
            backgroundUrl = data.backgroundUrl;
        } else {
            // Use default AQ40 background
            backgroundUrl = '/images/AQ40-background.png';
        }
        
        // ALWAYS apply the pseudo-element approach when blur > 0 OR darken < 100 (make it identical for both cases)
        if (globalBlurValue > 0 || globalDarkenValue < 100) {
            // Create a pseudo-element approach to apply effects only to the background
            eventDiv.style.position = 'relative';
            eventDiv.style.overflow = 'hidden';
            
            // Remove any existing pseudo-element
            const existingPseudo = eventDiv.querySelector('.background-pseudo');
            if (existingPseudo) {
                existingPseudo.remove();
            }
            
            // Create pseudo-element for filtered background
            const pseudoElement = document.createElement('div');
            pseudoElement.className = 'background-pseudo';
            
            // Build filter string - IDENTICAL for both cases
            let filterString = '';
            if (globalBlurValue > 0) {
                filterString += `blur(${globalBlurValue}px)`;
            }
            if (globalDarkenValue < 100) {
                if (filterString) filterString += ' ';
                filterString += `brightness(${globalDarkenValue}%)`;
            }
            if (isGrayscale) {
                if (filterString) filterString += ' ';
                filterString += 'grayscale(100%)';
            }
            
            // Apply styles using individual properties instead of cssText for better debugging
            pseudoElement.style.position = 'absolute';
            pseudoElement.style.top = '-10px';
            pseudoElement.style.left = '-10px';
            pseudoElement.style.right = '-10px';
            pseudoElement.style.bottom = '-10px';
            pseudoElement.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url('${backgroundUrl}')`;
            pseudoElement.style.backgroundSize = 'cover';
            pseudoElement.style.backgroundPosition = 'center';
            pseudoElement.style.filter = filterString;
            pseudoElement.style.zIndex = '0';
            pseudoElement.style.pointerEvents = 'none';
            
            eventDiv.insertBefore(pseudoElement, eventDiv.firstChild);
            
            // Remove the background from the main element to prevent double-background
            eventDiv.style.backgroundImage = 'none';
            
            console.log(`✅ Applied filtered background for ${isGrayscale ? 'historic' : 'upcoming'} raid with ${globalBlurValue}px blur and ${globalDarkenValue}% brightness`);
        } else {
            // No blur or darken - but we still need pseudo-element for historic events to apply grayscale to background only
            if (isGrayscale) {
                // Create pseudo-element for grayscale background (no blur or darken)
                eventDiv.style.position = 'relative';
                eventDiv.style.overflow = 'hidden';
                
                // Remove any existing pseudo-element
                const existingPseudo = eventDiv.querySelector('.background-pseudo');
                if (existingPseudo) {
                    existingPseudo.remove();
                }
                
                // Create pseudo-element for grayscale background
                const pseudoElement = document.createElement('div');
                pseudoElement.className = 'background-pseudo';
                
                // Apply styles for grayscale background (no blur or darken)
                pseudoElement.style.position = 'absolute';
                pseudoElement.style.top = '-10px';
                pseudoElement.style.left = '-10px';
                pseudoElement.style.right = '-10px';
                pseudoElement.style.bottom = '-10px';
                pseudoElement.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url('${backgroundUrl}')`;
                pseudoElement.style.backgroundSize = 'cover';
                pseudoElement.style.backgroundPosition = 'center';
                pseudoElement.style.filter = 'grayscale(100%)'; // Only grayscale, no blur or darken
                pseudoElement.style.zIndex = '0';
                pseudoElement.style.pointerEvents = 'none';
                
                eventDiv.insertBefore(pseudoElement, eventDiv.firstChild);
                eventDiv.style.backgroundImage = 'none';
                
                console.log(`⚫ Applied grayscale-only background for historic raid`);
            } else {
                // No effects - apply background normally to the div
                if (data.success && data.backgroundUrl) {
                    const backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url('${backgroundUrl}')`;
                    eventDiv.style.backgroundImage = backgroundImage;
                }
                // If no custom background, keep the default CSS background
            }
        }
    } catch (error) {
        console.warn('Error loading channel background, using fallback:', error);
        // Apply effects to default background if needed
        if (globalBlurValue > 0 || globalDarkenValue < 100 || isGrayscale) {
            applyEffectsToDefaultBackground(eventDiv, isGrayscale);
        }
    }
}

// Function to apply effects (blur/darken/grayscale) to default background (fallback)
function applyEffectsToDefaultBackground(eventDiv, isGrayscale = false) {
    // Always use pseudo-element for historic events (grayscale) or when effects are applied
    if (globalBlurValue > 0 || globalDarkenValue < 100 || isGrayscale) {
        eventDiv.style.position = 'relative';
        eventDiv.style.overflow = 'hidden';
        
        // Remove any existing pseudo-element
        const existingPseudo = eventDiv.querySelector('.background-pseudo');
        if (existingPseudo) {
            existingPseudo.remove();
        }
        
        // Create pseudo-element for filtered default background
        const pseudoElement = document.createElement('div');
        pseudoElement.className = 'background-pseudo';
        
        // Build filter string properly
        let filterString = '';
        if (globalBlurValue > 0) {
            filterString += `blur(${globalBlurValue}px)`;
        }
        if (globalDarkenValue < 100) {
            if (filterString) filterString += ' ';
            filterString += `brightness(${globalDarkenValue}%)`;
        }
        if (isGrayscale) {
            if (filterString) filterString += ' ';
            filterString += 'grayscale(100%)';
        }
        
        pseudoElement.style.cssText = `
            position: absolute;
            top: -10px;
            left: -10px;
            right: -10px;
            bottom: -10px;
            background-image: linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)), url('/images/AQ40-background.png');
            background-size: cover;
            background-position: center;
            filter: ${filterString};
            z-index: 0;
            pointer-events: none;
        `;
        
        eventDiv.insertBefore(pseudoElement, eventDiv.firstChild);
        eventDiv.style.backgroundImage = 'none';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const raidsTbody = document.getElementById('raids-tbody');
    let lastRefreshTime = null;
    let lastHistoricRefreshTime = null;
    
    // Pagination variables for completed raids in unified table
    let allHistoricEvents = [];
    let allUpcomingEvents = [];
    let currentHistoricDisplayLimit = 5;
    const historicEventsPerPage = 5;

    // Load global blur and darken settings
    await loadGlobalBlurSetting();
    await loadGlobalDarkenSetting();

    // The user status and auth UI are now handled by top-bar.js
    // We just need to check if the user is logged in to fetch events.
    async function checkLoginAndFetch() {
        try {
            const response = await fetch('/user');
            const user = await response.json();
            
            if (user.loggedIn) {
                fetchAndRenderRaidsTable();
                fetchAndDisplayMyCharacters();
                fetchAndDisplayItemsHallOfFame();
                
                // Only show refresh sections for users with Management role
                showRefreshButtons(!!user.hasManagementRole);
            } else {
                if (raidsTbody) {
                    raidsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">Please sign in with Discord to view raids.</td></tr>';
                }
                const myCharsContainer = document.getElementById('my-characters-list');
                if (myCharsContainer) {
                    myCharsContainer.innerHTML = '<p>Please sign in to see your characters.</p>';
                }
                
                const hallOfFameContainer = document.getElementById('items-hall-of-fame-list');
                if (hallOfFameContainer) {
                    hallOfFameContainer.innerHTML = '<p>Please sign in to view the hall of fame.</p>';
                }
                
                // Hide refresh buttons for non-logged-in users
                showRefreshButtons(false);
            }
        } catch (error) {
            console.error('Error checking user status:', error);
            showRefreshButtons(false);
        }
    }
    
    // Function to show/hide refresh button (Management-only)
    function showRefreshButtons(show) {
        const refreshBtn = document.getElementById('refresh-raids-btn');
        if (refreshBtn) {
            refreshBtn.style.display = show ? 'inline-flex' : 'none';
        }
    }

    /**
     * Fetch and display event duration in the target element (td cell).
     * For completed raids in the unified table, renders compact duration text.
     */
    async function fetchEventDuration(eventId, delay = 0) {
        const durationElement = document.getElementById(`duration-${eventId}`);
        if (!durationElement) return;

        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`/api/event-duration/${eventId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success && data.duration && typeof data.duration === 'number') {
                const totalMinutes = data.duration;
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const formattedDuration = hours > 0 ? `${hours}h ${minutes}m` : `${totalMinutes}m`;
                durationElement.classList.remove('raid-cell-loading');
                durationElement.textContent = formattedDuration;
            } else {
                durationElement.classList.remove('raid-cell-loading');
                durationElement.textContent = 'N/A';
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.warn(`Error fetching duration for event ${eventId}:`, error.message);
            }
            durationElement.classList.remove('raid-cell-loading');
            durationElement.textContent = 'N/A';
        }
    }

    /**
     * Fetch and display event gold pot in the target element (td cell).
     */
    async function fetchEventGoldPot(eventId, delay = 0) {
        const goldPotElement = document.getElementById(`goldpot-${eventId}`);
        if (!goldPotElement) return;

        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`/api/event-goldpot/${eventId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            goldPotElement.classList.remove('raid-cell-loading');
            const formatGold = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            if (data.success && typeof data.goldPot === 'number') {
                goldPotElement.innerHTML = `<span class="raid-gold">${formatGold(data.goldPot)}g</span>`;
            } else {
                goldPotElement.innerHTML = `<span class="raid-gold">0g</span>`;
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.warn(`Error fetching gold pot for event ${eventId}:`, error.message);
            }
            goldPotElement.classList.remove('raid-cell-loading');
            goldPotElement.innerHTML = `<span class="raid-gold">N/A</span>`;
        }
    }

    /**
     * Fetch and display event biggest item in the target element (td cell).
     */
    async function fetchEventBiggestItem(eventId, delay = 0) {
        const biggestItemElement = document.getElementById(`biggestitem-${eventId}`);
        if (!biggestItemElement) return;

        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`/api/event-biggestitem/${eventId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            biggestItemElement.classList.remove('raid-cell-loading');
            if (data.success && data.itemName) {
                const iconHtml = data.iconLink
                    ? `<img src="${data.iconLink}" alt="${data.itemName}" class="raid-item-icon">`
                    : '';
                biggestItemElement.innerHTML = `${iconHtml}<span class="raid-item-name">${data.itemName}</span>`;
            } else {
                biggestItemElement.textContent = '-';
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.warn(`Error fetching biggest item for event ${eventId}:`, error.message);
            }
            biggestItemElement.classList.remove('raid-cell-loading');
            biggestItemElement.textContent = 'N/A';
        }
    }

    // Check if raidlogs are published for an event (controls Completed Raids link target)
    async function fetchPublishedStatus(eventId, delay = 0) {
        if (!eventId) return false;
        if (publishedStatusCache.has(String(eventId))) {
            return publishedStatusCache.get(String(eventId));
        }

        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(`/api/raidlogs/published/${eventId}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) {
                publishedStatusCache.set(String(eventId), false);
                return false;
            }
            const data = await res.json();
            const isPublished = !!(data && data.success && data.header);
            publishedStatusCache.set(String(eventId), isPublished);
            return isPublished;
        } catch (_) {
            publishedStatusCache.set(String(eventId), false);
            return false;
        }
    }

    // ──────────────────────────────────────────────
    // Shared utility functions
    // ──────────────────────────────────────────────

    /**
     * Clean a Discord channel name: remove emojis/special chars, replace dashes
     * with spaces, and capitalize each word.
     * @param {string} rawName - Raw channel name from the API
     * @param {string} [channelId] - Fallback channel ID if name is unusable
     * @returns {string} Cleaned, human-readable channel name
     */
    function cleanChannelName(rawName, channelId) {
        if (rawName && rawName.trim() && rawName !== channelId && !rawName.match(/^\d+$/)) {
            return rawName
                .replace(/[^\w\s-]/g, '')
                .replace(/-/g, ' ')
                .trim()
                .split(' ')
                .filter(Boolean)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
        }
        return channelId ? `Channel ${channelId.slice(-4)}` : 'Unknown Channel';
    }

    /**
     * Format a Unix epoch timestamp as a day-of-week string (e.g. "Thursday").
     * @param {number} epochSeconds - Unix timestamp in seconds
     * @returns {string} Day of week
     */
    function formatRaidDay(epochSeconds) {
        if (!epochSeconds) return '';
        const now = Date.now();
        const startMs = epochSeconds * 1000;
        const diffMs = startMs - now;
        // Same calendar day in Copenhagen timezone?
        const d = new Date(startMs);
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
        const raidStr = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
        const isToday = raidStr === todayStr;
        // "Now": today AND (already started OR starts within 1 hour)
        if (isToday && diffMs < 60 * 60 * 1000) return 'Now';
        // "Today": same day but more than 1 hour away
        if (isToday) return 'Today';
        return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Copenhagen' });
    }

    /**
     * Format a Unix epoch timestamp as HH:MM in Copenhagen timezone.
     * @param {number} epochSeconds - Unix timestamp in seconds
     * @returns {string} Formatted time string
     */
    function formatRaidTime(epochSeconds) {
        if (!epochSeconds) return '';
        const d = new Date(epochSeconds * 1000);
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Copenhagen' });
    }

    /**
     * Format a Unix epoch timestamp as DD/MM/YYYY in Copenhagen timezone.
     * @param {number} epochSeconds - Unix timestamp in seconds
     * @returns {string} Formatted date string
     */
    function formatRaidDate(epochSeconds) {
        if (!epochSeconds) return '';
        const d = new Date(epochSeconds * 1000);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Copenhagen' });
    }

    /**
     * Check if a Unix epoch timestamp falls on today (Copenhagen timezone).
     * @param {number} epochSeconds - Unix timestamp in seconds
     * @returns {boolean}
     */
    function isToday(epochSeconds) {
        if (!epochSeconds) return false;
        const eventDate = new Date(epochSeconds * 1000);
        const nowStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
        const eventStr = eventDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
        return nowStr === eventStr;
    }

    /**
     * Fetch a channel background thumbnail and apply it to an <img> element.
     * Falls back to the AQ40 default.
     * @param {string} channelId - Discord channel ID
     * @param {HTMLImageElement} imgElement - Target <img> element
     */
    async function fetchChannelThumbnail(channelId, imgElement) {
        if (!channelId || !imgElement) return;
        const fallback = '/images/AQ40-background.png';
        try {
            const response = await fetch(`/api/channel-background/${channelId}`);
            const data = await response.json();
            imgElement.src = (data.success && data.backgroundUrl) ? data.backgroundUrl : fallback;
        } catch {
            imgElement.src = fallback;
        }
    }

    // ──────────────────────────────────────────────
    // Unified Raids Table
    // ──────────────────────────────────────────────

    /**
     * Build a single <tr> element for the raids table.
     * @param {Object} event - Event data from the API
     * @param {boolean} isCompleted - Whether this is a completed raid
     * @returns {HTMLTableRowElement}
     */
    function buildRaidRow(event, isCompleted) {
        const eventId = event.id || event.eventId || 'unknown';
        const tr = document.createElement('tr');

        // Row CSS classes
        const classes = [isCompleted ? 'raid-row--completed' : 'raid-row--upcoming'];
        if (!isCompleted && isToday(event.startTime)) {
            classes.push('raid-row--today');
        }
        tr.className = classes.join(' ');

        // Make the entire row clickable
        const link = isCompleted ? `/event/${eventId}/roster` : `/event/${eventId}/roster`;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
            // Don't navigate if user clicked an actual link inside
            if (e.target.closest('a')) return;
            window.location.href = link;
        });
        tr.setAttribute('data-event-id', eventId);

        // 1. Image thumbnail
        const tdImg = document.createElement('td');
        const img = document.createElement('img');
        img.className = 'raid-thumbnail';
        img.alt = cleanChannelName(event.channelName, event.channelId);
        img.src = '/images/AQ40-background.png'; // placeholder until async load
        tdImg.appendChild(img);
        tr.appendChild(tdImg);

        // Async-load the real thumbnail
        if (event.channelId) {
            fetchChannelThumbnail(event.channelId, img);
        }

        // 2. Name
        const tdName = document.createElement('td');
        const nameLink = document.createElement('a');
        nameLink.className = 'raid-name-link';
        nameLink.href = link;
        if (isCompleted) {
            // Just the raid name — date moves to Day column
            nameLink.textContent = cleanChannelName(event.channelName, event.channelId);
        } else {
            // Strip " | Day | Time" suffix from title (e.g. "Nax Thursday | Thursday | 20:30" → "Nax Thursday")
            const rawTitle = event.title || 'Untitled Event';
            nameLink.textContent = rawTitle.includes(' | ') ? rawTitle.split(' | ')[0].trim() : rawTitle;
        }
        tdName.appendChild(nameLink);
        tr.appendChild(tdName);

        // 3. Day — for completed raids, show the date (dd/mm/yyyy); for upcoming, show day name
        const tdDay = document.createElement('td');
        tdDay.textContent = isCompleted ? formatRaidDate(event.startTime) : formatRaidDay(event.startTime);
        tr.appendChild(tdDay);

        // 4. Time (upcoming: start time; completed: duration loaded async)
        const tdTime = document.createElement('td');
        if (isCompleted) {
            tdTime.id = `duration-${eventId}`;
            tdTime.className = 'raid-cell-loading';
            tdTime.textContent = '...';
        } else {
            tdTime.textContent = formatRaidTime(event.startTime);
        }
        tr.appendChild(tdTime);

        // 5. Signed
        const tdSigned = document.createElement('td');
        tdSigned.textContent = event.signUpCount || '0';
        tr.appendChild(tdSigned);

        // 6. Channel


        // 7. Gold Pot
        const tdGold = document.createElement('td');
        if (isCompleted) {
            tdGold.id = `goldpot-${eventId}`;
            tdGold.className = 'raid-cell-loading';
            tdGold.textContent = '...';
        } else {
            tdGold.innerHTML = '<span class="raid-gold">0g</span>';
        }
        tr.appendChild(tdGold);

        // 8. Top Item
        const tdItem = document.createElement('td');
        if (isCompleted) {
            tdItem.id = `biggestitem-${eventId}`;
            tdItem.className = 'raid-cell-loading';
            tdItem.textContent = '...';
        } else {
            tdItem.textContent = '-';
        }
        tr.appendChild(tdItem);

        // For completed raids, update the link to raidlogs if published
        if (isCompleted && eventId !== 'unknown') {
            fetchPublishedStatus(eventId, 0).then(isPublished => {
                if (isPublished) {
                    const newLink = `/event/${eventId}/raidlogs`;
                    nameLink.href = newLink;
                    // Update the row click handler too
                    tr.onclick = null;
                    tr.addEventListener('click', (e) => {
                        if (e.target.closest('a')) return;
                        window.location.href = newLink;
                    });
                }
            });
        }

        return tr;
    }

    /**
     * Render the unified raids table with upcoming + completed events.
     * Upcoming events are shown first (soonest first), then completed (newest first).
     * Only the first `currentHistoricDisplayLimit` completed events are shown initially.
     * @param {Array} upcomingEvents - Sorted upcoming events (soonest first)
     * @param {Array} completedEvents - Sorted completed events (newest first)
     * @param {boolean} [appendMode=false] - If true, only append new completed rows
     */
    function renderRaidsTable(upcomingEvents, completedEvents, appendMode) {
        if (!raidsTbody) return;

        if (!appendMode) {
            raidsTbody.innerHTML = '';

            // Render all upcoming rows
            upcomingEvents.forEach(event => {
                raidsTbody.appendChild(buildRaidRow(event, false));
            });
        }

        // Determine which completed events to render
        const startIdx = appendMode ? (currentHistoricDisplayLimit - historicEventsPerPage) : 0;
        const endIdx = currentHistoricDisplayLimit;
        const completedSlice = completedEvents.slice(startIdx, endIdx);

        completedSlice.forEach((event, index) => {
            const tr = buildRaidRow(event, true);
            raidsTbody.appendChild(tr);

            // Stagger async fetches for duration, gold pot, and biggest item
            const eventId = event.id || event.eventId || 'unknown';
            const delay = (startIdx + index) * 300;
            fetchEventDuration(eventId, delay);
            fetchEventGoldPot(eventId, delay + 100);
            fetchEventBiggestItem(eventId, delay + 200);
        });

        // Update count display and show-more button
        const totalShown = upcomingEvents.length + Math.min(endIdx, completedEvents.length);
        const totalRaids = upcomingEvents.length + completedEvents.length;
        updateRaidsCount(totalShown, totalRaids);
    }

    /**
     * Update the count display and Show More button visibility.
     */
    function updateRaidsCount(shown, total) {
        const countEl = document.getElementById('raids-count');
        const showMoreBtn = document.getElementById('show-more-raids-btn');

        if (countEl) {
            countEl.textContent = shown < total
                ? `Showing ${shown} of ${total} raids`
                : `Showing all ${total} raids`;
        }

        if (showMoreBtn) {
            showMoreBtn.style.display = shown < total ? 'inline-flex' : 'none';
        }
    }

    /**
     * Fetch both upcoming and completed events, then render the unified table.
     * Also handles the Next Upcoming Raid hero panel.
     */
    async function fetchAndRenderRaidsTable() {
        if (raidsTbody) {
            raidsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#9ca3af;">Loading raids...</td></tr>';
        }

        try {
            const [upcomingRes, historicRes] = await Promise.all([
                fetch('/api/events'),
                fetch('/api/events/historic')
            ]);
            const upcomingData = await upcomingRes.json();
            const historicData = await historicRes.json();

            const upcomingRaw = Array.isArray(upcomingData.scheduledEvents) ? upcomingData.scheduledEvents : [];
            const historicRaw = Array.isArray(historicData.scheduledEvents) ? historicData.scheduledEvents : [];

            // Filter & sort upcoming: future events, soonest first
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const upcoming = upcomingRaw
                .filter(e => typeof e.startTime === 'number' && new Date(e.startTime * 1000) >= today)
                .sort((a, b) => a.startTime - b.startTime);

            // Filter & sort completed: past events within 1 year, newest first
            const now = new Date();
            const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            const completed = historicRaw
                .filter(e => {
                    if (typeof e.startTime !== 'number') return false;
                    const d = new Date(e.startTime * 1000);
                    return d < now && d >= oneYearAgo;
                })
                .sort((a, b) => b.startTime - a.startTime);

            // Store for pagination
            allUpcomingEvents = upcoming;
            allHistoricEvents = completed;
            currentHistoricDisplayLimit = historicEventsPerPage;

            // Render the hero panel for the next upcoming raid
            displayNextRaidHero(upcoming);

            // Render the table (upcoming minus the hero raid are still shown in table)
            renderRaidsTable(upcoming, completed, false);

        } catch (error) {
            console.error('Error fetching raids:', error);
            if (raidsTbody) {
                raidsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#f87171;">Failed to load raids. Please try again.</td></tr>';
            }
        }
    }

    /**
     * Display the first upcoming event in the Next Upcoming Raid hero panel.
     * Reuses the existing createEventCard logic.
     */
    function displayNextRaidHero(upcomingEvents) {
        const nextRaidPanel = document.getElementById('next-raid-panel');
        const nextRaidContainer = document.getElementById('next-raid-container');
        if (!nextRaidPanel || !nextRaidContainer) return;

        if (!upcomingEvents || upcomingEvents.length === 0) {
            nextRaidPanel.style.display = 'none';
            return;
        }

        // Remove any existing card or spark-border wrapper
        const existingSparkBorder = nextRaidContainer.querySelector('.spark-border');
        if (existingSparkBorder) existingSparkBorder.remove();
        const existingCard = nextRaidContainer.querySelector('.event-panel');
        if (existingCard) existingCard.remove();

        const nextEvent = upcomingEvents[0];
        const nextRaidCard = createEventCard(nextEvent, 0);

        // Calculate raid status based on time
        const now = Date.now();
        const raidStartTime = nextEvent.startTime * 1000;
        const oneHourBefore = raidStartTime - (60 * 60 * 1000);
        const fourHoursAfter = raidStartTime + (4 * 60 * 60 * 1000);
        const panelTitle = nextRaidPanel.querySelector('.panel-title');
        let isRaidActive = false;

        if (now >= oneHourBefore && now < raidStartTime) {
            if (panelTitle) panelTitle.textContent = 'Raid Starting Soon';
            isRaidActive = true;
        } else if (now >= raidStartTime && now < fourHoursAfter) {
            if (panelTitle) panelTitle.textContent = 'Raid In Progress';
            isRaidActive = true;
        } else {
            if (panelTitle) panelTitle.textContent = 'Next Upcoming Raid';
        }

        if (isRaidActive) {
            const sparkWrapper = document.createElement('div');
            sparkWrapper.className = 'spark-border';
            sparkWrapper.appendChild(nextRaidCard);
            nextRaidContainer.insertBefore(sparkWrapper, nextRaidContainer.firstChild);
        } else {
            nextRaidContainer.insertBefore(nextRaidCard, nextRaidContainer.firstChild);
        }
        nextRaidPanel.style.display = 'block';

        // Update button links
        const eventId = nextEvent.id || nextEvent.eventId || 'unknown';
        if (eventId !== 'unknown') {
            const btnMap = {
                'next-raid-btn-roster': `/event/${eventId}/roster`,
                'next-raid-btn-assignments': `/event/${eventId}/assignments`,
                'next-raid-btn-my-assignments': `/event/${eventId}/assignments/myassignments`,
                'next-raid-btn-raidlogs': `/event/${eventId}/raidlogs`,
                'next-raid-btn-goldpot': `/event/${eventId}/gold`,
                'next-raid-btn-loot': `/event/${eventId}/loot`
            };
            for (const [id, href] of Object.entries(btnMap)) {
                const btn = document.getElementById(id);
                if (btn) btn.href = href;
            }

            const signupBtn = document.getElementById('next-raid-btn-signup');
            if (signupBtn && nextEvent.channelId) {
                signupBtn.href = `https://discord.com/channels/777268886939893821/${nextEvent.channelId}`;
            }
        }
    }

    async function fetchAndDisplayMyCharacters() {
        const myCharsContainer = document.getElementById('my-characters-list');
        if (!myCharsContainer) return; // Don't run if the container doesn't exist

        myCharsContainer.innerHTML = '<p>Loading my characters...</p>';

        try {
            const response = await fetch('/api/my-characters');
            if (!response.ok) {
                myCharsContainer.innerHTML = '<p>Could not load characters. Are you signed in?</p>';
                return;
            }

            const characters = await response.json();

            // Sort by class order and then by character name
            const CLASS_ORDER = ['Warrior','Rogue','Hunter','Mage','Warlock','Shaman','Priest','Druid'];
            const classRank = (cls) => {
                const normalized = String(cls || '').trim();
                const idx = CLASS_ORDER.indexOf(normalized);
                return idx === -1 ? 999 : idx;
            };
            characters.sort((a, b) => {
                const ra = classRank(a.class);
                const rb = classRank(b.class);
                if (ra !== rb) return ra - rb;
                const na = String(a.character_name || '').toLowerCase();
                const nb = String(b.character_name || '').toLowerCase();
                return na.localeCompare(nb);
            });

            if (characters && characters.length > 0) {
                myCharsContainer.innerHTML = ''; // Clear loading message
                const list = document.createElement('ul');
                list.classList.add('character-list');
                characters.forEach(char => {
                    const characterClass = (char.class || 'Unknown').toLowerCase().replace(/\s+/g, '-');
                    const classIconUrl = getClassIconUrl(char.class);

                    const wrapper = document.createElement('li');
                    wrapper.classList.add('character-card');

                    const top = document.createElement('div');
                    top.classList.add('character-item', `class-${characterClass}`);
                    top.innerHTML = `
                        ${classIconUrl ? `<img class="class-icon" src="${classIconUrl}" alt="${char.class}">` : ''}
                        <div class="char-text">
                            <span class="char-name">${char.character_name}</span>
                            <span class="char-details">${char.class || ''}</span>
                        </div>
                    `;

                    const bottom = document.createElement('div');
                    bottom.classList.add('character-item-sub', `class-${characterClass}`);
                    bottom.innerHTML = `
                        <div class="char-extra" data-char="${char.character_name}">
                            <div><span class="label">1P member:</span> <span class="extra-guild value">…</span></div>
                            <div><span class="label">Last raid:</span> <span class="extra-last-raid value">…</span></div>
                            <div><span class="label">Last item won:</span> <span class="extra-last-item value">…</span></div>
                        </div>
                    `;

                    wrapper.appendChild(top);
                    wrapper.appendChild(bottom);
                    list.appendChild(wrapper);

                    // Load and fill in extra details asynchronously
                    loadCharacterExtras(char, bottom.querySelector('.char-extra')).catch(() => {
                        // Leave placeholders on error
                    });
                });
                myCharsContainer.appendChild(list);
            } else {
                myCharsContainer.innerHTML = '<p>No characters found for your Discord account.</p>';
            }

        } catch (error) {
            console.error('Error fetching user characters:', error);
            myCharsContainer.innerHTML = '<p>An error occurred while fetching your characters.</p>';
        }
    }

    // Map class to icon using the same assets as raidlogs class icon display
    function getClassIconUrl(cls) {
        const map = {
            'Warrior': 'https://cdn.discordapp.com/emojis/579532030153588739.png',
            'Rogue': 'https://cdn.discordapp.com/emojis/579532030086217748.png',
            'Hunter': 'https://cdn.discordapp.com/emojis/579532029880827924.png',
            'Mage': 'https://cdn.discordapp.com/emojis/579532030161977355.png',
            'Warlock': 'https://cdn.discordapp.com/emojis/579532029851336716.png',
            'Shaman': 'https://cdn.discordapp.com/emojis/579532030056857600.png',
            'Paladin': 'https://cdn.discordapp.com/emojis/579532029906124840.png',
            'Priest': 'https://cdn.discordapp.com/emojis/579532029901799437.png',
            'Druid': 'https://cdn.discordapp.com/emojis/579532029675438081.png'
        };
        return map[cls] || '';
    }

    // Caches for API data
    let cachedUser = null;
    let cachedGuildMembers = null;
    let cachedAttendance = null;
    let cachedUpcoming = null;
    let cachedHistoric = null;
    const publishedStatusCache = new Map();

    async function getCurrentUser() {
        if (cachedUser) return cachedUser;
        try {
            const res = await fetch('/user');
            cachedUser = await res.json();
        } catch (e) {
            cachedUser = { loggedIn: false };
        }
        return cachedUser;
    }

    async function getGuildMembers() {
        if (cachedGuildMembers) return cachedGuildMembers;
        try {
            const res = await fetch('/api/guild-members');
            const data = await res.json();
            cachedGuildMembers = data.success ? data.members : [];
        } catch (e) {
            cachedGuildMembers = [];
        }
        return cachedGuildMembers;
    }

    async function getAttendance() {
        if (cachedAttendance) return cachedAttendance;
        try {
            const res = await fetch('/api/attendance');
            const data = await res.json();
            cachedAttendance = data.success ? data.data : null;
        } catch (e) {
            cachedAttendance = null;
        }
        return cachedAttendance;
    }

    async function getUpcomingEvents() {
        if (cachedUpcoming) return cachedUpcoming;
        try {
            const res = await fetch('/api/events');
            const data = await res.json();
            cachedUpcoming = Array.isArray(data.scheduledEvents) ? data.scheduledEvents : [];
        } catch (e) {
            cachedUpcoming = [];
        }
        return cachedUpcoming;
    }

    async function getHistoricEvents() {
        if (cachedHistoric) return cachedHistoric;
        try {
            const res = await fetch('/api/events/historic');
            const data = await res.json();
            cachedHistoric = Array.isArray(data.scheduledEvents) ? data.scheduledEvents : [];
        } catch (e) {
            cachedHistoric = [];
        }
        return cachedHistoric;
    }

    function getEventId(obj) {
        return obj?.eventId || obj?.eventID || obj?.id || obj?.event_id || null;
    }

    function findEventById(events, id) {
        if (!id) return null;
        return events.find(ev => String(getEventId(ev)) === String(id)) || null;
    }

    function formatDateDDMMYYYYFromEpochSeconds(sec) {
        if (!sec) return '';
        const d = new Date(sec * 1000);
        const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
        return d.toLocaleDateString('en-GB', options); // dd/mm/yyyy
    }

    function formatEventDisplay(name, startTime) {
        const dateStr = formatDateDDMMYYYYFromEpochSeconds(startTime);
        return dateStr ? `${name} - ${dateStr}` : name;
    }

    const rosterCache = new Map(); // eventId -> Promise(roster)
    async function fetchRoster(eventId) {
        if (!eventId) return null;
        if (rosterCache.has(eventId)) return rosterCache.get(eventId);
        const p = (async () => {
            try {
                const res = await fetch(`/api/roster/${eventId}`);
                if (!res.ok) return null;
                return await res.json();
            } catch (e) {
                return null;
            }
        })();
        rosterCache.set(eventId, p);
        return p;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function fetchLoot(eventId) {
        try {
            const res = await fetch(`/api/loot/${eventId}`);
            if (!res.ok) return { success: true, data: [] };
            const data = await res.json();
            return data;
        } catch (e) {
            return { success: true, data: [] };
        }
    }

    async function loadCharacterExtras(char, container) {
        const [user, guildMembers, attendance, upcoming, historic] = await Promise.all([
            getCurrentUser(),
            getGuildMembers(),
            getAttendance(),
            getUpcomingEvents(),
            getHistoricEvents()
        ]);

        // 1P member
        const inGuild = !!(guildMembers || []).find(m => (m.character_name || '').toLowerCase() === (char.character_name || '').toLowerCase());
        container.querySelector('.extra-guild').textContent = inGuild ? 'Yes' : 'No';

        // Removed: Current Naxx streak

        // Last raid (direct from backend using log_data with characterName + characterClass + discordId)
        let lastRaid = '—';
        try {
            const user = await getCurrentUser();
            if (user && user.id) {
                const params = new URLSearchParams({
                    discordId: user.id,
                    characterName: char.character_name,
                    characterClass: char.class
                });
                const res = await fetch(`/api/character/last-raid?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.found) {
                        lastRaid = formatEventDisplay(data.channelName || 'Raid', data.startTime);
                    }
                }
            }
        } catch {}
        container.querySelector('.extra-last-raid').textContent = lastRaid;

        // Removed: Next raid

        // Last item won (scan recent historic events for loot by this character)
        let lastItem = '—';
        try {
            if (Array.isArray(historic)) {
                const histSorted = historic.slice().sort((a,b) => (b.startTime || 0) - (a.startTime || 0));
                const recent = histSorted.slice(0, 20);
                for (const ev of recent) {
                    const loot = await fetchLoot(ev.eventId || ev.eventID || ev.id || ev.event_id);
                    if (loot && loot.success && Array.isArray(loot.items)) {
                        const found = loot.items.find(it => (it.player_name || '').toLowerCase() === (char.character_name || '').toLowerCase());
                        if (found) {
                            const icon = found.icon_link ? `<img src="${found.icon_link}" alt=""/>` : '';
                            lastItem = `<span class="last-item">${icon}<span>${found.item_name}</span></span>`;
                            break;
                        }
                    }
                }
            }
        } catch {}
        const lastItemEl = container.querySelector('.extra-last-item');
        if (lastItem.startsWith('<span')) lastItemEl.innerHTML = lastItem; else lastItemEl.textContent = lastItem;
    }

    function isSameCharacter(playerObj, char) {
        const charName = (char.character_name || '').toLowerCase();
        const charClass = (char.class || '').toLowerCase();
        const names = [
            playerObj?.assigned_char_name,
            playerObj?.original_signup_name,
            playerObj?.player_name,
            playerObj?.name,
            playerObj?.character_name
        ].filter(Boolean).map(n => String(n).toLowerCase());
        const classes = [
            playerObj?.assigned_char_class,
            playerObj?.character_class,
            playerObj?.class
        ].filter(Boolean).map(c => String(c).toLowerCase());
        const nameMatches = names.includes(charName);
        const classMatches = classes.length === 0 ? true : classes.includes(charClass);
        return nameMatches && classMatches;
    }

    // Function to fetch and display Items Hall of Fame
    async function fetchAndDisplayItemsHallOfFame() {
        const hallOfFameContainer = document.getElementById('items-hall-of-fame-list');
        if (!hallOfFameContainer) return; // Don't run if the container doesn't exist

        hallOfFameContainer.innerHTML = '<p>Loading hall of fame...</p>';

        try {
            const response = await fetch('/api/items-hall-of-fame');
            if (!response.ok) {
                hallOfFameContainer.innerHTML = '<p>Could not load items. Are you signed in?</p>';
                return;
            }

            const data = await response.json();

            if (data.success && data.items && data.items.length > 0) {
                hallOfFameContainer.innerHTML = ''; // Clear loading message
                const list = document.createElement('div');
                list.classList.add('hall-of-fame-list');
                
                data.items.forEach((item, index) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.classList.add('hall-of-fame-item');
                    
                    // Format the raid name like completed raids
                    let raidName = 'Unknown Raid';
                    if (item.channelName && item.channelName.trim() && !item.channelName.match(/^\d+$/)) {
                        raidName = item.channelName
                            .replace(/[^\w\s-]/g, '') // Remove emojis and special chars
                            .replace(/-/g, ' ') // Replace dashes with spaces
                            .trim()
                            .split(' ')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ');
                    }
                    
                    // Format date if available
                    let dateStr = '';
                    if (item.startTime) {
                        const eventDate = new Date(item.startTime * 1000);
                        const options = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Copenhagen' };
                        dateStr = ` - ${eventDate.toLocaleDateString('en-GB', options)}`;
                    }
                    
                    const raidDisplay = `${raidName}${dateStr}`;
                    
                    const iconHtml = item.iconLink ? 
                        `<img src="${item.iconLink}" alt="${item.itemName}" class="item-icon-large" style="width: 50px; height: 50px; border-radius: 8px; margin-right: 12px; vertical-align: top; position: relative; left: 3px; top: 3px;">` : 
                        `<div style="width: 50px; height: 50px; background: #666; border-radius: 8px; margin-right: 12px; display: inline-block; vertical-align: top; position: relative; left: 5px; top: 5px;"></div>`;
                    
                    itemDiv.innerHTML = `
                        <div class="hall-of-fame-content">
                            ${iconHtml}
                            <div class="hall-of-fame-details">
                                <div class="hall-of-fame-item-name" style="color: #a335ee; font-weight: bold; font-size: 14px;">${item.itemName}</div>
                                <div class="hall-of-fame-price" style="color: #FFD700; font-weight: bold; margin: 2px 0;">${item.goldAmount}g</div>
                                <div class="hall-of-fame-info" style="font-size: 12px; margin-top: 2px;">${item.playerName}, ${raidDisplay}</div>
                            </div>
                        </div>
                    `;
                    list.appendChild(itemDiv);
                });
                hallOfFameContainer.appendChild(list);
            } else {
                hallOfFameContainer.innerHTML = '<p>No items found in the hall of fame yet.</p>';
            }

        } catch (error) {
            console.error('Error fetching items hall of fame:', error);
            hallOfFameContainer.innerHTML = '<p>An error occurred while fetching the hall of fame.</p>';
        }
    }

    // 🎯 Discord API functions removed - we now get channel names directly from Raid-Helper API!

    /**
     * Set loading state on the unified refresh button.
     */
    function setRaidsLoadingState(isLoading) {
        const refreshBtn = document.getElementById('refresh-raids-btn');
        if (refreshBtn) {
            refreshBtn.disabled = isLoading;
            if (isLoading) {
                refreshBtn.classList.add('loading');
            } else {
                refreshBtn.classList.remove('loading');
            }
        }
    }

    /**
     * Refresh both upcoming and completed raid data, then re-render the table.
     */
    async function refreshRaids() {
        const refreshStatus = document.getElementById('refresh-raids-status');

        try {
            setRaidsLoadingState(true);
            if (refreshStatus) {
                refreshStatus.textContent = 'Refreshing events...';
                refreshStatus.className = 'refresh-status';
            }

            // Refresh both caches in parallel
            const [upRes, histRes] = await Promise.all([
                fetch('/api/events/refresh', { method: 'POST' }),
                fetch('/api/events/historic/refresh', { method: 'POST' })
            ]);

            if (upRes.status === 401 || histRes.status === 401) {
                throw new Error('Please sign in with Discord to refresh events');
            }
            if (!upRes.ok || !histRes.ok) {
                throw new Error('One or more refresh requests failed');
            }

            if (refreshStatus) {
                refreshStatus.textContent = 'Events refreshed successfully!';
                refreshStatus.className = 'refresh-status success';
            }

            // Clear caches so fetchAndRenderRaidsTable fetches fresh
            cachedUpcoming = null;
            cachedHistoric = null;

            // Re-render the entire table
            await fetchAndRenderRaidsTable();

            setTimeout(() => {
                if (refreshStatus) {
                    refreshStatus.textContent = '';
                    refreshStatus.className = 'refresh-status';
                }
            }, 3000);
        } catch (error) {
            console.error('Error refreshing raids:', error);
            if (refreshStatus) {
                refreshStatus.textContent = error.message || 'Failed to refresh. Please try again.';
                refreshStatus.className = 'refresh-status error';
            }
            setTimeout(() => {
                if (refreshStatus) {
                    refreshStatus.textContent = '';
                    refreshStatus.className = 'refresh-status';
                }
            }, 5000);
        } finally {
            setRaidsLoadingState(false);
        }
    }

    /**
     * Show more completed raids by appending additional rows.
     */
    function showMoreRaids() {
        currentHistoricDisplayLimit += historicEventsPerPage;
        renderRaidsTable(allUpcomingEvents, allHistoricEvents, true);
    }
    
    // Helper function to create an event card element
    function createEventCard(event, index) {
        const eventDiv = document.createElement('a');
        eventDiv.classList.add('event-panel');
        eventDiv.setAttribute('data-event-index', index);
        
        const eventId = event.id || 'unknown';
        const eventTitle = event.title || 'Untitled Event';
        
        // Apply channel-specific background if available
        if (event.channelId) {
            applyChannelBackground(eventDiv, event.channelId, false); // false = color (upcoming)
        }

        if (eventId !== 'unknown') {
            eventDiv.href = `/event/${eventId}/roster`;
        }

        const eventStartDate = new Date(event.startTime * 1000);
        const cetTimeZone = 'Europe/Copenhagen';
        const nowInCET = new Date();
        const todayAtMidnightCET = new Date(nowInCET.toLocaleDateString('en-CA', { timeZone: cetTimeZone }));
        const eventDateOnly = new Date(eventStartDate.toLocaleDateString('en-CA', { timeZone: cetTimeZone }));

        let dateDisplayHTML;
        if (eventDateOnly.getTime() === todayAtMidnightCET.getTime()) {
            dateDisplayHTML = `<span class="event-today-text">Today</span>`;
            eventDiv.classList.add('event-panel-today');
        } else {
            const optionsDay = { weekday: 'long', timeZone: cetTimeZone };
            const optionsDate = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: cetTimeZone };
            const formattedDayName = eventStartDate.toLocaleDateString('en-US', optionsDay);
            const formattedDate = eventStartDate.toLocaleDateString('en-GB', optionsDate);
            dateDisplayHTML = `${formattedDayName} (${formattedDate})`;
        }
        
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: cetTimeZone };
        const formattedStartTime = eventStartDate.toLocaleTimeString('en-GB', optionsTime);
        const signUpCount = event.signUpCount || '0';
        
        let channelDisplayName = '#unknown-channel';
        if (event.channelName && 
            event.channelName.trim() && 
            event.channelName !== event.channelId &&
            !event.channelName.match(/^\d+$/)) {
            channelDisplayName = `#${event.channelName}`;
        } else if (event.channelId) {
            channelDisplayName = `#channel-${event.channelId.slice(-4)}`;
        }

        eventDiv.innerHTML = `
            <h3>${eventTitle}</h3>
            <div class="event-time-info">
                <p><i class="far fa-calendar-alt event-icon"></i> ${dateDisplayHTML}</p>
                <p><i class="far fa-clock event-icon"></i> ${formattedStartTime}</p>
                <p><i class="fas fa-user event-icon"></i> ${signUpCount} Signed</p>
                <p class="channel-info"><i class="fas fa-hashtag event-icon"></i> ${channelDisplayName}</p>
            </div>
        `;
        
        return eventDiv;
    }

    // Add event listener for Show More button
    const showMoreRaidsBtn = document.getElementById('show-more-raids-btn');
    if (showMoreRaidsBtn) {
        showMoreRaidsBtn.addEventListener('click', showMoreRaids);
    }

    // Add event listener for Refresh Events button
    const refreshRaidsBtn = document.getElementById('refresh-raids-btn');
    if (refreshRaidsBtn) {
        refreshRaidsBtn.addEventListener('click', refreshRaids);
    }

    // Function to apply effects to all existing event panels on page load
    function applyEffectsToAllPanels() {
        const eventPanels = document.querySelectorAll('.event-panel');
        eventPanels.forEach(panel => {
            // Only apply if it doesn't already have a pseudo-element
            if (!panel.querySelector('.background-pseudo')) {
                const isHistoric = panel.classList.contains('historic');
                // Apply pseudo-element if effects are enabled OR if it's a historic panel (needs grayscale)
                if (globalBlurValue > 0 || globalDarkenValue < 100 || isHistoric) {
                    applyEffectsToDefaultBackground(panel, isHistoric);
                }
            }
        });
    }

    // Apply effects to any existing panels after loading the setting
    setTimeout(applyEffectsToAllPanels, 500);

    // Add a simple test to verify blur is working for both types
    setTimeout(() => {
        const upcomingPanels = document.querySelectorAll('.event-panel:not(.historic)');
        const historicPanels = document.querySelectorAll('.event-panel.historic');
        console.log(`🔍 Panel verification - Upcoming: ${upcomingPanels.length}, Historic: ${historicPanels.length}, Blur setting: ${globalBlurValue}px`);
        
        if (globalBlurValue > 0) {
            upcomingPanels.forEach((panel, index) => {
                const pseudo = panel.querySelector('.background-pseudo');
                console.log(`📅 Upcoming panel ${index + 1}: ${pseudo ? '✅ Has blur pseudo-element' : '❌ Missing blur pseudo-element'}`);
                
                if (pseudo) {
                    const computedStyle = window.getComputedStyle(pseudo);
                    console.log(`🔍 Upcoming panel ${index + 1} pseudo styles:`, {
                        backgroundImage: computedStyle.backgroundImage,
                        filter: computedStyle.filter,
                        zIndex: computedStyle.zIndex,
                        position: computedStyle.position,
                        display: computedStyle.display,
                        opacity: computedStyle.opacity,
                        visibility: computedStyle.visibility
                    });
                }
            });
            
            historicPanels.forEach((panel, index) => {
                const pseudo = panel.querySelector('.background-pseudo');
                console.log(`📚 Historic panel ${index + 1}: ${pseudo ? '✅ Has blur pseudo-element' : '❌ Missing blur pseudo-element'}`);
                
                if (pseudo && index === 0) { // Just check the first one for comparison
                    const computedStyle = window.getComputedStyle(pseudo);
                    console.log(`🔍 Historic panel ${index + 1} pseudo styles:`, {
                        backgroundImage: computedStyle.backgroundImage,
                        filter: computedStyle.filter,
                        zIndex: computedStyle.zIndex,
                        position: computedStyle.position,
                        display: computedStyle.display,
                        opacity: computedStyle.opacity,
                        visibility: computedStyle.visibility
                    });
                }
            });
        }
    }, 2000);

    // Initial check on page load
    checkLoginAndFetch();

    // Masonry: auto-calc row spans for .main-content-grid direct children
    try {
        const grid = document.querySelector('.main-content-grid');
        if (grid) {
            const rowHeightUnit = parseInt(getComputedStyle(grid).getPropertyValue('grid-auto-rows')) || 1;
            const rowGap = parseInt(getComputedStyle(grid).getPropertyValue('gap')) || 0;
            const items = Array.from(grid.children);

            const resizeObserver = new ResizeObserver(() => {
                items.forEach(item => {
                    if (!(item instanceof HTMLElement)) return;
                    const contentHeight = item.getBoundingClientRect().height;
                    const span = Math.ceil((contentHeight + rowGap) / (rowHeightUnit + rowGap));
                    item.style.gridRowEnd = `span ${span}`;
                });
            });

            items.forEach(el => resizeObserver.observe(el));
        }
    } catch (e) {
        console.warn('Masonry init failed:', e);
    }
});