// public/top-bar.js

// Google Analytics (gtag) universal injection
(function initGoogleAnalytics() {
	try {
		const host = window.location && window.location.hostname || '';
		const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
		if (isLocal) return; // Skip GA on localhost
		if (window.gtag) return; // Avoid duplicate init
		window.dataLayer = window.dataLayer || [];
		function gtag(){ dataLayer.push(arguments); }
		window.gtag = gtag;
		const gaScript = document.createElement('script');
		gaScript.async = true;
		gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-JJJVQ34B6R';
		(document.head || document.documentElement).appendChild(gaScript);
		gtag('js', new Date());
		gtag('config', 'G-JJJVQ34B6R');
	} catch (_) {
		// no-op
	}
})();

// Helper: get event ID from URL (/event/:id/*)
function getEventIdFromUrl() {
    try {
        const parts = window.location.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('event');
        if (idx >= 0 && parts[idx + 1]) {
            return parts[idx + 1];
        }
        return null;
    } catch (_) {
        return null;
    }
}

// This function fetches the user's login status from the server.
async function getUserStatus() {
    try {
        const response = await fetch('/user');
        if (!response.ok) return { loggedIn: false };
        return await response.json();
    } catch (error) {
        console.error('Error fetching user status:', error);
        return { loggedIn: false };
    }
}

// This function updates the top bar UI based on the user's login status.
async function updateAuthUI() {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;

    const user = await getUserStatus();

    if (user.loggedIn && user.username) {
        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator) % 5}.png`;

        // Build dropdown menu items based on user permissions
        let dropdownItems = `<a href="/user-settings" class="dropdown-item">User settings</a>`;
        
        // Add management-only options for users with Management role
        if (user.hasManagementRole) {
            // Prefer event-scoped Logs link when an active event is known
            let logsHref = '/logs';
            try {
                const urlEventId = getEventIdFromUrl();
                const lsEventId = localStorage.getItem('activeEventSession');
                const eventId = urlEventId || lsEventId;
                if (eventId) logsHref = `/event/${eventId}/logs`;
            } catch (_) {}
            dropdownItems += `<a href="${logsHref}" class="dropdown-item">Logs</a>`;
            dropdownItems += `<a href="/admin" class="dropdown-item">Admin settings</a>`;
        }
        
        dropdownItems += `<a href="/auth/logout" class="dropdown-item">Logout</a>`;

        authContainer.innerHTML = `
            <div class="user-info">
                <span class="user-name">${user.username}</span>
                <img src="${avatarUrl}" alt="${user.username}'s avatar" class="user-avatar-small" id="user-avatar-toggle">
                <div class="user-dropdown" id="user-dropdown-menu">
                    ${dropdownItems}
                </div>
            </div>
        `;

        // Add event listener for the new dropdown
        const avatarToggle = document.getElementById('user-avatar-toggle');
        const dropdownMenu = document.getElementById('user-dropdown-menu');
        
        avatarToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevents the window click listener from firing immediately
            dropdownMenu.classList.toggle('show');
        });

    } else {
        const currentPath = window.location.pathname + window.location.search + window.location.hash;
        const encodedReturnTo = encodeURIComponent(currentPath);
        authContainer.innerHTML = `
            <button class="discord-button" onclick="window.location.href='/auth/discord?returnTo=${encodedReturnTo}'">
                <i class="fab fa-discord discord-icon"></i>
                Sign in with Discord
            </button>
        `;
    }
}

// This function highlights the active navigation link based on the current page.
function highlightActiveNav() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.top-nav-link');
    const isLivePage = currentPath === '/live' || currentPath === '/livehost';
    
    navLinks.forEach(link => {
        const linkHref = link.getAttribute('href');
        // Special handling for Live link (matches both /live and /livehost)
        if (isLivePage && linkHref === '/live') {
            link.classList.add('active');
        } else if (linkHref === currentPath) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
    
    // Also highlight raid navigation links
    highlightActiveRaidNav();
}

// This function highlights the active raid navigation link based on the current page.
function highlightActiveRaidNav() {
    const currentPath = window.location.pathname;
    const raidNavLinks = document.querySelectorAll('.raid-nav-link');
    
    raidNavLinks.forEach(link => {
        const linkHref = link.getAttribute('href') || '';
        const isRoster = currentPath.includes('/event/') && currentPath.includes('/roster');
        const isAssignments = currentPath.includes('/event/') && currentPath.includes('/assignments');
        const isGold = currentPath.includes('/event/') && currentPath.includes('/gold');
        const isLoot = currentPath.includes('/event/') && currentPath.includes('/loot');
        const isRaidlogs = currentPath.includes('/event/') && currentPath.includes('/raidlogs');

        if (isRoster && link.id === 'raid-roster-link') {
            link.classList.add('active');
        } else if (isAssignments && link.id === 'raid-assignments-link') {
            link.classList.add('active');
        } else if ((isGold || currentPath === '/gold') && link.id === 'raid-goldpot-link') {
            link.classList.add('active');
        } else if ((isLoot || currentPath === '/loot') && link.id === 'raid-loot-link') {
            link.classList.add('active');
        } else if ((isRaidlogs || currentPath === '/raidlogs') && link.id === 'raid-logs-link') {
            link.classList.add('active');
        } else if (linkHref && linkHref === currentPath) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// Check live session status and update the indicator in top-bar
async function updateLiveStatusIndicator() {
    const statusDot = document.getElementById('live-status-dot');
    const liveLink = document.getElementById('top-nav-live-link');
    
    if (!statusDot) return;
    
    try {
        const response = await fetch('/api/live/status');
        if (response.ok) {
            const data = await response.json();
            if (data.active) {
                statusDot.classList.add('active');
                if (liveLink) liveLink.classList.add('live-active');
            } else {
                statusDot.classList.remove('active');
                if (liveLink) liveLink.classList.remove('live-active');
            }
        }
    } catch (err) {
        // Silent fail - keep default state
        if (statusDot) statusDot.classList.remove('active');
        if (liveLink) liveLink.classList.remove('live-active');
    }
}

// Track polling interval to prevent duplicates
let liveStatusPollingInterval = null;

// Start periodic live status checks
function startLiveStatusPolling() {
    // Clear any existing interval to prevent duplicates (memory leak fix)
    if (liveStatusPollingInterval) {
        clearInterval(liveStatusPollingInterval);
        liveStatusPollingInterval = null;
    }
    
    // Initial check after a short delay to allow DOM to be ready
    setTimeout(updateLiveStatusIndicator, 100);
    
    // Poll every 10 seconds
    liveStatusPollingInterval = setInterval(updateLiveStatusIndicator, 10000);
}

// Inject a "Rules" link into the top navigation if not present
function injectRulesNavLink() {
    const navs = document.querySelectorAll('.top-nav');
    navs.forEach(nav => {
        // Avoid duplicates
        const existingRules = nav.querySelector('a.top-nav-link[href="/rules"]');
        const existingStats = nav.querySelector('a.top-nav-link[href="/stats"]');
        const existingFaq = nav.querySelector('a.top-nav-link[href="/faq"]');
        const existingLive = nav.querySelector('a.top-nav-link[href="/live"]');

        // Insert Stats link to the left of Rules
        if (!existingStats) {
            const statsLink = document.createElement('a');
            statsLink.href = '/stats';
            statsLink.className = 'top-nav-link';
            statsLink.textContent = 'Stats';
            if (existingRules && existingRules.parentNode === nav) {
                nav.insertBefore(statsLink, existingRules);
            } else {
                nav.appendChild(statsLink);
            }
        }

        if (!existingRules) {
            const rulesLink = document.createElement('a');
            rulesLink.href = '/rules';
            rulesLink.className = 'top-nav-link';
            rulesLink.textContent = 'Rules';
            nav.appendChild(rulesLink);
        }

        if (!existingFaq) {
            const faqLink = document.createElement('a');
            faqLink.href = '/faq';
            faqLink.className = 'top-nav-link';
            faqLink.textContent = 'FAQ';
            nav.appendChild(faqLink);
        }

        // Add Live link with status indicator
        if (!existingLive) {
            const liveLink = document.createElement('a');
            liveLink.href = '/live';
            liveLink.className = 'top-nav-link live-nav-link';
            liveLink.id = 'top-nav-live-link';
            liveLink.innerHTML = '<span class="live-status-dot" id="live-status-dot"></span><span class="nav-text">Live</span>';
            nav.appendChild(liveLink);
        }

    });
}

/**
 * Replaces the logo image with bold orange "SANDBOX" text on staging deployments.
 * Detection is hostname-based: only activates when the hostname contains "staging".
 * Must be called AFTER normalizeTopBar() so the logo-link anchor is already in place.
 *
 * @see public/style.css .sandbox-logo for styling
 */
function injectSandboxBanner() {
    try {
        const hostname = window.location.hostname || '';
        if (!hostname.includes('staging')) return;

        const logoImg = document.querySelector('.top-bar .app-logo');
        if (!logoImg) return;

        const sandboxLabel = document.createElement('span');
        sandboxLabel.textContent = 'SANDBOX';
        sandboxLabel.className = 'sandbox-logo';

        logoImg.parentNode.replaceChild(sandboxLabel, logoImg);
    } catch (_) {
        // Fail silently — production and localhost are unaffected
    }
}

// Normalize top bar: link logo to home and remove explicit Home link
function normalizeTopBar() {
    try {
        // Wrap the logo image with a link to '/'
        const logoImg = document.querySelector('.top-bar .app-logo');
        if (logoImg) {
            const parent = logoImg.parentElement;
            const isAlreadyLink = parent && parent.tagName && parent.tagName.toLowerCase() === 'a';
            if (!isAlreadyLink) {
                const logoLink = document.createElement('a');
                logoLink.href = '/';
                logoLink.className = 'logo-link';
                // Replace img with anchor, then append img inside
                parent && parent.replaceChild(logoLink, logoImg);
                logoLink.appendChild(logoImg);
            } else {
                // Ensure href and class on existing link
                if (!parent.getAttribute('href')) parent.setAttribute('href', '/');
                parent.setAttribute('href', '/');
                parent.classList.add('logo-link');
            }
        }

        // Remove any explicit Home link from top navs
        document.querySelectorAll('.top-nav').forEach(nav => {
            nav.querySelectorAll('a.top-nav-link[href="/"]').forEach(el => {
                el.remove();
            });
        });
    } catch (_) {
        // no-op
    }
}

// Add icons to nav links and ensure consistent button styling
function enhanceTopNavIcons() {
	try {
		const iconForHref = (href) => {
			if (!href) return 'fa-link';
			try {
				const u = new URL(href, window.location.origin);
				switch (u.pathname) {
					case '/guild-members': return 'fa-users';
					case '/attendance': return 'fa-user-check';
					case '/rules': return 'fa-scroll';
					case '/stats': return 'fa-chart-line';
					case '/faq': return 'fa-question-circle';
					case '/itemlog': return 'fa-shield-alt';
					case '/gold': return 'fa-coins';
					case '/loot': return 'fa-box-open';
					default: return 'fa-link';
				}
			} catch (_) { return 'fa-link'; }
		};

		// Links
		document.querySelectorAll('.top-nav a.top-nav-link').forEach(link => {
			// Skip if already enhanced or if it's the live link (has custom structure with status dot)
			if (link.querySelector('i.nav-icon')) return;
			if (link.classList.contains('live-nav-link')) return;
			const href = link.getAttribute('href') || '';
			const icon = iconForHref(href);
			const text = link.textContent.trim();
			link.innerHTML = `<i class="fas ${icon} nav-icon" aria-hidden="true"></i><span class="nav-text">${text}</span>`;
		});

		// Dropdown toggle (Raids)
		document.querySelectorAll('.top-nav .dropdown-toggle').forEach(btn => {
			if (!btn.classList.contains('top-nav-link')) {
				btn.classList.add('top-nav-link');
			}
			const hasIcon = btn.querySelector('i.nav-icon');
			if (!hasIcon) {
				// Preserve existing chevron, prepend calendar icon
				const chevron = btn.querySelector('.fa-chevron-down');
				const label = btn.childNodes[0] && btn.childNodes[0].nodeType === Node.TEXT_NODE
					? btn.childNodes[0].textContent.trim()
					: (btn.textContent.replace(/\s*\u25BC|\s*▼/g, '').trim() || 'Raids');
				btn.innerHTML = `<i class="fas fa-calendar-alt nav-icon" aria-hidden="true"></i><span class="nav-text">${label}</span>` + (chevron ? ` <i class="fas fa-chevron-down"></i>` : ' <i class="fas fa-chevron-down"></i>');
			}
		});
	} catch (_) {
		// no-op
	}
}

// Scroll behavior for sticky header
let lastScrollTop = 0;
let scrollTimeout = null;

function handleScroll() {
    const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const topBar = document.querySelector('.top-bar');
    const raidBar = document.querySelector('.raid-bar');
    
    if (!topBar) return;
    
    // Clear any existing timeout
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }
    
    // Only hide/show after user stops scrolling rapidly
    scrollTimeout = setTimeout(() => {
        if (currentScrollTop > lastScrollTop && currentScrollTop > 44) {
            // Scrolling down - hide main bar, dock raid bar to top
            topBar.classList.add('hidden');
            if (raidBar && raidBar.style.display !== 'none') {
                raidBar.classList.add('docked-top');
            }
        } else {
            // Scrolling up - show main bar, undock raid bar
            topBar.classList.remove('hidden');
            if (raidBar && raidBar.style.display !== 'none') {
                raidBar.classList.remove('docked-top');
            }
        }
        
        // Handle opacity based on scroll position for both bars
        if (currentScrollTop > 0) {
            // Not at top - reduce opacity
            topBar.classList.add('scrolled');
            if (raidBar && raidBar.style.display !== 'none') {
                raidBar.classList.add('scrolled');
            }
        } else {
            // At top - full opacity
            topBar.classList.remove('scrolled');
            if (raidBar && raidBar.style.display !== 'none') {
                raidBar.classList.remove('scrolled');
            }
        }
        
        lastScrollTop = currentScrollTop <= 0 ? 0 : currentScrollTop; // For Mobile or negative scrolling
    }, 50); // Small delay to prevent excessive triggering
}

// Raids Dropdown functionality
async function loadUpcomingRaids() {
    const dropdownMenu = document.getElementById('upcoming-raids-menu');
    if (!dropdownMenu) return;

    try {
        const response = await fetch('/api/events');
        const data = await response.json();

        if (data && data.scheduledEvents && Array.isArray(data.scheduledEvents)) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Filter upcoming events
            const upcomingEvents = data.scheduledEvents.filter(event => {
                if (typeof event.startTime !== 'number') return false;
                const eventStartDate = new Date(event.startTime * 1000);
                return eventStartDate >= today;
            });

            // Sort by start time
            upcomingEvents.sort((a, b) => a.startTime - b.startTime);

            if (upcomingEvents.length === 0) {
                dropdownMenu.innerHTML = '<div class="dropdown-empty">No upcoming raids found</div>';
                return;
            }

            // Generate dropdown items
            let dropdownHTML = '';
            upcomingEvents.forEach(event => {
                const eventId = event.id;
                const eventTitle = event.title || 'Untitled Event';
                const eventStartDate = new Date(event.startTime * 1000);
                
                // Format day and time
                const cetTimeZone = 'Europe/Copenhagen';
                const nowInCET = new Date();
                const todayAtMidnightCET = new Date(nowInCET.toLocaleDateString('en-CA', { timeZone: cetTimeZone }));
                const eventDateOnly = new Date(eventStartDate.toLocaleDateString('en-CA', { timeZone: cetTimeZone }));

                let dayDisplay;
                if (eventDateOnly.getTime() === todayAtMidnightCET.getTime()) {
                    dayDisplay = 'Today';
                } else {
                    const optionsDay = { weekday: 'long', timeZone: cetTimeZone };
                    dayDisplay = eventStartDate.toLocaleDateString('en-US', optionsDay);
                }

                const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: cetTimeZone };
                const timeDisplay = eventStartDate.toLocaleTimeString('en-GB', optionsTime);

                dropdownHTML += `
                    <div class="dropdown-item" data-event-id="${eventId}">
                        <div class="dropdown-item-left">${eventTitle}</div>
                        <div class="dropdown-item-right">
                            <span>${dayDisplay}</span>
                            <span>|</span>
                            <span class="dropdown-item-time">${timeDisplay}</span>
                        </div>
                    </div>
                `;
            });

            dropdownMenu.innerHTML = dropdownHTML;

            // Add click handlers to dropdown items
            dropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const eventId = item.dataset.eventId;
                    if (eventId) {
                        // Set active session in localStorage
                        localStorage.setItem('activeEventSession', eventId);
                        console.log('🎯 Set active event session:', eventId);
                        
                        // Navigate to roster page
                        window.location.href = `/event/${eventId}/roster`;
                    }
                });
            });

        } else {
            dropdownMenu.innerHTML = '<div class="dropdown-empty">No events data available</div>';
        }
    } catch (error) {
        console.error('Error loading upcoming raids:', error);
        dropdownMenu.innerHTML = '<div class="dropdown-empty">Error loading raids</div>';
    }
}

function setupUpcomingRaidsDropdown() {
    const dropdownToggle = document.getElementById('upcoming-raids-dropdown');
    const dropdownMenu = document.getElementById('upcoming-raids-menu');

    if (!dropdownToggle || !dropdownMenu) return;

    dropdownToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = dropdownMenu.classList.contains('show');

        // Close all dropdowns first
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
        document.querySelectorAll('.dropdown-toggle.active').forEach(toggle => {
            toggle.classList.remove('active');
        });

        if (!isOpen) {
            // Open this dropdown
            dropdownMenu.classList.add('show');
            dropdownToggle.classList.add('active');
            
            // Load raids data when opening
            loadUpcomingRaids();
        }
    });
}

// Internal guards to prevent thrash/fetch storms
let __updateRaidBarBusy = false;
let __handlingStorageEvent = false;

// Raid Bar functionality
async function updateRaidBar() {
    if (__updateRaidBarBusy) return; // Drop re-entrant calls
    __updateRaidBarBusy = true;
    const urlEventId = getEventIdFromUrl();
    let activeEventId = urlEventId || localStorage.getItem('activeEventSession');
    // Keep localStorage in sync with URL when present, but do NOT bounce writes during storage handling
    if (!__handlingStorageEvent && urlEventId && localStorage.getItem('activeEventSession') !== urlEventId) {
        localStorage.setItem('activeEventSession', urlEventId);
    }
    const raidBar = document.getElementById('raid-bar');
    const raidTitle = document.getElementById('raid-title');
    
    if (!raidBar) return;
    
    // If no active event at all, hide the bar and exit
    if (!activeEventId) {
        hideRaidBar();
        return;
    }

    // Always show the bar and update links based on the active event ID
    raidBar.style.display = 'flex';
    document.body.classList.add('has-raid-bar');
    updateRaidNavigation(activeEventId);
    setTimeout(() => highlightActiveRaidNav(), 100);

    // Best-effort: fetch the event title; if it fails, keep a generic title
    try {
        const response = await fetch('/api/events');
        if (response.ok) {
            const data = await response.json();
            if (data && data.scheduledEvents) {
                const activeEvent = data.scheduledEvents.find(event => event.id === activeEventId);
                if (activeEvent && raidTitle) {
                    raidTitle.textContent = activeEvent.title || 'Selected Raid';
                } else if (raidTitle && !raidTitle.textContent) {
                    raidTitle.textContent = 'Selected Raid';
                }
            }
        } else if (raidTitle && !raidTitle.textContent) {
            raidTitle.textContent = 'Selected Raid';
        }
    } catch (_) {
        if (raidTitle && !raidTitle.textContent) {
            raidTitle.textContent = 'Selected Raid';
        }
    } finally {
        __updateRaidBarBusy = false;
    }
}

function hideRaidBar() {
    const raidBar = document.getElementById('raid-bar');
    if (raidBar) {
        raidBar.style.display = 'none';
        document.body.classList.remove('has-raid-bar');
    }
}

function updateRaidNavigation(eventId) {
    const rosterLink = document.getElementById('raid-roster-link');
    const assignmentsLink = document.getElementById('raid-assignments-link');
    const logsLink = document.getElementById('raid-logs-link');
    const goldpotLink = document.getElementById('raid-goldpot-link');
    const lootLink = document.getElementById('raid-loot-link');
    
    // Update roster link
    if (rosterLink) {
        rosterLink.href = `/event/${eventId}/roster`;
    }
    
    // Assignments link
    if (assignmentsLink) {
        assignmentsLink.href = `/event/${eventId}/assignments`;
        // Remove any existing event listeners by cloning the node (keeps id and classes)
        assignmentsLink.replaceWith(assignmentsLink.cloneNode(true));
    }
    
    if (goldpotLink) {
        goldpotLink.href = `/event/${eventId}/gold`;
        goldpotLink.replaceWith(goldpotLink.cloneNode(true));
    }
    
    if (logsLink) {
        // Always point Raid Logs to the event-specific raidlogs page
        logsLink.href = `/event/${eventId}/raidlogs`;
    }

    if (lootLink) {
        lootLink.href = `/event/${eventId}/loot`;
        lootLink.replaceWith(lootLink.cloneNode(true));
    }
}

// Run the functions when the document is ready.
document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();
    // Inject links first so icon enhancement can decorate them
    injectRulesNavLink();
    normalizeTopBar();
    injectSandboxBanner();
    enhanceTopNavIcons();
    highlightActiveNav();
    setupUpcomingRaidsDropdown();
    updateRaidBar();
    
    // Ensure raid navigation highlighting is applied after everything loads
    setTimeout(() => highlightActiveRaidNav(), 200);
    
    // Start polling for live session status
    setTimeout(() => startLiveStatusPolling(), 500);

    // Add scroll listener for sticky header behavior
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Listen for localStorage changes to update raid bar.
    // IMPORTANT: Ignore storage events on event-scoped pages to avoid cross-tab ping-pong.
    window.addEventListener('storage', (e) => {
        if (e.key === 'activeEventSession') {
            const urlEventId = getEventIdFromUrl();
            if (urlEventId) return; // URL is source of truth on event pages; ignore external changes
            __handlingStorageEvent = true;
            Promise.resolve(updateRaidBar()).finally(() => { __handlingStorageEvent = false; });
        }
    });

    // Update raid bar if history navigation changes the URL (URL is source of truth)
    window.addEventListener('popstate', () => {
        updateRaidBar();
    });

    // Global click listener to close dropdowns
    window.addEventListener('click', () => {
        // Close user dropdown
        const userDropdown = document.getElementById('user-dropdown-menu');
        if (userDropdown && userDropdown.classList.contains('show')) {
            userDropdown.classList.remove('show');
        }

        // Close upcoming raids dropdown
        const raidsDropdown = document.getElementById('upcoming-raids-menu');
        const raidsToggle = document.getElementById('upcoming-raids-dropdown');
        if (raidsDropdown && raidsDropdown.classList.contains('show')) {
            raidsDropdown.classList.remove('show');
            if (raidsToggle) {
                raidsToggle.classList.remove('active');
            }
        }
    });

	// Initialize site-wide chat widget (explicit init)
	(function initSiteChatWidget() {
		try {
			let loaded = false;
			const ensureScript = (src) => new Promise((resolve, reject) => {
				// Avoid duplicate loads
				if (document.querySelector(`script[src="${src}"]`)) return resolve();
				const s = document.createElement('script');
				s.src = src;
				s.async = true;
				s.onload = () => resolve();
				s.onerror = (e) => reject(e);
				(document.head || document.documentElement).appendChild(s);
			});

			const mount = async () => {
				if (loaded) return; // idempotent
				if (window.__SITE_CHAT_MOUNTED__) return;
				loaded = true;
				window.__SITE_CHAT_MOUNTED__ = true;
				try {
					if (!window.io) {
						await ensureScript('https://cdn.socket.io/4.7.5/socket.io.min.js');
					}
					// Remove any prior widget scripts to avoid stale code
					Array.from(document.querySelectorAll('script[src^="/widget/site-chat"],script[src*="/widget/site-chat"]')).forEach(n => { try { n.parentNode && n.parentNode.removeChild(n); } catch(_){} });
					const ts = Date.now();
					await ensureScript(`/widget/site-chat.js?v=${ts}`);
					// Mark body to confirm stylesheet applied
					try { document.body.classList.add('site-chat-mounted'); } catch(_){}
					if (window.SiteChat && typeof window.SiteChat.init === 'function') {
						window.SiteChat.init({
							endpoints: {
								whoAmI: '/api/auth/whoami',
								chatSocketUrl: '/socket.io',
								uploadUrl: '/api/chat/upload',
								adminStateUrl: '/api/chat/config',
								userPrefsUrl: '/api/chat/prefs'
							}
						});
					}
				} catch (e) {
					console.warn('[SiteChat] init failed', e);
				}
			};

			// Only mount for logged-in users and when server says enabled
			Promise.resolve(getUserStatus()).then(async (user) => {
				if (!user || !user.loggedIn) return; // require login
				try {
					const r = await fetch('/api/chat/config');
					if (!r.ok) return;
					const cfg = await r.json();
					if (cfg && cfg.ok !== false && cfg.enabled && !cfg.userDisabled) {
						mount();
					}
				} catch (_) {}
			});
		} catch (_) {}
	})();
}); 