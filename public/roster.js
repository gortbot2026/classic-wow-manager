// public/roster.js

document.addEventListener('DOMContentLoaded', async () => {
    // Utility: Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    const rosterGrid = document.getElementById('roster-grid');
    const rosterEventTitle = document.getElementById('roster-event-title');
    const compToolButton = document.getElementById('comp-tool-button');
    const voiceSpyButton = document.getElementById('voice-spy-button');
    const revertButton = document.getElementById('revert-roster-button');
    const announceInvitesButton = document.getElementById('announce-invites-button');
    const autoAssignmentsButton = document.getElementById('auto-assignments-button');
    const benchContainer = document.getElementById('bench-container');
    const benchedList = document.getElementById('benched-list');
    const compareButton = document.getElementById('compare-string-button');
    const compareOverlay = document.getElementById('compare-overlay');
    const compareInput = document.getElementById('compare-input');
    const compareRunBtn = document.getElementById('compare-run');
    const compareCancelBtn = document.getElementById('compare-cancel');
    const compareCloseBtn = compareOverlay ? compareOverlay.querySelector('.compare-close') : null;
    const compareResults = document.getElementById('compare-results');

    const pathParts = window.location.pathname.split('/');
    const eventKeywordIndex = pathParts.indexOf('event');
    const eventId = (eventKeywordIndex !== -1 && pathParts.length > eventKeywordIndex + 1) ? pathParts[eventKeywordIndex + 1] : null;

    if (!eventId) {
        rosterGrid.innerHTML = '<p>Error: Event ID not found in URL.</p>';
        return;
    }

    // Set active event session in localStorage when visiting roster directly
    localStorage.setItem('activeEventSession', eventId);
    console.log('🎯 Set active event session from roster page:', eventId);
    // Update raid bar once (URL is source of truth). Avoid duplicate immediate calls.
    if (typeof updateRaidBar === 'function') {
        setTimeout(() => updateRaidBar(), 0);
    }

    if (compToolButton) {
        compToolButton.href = `https://raid-helper.dev/raidplan/${eventId}`;
    }

    if (voiceSpyButton) {
        voiceSpyButton.href = `/voice-check?eventId=${eventId}`;
    }

    // Custom modal for announce invites
    function openAnnounceInvitesModal() {
        const inputId = 'announce-invite-person-input';
        const messageHtml = `
            <label for="${inputId}">Invite person name</label>
            <input id="${inputId}" type="text" class="player-search-input" placeholder="e.g., RaidLead" autocomplete="off" style="width:100%; margin-top:6px;">
        `;
        const modal = new ConfirmationModal({
            type: 'custom',
            title: 'Announce invites',
            message: messageHtml,
            allowHtmlContent: true,
            buttons: [
                { text: 'Cancel', action: 'cancel', style: 'secondary' },
                { text: 'Send', action: 'confirm', style: 'primary' }
            ],
            onConfirm: async () => {
                try {
                    const input = modal.modal ? modal.modal.querySelector(`#${inputId}`) : null;
                    const trimmed = String(input && input.value ? input.value : '').trim();
                    if (!trimmed) { showAlert('Missing name', 'Please enter a valid name.'); return; }
                    announceInvitesButton.disabled = true;
                    // Build roster mentions from current roster data if available
                    let mentionContent = '';
                    const mentionUserIds = [];
                    try {
                        const names = new Set();
                        (currentRosterData.raidDrop || []).forEach(p => {
                            if (p && p.userid) mentionUserIds.push(String(p.userid));
                            if (p && p.name) names.add(`@${p.name}`);
                        });
                        (currentRosterData.bench || []).forEach(p => {
                            if (p && p.userid) mentionUserIds.push(String(p.userid));
                            if (p && p.name) names.add(`@${p.name}`);
                        });
                        const list = Array.from(names);
                        if (list.length) mentionContent = list.join(' ');
                    } catch {}

                    const resp = await fetch('/api/discord/announce-invites', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ eventId, invitePerson: trimmed, mentionContent, mentionUserIds })
                    });
                    if (!resp.ok) {
                        const t = await resp.text();
                        console.error('Announce invites failed:', t);
                        showAlert('Announce failed', 'Failed to announce invites.');
                    } else {
                        try { localStorage.setItem('lastInvitePerson', trimmed); } catch {}
                        try { localStorage.setItem(`invitesStarted:${eventId}`, JSON.stringify({ started: true, by: trimmed, ts: Date.now() })); } catch {}
                        updateInvitesStartedStat().catch(()=>{});
                        showAlert('Invites sent', 'Your announcement was posted to Discord.');
                    }
                } catch (e) {
                    console.error(e);
                    showAlert('Announce failed', 'Failed to announce invites.');
                } finally {
                    announceInvitesButton.disabled = false;
                }
            }
        });
        modal.show();
        // Prefill from invites-by input or stored value
        try {
            const field = modal.modal ? modal.modal.querySelector(`#${inputId}`) : null;
            if (field) {
                let preset = '';
                const invitesByEl = document.getElementById('invites-by-input');
                if (invitesByEl) preset = String(invitesByEl.value||'').trim();
                if (!preset) {
                    try { preset = localStorage.getItem(`invitesBy:${eventId}`) || localStorage.getItem('lastInvitePerson') || ''; } catch {}
                }
                if (preset) field.value = preset;
            }
        } catch {}
    }

    if (announceInvitesButton) {
        announceInvitesButton.addEventListener('click', () => {
            openAnnounceInvitesModal();
        });
    }

    // Compare string overlay handlers
    function openCompareOverlay() {
        if (!compareOverlay) return;
        compareOverlay.style.display = 'flex';
        if (compareInput) compareInput.focus();
    }
    function closeCompareOverlay() {
        if (!compareOverlay) return;
        compareOverlay.style.display = 'none';
        if (compareInput) compareInput.value = '';
    }
    function parseCompareString(str) {
        const items = String(str || '')
            .split(';')
            .map(s => s.trim())
            .filter(Boolean);
        const parsed = [];
        for (const item of items) {
            // Expect "<name> <class>"; class may be multiple words like "Death Knight" (but classic doesn't use DK)
            const m = item.match(/^(\S+)\s+(.+)$/);
            if (!m) continue;
            const name = m[1];
            const cls = m[2];
            parsed.push({ name, cls });
        }
        return parsed;
    }
    function buildRosterNameClassMap() {
        const map = new Map();
        const push = (p) => {
            if (!p) return;
            // Prefer the same display name the UI shows, then fall back to server-side fields
            const display = (p.mainCharacterName || p.assigned_char_name || p.character_name || p.name || '').trim();
            // Use the roster class if present; fall back to API variants. Normalize "Tank" -> Warrior
            const clsRaw = (p.class || p.class_name || '').trim();
            if (!display || !clsRaw) return;
            const canonicalClass = canonicalizeClassForDbMatch(String(clsRaw));
            map.set(display.toLowerCase(), canonicalClass);
        };
        (currentRosterData.raidDrop || []).forEach(push);
        (currentRosterData.bench || []).forEach(push);
        return map;
    }
    function renderCompareResults(list) {
        if (!compareResults) return;
        const rosterMap = buildRosterNameClassMap();
        let nameMatches = 0, classMatches = 0;
        const rows = list.map(item => {
            const key = String(item.name || '').trim().toLowerCase();
            const inputClassCanonical = getCanonicalClass(item.cls);
            const rosterClass = rosterMap.get(key);
            const hasName = rosterMap.has(key);
            const hasClass = hasName && rosterClass === inputClassCanonical;
            if (hasName) nameMatches++;
            if (hasClass) classMatches++;
            const nameBadge = hasName
                ? '<span class="compare-badge badge-ok"><i class="fas fa-check"></i> Name match</span>'
                : '<span class="compare-badge badge-fail"><i class="fas fa-times"></i> Name missing</span>';
            const classBadge = hasClass
                ? '<span class="compare-badge badge-ok"><i class="fas fa-check"></i> Class match</span>'
                : `<span class="compare-badge badge-fail"><i class="fas fa-times"></i> Class ${hasName && rosterClass ? '('+rosterClass+')' : ''}</span>`;
            return `
                <div class="compare-row">
                    <div class="compare-name">${escapeHtml(item.name)} <span style="opacity:0.8; font-weight:400;">${escapeHtml(item.cls)}</span></div>
                    <div>${nameBadge}</div>
                    <div>${classBadge}</div>
                </div>`;
        }).join('');
        const summary = `<div class="compare-results-summary"><div><strong>Total</strong>: ${list.length}</div><div><strong>Name matches</strong>: ${nameMatches}</div><div><strong>Class matches</strong>: ${classMatches}</div></div>`;
        compareResults.innerHTML = summary + rows;
        compareResults.style.display = 'block';
        // Scroll into view
        try { compareResults.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
    }
    async function runCompare() {
        const val = (compareInput && compareInput.value) ? compareInput.value : '';
        const parsed = parseCompareString(val);
        closeCompareOverlay();
        renderCompareResults(parsed);
    }
    if (compareButton) compareButton.addEventListener('click', openCompareOverlay);
    if (compareCloseBtn) compareCloseBtn.addEventListener('click', closeCompareOverlay);
    if (compareCancelBtn) compareCancelBtn.addEventListener('click', closeCompareOverlay);
    if (compareOverlay) compareOverlay.addEventListener('click', (e)=>{ if (e.target === compareOverlay) closeCompareOverlay(); });
    if (compareRunBtn) compareRunBtn.addEventListener('click', runCompare);
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape' && compareOverlay && compareOverlay.style.display === 'flex') closeCompareOverlay(); });

    let isManaged = false;
    let currentUserCanManage = false;
    let specData = {};
    let currentRosterData = {};
    let playerCharacterHistory = {}; // Track all characters each player has used
    let playerCharacterDetails = {}; // Track class info for each character
    let playersDbCache = {}; // Cache of players table entries by discord ID
    
    // Version check - updated 2026-01-23 to fix character swap color bug
    console.log('[ROSTER] Version: 2026-01-23-v3 - Tank role mapping fix loaded');

    // Add utility functions for optimistic updates
    const OptimisticUpdates = {
        // Find a player cell by userid
        findPlayerCell(userid) {
            const cells = document.querySelectorAll('.roster-cell.player-filled');
            for (let cell of cells) {
                const nameDiv = cell.querySelector('.player-name');
                if (nameDiv && nameDiv.dataset.discordName) {
                    // We need to find by userid, but we only have discord name in DOM
                    // Let's check if this player matches by finding them in currentRosterData
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userid);
                    if (player && nameDiv.dataset.discordName === player.name) {
                        return cell;
                    }
                }
            }
            // Also check bench
            const benchCells = document.querySelectorAll('#benched-list .roster-cell.player-filled');
            for (let cell of benchCells) {
                const nameDiv = cell.querySelector('.player-name');
                if (nameDiv && nameDiv.dataset.discordName) {
                    const player = currentRosterData.bench?.find(p => p && p.userid === userid);
                    if (player && nameDiv.dataset.discordName === player.name) {
                        return cell;
                    }
                }
            }
            return null;
        },

        // Update a specific cell with new player data
        async updatePlayerCell(cell, newPlayerData, isBenched = false) {
            if (!cell || !newPlayerData) return;

            // First, ensure the cell has the proper class for filled cells
            cell.classList.add('player-filled');

            const displayName = newPlayerData.mainCharacterName || newPlayerData.name;
            const nameClass = newPlayerData.mainCharacterName ? 'player-name' : 'player-name unregistered-name';
            
            // Check if player is absent for bench display
            const discordAbsentEmoji = "612343589070045200";
            const isAbsent = newPlayerData.spec_emote === discordAbsentEmoji;
            if (isAbsent && isBenched) {
                cell.classList.add('absent-player');
            } else {
                cell.classList.remove('absent-player');
            }

            let dropdownContentHTML = await buildDropdownContent(newPlayerData, isBenched);

            // Single icon only: class-icon-badge is added by applyPlayerColor()
            cell.innerHTML = `
                <div class="${nameClass}" data-character-name="${displayName}" data-discord-name="${newPlayerData.name}"><span>${displayName}</span></div>
                <div class="player-details-dropdown">${dropdownContentHTML}</div>`;

            const cellCanonicalClass = getCanonicalClass(newPlayerData.class);
            applyPlayerColor(cell, newPlayerData.color, cellCanonicalClass);
            try {
                if (!newPlayerData.userid) cell.classList.add('no-discord-id');
                else cell.classList.remove('no-discord-id');
            } catch {}
            applyNoAssignmentsStyling(cell, newPlayerData);
            
            // Re-attach event listeners for this specific cell
            const updatedCell = this.attachCellEventListeners(cell);
            return updatedCell; // Return the updated cell reference
        },

        // Move player cell to a new position optimistically
        movePlayerToPosition(userid, targetPartyId, targetSlotId) {
            const sourceCell = this.findPlayerCell(userid);
            if (!sourceCell) return false;

            // Find target cell in roster grid
            const columns = document.querySelectorAll('.roster-column');
            if (targetPartyId < 1 || targetPartyId > columns.length) return false;
            
            const targetColumn = columns[targetPartyId - 1];
            const cells = targetColumn.querySelectorAll('.roster-cell');
            if (targetSlotId < 1 || targetSlotId > cells.length) return false; // cells array is 0-indexed, slots are 1-indexed
            
            const targetCell = cells[targetSlotId - 1]; // Convert 1-indexed slot to 0-indexed array

            // Get player data BEFORE any updates to avoid timing issues
            // Check both roster and bench for the moving player
            let movingPlayer = currentRosterData.raidDrop.find(p => p && p.userid === userid);
            let isMovingFromBench = false;
            
            if (!movingPlayer) {
                movingPlayer = currentRosterData.bench?.find(p => p && p.userid === userid);
                isMovingFromBench = true;
            }
            
            const targetPlayerInOriginalPos = currentRosterData.raidDrop.find(p => 
                p && p.partyId === parseInt(targetPartyId) && p.slotId === parseInt(targetSlotId));

            if (!movingPlayer) {
                console.error('Moving player not found in roster or bench:', userid);
                return false;
            }

            // Move operation starting (debug details removed)

            // Add moving animation
            sourceCell.classList.add('moving');
            if (targetCell.classList.contains('player-filled')) {
                targetCell.classList.add('moving');
            }

            // Store original content for potential rollback
            const sourceOriginalContent = sourceCell.innerHTML;
            const targetOriginalContent = targetCell.innerHTML;
            
            // Handle data updates based on source location
            if (isMovingFromBench) {
                // Moving from bench to roster
                // Remove from bench array
                const benchIndex = currentRosterData.bench.findIndex(p => p && p.userid === userid);
                if (benchIndex !== -1) {
                    currentRosterData.bench.splice(benchIndex, 1);
                }
                
                // Set roster position for the moving player
                movingPlayer.partyId = parseInt(targetPartyId);
                movingPlayer.slotId = parseInt(targetSlotId);
                
                // Add to roster array
                currentRosterData.raidDrop.push(movingPlayer);
                
                // If there's a target player, move them to bench
                if (targetPlayerInOriginalPos) {
                    // Remove target from roster
                    const targetIndex = currentRosterData.raidDrop.findIndex(p => p && p.userid === targetPlayerInOriginalPos.userid);
                    if (targetIndex !== -1) {
                        currentRosterData.raidDrop.splice(targetIndex, 1);
                    }
                    
                    // Clear target player's position data and add to bench
                    delete targetPlayerInOriginalPos.partyId;
                    delete targetPlayerInOriginalPos.slotId;
                    currentRosterData.bench.push(targetPlayerInOriginalPos);
                }
            } else {
                // Moving within roster (existing logic)
                // Store original positions before updating
                const originalPartyId = movingPlayer.partyId;
                const originalSlotId = movingPlayer.slotId;

                // Update positions in data immediately
                movingPlayer.partyId = parseInt(targetPartyId);
                movingPlayer.slotId = parseInt(targetSlotId);

                if (targetPlayerInOriginalPos) {
                    targetPlayerInOriginalPos.partyId = originalPartyId;
                    targetPlayerInOriginalPos.slotId = originalSlotId;
                }
            }

            // Update the cell contents after a brief delay for animation
            setTimeout(async () => {
                try {
                    let updatedSourceCell = sourceCell;
                    let updatedTargetCell = targetCell;

                    if (isMovingFromBench) {
                        // Moving from bench to roster
                        // Moving from bench to roster
                        
                        // Remove player from bench visually (sourceCell is in bench)
                        sourceCell.remove();
                        
                        // Update target cell with moving player
                        updatedTargetCell = await this.updatePlayerCell(targetCell, movingPlayer, false);
                        
                        // If there was a target player, add them to bench
                        if (targetPlayerInOriginalPos) {
                            // Player displaced to bench
                            // Show bench container if it was hidden
                            document.getElementById('bench-container').style.display = 'block';
                            await this.createBenchCell(targetPlayerInOriginalPos);
                        }
                        
                        // Hide bench if it's now empty
                        if (currentRosterData.bench.length === 0) {
                            document.getElementById('bench-container').style.display = 'none';
                        }
                        
                        updatedSourceCell = null; // No source cell to update
                    } else {
                        // Moving within roster (existing logic)
                        // Rebuild source cell
                        if (targetPlayerInOriginalPos) {
                            // There was a player in target - they go to source position
                            // Updating source cell
                            updatedSourceCell = await this.updatePlayerCell(sourceCell, targetPlayerInOriginalPos, false);
                                            } else {
                        // Target was empty - source becomes empty, restore empty slot functionality
                                                    // Making source cell empty
                        sourceCell.classList.remove('player-filled');
                        sourceCell.classList.add('empty-slot-clickable');
                        
                        // Figure out the party and slot IDs for this cell
                        const sourcePartyId = movingPlayer.partyId;
                        const sourceSlotId = movingPlayer.slotId;
                        const emptyDropdownContent = buildEmptySlotDropdownContent(sourcePartyId, sourceSlotId);
                        
                        sourceCell.innerHTML = `
                            <div class="player-name">Empty</div>
                            <div class="player-details-dropdown">${emptyDropdownContent}</div>`;
                        sourceCell.style.backgroundColor = '#777';
                        sourceCell.style.color = '';
                        
                        // Attach empty slot event listeners after a brief delay to ensure DOM is updated
                        setTimeout(() => {
                            if (sourceCell && sourceCell.parentNode) {
                                const updatedCell = attachEmptySlotListeners(sourceCell);
                                // updatedSourceCell is now the new cell reference
                                updatedSourceCell = updatedCell;
                            }
                        }, 10);
                    }

                        // Rebuild target cell with moving player
                        // Updating target cell with moving player
                        updatedTargetCell = await this.updatePlayerCell(targetCell, movingPlayer, false);
                    }

                    // Remove animation classes from the updated cell references
                    if (updatedSourceCell) {
                        updatedSourceCell.classList.remove('moving');
                    }
                    updatedTargetCell.classList.remove('moving');
                    
                    // Refresh all dropdown content to reflect current positions
                    await this.refreshAllDropdownContent();
                    
                    // Move visual update completed
                } catch (error) {
                    console.error('Error during visual update:', error);
                }
            }, 150);

            return { sourceOriginalContent, targetOriginalContent, sourceCell, targetCell };
        },

        // Move player to bench optimistically
        moveToBench(userid) {
            const sourceCell = this.findPlayerCell(userid);
            if (!sourceCell) return false;

            // Find the player data
            const playerIndex = currentRosterData.raidDrop.findIndex(p => p && p.userid === userid);
            if (playerIndex === -1) return false;

            const playerData = currentRosterData.raidDrop[playerIndex];
            
            // Store original for rollback
            const originalContent = sourceCell.innerHTML;
            const originalPosition = { partyId: playerData.partyId, slotId: playerData.slotId };

            // Add moving-to-bench animation
            sourceCell.classList.add('moving-to-bench');

            // Update source cell to empty after animation delay
            const self = this; // Capture 'this' reference for setTimeout
            setTimeout(() => {
                sourceCell.classList.remove('player-filled', 'moving-to-bench');
                sourceCell.classList.add('empty-slot-clickable');
                
                // Find the party and slot IDs for this cell by looking at its position in the grid
                const column = sourceCell.closest('.roster-column');
                const allColumns = Array.from(document.querySelectorAll('.roster-column'));
                const partyId = allColumns.indexOf(column) + 1;
                
                const cellsInColumn = Array.from(column.querySelectorAll('.roster-cell'));
                const slotId = cellsInColumn.indexOf(sourceCell) + 1;
                
                const emptyDropdownContent = buildEmptySlotDropdownContent(partyId, slotId);
                sourceCell.innerHTML = `
                    <div class="player-name">Empty</div>
                    <div class="player-details-dropdown">${emptyDropdownContent}</div>`;
                sourceCell.style.backgroundColor = '#777'; // Default empty cell color
                sourceCell.style.color = '';
                
                // Attach empty slot event listeners after a brief delay to ensure DOM is updated
                setTimeout(() => {
                    if (sourceCell && sourceCell.parentNode) {
                        attachEmptySlotListeners(sourceCell);
                    }
                }, 10);
            }, 200);

            // Add to bench visually
            const benchContainer = document.getElementById('bench-container');
            const benchedList = document.getElementById('benched-list');
            
            if (!currentRosterData.bench) currentRosterData.bench = [];
            currentRosterData.bench.push(playerData);
            
            // Remove from roster data
            currentRosterData.raidDrop.splice(playerIndex, 1);

            // Show bench if hidden
            benchContainer.style.display = 'block';

            // Create new bench cell with delay
            setTimeout(() => {
                this.createBenchCell(playerData);
            }, 300);

            return { originalContent, originalPosition, sourceCell, playerData };
        },

        // Create a new cell in the bench
        async createBenchCell(playerData) {
            const benchedList = document.getElementById('benched-list');
            const discordAbsentEmoji = "612343589070045200";
            const isAbsent = playerData.spec_emote === discordAbsentEmoji;
            
            const cellDiv = await createPlayerCell(playerData, true, isAbsent);
            benchedList.appendChild(cellDiv);
            
            this.attachCellEventListeners(cellDiv);
            return cellDiv;
        },

        // Update player spec optimistically
        async updatePlayerSpec(userid, newSpecName) {
            const cell = this.findPlayerCell(userid);
            if (!cell) return false;

            // Find player in data
            let playerData = currentRosterData.raidDrop?.find(p => p && p.userid === userid);
            if (!playerData) {
                playerData = currentRosterData.bench?.find(p => p && p.userid === userid);
            }
            if (!playerData) return false;

            // Store original for rollback
            const originalSpecEmote = playerData.spec_emote;

            // Add spec changing animation
            cell.classList.add('spec-changing');

            // Find new spec data
            const canonicalClass = getCanonicalClass(playerData.class);
            const specsForClass = specData[canonicalClass] || [];
            const newSpec = specsForClass.find(spec => spec.name === newSpecName);
            
            if (newSpec) {
                // Update the data immediately
                playerData.spec_emote = newSpec.emote;
                
                // Update the cell after animation delay
                setTimeout(async () => {
                    const isBenched = cell.closest('#benched-list') !== null;
                    const updatedCell = await this.updatePlayerCell(cell, playerData, isBenched);
                    updatedCell.classList.remove('spec-changing');
                    updatedCell.classList.add('success-update');
                    
                    // Refresh all dropdown content to reflect current state
                    await this.refreshAllDropdownContent();
                    
                    // Remove success animation
                    setTimeout(() => {
                        updatedCell.classList.remove('success-update');
                    }, 600);
                }, 250);

                return { originalSpecEmote, playerData };
            }
            return false;
        },

        // Update player character optimistically
        async updatePlayerCharacter(userid, newCharacterName, newCharacterClass) {
            const cell = this.findPlayerCell(userid);
            if (!cell) return false;

            // Find player in data
            let playerData = currentRosterData.raidDrop?.find(p => p && p.userid === userid);
            if (!playerData) {
                playerData = currentRosterData.bench?.find(p => p && p.userid === userid);
            }
            if (!playerData) return false;

            // Store original for rollback
            const originalData = {
                mainCharacterName: playerData.mainCharacterName,
                class: playerData.class,
                spec_emote: playerData.spec_emote,
                color: playerData.color
            };

            // Add character swapping animation
            cell.classList.add('character-swapping');

            // If class is missing or invalid, fetch it from the API
            if (!newCharacterClass || newCharacterClass === 'undefined' || newCharacterClass === 'null' || (typeof newCharacterClass === 'string' && newCharacterClass.trim() === '')) {
                console.log(`[OPTIMISTIC_UPDATE] Class info missing for "${newCharacterName}", fetching from API...`);
                try {
                    const response = await fetch(`/api/players/by-discord-id/${userid}`);
                    if (response.ok) {
                        const data = await response.json();
                        console.log(`[OPTIMISTIC_UPDATE] API returned ${data.characters?.length || 0} characters:`, data.characters);
                        const character = data.characters?.find(c => c.character_name.toLowerCase() === newCharacterName.toLowerCase());
                        if (character) {
                            newCharacterClass = character.class;
                            console.log(`[OPTIMISTIC_UPDATE] Found class from API: "${newCharacterClass}" for "${newCharacterName}"`);
                        } else {
                            console.warn(`[OPTIMISTIC_UPDATE] Character "${newCharacterName}" not found in API response`);
                        }
                    } else {
                        console.warn(`[OPTIMISTIC_UPDATE] API returned status ${response.status}`);
                    }
                } catch (error) {
                    console.error('[OPTIMISTIC_UPDATE] Failed to fetch class from API:', error);
                }
            }

            // Update player data
            playerData.mainCharacterName = newCharacterName;
            playerData.class = newCharacterClass;
            
            // Update color based on new class
            const canonicalClass = getCanonicalClass(newCharacterClass);
            playerData.color = getClassColor(canonicalClass);
            
            console.log(`[OPTIMISTIC_UPDATE] newCharacterClass="${newCharacterClass}", canonicalClass="${canonicalClass}", color="${playerData.color}"`);

            // Reset spec to a default for the new class
            const specsForClass = specData[canonicalClass] || [];
            if (specsForClass.length > 0) {
                playerData.spec_emote = specsForClass[0].emote;
            }

            // Update the cell after animation delay
            setTimeout(async () => {
                const isBenched = cell.closest('#benched-list') !== null;
                const updatedCell = await this.updatePlayerCell(cell, playerData, isBenched);
                updatedCell.classList.remove('character-swapping');
                updatedCell.classList.add('success-update');
                
                // Refresh all dropdown content to reflect current state
                await this.refreshAllDropdownContent();
                
                // Remove success animation
                setTimeout(() => {
                    updatedCell.classList.remove('success-update');
                }, 600);
            }, 300);

            return { originalData, playerData };
        },

        // Refresh dropdown content for all player cells to reflect current positions
        async refreshAllDropdownContent() {
            // Update roster cells
            const rosterCells = document.querySelectorAll('.roster-cell.player-filled');
            for (const cell of rosterCells) {
                const nameDiv = cell.querySelector('.player-name');
                if (nameDiv && nameDiv.dataset.discordName) {
                    // Find the player data for this cell
                    let playerData = currentRosterData.raidDrop?.find(p => p && p.name === nameDiv.dataset.discordName);
                    if (playerData) {
                        const dropdownDiv = cell.querySelector('.player-details-dropdown');
                        if (dropdownDiv) {
                            const isBenched = cell.closest('#benched-list') !== null;
                            dropdownDiv.innerHTML = await buildDropdownContent(playerData, isBenched);
                        }
                    }
                }
            }

            // Update bench cells
            const benchCells = document.querySelectorAll('#benched-list .roster-cell.player-filled');
            for (const cell of benchCells) {
                const nameDiv = cell.querySelector('.player-name');
                if (nameDiv && nameDiv.dataset.discordName) {
                    // Find the player data for this cell
                    let playerData = currentRosterData.bench?.find(p => p && p.name === nameDiv.dataset.discordName);
                    if (playerData) {
                        const dropdownDiv = cell.querySelector('.player-details-dropdown');
                        if (dropdownDiv) {
                            dropdownDiv.innerHTML = await buildDropdownContent(playerData, true);
                        }
                    }
                }
            }

            // Re-attach dropdown listeners to all cells
            document.querySelectorAll('.roster-cell.player-filled').forEach(cell => {
                this.attachDropdownListeners(cell);
            });
        },

        // Attach event listeners to a specific cell
        attachCellEventListeners(cell) {
            if (!cell.classList.contains('player-filled')) return cell;

            // Remove existing listeners by cloning the node
            const newCell = cell.cloneNode(true);
            if (cell.parentNode) {
                cell.parentNode.replaceChild(newCell, cell);
            } else {
                console.warn('Cell has no parent node, cannot replace');
                return cell;
            }

            // Add click listener for dropdown (suppressed if drag just ended)
            newCell.addEventListener('click', (e) => {
                e.stopPropagation();
                // Suppress dropdown if a drag operation just ended within 100ms
                if (isDragging || (Date.now() - dragEndTimestamp) < 100) return;
                const dropdown = newCell.querySelector('.player-details-dropdown');
                document.querySelectorAll('.player-details-dropdown').forEach(d => {
                    if (d !== dropdown) d.classList.remove('show');
                });
                dropdown.classList.toggle('show');
                if (dropdown.classList.contains('show')) {
                    positionDropdownSmart(newCell, dropdown);
                }
            });

            // Add listeners for dropdown actions
            this.attachDropdownListeners(newCell);
            
            // Attach placeholder-specific actions
            const addDiscordIdItem = newCell.querySelector('[data-action="add-discord-id"]');
            if (addDiscordIdItem) {
                addDiscordIdItem.addEventListener('click', (e) => {
                    const { partyId, slotId } = e.currentTarget.dataset;
                    const player = currentRosterData.raidDrop?.find(p => 
                        p && p.partyId === parseInt(partyId) && p.slotId === parseInt(slotId)
                    );
                    if (player) openAddDiscordIdModal(player);
                });
            }
            
            const removePlaceholderItem = newCell.querySelector('[data-action="remove-placeholder"]');
            if (removePlaceholderItem) {
                removePlaceholderItem.addEventListener('click', (e) => {
                    const { partyId, slotId } = e.currentTarget.dataset;
                    handleRemovePlaceholder(parseInt(partyId), parseInt(slotId));
                });
            }
            
            return newCell; // Return the new cell reference
        },



        // Attach dropdown action listeners
        attachDropdownListeners(cell) {
            // Move player actions
            cell.querySelectorAll('[data-action="move-player"]:not(.disabled)').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid, targetParty, targetSlot } = e.currentTarget.dataset;
                    
                    // Optimistic update
                    const rollbackInfo = this.movePlayerToPosition(userid, targetParty, targetSlot);
                    
                    try {
                        await updatePlayerPosition(eventId, userid, targetParty, targetSlot);
                        // Success - update was already applied optimistically
                        isManaged = true; // Mark roster as managed
                        updateRevertButtonVisibility(); // Show revert button
                        const cell = this.findPlayerCell(userid);
                        if (cell) {
                            cell.classList.add('success-update');
                            setTimeout(() => cell.classList.remove('success-update'), 600);
                        }
                    } catch (error) {
                        // Rollback on error with animation
                        if (rollbackInfo) {
                            rollbackInfo.sourceCell.classList.add('error-rollback');
                            rollbackInfo.targetCell.classList.add('error-rollback');
                            
                            setTimeout(() => {
                                rollbackInfo.sourceCell.innerHTML = rollbackInfo.sourceOriginalContent;
                                rollbackInfo.targetCell.innerHTML = rollbackInfo.targetOriginalContent;
                                this.attachCellEventListeners(rollbackInfo.sourceCell);
                                this.attachCellEventListeners(rollbackInfo.targetCell);
                                
                                setTimeout(() => {
                                    rollbackInfo.sourceCell.classList.remove('error-rollback');
                                    rollbackInfo.targetCell.classList.remove('error-rollback');
                                }, 500);
                            }, 250);
                        }
                        showAlert('Move Error', `Error moving player: ${error.message}`);
                    }
                });
            });

            // Toggle no-assignments actions
            cell.querySelectorAll('[data-action="toggle-no-assignments"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid, currentStatus } = e.currentTarget.dataset;
                    const flag = !(currentStatus === 'true');
                    // Update localStorage flag
                    try {
                        const key = 'noAssignmentsMap';
                        const map = JSON.parse(localStorage.getItem(key) || '{}') || {};
                        if (flag) map[String(userid)] = true; else delete map[String(userid)];
                        localStorage.setItem(key, JSON.stringify(map));
                    } catch {}

                    // Refresh dropdown + styling for this cell
                    const cell = this.findPlayerCell(userid);
                    if (cell) {
                        const isBenched = cell.closest('#benched-list') !== null;
                        const playerData = (currentRosterData.raidDrop || []).find(p => p && p.userid === userid) ||
                                           (currentRosterData.bench || []).find(p => p && p.userid === userid);
                        if (playerData) {
                            const dropdownDiv = cell.querySelector('.player-details-dropdown');
                            if (dropdownDiv) dropdownDiv.innerHTML = await buildDropdownContent(playerData, isBenched);
                            applyNoAssignmentsStyling(cell, playerData);
                            this.attachDropdownListeners(cell);
                        }
                    }
                });
            });

            // Move to bench actions
            cell.querySelectorAll('[data-action="move-to-bench"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid } = e.currentTarget.dataset;
                    
                    showConfirm(
                        'Move to Bench',
                        'Are you sure you want to move this player to the bench?',
                        async () => {
                            // Optimistic update
                            const rollbackInfo = this.moveToBench(userid);
                            
                            try {
                                await movePlayerToBench(eventId, userid);
                                // Success - update was already applied optimistically
                                isManaged = true; // Mark roster as managed
                                updateRevertButtonVisibility(); // Show revert button
                            } catch (error) {
                                // Rollback on error with animation
                                if (rollbackInfo) {
                                    rollbackInfo.sourceCell.classList.add('error-rollback');
                                    
                                    setTimeout(() => {
                                        rollbackInfo.sourceCell.innerHTML = rollbackInfo.originalContent;
                                        rollbackInfo.sourceCell.classList.add('player-filled');
                                        this.attachCellEventListeners(rollbackInfo.sourceCell);
                                        
                                        // Remove from bench
                                        const benchIndex = currentRosterData.bench.findIndex(p => p && p.userid === userid);
                                        if (benchIndex !== -1) {
                                            currentRosterData.bench.splice(benchIndex, 1);
                                        }
                                        currentRosterData.raidDrop.push(rollbackInfo.playerData);
                                        
                                        setTimeout(() => {
                                            rollbackInfo.sourceCell.classList.remove('error-rollback');
                                        }, 500);
                                    }, 250);
                                }
                                showAlert('Bench Error', `Error moving player to bench: ${error.message}`);
                            }
                        }
                    );
                });
            });

            // Swap spec actions
            cell.querySelectorAll('[data-action="swap-spec"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid, specName } = e.currentTarget.dataset;
                    
                    // Optimistic update
                    const rollbackInfo = await this.updatePlayerSpec(userid, specName);
                    
                    try {
                        await updatePlayerSpec(eventId, userid, specName);
                        // Success - update was already applied optimistically (animation handled in updatePlayerSpec)
                        isManaged = true; // Mark roster as managed
                        updateRevertButtonVisibility(); // Show revert button
                    } catch (error) {
                        // Rollback on error with animation
                        if (rollbackInfo) {
                            rollbackInfo.playerData.spec_emote = rollbackInfo.originalSpecEmote;
                            const cell = this.findPlayerCell(userid);
                            if (cell) {
                                cell.classList.add('error-rollback');
                                setTimeout(async () => {
                                    const isBenched = cell.closest('#benched-list') !== null;
                                    const updatedCell = await this.updatePlayerCell(cell, rollbackInfo.playerData, isBenched);
                                    setTimeout(() => {
                                        updatedCell.classList.remove('error-rollback');
                                    }, 500);
                                }, 250);
                            }
                        }
                        showAlert('Spec Error', `Error swapping spec: ${error.message}`);
                    }
                });
            });

            // Toggle in-raid status actions
            cell.querySelectorAll('[data-action="toggle-in-raid"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid, currentStatus } = e.currentTarget.dataset;
                    const newStatus = currentStatus === 'true' ? false : true;
                    
                    try {
                        await togglePlayerInRaid(eventId, userid, newStatus);
                        
                        // Update the player data in our local state
                        const player = currentRosterData.raidDrop.find(p => p && p.userid === userid);
                        if (player) {
                            player.inRaid = newStatus;
                        }
                        
                        // Force dropdown rebuild to show updated status
                        const cell = this.findPlayerCell(userid);
                        if (cell) {
                            const dropdownDiv = cell.querySelector('.player-details-dropdown');
                            if (dropdownDiv) {
                                const isBenched = cell.closest('#benched-list') !== null;
                                const playerData = currentRosterData.raidDrop.find(p => p && p.userid === userid) || 
                                                 currentRosterData.bench?.find(p => p && p.userid === userid);
                                if (playerData) {
                                    dropdownDiv.innerHTML = await buildDropdownContent(playerData, isBenched);
                                    this.attachDropdownListeners(cell);
                                }
                            }
                        }
                        
                        // Apply visual effects for both toggles
                        applyInRaidVisibility();
                        applyConfirmedVisibility();
                        
                        isManaged = true; // Mark roster as managed
                        updateRevertButtonVisibility(); // Show revert button
                    } catch (error) {
                        showAlert('In-Raid Error', `Error toggling in-raid status: ${error.message}`);
                    }
                });
            });

            // Swap character actions
            cell.querySelectorAll('[data-action="swap-char"]:not(.disabled)').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid, altName, altClass } = e.currentTarget.dataset;
                    
                    console.log(`[SWAP_CHAR_CLICK] Swapping to: name="${altName}", class="${altClass}", type=${typeof altClass}`);
                    
                    // Optimistic update
                    const rollbackInfo = await this.updatePlayerCharacter(userid, altName, altClass);
                    
                    try {
                        await updatePlayerCharacter(eventId, userid, altName, altClass);
                        // Success - update was already applied optimistically (animation handled in updatePlayerCharacter)
                        isManaged = true; // Mark roster as managed
                        updateRevertButtonVisibility(); // Show revert button
                    } catch (error) {
                        // Rollback on error with animation
                        if (rollbackInfo) {
                            Object.assign(rollbackInfo.playerData, rollbackInfo.originalData);
                            const cell = this.findPlayerCell(userid);
                            if (cell) {
                                cell.classList.add('error-rollback');
                                setTimeout(async () => {
                                    const isBenched = cell.closest('#benched-list') !== null;
                                    const updatedCell = await this.updatePlayerCell(cell, rollbackInfo.playerData, isBenched);
                                    setTimeout(() => {
                                        updatedCell.classList.remove('error-rollback');
                                    }, 500);
                                }, 250);
                            }
                        }
                        showAlert('Character Swap Error', `Error swapping character: ${error.message}`);
                    }
                });
            });

            // Fix name action
            cell.querySelectorAll('[data-action="fix-name"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid } = e.currentTarget.dataset;
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userid) || currentRosterData.bench?.find(p => p && p.userid === userid);
                    if (!player) return;
                    openFixNameOverlay(player);
                });
            });

            // Replace assignments action
            cell.querySelectorAll('[data-action="replace-assignments"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid } = e.currentTarget.dataset;
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userid) || currentRosterData.bench?.find(p => p && p.userid === userid);
                    if (!player) return;
                    openReplaceAssignmentsOverlay(player);
                });
            });

            // Prompt for confirmation action
            cell.querySelectorAll('[data-action="prompt-confirmation"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid } = e.currentTarget.dataset;
                    try {
                        const r = await fetch('/api/discord/prompt-confirmation', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: userid, eventId })
                        });
                        if (!r.ok) {
                            const t = await r.text();
                            console.error('Prompt confirmation failed:', t);
                            alert('Failed to send prompt');
                        } else {
                            alert('Prompt sent');
                        }
                    } catch (err) {
                        console.error(err);
                        alert('Failed to send prompt');
                    }
                });
            });

            // Prompt for invite action
            cell.querySelectorAll('[data-action="prompt-invite"]').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const { userid } = e.currentTarget.dataset;
                    try {
                        const cellEl = this.findPlayerCell(userid);
                        const nameDiv = cellEl ? cellEl.querySelector('.player-name') : null;
                        const characterName = nameDiv && nameDiv.dataset && nameDiv.dataset.characterName ? nameDiv.dataset.characterName : null;
                        let invitePerson = null;
                        try { invitePerson = localStorage.getItem('lastInvitePerson') || null; } catch {}
                        if (!invitePerson) {
                            const entered = window.prompt('Enter the name of the person doing invites:');
                            if (!entered || !entered.trim()) return;
                            invitePerson = entered.trim();
                            try { localStorage.setItem('lastInvitePerson', invitePerson); } catch {}
                        }
                        const r = await fetch('/api/discord/prompt-invite', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: userid, eventId, characterName, invitePerson })
                        });
                        if (!r.ok) {
                            const t = await r.text();
                            console.error('Prompt invite failed:', t);
                            alert('Failed to send invite prompt');
                        } else {
                            alert('Invite prompt sent');
                        }
                    } catch (err) {
                        console.error(err);
                        alert('Failed to send invite prompt');
                    }
                });
            });

            // Show player data page — open admin profile in new tab
            cell.querySelectorAll('[data-action="show-player-page"]').forEach(item => {
                item.addEventListener('click', (e) => {
                    const { userid } = e.currentTarget.dataset;
                    if (userid) window.open('/admin/player/' + userid, '_blank');
                });
            });
        }
    };

    // ===== Drag-and-Drop via SortableJS =====

    /** Track active Sortable instances for cleanup on re-render */
    let sortableInstances = [];

    /** Drag state flag to prevent click-handler from opening dropdown after a drag */
    let isDragging = false;
    let dragEndTimestamp = 0;

    /**
     * Initializes SortableJS drag-and-drop on all roster columns and bench columns.
     * Only called when currentUserCanManage is true.
     * Destroys previous instances before creating new ones (safe for re-renders).
     */
    function initDragAndDrop() {
        // Gate behind management permission
        if (!currentUserCanManage) return;

        // Destroy previous instances
        sortableInstances.forEach(instance => {
            try { instance.destroy(); } catch (_) {}
        });
        sortableInstances = [];

        // Mount Swap plugin (included in SortableJS full CDN build)
        try {
            if (Sortable.Plugins && Sortable.Plugins.Swap) {
                Sortable.mount(new Sortable.Plugins.Swap());
            } else if (typeof Swap !== 'undefined') {
                Sortable.mount(new Swap());
            }
        } catch (_) { /* already mounted */ }

        const sharedConfig = {
            group: { name: 'roster', pull: true, put: true },
            draggable: '.roster-cell',      // All cells draggable (filled + empty) so empty slots are valid targets
            filter: '.empty-slot-clickable', // Empty slots can't be PICKED UP, only dropped onto
            preventOnFilter: false,
            animation: 150,
            delay: 150,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            ghostClass: 'drag-ghost',
            chosenClass: 'drag-chosen',
            dragClass: 'drag-active',
            swap: true,                     // Swap plugin: drop ON a cell = swap/move, not insert
            swapClass: 'drag-swap-target',  // Green highlight on drop target
            invertSwap: true,               // Snap to swap (not insert gap) across full cell height
            onStart: function (evt) {
                // Only allow dragging filled cells — cancel if empty slot is somehow grabbed
                if (evt.item.classList.contains('empty-slot-clickable')) {
                    evt.cancel ? evt.cancel() : (evt.item.style.display = '');
                }
                isDragging = true;
            },
            onEnd: function (evt) {
                isDragging = false;
                dragEndTimestamp = Date.now();
                handleDragEnd(evt);
            }
        };

        // Create Sortable for each roster column
        document.querySelectorAll('.roster-column').forEach(col => {
            col.classList.add('sortable-enabled');
            const instance = new Sortable(col, { ...sharedConfig });
            sortableInstances.push(instance);
        });

        // Create Sortable for each bench class column
        // emptyInsertThreshold allows drops into empty bench columns (no player cells present)
        document.querySelectorAll('.bench-class-column').forEach(col => {
            col.classList.add('sortable-enabled');
            const instance = new Sortable(col, { ...sharedConfig, emptyInsertThreshold: 40 });
            sortableInstances.push(instance);
        });
    }

    /**
     * Handles the end of a drag operation. Reads data attributes from source/target
     * to determine the operation (swap, move, bench) and calls the appropriate API.
     *
     * IMPORTANT: SortableJS has already moved the DOM node by the time onEnd fires.
     * We revert the DOM move immediately and let OptimisticUpdates handle the visual
     * update, ensuring data consistency with the existing optimistic update system.
     *
     * @param {Sortable.SortableEvent} evt - The SortableJS onEnd event
     */
    function handleDragEnd(evt) {
        const draggedEl = evt.item;
        const fromContainer = evt.from;
        const toContainer = evt.to;

        // Capture ALL IDs immediately from the DOM — before SortableJS modifies anything further
        const userid = draggedEl.dataset.userid;
        const fromIsBench = fromContainer.classList.contains('bench-class-column');
        const toIsBench = toContainer.classList.contains('bench-class-column');

        // Capture source slot/party (draggedEl's original position)
        const sourcePartyId = fromContainer.dataset.partyId;
        const sourceSlotId = draggedEl.dataset.slotId ? parseInt(draggedEl.dataset.slotId, 10) : null;

        const targetPartyId = toContainer.dataset.partyId;

        // swapItem = the cell at the drop target (filled player OR empty slot)
        const swapItem = evt.swapItem;
        // Capture target slot from swapItem BEFORE anything changes
        const targetSlotId = swapItem?.dataset?.slotId
            ? parseInt(swapItem.dataset.slotId, 10)
            : getTargetSlotId(toContainer, evt.newIndex);



        // No-op: same slot (dropped on self or nothing changed)
        if (fromContainer === toContainer && swapItem === draggedEl) return;
        if (fromContainer === toContainer && !swapItem && evt.oldIndex === evt.newIndex) return;
        if (!userid) return;

        // Ignore if dragged element is an empty slot
        if (draggedEl.classList.contains('empty-slot-clickable')) return;

        // SortableJS has already visually moved the elements.
        // After success: update data attributes so subsequent drags read correct IDs.
        // After failure: re-render to rollback.

        const updateDataAttrs = () => {
            // draggedEl is now in toContainer at target position — update its slot/party
            if (targetSlotId) draggedEl.dataset.slotId = targetSlotId;
            if (targetPartyId) draggedEl.dataset.partyId = targetPartyId;
            // swapItem is now in fromContainer at source position — update its slot/party
            if (swapItem && swapItem.classList.contains('player-filled')) {
                if (sourceSlotId) swapItem.dataset.slotId = sourceSlotId;
                if (sourcePartyId) swapItem.dataset.partyId = sourcePartyId;
            }
        };

        if (!fromIsBench && toIsBench) {
            // Raid → Bench
            if (swapItem && swapItem.dataset.userid && !swapItem.classList.contains('empty-slot-clickable')) {
                // Dropped ONTO a bench player → swap: bench player takes raid slot, raid player goes to bench
                // Call updatePlayerPosition for the bench player to move them to the freed raid slot.
                // Server will auto-bench the occupant (raid player) since they're currently there.
                const benchPlayerUserId = swapItem.dataset.userid;
                executeDragSimple(async () => {
                    await updatePlayerPosition(eventId, benchPlayerUserId, sourcePartyId, sourceSlotId);
                }, () => {
                    // Update bench player's data attrs (now in raid slot)
                    swapItem.dataset.slotId = sourceSlotId;
                    swapItem.dataset.partyId = sourcePartyId;
                    // Clean up empty slots that may have ended up in bench columns
                    cleanupBenchDom();
                    initDragAndDrop();
                });
            } else {
                // Dropped onto empty bench area → just bench the raid player
                executeDragSimple(async () => {
                    await movePlayerToBench(eventId, userid);
                }, () => {
                    cleanupBenchDom();
                    initDragAndDrop();
                });
            }
        } else if (fromIsBench && !toIsBench) {
            // Bench → Raid
            if (!targetPartyId || !targetSlotId) return;
            executeDragSimple(async () => {
                await updatePlayerPosition(eventId, userid, targetPartyId, targetSlotId);
            }, () => {
                // Update the bench player's data attrs (now a raid slot)
                draggedEl.dataset.slotId = targetSlotId;
                draggedEl.dataset.partyId = targetPartyId;
                // Clean up any empty-slot cells that landed in the bench
                cleanupBenchDom();
                initDragAndDrop();
            });
        } else if (!fromIsBench && !toIsBench) {
            // Raid → Raid (move or swap)
            if (!targetPartyId || !targetSlotId) return;
            executeDragSimple(async () => {
                await updatePlayerPosition(eventId, userid, targetPartyId, targetSlotId);
            }, updateDataAttrs); // pass callback to update data attrs on success
        }
        // Bench → Bench: no-op
    }

    /**
     * Removes empty-slot cells and other stray raid-DOM elements from bench columns.
     * Called after bench drag operations to keep bench clean without a full re-render.
     */
    function cleanupBenchDom() {
        document.querySelectorAll('.bench-class-column').forEach(col => {
            // Remove empty-slot-clickable cells (they belong in raid columns only)
            col.querySelectorAll('.empty-slot-clickable').forEach(el => el.remove());
            // Update empty-class state
            const hasBenchPlayers = col.querySelectorAll('.roster-cell.player-filled[data-bench="true"]').length > 0
                || col.querySelectorAll('.roster-cell.player-filled:not([data-slot-id])').length > 0;
            col.classList.toggle('empty-class', !hasBenchPlayers);
        });
    }

    /**
     * Executes a drag API call. On success/failure, re-renders the roster to sync DOM.
     * SortableJS already shows the visual result; re-render confirms or rolls back.
     */
    async function executeDragSimple(apiFn, onSuccessCallback) {
        try {
            await apiFn();
            // Success — SortableJS already shows the correct visual state
            isManaged = true;
            updateRevertButtonVisibility();
            if (onSuccessCallback) {
                onSuccessCallback(); // e.g. update data-slot-id / data-party-id attrs
            } else {
                // No callback = bench involved, re-render to sync bench HTML
                try { await renderRoster(); } catch (_) {}
            }
        } catch (error) {

            showAlert('Move Error', `Error moving player: ${error.message}`);
            // Failure — re-render to rollback to actual server state
            try { await renderRoster(); } catch (_) {}
        }
    }

    /**
     * Determines the target slot ID based on drop index within a roster column.
     * Accounts for the party-name header element at index 0.
     *
     * @param {HTMLElement} column - The roster column container
     * @param {number} newIndex - SortableJS newIndex (within draggable elements)
     * @returns {number|null} The 1-indexed slot ID, or null if invalid
     */
    function getTargetSlotId(column, newIndex) {
        // SortableJS newIndex is relative to draggable items (.player-filled only)
        // but we need slot position including empty slots
        const allCells = column.querySelectorAll('.roster-cell');
        if (newIndex >= 0 && newIndex < allCells.length) {
            const targetCell = allCells[newIndex];
            if (targetCell && targetCell.dataset.slotId) {
                return parseInt(targetCell.dataset.slotId, 10);
            }
        }
        // Fallback: if dropped past the end, use the last slot
        if (allCells.length > 0) {
            const lastCell = allCells[allCells.length - 1];
            if (lastCell && lastCell.dataset.slotId) {
                return parseInt(lastCell.dataset.slotId, 10);
            }
        }
        return null;
    }

    /**
     * Executes a drag-to-raid move (raid→raid or bench→raid).
     * Uses OptimisticUpdates.movePlayerToPosition for instant UI and rollback.
     */
    async function executeDragToRaid(userid, targetPartyId, targetSlotId, isFromBench) {
        const rollbackInfo = OptimisticUpdates.movePlayerToPosition(userid, parseInt(targetPartyId), parseInt(targetSlotId));

        try {
            await updatePlayerPosition(eventId, userid, targetPartyId, targetSlotId);
            // Success
            isManaged = true;
            updateRevertButtonVisibility();

            // Flash success on the target cell after optimistic update settles
            setTimeout(() => {
                const cell = OptimisticUpdates.findPlayerCell(userid);
                if (cell) {
                    cell.classList.add('success-update');
                    setTimeout(() => cell.classList.remove('success-update'), 600);
                }
            }, 200);
        } catch (error) {
            // Rollback on error
            if (rollbackInfo) {
                if (rollbackInfo.sourceCell) rollbackInfo.sourceCell.classList.add('error-rollback');
                rollbackInfo.targetCell.classList.add('error-rollback');

                setTimeout(() => {
                    if (rollbackInfo.sourceCell) {
                        rollbackInfo.sourceCell.innerHTML = rollbackInfo.sourceOriginalContent;
                        OptimisticUpdates.attachCellEventListeners(rollbackInfo.sourceCell);
                    }
                    rollbackInfo.targetCell.innerHTML = rollbackInfo.targetOriginalContent;
                    OptimisticUpdates.attachCellEventListeners(rollbackInfo.targetCell);

                    setTimeout(() => {
                        if (rollbackInfo.sourceCell) rollbackInfo.sourceCell.classList.remove('error-rollback');
                        rollbackInfo.targetCell.classList.remove('error-rollback');
                    }, 500);
                }, 250);
            }
            showAlert('Move Error', `Error moving player: ${error.message}`);
        }
    }

    /**
     * Executes a drag-to-bench move (raid→bench).
     * Uses OptimisticUpdates.moveToBench for instant UI and rollback.
     * Skips the confirmation dialog that the dropdown menu uses.
     */
    async function executeDragToBench(userid) {
        const rollbackInfo = OptimisticUpdates.moveToBench(userid);

        try {
            await movePlayerToBench(eventId, userid);
            // Success
            isManaged = true;
            updateRevertButtonVisibility();
        } catch (error) {
            // Rollback on error
            if (rollbackInfo) {
                rollbackInfo.sourceCell.classList.add('error-rollback');

                setTimeout(() => {
                    rollbackInfo.sourceCell.innerHTML = rollbackInfo.originalContent;
                    rollbackInfo.sourceCell.classList.add('player-filled');
                    OptimisticUpdates.attachCellEventListeners(rollbackInfo.sourceCell);

                    // Remove from bench data
                    const benchIndex = currentRosterData.bench.findIndex(p => p && p.userid === userid);
                    if (benchIndex !== -1) {
                        currentRosterData.bench.splice(benchIndex, 1);
                    }
                    currentRosterData.raidDrop.push(rollbackInfo.playerData);

                    setTimeout(() => {
                        rollbackInfo.sourceCell.classList.remove('error-rollback');
                    }, 500);
                }, 250);
            }
            showAlert('Bench Error', `Error moving player to bench: ${error.message}`);
        }
    }

    /**
     * Re-attaches event listeners on cells affected by a drag operation.
     * Called after every drag end (success or cancel).
     */
    function reattachAfterDrag(draggedEl, fromContainer, toContainer) {
        // Re-attach listeners on the dragged element
        if (draggedEl.classList.contains('player-filled')) {
            OptimisticUpdates.attachCellEventListeners(draggedEl);
        } else if (draggedEl.classList.contains('empty-slot-clickable')) {
            attachEmptySlotListeners(draggedEl);
        }

        // Re-attach on any empty slots that may have been affected
        [fromContainer, toContainer].forEach(container => {
            if (!container) return;
            container.querySelectorAll('.roster-cell.empty-slot-clickable').forEach(cell => {
                attachEmptySlotListeners(cell);
            });
        });
    }

    try {
        // Determine user management role to gate UI/menus
        try {
            const uRes = await fetch('/user');
            if (uRes && uRes.ok) {
                const u = await uRes.json();
                const canRoster = !!(u && u.permissions && (u.permissions.canManageRoster || u.permissions.canManage));
                const isMgmt = !!(u && u.hasManagementRole);
                const isHelper = !!(u && u.hasHelperRole);
                currentUserCanManage = !!(u && u.loggedIn && (canRoster || isMgmt || isHelper));
            }
        } catch {}

        // Show management-only sections for management users
        if (currentUserCanManage) {
            try {
                // Hide old button-panel — we move controls to sidebar
                const btnPanel = document.querySelector('.button-panel');
                if (btnPanel) btnPanel.style.display = 'none';

                if (benchContainer) {
                    benchContainer.classList.add('bench-visible');
                }
                const statsSection = document.querySelector('.stats-section');
                if (statsSection) statsSection.style.display = '';
                const hostLiveBtn = document.getElementById('host-live-button');
                if (hostLiveBtn) hostLiveBtn.style.display = '';

                // Create admin sidebar
                createAdminSidebar();
            } catch {}
        }

        const response = await fetch('/api/specs');
        specData = await response.json();
    } catch (error) {
        console.error('Failed to load spec data:', error);
    }

    async function renderRoster() {
        // Keep roster page title text empty
        if (rosterEventTitle) rosterEventTitle.textContent = '';
        try {
            const rosterData = await fetchRoster(eventId);

            if (!rosterData || !rosterData.raidDrop) {
                throw new Error("Invalid or empty roster data received from server.");
            }

            currentRosterData = rosterData;
            isManaged = rosterData.isManaged;

            updateRevertButtonVisibility();
            await renderGrid(rosterData);
            await renderBench(rosterData.bench || []);
            setupEventListeners();
            setupToggleSwitches();
            setupNameToggle();
            setupHideInRaidToggle();
            setupHideBenchToggle();
            setupHideConfirmedToggle();
            setupPlayerSearchModal();
            setupFixNameModal();
            setupPlaceholderModals();
            wireRaidleaderControls();
            await prefetchPlayersDb();
            await applyDbMismatchStyling();
            
            // Apply all visibility effects after roster is rendered
            setTimeout(() => {
                applyInRaidVisibility();
                applyConfirmedVisibility();
            }, 100);

            // Update stats dashboard cards (Assignments comparison)
            updateAssignmentsStat().catch(()=>{});
            updatePlayersStat().catch(()=>{});
            updateRosterStat().catch(()=>{});
            updateRaidleaderStat().catch(()=>{});
            updateInvitesByStat().catch(()=>{});
            updateInvitesStartedStat().catch(()=>{});

            // Initialize drag-and-drop after all rendering and listeners are set up
            initDragAndDrop();
        } catch (error) {
            console.error('roster.js: A critical error occurred during renderRoster:', error);
            const rosterGrid = document.getElementById('roster-grid');
            rosterGrid.innerHTML = `<div style="color: #ffcccc; background-color: #3e2727; border: 1px solid #d32f2f; padding: 15px; border-radius: 5px;">
                <h3 style="margin-top: 0;">Error Rendering Roster</h3>
                <p>${error.message}</p>
                <pre style="white-space: pre-wrap; word-wrap: break-word;">${error.stack}</pre>
            </div>`;
        }
    }

    async function updateAssignmentsStat() {
        const valEl = document.getElementById('stat-assignments');
        const detailEl = document.getElementById('stat-assignments-detail');
        const cardEl = document.querySelector('.stat-card.assignments');
        if (!valEl || !cardEl) return;
        try {
            // Load assignments panels
            const aRes = await fetch(`/api/assignments/${encodeURIComponent(eventId)}`);
            if (!aRes.ok) throw new Error('Failed to load assignments');
            const aData = await aRes.json();
            const panels = Array.isArray(aData?.panels) ? aData.panels : [];
            const namesFromAssignments = new Map(); // lower -> display
            for (const p of panels) {
                const entries = Array.isArray(p?.entries) ? p.entries : [];
                for (const e of entries) {
                    const nm = String(e?.character_name || '').trim();
                    if (!nm) continue;
                    const lower = nm.toLowerCase();
                    if (!namesFromAssignments.has(lower)) namesFromAssignments.set(lower, nm);
                }
            }

            // If no assignment names exist at all, show Waiting state
            if (namesFromAssignments.size === 0) {
                valEl.textContent = 'Waiting';
                valEl.style.color = '#fbbf24'; // yellow
                if (detailEl) { detailEl.textContent = ''; }
                cardEl.title = 'No assignments created yet';
                return;
            }

            // Load roster names from DB
            const rRes = await fetch(`/api/assignments/${encodeURIComponent(eventId)}/roster`);
            if (!rRes.ok) throw new Error('Failed to load roster');
            const rData = await rRes.json();
            const rosterRows = Array.isArray(rData?.roster) ? rData.roster : [];
            const namesFromRoster = new Map(); // lower -> display
            for (const row of rosterRows) {
                const nm = String(row?.character_name || '').trim();
                if (!nm) continue;
                const lower = nm.toLowerCase();
                if (!namesFromRoster.has(lower)) namesFromRoster.set(lower, nm);
            }

            // Compute mismatches
            const onlyInAssignments = [];
            for (const [lower, disp] of namesFromAssignments.entries()) {
                if (!namesFromRoster.has(lower)) onlyInAssignments.push(disp);
            }
            const onlyInRoster = [];
            for (const [lower, disp] of namesFromRoster.entries()) {
                if (!namesFromAssignments.has(lower)) onlyInRoster.push(disp);
            }

            const matched = onlyInAssignments.length === 0 && onlyInRoster.length === 0;
            valEl.textContent = matched ? 'Matched' : 'Failed';
            valEl.style.color = matched ? '#22c55e' : '#ef4444';
            if (detailEl) {
                if (matched) {
                    detailEl.textContent = '';
                    cardEl.title = 'All assignment names match the roster';
                } else {
                    const fmt = (arr)=> (arr.length? arr.sort((a,b)=>a.localeCompare(b)).join(', ') : '(none)');
                    const html = `<div><strong>Only in assignments:</strong> ${fmt(onlyInAssignments)}</div><div style="margin-top:6px;"><strong>Only in roster:</strong> ${fmt(onlyInRoster)}</div>`;
                    detailEl.innerHTML = html;
                    cardEl.title = '';
                }
            }
        } catch (e) {
            valEl.textContent = 'Failed';
            valEl.style.color = '#ef4444';
            if (detailEl) detailEl.textContent = 'Error comparing names';
        }
    }

    async function updateRosterStat() {
        const valEl = document.getElementById('stat-roster');
        const detailEl = document.getElementById('stat-roster-detail');
        if (!valEl) return;
        try {
            // Only groups 1-8 (exclude bench)
            const rosterPlayers = (currentRosterData.raidDrop || []).filter(p => p && p.userid);

            // Ensure DB cache ready for all
            const fetches = [];
            for (const p of rosterPlayers) {
                if (playersDbCache[p.userid] === undefined) fetches.push(fetchDbCharactersForUser(p.userid));
            }
            if (fetches.length) { try { await Promise.all(fetches); } catch {} }

            let confirmedCount = 0;
            let notMatchedCount = 0;
            for (const p of rosterPlayers) {
                if (p.isConfirmed === true || p.isConfirmed === 'confirmed') confirmedCount += 1;
                try { if (!doesPlayerExistInDbCached(p)) notMatchedCount += 1; } catch {}
            }
            const notConfirmedCount = Math.max(0, rosterPlayers.length - confirmedCount);

            // Value shows total roster size
            valEl.textContent = String(rosterPlayers.length);
            if (detailEl) {
                detailEl.innerHTML = `<div><strong>Confirmed</strong>: ${confirmedCount}</div><div><strong>Not confirmed</strong>: ${notConfirmedCount}</div><div class="cat-notmatched"><strong>Not matched</strong>: ${notMatchedCount}</div>`;
            }
        } catch (e) {
            // Leave previous content on error
        }
    }

    async function updateRaidleaderStat() {
        const valEl = document.getElementById('stat-raidleader');
        if (!valEl) return;
        try {
            const meta = await getEventRaidleader(eventId);
            const name = meta && meta.raidleaderName ? meta.raidleaderName : '';
            valEl.textContent = name || '-';
        } catch { valEl.textContent = '-'; }
    }

    async function updateInvitesByStat() {
        const valEl = document.getElementById('stat-invites');
        if (!valEl) return;
        let name = '';
        try { name = localStorage.getItem(`invitesBy:${eventId}`) || ''; } catch {}
        valEl.textContent = name || '-';
    }

    async function updateInvitesStartedStat() {
        const valEl = document.getElementById('stat-invites-started');
        const detailEl = document.getElementById('stat-invites-started-detail');
        if (!valEl) return;
        try {
            let info = null;
            try { info = JSON.parse(localStorage.getItem(`invitesStarted:${eventId}`) || 'null'); } catch {}
            const started = !!(info && info.started);
            const by = (info && info.by) ? String(info.by) : '';
            valEl.textContent = started ? 'Yes' : 'No';
            if (detailEl) {
                detailEl.textContent = started && by ? `(${by})` : '';
            }
        } catch {
            valEl.textContent = 'No';
            if (detailEl) detailEl.textContent = '';
        }
    }

    async function updatePlayersStat() {
        const valEl = document.getElementById('stat-players');
        const detailEl = document.getElementById('stat-players-detail');
        const cardEl = document.querySelector('.stat-card.players');
        if (!valEl) return;
        try {
            // Collect roster user IDs (only groups 1-8; exclude bench)
            const userIdSet = new Set();
            (currentRosterData.raidDrop || []).forEach(p => { if (p && p.userid) userIdSet.add(String(p.userid)); });
            const rosterUserIds = Array.from(userIdSet);
            const rosterUsersSet = new Set(rosterUserIds);

            // Guildies via /api/guild-members
            let guildiesCount = 0;
            let guildiesList = [];
            try {
                const gRes = await fetch('/api/guild-members');
                if (gRes.ok) {
                    const gData = await gRes.json();
                    const mems = Array.isArray(gData?.members) ? gData.members : [];
                    const guildIdSet = new Set(mems.map(m => String(m.discord_id || m.discordId || '').trim()).filter(Boolean));
                    const list = rosterUserIds.filter(id => guildIdSet.has(String(id)));
                    guildiesCount = list.length;
                    guildiesList = list;
                }
            } catch {}

            // Attendance via /api/attendance (use the same structure as attendance page)
            let regularsCount = 0;
            let firstTimeCount = 0;
            let regularsList = [];
            let firstTimeList = [];
            try {
                const aRes = await fetch('/api/attendance');
                if (aRes.ok) {
                    const result = await aRes.json();
                    if (result && result.success && result.data) {
                        const { weeks = [], attendance = {} } = result.data;
                        // last 12 weeks from provided ordered weeks array
                        const last12 = weeks.slice(-12);
                        const last12Keys = last12.map(w => `${w.weekYear}-${w.weekNumber}`);
                        const allKeys = weeks.map(w => `${w.weekYear}-${w.weekNumber}`);

                        // DB mismatch (red outline) users should also be counted as first time
                        const mismatchSet = new Set();
                        const pushMismatch = (p)=>{ if(!p||!p.userid) return; try{ if(!doesPlayerExistInDbCached(p)) mismatchSet.add(String(p.userid)); }catch{} };
                        (currentRosterData.raidDrop||[]).forEach(pushMismatch); // only groups 1-8

                        for (const uid of rosterUserIds) {
                            const uidStr = String(uid);
                            const userWeeks = attendance[uidStr] || {};
                            // Count hits in last 12
                            let hits = 0;
                            for (const key of last12Keys) {
                                const arr = userWeeks[key];
                                if (Array.isArray(arr) && arr.length > 0) hits += 1;
                            }
                            if (hits >= 3) { regularsCount += 1; regularsList.push(uidStr); }
                            // Ever attended (any week in dataset)
                            let ever = false;
                            for (const key of allKeys) {
                                const arr = userWeeks[key];
                                if (Array.isArray(arr) && arr.length > 0) { ever = true; break; }
                            }
                            if (!ever || mismatchSet.has(uidStr)) { firstTimeCount += 1; firstTimeList.push(uidStr); }
                        }
                    }
                }
            } catch {}

            // Render card with colored pills
            valEl.innerHTML = `<span class="stat-pill pill-regulars">${regularsCount}</span> / <span class="stat-pill pill-guildies">${guildiesCount}</span> / <span class="stat-pill pill-first">${firstTimeCount}</span>`;
            if (detailEl) {
                detailEl.innerHTML = `<div class="cat-regulars"><strong>Regulars</strong>: ${regularsCount}</div><div class="cat-guildies"><strong>Guildies</strong>: ${guildiesCount}</div><div class="cat-first"><strong>First time</strong>: ${firstTimeCount}</div>`;
            }

            // Build tooltip content lists by resolving current roster display names for userIds
            const userIdToName = new Map();
            const pushName = (p)=>{ if(!p||!p.userid) return; const disp = p.mainCharacterName||p.assigned_char_name||p.character_name||p.name||p.userid; userIdToName.set(String(p.userid), String(disp)); };
            (currentRosterData.raidDrop||[]).forEach(pushName); // only groups 1-8
            const listHtmlGrid = (arr)=>{
                const uniq = Array.from(new Set(arr.map(id=> userIdToName.get(String(id)) || String(id))));
                if (!uniq.length) return '<div class="grid-list"><div class="grid-item">None</div></div>';
                const items = uniq.sort((a,b)=>a.localeCompare(b)).map(n=>`<div class="grid-item">${n}</div>`).join('');
                return `<div class="grid-list">${items}</div>`;
            };

            // Setup hover tooltip with 1s delay
            if (cardEl) {
                let tt=null, timer=null;
                const ensureTooltip = ()=>{
                    if (tt) return tt;
                    tt = document.createElement('div');
                    tt.className = 'players-tooltip';
                    document.body.appendChild(tt);
                    return tt;
                };
                const showAt = (x,y)=>{
                    const el = ensureTooltip();
                    el.innerHTML = `<div class=\"cat-regulars\"><h4>Regulars (${regularsCount})</h4><div class=\"list\">${listHtmlGrid(regularsList)}</div></div><div class=\"cat-guildies\"><h4>Guildies (${guildiesCount})</h4><div class=\"list\">${listHtmlGrid(guildiesList)}</div></div><div class=\"cat-first\"><h4>First time (${firstTimeCount})</h4><div class=\"list\">${listHtmlGrid(firstTimeList)}</div></div>`;
                    const pad=12; el.style.left = (x+pad)+'px'; el.style.top=(y+pad)+'px';
                    requestAnimationFrame(()=> el.classList.add('show'));
                };
                const hide = ()=>{ if (!tt) return; tt.classList.remove('show'); };
                const onMove = (e)=>{ if (tt && tt.classList.contains('show')) { tt.style.left=(e.clientX+12)+'px'; tt.style.top=(e.clientY+12)+'px'; } };
                cardEl.addEventListener('mouseenter', (e)=>{ clearTimeout(timer); timer = setTimeout(()=> showAt(e.clientX, e.clientY), 1000); });
                cardEl.addEventListener('mousemove', onMove);
                cardEl.addEventListener('mouseleave', ()=>{ clearTimeout(timer); hide(); });
            }
        } catch (e) {
            valEl.textContent = 'N/A';
            if (detailEl) detailEl.textContent = 'Failed to load player stats';
        }
    }

    async function renderGrid(rosterData) {
        const { raidDrop, partyPerRaid, slotPerParty, partyNames, title } = rosterData;
            rosterGrid.style.gridTemplateColumns = ''; // Controlled by CSS (8 or 4 cols breakpoint)
            rosterGrid.innerHTML = '';

            const rosterMatrix = Array(partyPerRaid).fill(null).map(() => Array(slotPerParty).fill(null));
        raidDrop.forEach(p => {
            if (p && p.partyId >= 1 && p.partyId <= partyPerRaid && p.slotId >= 1 && p.slotId <= slotPerParty) {
                rosterMatrix[p.partyId - 1][p.slotId - 1] = p;
                }
            });

            for (let i = 0; i < partyPerRaid; i++) {
                const columnDiv = document.createElement('div');
                columnDiv.classList.add('roster-column');
                columnDiv.dataset.partyId = String(i + 1);
            const partyNameText = (partyNames && partyNames[i]) ? partyNames[i] : `Group ${i + 1}`;
                    const partyName = document.createElement('div');
                    partyName.classList.add('party-name');
            partyName.textContent = partyNameText;
                    columnDiv.appendChild(partyName);

                for (let j = 0; j < slotPerParty; j++) {
                    const player = rosterMatrix[i][j];

                    if (player && player.name) {
                        // Use createPlayerCell to handle both regular and placeholder players
                        const cellDiv = await createPlayerCell(player, false, false);
                        cellDiv.dataset.slotId = String(j + 1);
                        cellDiv.dataset.userid = player.userid || '';
                        columnDiv.appendChild(cellDiv);
                    } else {
                        // Empty slot - make it clickable with "Add new character" option
                        const cellDiv = document.createElement('div');
                        cellDiv.classList.add('roster-cell', 'empty-slot-clickable');
                        cellDiv.dataset.slotId = String(j + 1);
                        cellDiv.dataset.userid = '';
                        const emptyDropdownContent = buildEmptySlotDropdownContent(i + 1, j + 1);
                        cellDiv.innerHTML = `
                            <div class="player-name">Empty</div>
                            <div class="player-details-dropdown">${emptyDropdownContent}</div>`;
                        columnDiv.appendChild(cellDiv);
                    }
                }
                rosterGrid.appendChild(columnDiv);
            }

        // Do not render a header title on the roster page
        if (rosterEventTitle) rosterEventTitle.textContent = '';
        // This is now called from renderRoster
        // setupEventListeners();
    }

    /** Class ordering for bench columns */
    const BENCH_CLASS_ORDER = ['warrior', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid']; // No paladin — Horde only

    async function renderBench(benchData) {
        if (!currentUserCanManage) {
            benchContainer.style.display = 'none';
            return;
        }
        if (benchData.length > 0) {
            benchContainer.style.display = 'block';
            benchedList.innerHTML = '';

            const discordAbsentEmoji = "612343589070045200";

            // Group bench players by canonical class
            const classBuckets = {};
            BENCH_CLASS_ORDER.forEach(cls => { classBuckets[cls] = []; });

            benchData.forEach(player => {
                const canonical = getCanonicalClass(player.class);
                if (!classBuckets[canonical]) classBuckets[canonical] = [];
                classBuckets[canonical].push(player);
            });

            // Sort each bucket: real spec icons first, absent emoji last
            Object.values(classBuckets).forEach(bucket => {
                bucket.sort((a, b) => {
                    const aAbs = a.spec_emote === discordAbsentEmoji;
                    const bAbs = b.spec_emote === discordAbsentEmoji;
                    if (!aAbs && bAbs) return -1;
                    if (aAbs && !bAbs) return 1;
                    return 0;
                });
            });

            // Build class-column grid
            const grid = document.createElement('div');
            grid.className = 'bench-class-grid';

            for (const cls of BENCH_CLASS_ORDER) {
                const players = classBuckets[cls];

                const col = document.createElement('div');
                col.className = players.length === 0 ? 'bench-class-column empty-class' : 'bench-class-column';
                col.dataset.class = cls;

                // Class header
                const header = document.createElement('div');
                header.className = 'bench-class-header';
                const iconUrl = getClassIconUrl(cls);
                if (iconUrl) {
                    const img = document.createElement('img');
                    img.src = iconUrl;
                    img.alt = cls;
                    header.appendChild(img);
                }
                const label = document.createElement('span');
                label.textContent = cls.charAt(0).toUpperCase() + cls.slice(1);
                header.appendChild(label);
                col.appendChild(header);

                // Player cells
                for (const player of players) {
                    const isAbsent = player.spec_emote === discordAbsentEmoji;
                    const cellDiv = await createPlayerCell(player, true, isAbsent);
                    cellDiv.dataset.userid = player.userid || '';
                    cellDiv.dataset.bench = 'true';
                    col.appendChild(cellDiv);
                }

                grid.appendChild(col);
            }

            benchedList.appendChild(grid);
        } else {
            benchContainer.style.display = 'none';
        }
    }

    async function createPlayerCell(player, isBenched, isAbsent = false) {
        const cellDiv = document.createElement('div');
        cellDiv.classList.add('roster-cell', 'player-filled');
        cellDiv.dataset.userid = player.userid || '';
        if (isAbsent) {
            cellDiv.classList.add('absent-player');
        }

        const displayName = player.mainCharacterName || player.name;
        
        // Mark placeholders for styling (dashed red border via CSS)
        if (player.isPlaceholder === true || player.is_placeholder === true) {
            cellDiv.classList.add('placeholder-player');
        }

        let dropdownContentHTML = await buildDropdownContent(player, isBenched);

        // Confirmation checkmark (management-only — server strips isConfirmed for non-management)
        let confirmIconHTML = '';
        if (!player.isPlaceholder && player.isConfirmed !== undefined && player.isConfirmed !== null) {
            if (player.isConfirmed === 'confirmed' || player.isConfirmed === true) {
                confirmIconHTML = '<i class="fas fa-check confirmation-icon confirmed" title="Confirmed"></i>';
            } else {
                confirmIconHTML = '<i class="fas fa-times confirmation-icon unconfirmed" title="Not Confirmed"></i>';
            }
        }

        // Single icon only: class-icon-badge is added by applyPlayerColor()
        cellDiv.innerHTML = `
            <div class="player-name" data-character-name="${displayName}" data-discord-name="${player.name}"><span>${displayName}</span>${confirmIconHTML}</div>
            <div class="player-details-dropdown">${dropdownContentHTML}</div>`;

        const cellCanonicalClass = getCanonicalClass(player.class);
        applyPlayerColor(cellDiv, player.color, cellCanonicalClass);
        if (!player.userid || player.isPlaceholder) { try { cellDiv.classList.add('no-discord-id'); } catch {} }
        applyNoAssignmentsStyling(cellDiv, player);
        markCellDbMismatch(cellDiv, player);
        return cellDiv;
    }

    function getDisplayCharacterNameForPlayer(player) {
        return player.mainCharacterName || player.name || '';
    }

    async function fetchDbCharactersForUser(discordUserId) {
        if (playersDbCache[discordUserId] !== undefined) return playersDbCache[discordUserId];
        try {
            const resp = await fetch(`/api/players/by-discord-id/${discordUserId}`);
            if (!resp.ok) {
                playersDbCache[discordUserId] = [];
                return [];
            }
            const data = await resp.json();
            playersDbCache[discordUserId] = Array.isArray(data.characters) ? data.characters : [];
            return playersDbCache[discordUserId];
        } catch (e) {
            playersDbCache[discordUserId] = [];
            return [];
        }
    }

    async function prefetchPlayersDb() {
        const ids = new Set();
        (currentRosterData.raidDrop || []).forEach(p => { if (p && p.userid) ids.add(p.userid); });
        (currentRosterData.bench || []).forEach(p => { if (p && p.userid) ids.add(p.userid); });
        const promises = Array.from(ids).map(id => fetchDbCharactersForUser(id));
        await Promise.all(promises);
    }

    function canonicalizeClassForDbMatch(className) {
        const lower = (className || '').toLowerCase();
        if (lower === 'tank') return 'warrior';
        return getCanonicalClass(className);
    }

    function doesPlayerExistInDbCached(player) {
        const list = playersDbCache[player.userid] || [];
        const name = getDisplayCharacterNameForPlayer(player).toLowerCase();
        const cls = canonicalizeClassForDbMatch(player.class);
        return list.some(row => (
            (row.character_name || '').toLowerCase() === name &&
            canonicalizeClassForDbMatch(row.class) === cls
        ));
    }

    function markCellDbMismatch(cell, player) {
        if (!player || !player.userid) return;
        if (playersDbCache[player.userid] === undefined) {
            fetchDbCharactersForUser(player.userid).then(() => {
                if (!cell || !cell.parentNode) return;
                if (!doesPlayerExistInDbCached(player)) cell.classList.add('db-mismatch'); else cell.classList.remove('db-mismatch');
            });
            return;
        }
        if (!doesPlayerExistInDbCached(player)) {
            cell.classList.add('db-mismatch');
        } else {
            cell.classList.remove('db-mismatch');
        }
    }

    async function applyDbMismatchStyling() {
        // Roster cells
        (document.querySelectorAll('.roster-column .roster-cell.player-filled') || []).forEach(cell => {
            const dropdownItem = cell.querySelector('[data-userid]');
            const userid = dropdownItem ? dropdownItem.dataset.userid : null;
            if (!userid) return;
            const player = (currentRosterData.raidDrop || []).find(p => p && p.userid === userid);
            if (player) markCellDbMismatch(cell, player);
        });
        // Bench cells
        (document.querySelectorAll('#benched-list .roster-cell.player-filled') || []).forEach(cell => {
            const dropdownItem = cell.querySelector('[data-userid]');
            const userid = dropdownItem ? dropdownItem.dataset.userid : null;
            if (!userid) return;
            const player = (currentRosterData.bench || []).find(p => p && p.userid === userid);
            if (player) markCellDbMismatch(cell, player);
        });
    }

    // Raidleader inputs: autocomplete + save
    function wireRaidleaderControls(){
        const nameInput = document.getElementById('raidleader-input');
        const cutInput = document.getElementById('raidleader-cut-input');
        const suggestions = document.getElementById('raidleader-suggestions');
        if (!nameInput || !cutInput) return;

        // Load existing from event metadata
        (async()=>{
            try {
                const meta = await getEventRaidleader(eventId);
                if (meta && meta.success) {
                    if (meta.raidleaderName) nameInput.value = meta.raidleaderName;
                    if (meta.raidleaderCut != null) cutInput.value = String(meta.raidleaderCut);
                }
            } catch {}
        })();

        const buildRosterNames = ()=>{
            try {
                // Extract EXACT display names from roster grid only (exclude bench section)
                const nameEls = document.querySelectorAll('#roster-grid .roster-cell.player-filled .player-name span');
                const names = Array.from(nameEls).map(el => String(el.textContent||'').trim()).filter(Boolean);
                const unique = Array.from(new Set(names));
                // Map display name -> class from current roster data
                const classMap = new Map();
                const push = (p)=>{
                    if (!p) return;
                    const display = p.mainCharacterName || p.assigned_char_name || p.character_name || p.name;
                    // Treat role Tank as warrior color when class is not warrior
                    let cls = String(p.class_name || p.class || '').toLowerCase() || 'unknown';
                    try {
                        const role = deriveRole(p.class, p.spec);
                        if (String(role).toLowerCase() === 'tank') cls = 'warrior';
                    } catch {}
                    if (display) classMap.set(String(display).trim(), cls);
                };
                (currentRosterData.raidDrop||[]).forEach(push); // exclude bench by request
                return unique.map(n => ({ name: n, cls: classMap.get(n) || 'unknown' }));
            } catch { return []; }
        };

        const allNames = ()=> buildRosterNames();

        let hideTimer = null;
        const hideSuggestionsSoon = ()=>{ clearTimeout(hideTimer); hideTimer = setTimeout(()=> suggestions.style.display='none', 150); };
        const showSuggestions = (items)=>{
            if(!suggestions) return;
            if(!items || !items.length){ suggestions.style.display='none'; return; }
            const esc = (s)=> String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]||c));
            suggestions.innerHTML = items.map(it=>`<div class="player-dropdown-item class-${esc(it.cls)}">${esc(it.name)}</div>`).join('');
            suggestions.style.display='block';
            suggestions.querySelectorAll('.player-dropdown-item').forEach(el=>{
                el.addEventListener('click', ()=>{
                    nameInput.value = el.textContent;
                    suggestions.style.display='none';
                    saveMeta();
                });
            });
        };

        nameInput.addEventListener('input', ()=>{
            const q = String(nameInput.value||'').toLowerCase();
            const options = allNames().filter(it=> it.name.toLowerCase().includes(q)).slice(0,50);
            showSuggestions(options);
        });
        nameInput.addEventListener('focus', ()=>{
            const q = String(nameInput.value||'').toLowerCase();
            const options = allNames().filter(it=> !q || it.name.toLowerCase().includes(q)).slice(0,50);
            showSuggestions(options);
        });
        nameInput.addEventListener('blur', hideSuggestionsSoon);
        suggestions.addEventListener('mousedown', e=> e.preventDefault());

        const saveMeta = async()=>{
            try {
                // numeric only for cut
                let cut = cutInput.value;
                if (cut === '') cut = null;
                if (cut != null) {
                    const num = Number(cut);
                    if (!isFinite(num)) return; // ignore invalid
                    cut = num;
                }
                await setEventRaidleader(eventId, String(nameInput.value||'').trim() || null, cut);
                updateRaidleaderStat().catch(()=>{});
            } catch (e) { console.warn('Failed to save raidleader meta', e); }
        };

        nameInput.addEventListener('change', saveMeta);
        nameInput.addEventListener('keyup', (e)=>{ if(e.key==='Enter') saveMeta(); });
        cutInput.addEventListener('change', ()=>{
            // sanitize to number
            const v = Number(cutInput.value);
            if (!isFinite(v) || v < 0) { cutInput.value = ''; return; }
            saveMeta();
        });
        cutInput.addEventListener('keyup', (e)=>{ if(e.key==='Enter') cutInput.dispatchEvent(new Event('change')); });

        // Invites-by local field
        const invitesInput = document.getElementById('invites-by-input');
        if (invitesInput) {
            try { invitesInput.value = localStorage.getItem(`invitesBy:${eventId}`) || ''; } catch {}
            const saveInv = ()=>{
                try { localStorage.setItem(`invitesBy:${eventId}`, String(invitesInput.value||'').trim()); } catch {}
                updateInvitesByStat().catch(()=>{});
            };
            invitesInput.addEventListener('change', saveInv);
            invitesInput.addEventListener('keyup', (e)=>{ if(e.key==='Enter') saveInv(); });
        }
    }


        async function buildDropdownContent(player, isBenched) {
        if (!currentUserCanManage) {
            return '<div class="dropdown-header">Only management can edit</div>';
        }
        
        // Special menu for placeholder players
        if (player.isPlaceholder) {
            return `
                <div class="dropdown-header">Placeholder Actions</div>
                <div class="dropdown-item" data-action="add-discord-id" data-party-id="${player.partyId}" data-slot-id="${player.slotId}">
                    <i class="fas fa-user-plus menu-icon"></i>Add Discord ID
                </div>
                <div class="dropdown-item" data-action="remove-placeholder" data-party-id="${player.partyId}" data-slot-id="${player.slotId}">
                    <i class="fas fa-trash menu-icon"></i>Remove Placeholder
                </div>
            `;
        }
        
        let content = '<div class="dropdown-header">Actions</div>';

        // Helper: read/write "no assignments" map in localStorage
        function getNoAssignmentsMap() {
            try { return JSON.parse(localStorage.getItem('noAssignmentsMap') || '{}') || {}; } catch { return {}; }
        }
        function isNoAssignments(userid) {
            const map = getNoAssignmentsMap();
            return !!map[String(userid)];
        }
        function setNoAssignments(userid, flag) {
            const map = getNoAssignmentsMap();
            if (flag) map[String(userid)] = true; else delete map[String(userid)];
            try { localStorage.setItem('noAssignmentsMap', JSON.stringify(map)); } catch {}
        }

        let moveSubmenuHTML = '<div class="move-submenu">';
        for (let partyIdx = 0; partyIdx < currentRosterData.partyPerRaid; partyIdx++) {
            moveSubmenuHTML += `<div class="dropdown-header">${currentRosterData.partyNames[partyIdx] || `Group ${partyIdx + 1}`}</div>`;
            for (let slotIdx = 0; slotIdx < currentRosterData.slotPerParty; slotIdx++) {
                const targetPlayer = currentRosterData.raidDrop.find(p => p && p.partyId === partyIdx + 1 && p.slotId === slotIdx + 1);
                const targetLabel = targetPlayer ? `Swap with ${targetPlayer.mainCharacterName || targetPlayer.name}` : `Slot ${slotIdx + 1} (Empty)`;
                const isDisabled = !isBenched && player.partyId === partyIdx + 1 && player.slotId === slotIdx + 1;
                moveSubmenuHTML += `<div class="dropdown-item ${isDisabled ? 'disabled' : ''}" data-action="move-player" data-userid="${player.userid}" data-target-party="${partyIdx + 1}" data-target-slot="${slotIdx + 1}">${targetLabel}</div>`;
            }
        }
        moveSubmenuHTML += '</div>';
        content += `<div class="dropdown-item has-submenu"><i class="fas fa-arrows-alt menu-icon"></i>${isBenched ? 'Move to Roster' : 'Move Player'} ${moveSubmenuHTML}</div>`;

        if (!isBenched) {
            content += `<div class="dropdown-item" data-action="move-to-bench" data-userid="${player.userid}"><i class="fas fa-archive menu-icon"></i>Move to Bench</div>`;
        }

        // In raid toggle for roster players (not bench players)
        if (!isBenched) {
            const inRaidIcon = player.inRaid ? 'fas fa-check-circle' : 'fas fa-circle';
            const inRaidText = player.inRaid ? 'Mark not in raid' : 'Mark in raid';
            content += `<div class="dropdown-item" data-action="toggle-in-raid" data-userid="${player.userid}" data-current-status="${player.inRaid || false}"><i class="${inRaidIcon} menu-icon"></i>${inRaidText}</div>`;
        }

        // Only show spec swap for roster players, not bench players
        if (!isBenched) {
            const canonicalClass = getCanonicalClass(player.class);
            const specsForClass = specData[canonicalClass] || [];
            if (specsForClass.length > 0) {
                let specSubmenuHTML = '<div class="spec-submenu">';
                specsForClass.forEach(spec => {
                    specSubmenuHTML += `<div class="dropdown-item" data-action="swap-spec" data-userid="${player.userid}" data-spec-name="${spec.name}">${spec.name}</div>`;
                });
                specSubmenuHTML += '</div>';
                content += `<div class="dropdown-item has-submenu"><i class="fas fa-magic menu-icon"></i>Swap Spec ${specSubmenuHTML}</div>`;
            }
        }

        // Add Fix name action (available for both roster and bench players)
        content += `<div class="dropdown-item" data-action="fix-name" data-userid="${player.userid}"><i class="fas fa-edit menu-icon"></i>Fix name</div>`;
        // Replace assignments action (available for both roster and bench players)
        content += `<div class="dropdown-item" data-action="replace-assignments" data-userid="${player.userid}" data-player-name="${(player.mainCharacterName||player.name||'').replace(/"/g,'&quot;')}"><i class="fas fa-exchange-alt menu-icon"></i>Replace assignments</div>`;

        // Give no assignments toggle (available for both roster and bench players)
        const noAssign = isNoAssignments(player.userid);
        const noAssignIcon = noAssign ? 'fas fa-check-circle' : 'fas fa-minus-circle';
        const noAssignText = noAssign ? 'Allow assignments' : 'Give no assignments';
        content += `<div class="dropdown-item" data-action="toggle-no-assignments" data-userid="${player.userid}" data-current-status="${noAssign}"><i class="${noAssignIcon} menu-icon"></i>${noAssignText}</div>`;

        // Prompt items: confirmation only for unconfirmed; invite always available
        try {
            const isUnconfirmed = !(player.isConfirmed === 'confirmed' || player.isConfirmed === true);
            if (player.userid) {
                if (isUnconfirmed) {
                    content += `<div class=\"dropdown-item\" data-action=\"prompt-confirmation\" data-userid=\"${player.userid}\"><i class=\"fas fa-bell menu-icon\"></i>Prompt for confirmation</div>`;
                }
                content += `<div class=\"dropdown-item\" data-action=\"prompt-invite\" data-userid=\"${player.userid}\"><i class=\"fas fa-envelope-open-text menu-icon\"></i>Prompt for invite</div>`;
            }
        } catch {}

        // Show player data page — opens admin profile in new tab
        const showPlayerDisabled = !player.userid;
        content += `<div class="dropdown-separator"></div>`;
        content += `<div class="dropdown-item show-player-btn${showPlayerDisabled ? ' disabled' : ''}" data-action="show-player-page" data-userid="${player.userid || ''}"${showPlayerDisabled ? ' style="opacity:0.4;cursor:not-allowed;pointer-events:none;"' : ''}><i class="fas fa-external-link-alt menu-icon"></i>Show player data page</div>`;

                // Build complete character list (main + alts)
        const allCharacters = [];
        const currentCharacterName = player.mainCharacterName || player.name;
        const signupName = player.name;
        
        // Initialize or update character history for this player
        if (!playerCharacterHistory[player.userid]) {
            playerCharacterHistory[player.userid] = new Set();
        }
        if (!playerCharacterDetails[player.userid]) {
            playerCharacterDetails[player.userid] = {};
        }
        
        // Track current character with its class info
        if (currentCharacterName) {
            playerCharacterHistory[player.userid].add(currentCharacterName);
            playerCharacterDetails[player.userid][currentCharacterName] = {
                class: player.class,
                icon: null,
                color: null
            };
        }
        
        // Only track the signup name if it looks like a real character name (not Discord concatenated names)
        if (signupName && !signupName.includes('/') && signupName !== currentCharacterName) {
            playerCharacterHistory[player.userid].add(signupName);
            // Don't override if we already have better class info
            if (!playerCharacterDetails[player.userid][signupName]) {
                playerCharacterDetails[player.userid][signupName] = {
                    class: player.class,
                    icon: null,
                    color: null
                };
            }
        }
        
        // Track all alt characters with their detailed info
        if (player.altCharacters && player.altCharacters.length > 0) {
            player.altCharacters.forEach(alt => {
                playerCharacterHistory[player.userid].add(alt.name);
                playerCharacterDetails[player.userid][alt.name] = {
                    class: alt.class,
                    icon: alt.icon,
                    color: alt.color
                };
            });
        }
        
        // Character list building (debug removed for cleaner logs)
        
        const existingKeys = new Set();
        
        // First, add the current character (what's displayed in the roster)
        if (currentCharacterName) {
            const currentCanonicalClass = getCanonicalClass(player.class);
            allCharacters.push({
                name: currentCharacterName,
                class: player.class,
                icon: null,
                color: getClassColor(currentCanonicalClass),
                isMain: false, // We'll determine if this is main later
                isCurrent: true
            });
            existingKeys.add(`${currentCharacterName}::${currentCanonicalClass}`);
        }
        
        // Add registered character from database (if different from current)
        let registeredCharacter = null;
        try {
            registeredCharacter = await getRegisteredCharacter(player.userid);
            if (registeredCharacter) {
                const mainCanonicalClass = getCanonicalClass(registeredCharacter.characterClass);
                const key = `${registeredCharacter.characterName}::${mainCanonicalClass}`;
                if (!existingKeys.has(key)) {
                allCharacters.push({
                    name: registeredCharacter.characterName,
                    class: registeredCharacter.characterClass,
                    icon: null,
                    color: getClassColor(mainCanonicalClass),
                    isMain: true,
                    isCurrent: false
                });
                existingKeys.add(key);
                playerCharacterHistory[player.userid].add(registeredCharacter.characterName);
                }
            } else if (registeredCharacter && registeredCharacter.characterName === currentCharacterName) {
                // Current character is the registered main character
                const currentCharIndex = allCharacters.findIndex(char => char.isCurrent);
                if (currentCharIndex !== -1) {
                    allCharacters[currentCharIndex].isMain = true;
                }
            }
        } catch (error) {
            // Silently handle 404 errors for users without registered characters
            if (!error.message.includes('404') && 
                !error.message.includes('Not Found') && 
                !error.message.includes('No registered character found')) {
                console.warn(`Could not fetch registered character for ${player.userid}:`, error);
            }
        }
        
        // Add ALL characters from history with their stored class information
        playerCharacterHistory[player.userid].forEach(characterName => {
                const charDetails = playerCharacterDetails[player.userid][characterName];
                const characterClass = charDetails ? charDetails.class : player.class;
                const characterIcon = charDetails ? charDetails.icon : null;
                const characterColor = charDetails ? charDetails.color : null;
                
                // Debug logging for character class info
                if (!charDetails) {
                    console.log(`[DROPDOWN] No charDetails for "${characterName}", using fallback class: ${player.class}`);
                }
                
                const canonicalClass = getCanonicalClass(characterClass);
                const key = `${characterName}::${canonicalClass}`;
                if (!existingKeys.has(key)) {
                    allCharacters.push({
                        name: characterName,
                        class: characterClass,
                        icon: characterIcon,
                        color: characterColor || getClassColor(canonicalClass),
                        isMain: false,
                        isCurrent: false
                    });
                    existingKeys.add(key);
                }
        });
        
        if (allCharacters.length > 1) { // Only show if there are options to switch to
            content += '<div class="dropdown-separator"></div><div class="dropdown-header">Switch Character</div>';
            content += allCharacters.map(char => {
                // Use class icon from CLASS_ICONS map, fall back to char.icon, then fa-user
                const charCanonical = getCanonicalClass(char.class);
                const classIconUrl = getClassIconUrl(charCanonical);
                const iconHtml = classIconUrl
                    ? `<img src="${classIconUrl}" class="menu-icon" style="width:16px;height:16px;">`
                    : (char.icon ? `<img src="https://cdn.discordapp.com/emojis/${char.icon}.png" class="menu-icon">` : '<i class="fas fa-user menu-icon"></i>');
                const colorStyle = char.color ? `style="color: rgb(${char.color});"` : '';
                const disabledClass = char.isCurrent ? ' disabled' : '';
                const itemText = char.isCurrent ? `${char.name} (Current)` : char.name;
                // Use empty string instead of undefined/null to avoid "undefined" in HTML
                const altClass = char.class || '';
                
                return `<div class="dropdown-item${disabledClass}" data-action="swap-char" data-userid="${player.userid}" data-alt-name="${char.name}" data-alt-class="${altClass}">${iconHtml}<span ${colorStyle}>${itemText}</span></div>`;
            }).join('');
        }
        return content;
    }

    function buildEmptySlotDropdownContent(partyId, slotId) {
        if (!currentUserCanManage) {
            return '<div class="dropdown-header">Only management can edit</div>';
        }
        return `
            <div class="dropdown-header">Actions</div>
            <div class="dropdown-item" data-action="add-placeholder" data-target-party="${partyId}" data-target-slot="${slotId}">
                <i class="fas fa-user-plus menu-icon"></i>Add Placeholder
            </div>
            <div class="dropdown-item" data-action="add-new-character" data-target-party="${partyId}" data-target-slot="${slotId}">
                <i class="fas fa-plus menu-icon"></i>Add New Character
            </div>
            <div class="dropdown-item" data-action="add-existing-player" data-target-party="${partyId}" data-target-slot="${slotId}">
                <i class="fas fa-search menu-icon"></i>Add Existing Player
            </div>
        `;
    }

        /**
     * CLASS_ICONS — Discord emoji IDs for each WoW class icon.
     * Used for badge class icons and context menu character icons.
     */
    const CLASS_ICONS = {
        'warrior': '579532030153588739',
        'paladin': '579532029906124840',
        'hunter': '579532029880827924',
        'rogue': '579532030086217748',
        'priest': '579532029901799437',
        'shaman': '579532030056857600',
        'mage': '579532030161977355',
        'warlock': '579532029851336716',
        'druid': '579532029675438081',
    };

    /**
     * Returns the Discord CDN URL for a class icon.
     * @param {string} canonicalClass - Lowercase canonical class name
     * @returns {string} URL to the class icon image
     */
    function getClassIconUrl(canonicalClass) {
        const emojiId = CLASS_ICONS[canonicalClass];
        return emojiId ? `https://cdn.discordapp.com/emojis/${emojiId}.png` : '';
    }

    /**
     * Applies player styling to a roster cell:
     * - Uniform dark background (#374151)
     * - 4px left anchor bar in the player's class color
     * - Small class icon next to the anchor bar
     * - Light text color (#f3f4f6)
     *
     * @param {HTMLElement} cellDiv - The roster-cell element
     * @param {string} color - RGB color string (e.g. "199, 156, 110") or hex
     * @param {string} [canonicalClass] - Optional canonical class for the icon
     */
    function applyPlayerColor(cellDiv, color, canonicalClass) {
        // Set uniform dark background
        cellDiv.style.backgroundColor = '#374151';
        cellDiv.style.color = '#f3f4f6';

        // Parse color to RGB string
        let rgbColor = '128,128,128'; // fallback gray
        if (color) {
            if (typeof color === 'string' && color.includes(',')) {
                rgbColor = color;
            } else if (typeof color === 'string' && color.startsWith('#')) {
                const hex = color.substring(1);
                if (hex.length === 6) {
                    rgbColor = `${parseInt(hex.substr(0, 2), 16)},${parseInt(hex.substr(2, 2), 16)},${parseInt(hex.substr(4, 2), 16)}`;
                }
            }
        }

        // Remove any existing anchor bar and class icon (for re-renders)
        const existingBar = cellDiv.querySelector('.class-anchor-bar');
        if (existingBar) existingBar.remove();
        const existingIcon = cellDiv.querySelector('.class-icon-badge');
        if (existingIcon) existingIcon.remove();

        // Create class-color left anchor bar
        const bar = document.createElement('div');
        bar.className = 'class-anchor-bar';
        bar.style.backgroundColor = `rgb(${rgbColor})`;
        cellDiv.insertBefore(bar, cellDiv.firstChild);

        // Create class icon
        if (canonicalClass) {
            const iconUrl = getClassIconUrl(canonicalClass);
            if (iconUrl) {
                const icon = document.createElement('img');
                icon.className = 'class-icon-badge';
                icon.src = iconUrl;
                icon.alt = canonicalClass;
                icon.loading = 'lazy';
                // Insert after the anchor bar
                bar.after(icon);
            }
        }
    }

    // Styling for players flagged as "no assignments"
    function applyNoAssignmentsStyling(cellDiv, player) {
        if (!cellDiv || !player || !player.userid) return;
        let map = {};
        try { map = JSON.parse(localStorage.getItem('noAssignmentsMap') || '{}') || {}; } catch {}
        const flagged = !!map[String(player.userid)];
        try {
            if (flagged) {
                cellDiv.style.border = '2px solid #ff00ff';
            } else {
                // only remove if we previously set it
                if (cellDiv.style && cellDiv.style.border && cellDiv.style.border.includes('#ff00ff')) {
                    cellDiv.style.border = '';
                }
            }
        } catch {}
        try {
            const nameDiv = cellDiv.querySelector('.player-name span');
            if (nameDiv) {
                // Ensure only one gold icon is appended
                const existing = nameDiv.parentElement.querySelector('.no-assign-gold');
                if (flagged) {
                    if (!existing) {
                        const icon = document.createElement('i');
                        icon.className = 'fas fa-coins no-assign-gold';
                        icon.style.color = '#ffd700';
                        icon.style.marginLeft = '6px';
                        nameDiv.parentElement.insertBefore(icon, nameDiv.nextSibling);
                    }
                } else if (existing) {
                    existing.remove();
                }
            }
        } catch {}
    }

    function attachEmptySlotListeners(cell) {
        // This function replicates the exact logic from setupEventListeners for a single empty slot
        
        // IMPORTANT: Remove any existing listeners first to prevent duplicates
        const newCell = cell.cloneNode(true);
        if (cell.parentNode) {
            cell.parentNode.replaceChild(newCell, cell);
        } else {
            console.warn('Empty slot cell has no parent node, cannot replace');
            return cell;
        }
        
        newCell.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = newCell.querySelector('.player-details-dropdown');
            
            document.querySelectorAll('.player-details-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            
            if (dropdown) {
                dropdown.classList.toggle('show');
                if (dropdown.classList.contains('show')) {
                    positionDropdownSmart(newCell, dropdown);
                }
            }
        });

        // Add listener for "Add placeholder" action
        const addPlaceholderItem = newCell.querySelector('[data-action="add-placeholder"]');
        if (addPlaceholderItem) {
            addPlaceholderItem.addEventListener('click', (e) => {
                const { targetParty, targetSlot } = e.currentTarget.dataset;
                openAddPlaceholderModal(parseInt(targetParty), parseInt(targetSlot));
            });
        }

        // Add listener for "Add new character" action
        const addCharacterItem = newCell.querySelector('[data-action="add-new-character"]');
        if (addCharacterItem) {
            addCharacterItem.addEventListener('click', (e) => {
                const { targetParty, targetSlot } = e.currentTarget.dataset;
                handleAddNewCharacter(parseInt(targetParty), parseInt(targetSlot));
            });
        }

        // Add listener for "Add existing player" action
        const addExistingPlayerItem = newCell.querySelector('[data-action="add-existing-player"]');
        if (addExistingPlayerItem) {
            addExistingPlayerItem.addEventListener('click', (e) => {
                const { targetParty, targetSlot } = e.currentTarget.dataset;
                openPlayerSearchModal(parseInt(targetParty), parseInt(targetSlot));
            });
        }
        
        return newCell; // Return the updated cell reference
    }

    function setupEventListeners() {
        // Attach listeners to filled player cells
        document.querySelectorAll('.roster-cell.player-filled').forEach(cell => {
            OptimisticUpdates.attachCellEventListeners(cell);
        });

        // Attach listeners to empty slots
        document.querySelectorAll('.roster-cell.empty-slot-clickable').forEach(cell => {
            attachEmptySlotListeners(cell);
        });
    }

    function getCanonicalClass(className) {
        if (!className) return 'unknown';
        const lower = className.toLowerCase();
        
        // Handle common role names from Raid Helper and map them to a default class
        if (lower === 'tank') return 'warrior';
        
        // Handle class names
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

    function getClassColor(canonicalClass) {
        const classColors = {
            'death knight': '196,30,59',
            'druid': '255,125,10',
            'hunter': '171,212,115',
            'mage': '105,204,240',
            'paladin': '245,140,186',
            'priest': '255,255,255',
            'rogue': '255,245,105',
            'shaman': '0,112,222',
            'warlock': '148,130,201',
            'warrior': '199,156,110'
        };
        return classColors[canonicalClass] || '128,128,128'; // Default gray
    }

    /**
     * Positions a dropdown smartly to avoid viewport overflow.
     * If the dropdown would overflow the right edge, positions it to the left.
     * Also positions flyout submenus to flip direction if needed.
     */
    function positionDropdownSmart(cellDiv, dropdown) {
        // Reset positioning
        dropdown.style.left = '0';
        dropdown.style.right = 'auto';

        requestAnimationFrame(() => {
            const cellRect = cellDiv.getBoundingClientRect();
            const dropdownWidth = 260;

            // Check right overflow
            if (cellRect.left + dropdownWidth > window.innerWidth) {
                dropdown.style.left = 'auto';
                dropdown.style.right = '0';
            }

            // Position flyout submenus: check if they'd overflow the right edge
            dropdown.querySelectorAll('.has-submenu').forEach(item => {
                const sub = item.querySelector('.move-submenu, .spec-submenu');
                if (!sub) return;
                sub.classList.remove('flip-left');

                // Temporarily show to measure
                const origDisplay = sub.style.display;
                sub.style.display = 'block';
                sub.style.visibility = 'hidden';
                const subRect = sub.getBoundingClientRect();
                sub.style.display = origDisplay;
                sub.style.visibility = '';

                if (subRect.right > window.innerWidth || subRect.left < 0) {
                    sub.classList.add('flip-left');
                }
            });
        });
    }

    /**
     * Creates the admin right sidebar, moving all button-panel controls into it.
     * Only called when currentUserCanManage is true.
     */
    function createAdminSidebar() {
        // Don't create duplicate sidebars
        if (document.querySelector('.admin-sidebar')) return;

        const sidebar = document.createElement('div');
        sidebar.className = 'admin-sidebar';

        // Restore collapsed state from localStorage
        const isCollapsed = localStorage.getItem('adminSidebarCollapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
        } else {
            document.body.classList.add('sidebar-expanded');
        }

        // Toggle button with "Admin" label
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'admin-sidebar-toggle';
        toggleBtn.innerHTML = isCollapsed
            ? '<i class="fas fa-chevron-left"></i><span class="toggle-label-text">Admin</span>'
            : '<i class="fas fa-chevron-right"></i><span class="toggle-label-text">Admin</span>';

        // First-load pulse animation (once per session)
        if (!sessionStorage.getItem('adminToggleSeen')) {
            toggleBtn.classList.add('pulse-animate');
            toggleBtn.addEventListener('animationend', () => {
                toggleBtn.classList.remove('pulse-animate');
                sessionStorage.setItem('adminToggleSeen', '1');
            });
        }

        toggleBtn.addEventListener('click', () => {
            const nowCollapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem('adminSidebarCollapsed', nowCollapsed);
            document.body.classList.toggle('sidebar-expanded', !nowCollapsed);
            toggleBtn.innerHTML = nowCollapsed
                ? '<i class="fas fa-chevron-left"></i><span class="toggle-label-text">Admin</span>'
                : '<i class="fas fa-chevron-right"></i><span class="toggle-label-text">Admin</span>';
        });
        sidebar.appendChild(toggleBtn);

        // Inner scrollable container (keeps toggle visible outside overflow)
        const sidebarInner = document.createElement('div');
        sidebarInner.className = 'admin-sidebar-inner';
        sidebar.appendChild(sidebarInner);

        // Title
        const title = document.createElement('div');
        title.style.cssText = 'color:#e5e7eb;font-weight:700;font-size:0.9em;margin-bottom:12px;padding-left:2px;';
        title.textContent = 'Admin Controls';
        sidebarInner.appendChild(title);

        // Move all button-panel content into sidebar (move originals, not clones, so event listeners stay intact)
        const btnPanel = document.querySelector('.button-panel');
        if (btnPanel) {
            const sectionTitle1 = document.createElement('div');
            sectionTitle1.className = 'sidebar-section-title';
            sectionTitle1.textContent = 'Actions';
            sidebarInner.appendChild(sectionTitle1);

            // Move action buttons (originals — preserves event listeners + IDs)
            Array.from(btnPanel.querySelectorAll('.panel-button')).forEach(btn => {
                btn.style.width = '100%';
                btn.style.marginBottom = '4px';
                sidebarInner.appendChild(btn); // moves the real node
            });

            const sectionTitle2 = document.createElement('div');
            sectionTitle2.className = 'sidebar-section-title';
            sectionTitle2.textContent = 'Toggles';
            sidebarInner.appendChild(sectionTitle2);

            Array.from(btnPanel.querySelectorAll('.toggle-container')).forEach(toggle => {
                sidebarInner.appendChild(toggle);
            });

            const sectionTitle3 = document.createElement('div');
            sectionTitle3.className = 'sidebar-section-title';
            sectionTitle3.textContent = 'Settings';
            sidebarInner.appendChild(sectionTitle3);

            Array.from(btnPanel.querySelectorAll('.input-container, .raidleader-container, .cut-container, .invites-by-container')).forEach(container => {
                container.style.width = '100%';
                sidebarInner.appendChild(container);
            });

            Array.from(btnPanel.querySelectorAll('.panel-row, .input-row')).forEach(el => {
                el.style.width = '100%';
                sidebarInner.appendChild(el);
            });
        }

        // Recent Joins toggle button
        const joinsSection = document.createElement('div');
        joinsSection.className = 'sidebar-section-title';
        joinsSection.textContent = 'Discord';
        sidebarInner.appendChild(joinsSection);

        const joinsBtn = document.createElement('button');
        joinsBtn.className = 'panel-button';
        joinsBtn.style.cssText = 'width:100%;margin-bottom:4px;height:32px;font-size:0.78em;';
        joinsBtn.innerHTML = '<i class="fab fa-discord"></i><span>Recent Joins</span>';
        sidebarInner.appendChild(joinsBtn);

        const joinsPanel = document.createElement('div');
        joinsPanel.className = 'sidebar-recent-joins';
        joinsPanel.id = 'sidebar-recent-joins';
        joinsPanel.innerHTML = '<div style="color:#72767D;text-align:center;padding:12px;font-size:11px;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
        sidebarInner.appendChild(joinsPanel);

        joinsBtn.addEventListener('click', () => {
            joinsPanel.classList.toggle('visible');
            if (joinsPanel.classList.contains('visible')) {
                fetchRecentJoinsForSidebar(joinsPanel);
            }
        });

        document.body.appendChild(sidebar);

        // Re-wire all cloned button event listeners from original button-panel
        rewireSidebarButtons(sidebar);
    }

    /**
     * Fetches recent Discord joins and renders in the sidebar panel.
     */
    async function fetchRecentJoinsForSidebar(container) {
        try {
            const response = await fetch('/api/discord/member-events?limit=20');
            if (!response.ok) throw new Error('Failed to fetch');
            const data = await response.json();
            if (!data.ok || !data.events) throw new Error('Invalid response');

            const joinEvents = data.events.filter(e => e.eventType === 'join').slice(0, 5);
            if (joinEvents.length === 0) {
                container.innerHTML = '<div style="color:#72767D;text-align:center;padding:12px;font-style:italic;font-size:11px;">No recent joins</div>';
                return;
            }

            let html = '';
            joinEvents.forEach(event => {
                const username = event.username || 'Unknown';
                const ts = event.timestamp ? new Date(event.timestamp) : null;
                const ago = ts ? formatTimeAgoSidebar(ts) : '';
                html += `<div style="background:rgba(87,242,135,0.05);border-left:3px solid #57F287;padding:6px 8px;border-radius:4px;margin-bottom:4px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                        <span style="color:#57F287;font-size:11px;">👋</span>
                        <span style="color:#fff;font-weight:600;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtmlSidebar(username)}</span>
                        <span style="color:#72767D;font-size:10px;white-space:nowrap;">${ago}</span>
                    </div>
                </div>`;
            });
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<div style="color:#ED4245;text-align:center;padding:12px;font-size:11px;"><i class="fas fa-exclamation-triangle"></i> Failed to load</div>';
        }
    }

    function formatTimeAgoSidebar(date) {
        const diffMs = Date.now() - date.getTime();
        const min = Math.floor(diffMs / 60000);
        const hr = Math.floor(min / 60);
        const day = Math.floor(hr / 24);
        if (min < 1) return 'just now';
        if (min < 60) return `${min}m ago`;
        if (hr < 24) return `${hr}h ago`;
        if (day < 7) return `${day}d ago`;
        return date.toLocaleDateString();
    }

    function escapeHtmlSidebar(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    /**
     * Re-wires event listeners for cloned buttons in the sidebar.
     * Matches buttons by their inner text/icon and dispatches to the same handlers.
     */
    function rewireSidebarButtons(sidebar) {
        // Re-wire buttons by finding their data attributes or matching text
        sidebar.querySelectorAll('.panel-button').forEach(btn => {
            const originalBtn = findOriginalButton(btn);
            if (originalBtn) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    originalBtn.click();
                });
            }
        });

        // Re-wire toggle switches
        sidebar.querySelectorAll('.toggle-switch').forEach(toggle => {
            const label = toggle.closest('.toggle-container')?.querySelector('.toggle-label')?.textContent?.trim();
            const originalToggle = findOriginalToggle(label);
            if (originalToggle) {
                toggle.addEventListener('click', () => {
                    originalToggle.click();
                });
            }
        });
    }

    function findOriginalButton(clonedBtn) {
        const btnPanel = document.querySelector('.button-panel');
        if (!btnPanel) return null;
        const clonedText = clonedBtn.textContent.trim();
        const originals = btnPanel.querySelectorAll('.panel-button');
        for (const orig of originals) {
            if (orig.textContent.trim() === clonedText) return orig;
        }
        return null;
    }

    function findOriginalToggle(labelText) {
        if (!labelText) return null;
        const btnPanel = document.querySelector('.button-panel');
        if (!btnPanel) return null;
        const toggles = btnPanel.querySelectorAll('.toggle-container');
        for (const container of toggles) {
            const lbl = container.querySelector('.toggle-label');
            if (lbl && lbl.textContent.trim() === labelText) {
                return container.querySelector('.toggle-switch');
            }
        }
        return null;
    }

    // General toggle switch functionality
    function setupToggleSwitches() {
        document.querySelectorAll('.toggle-switch').forEach(toggle => {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('active');
            });
        });
    }

    function setupNameToggle() {
        const toggleNamesSwitch = document.getElementById('toggle-names-switch');
        if (!toggleNamesSwitch) return;
        
        // Restore saved state from localStorage
        const savedState = localStorage.getItem('showDiscordNames');
        let showDiscordNames = savedState === 'true';
        if (showDiscordNames) {
            toggleNamesSwitch.classList.add('active');
        }
        
        // Apply initial state
        document.querySelectorAll('.player-name').forEach(nameDiv => {
            const span = nameDiv.querySelector('span');
            if (span) {
                span.textContent = showDiscordNames ? nameDiv.dataset.discordName : nameDiv.dataset.characterName;
            }
        });
        
        toggleNamesSwitch.addEventListener('click', () => {
            setTimeout(() => {
                showDiscordNames = toggleNamesSwitch.classList.contains('active');
                localStorage.setItem('showDiscordNames', showDiscordNames.toString());
                
                document.querySelectorAll('.player-name').forEach(nameDiv => {
                    const span = nameDiv.querySelector('span');
                    if (span) {
                        span.textContent = showDiscordNames ? nameDiv.dataset.discordName : nameDiv.dataset.characterName;
                    }
                });
            }, 10);
        });
    }

    function setupHideInRaidToggle() {
        const hideInRaidSwitch = document.getElementById('hide-in-raid-switch');
        if (!hideInRaidSwitch) return;
        
        // Restore saved state from localStorage (default to ON if not set)
        const savedState = localStorage.getItem('hideInRaid');
        if (savedState === null || savedState === 'true') {
            hideInRaidSwitch.classList.add('active');
        } else {
            hideInRaidSwitch.classList.remove('active');
        }
        applyInRaidVisibility(); // Apply initial state
        
        hideInRaidSwitch.addEventListener('click', () => {
            setTimeout(() => {
                const isActive = hideInRaidSwitch.classList.contains('active');
                localStorage.setItem('hideInRaid', isActive.toString());
                applyInRaidVisibility();
            }, 10);
        });
    }

    function setupHideBenchToggle() {
        const hideBenchSwitch = document.getElementById('hide-bench-switch');
        const benchContainer = document.getElementById('bench-container');
        if (!hideBenchSwitch || !benchContainer) return;
        
        // Restore saved state from localStorage
        const savedState = localStorage.getItem('hideBench');
        if (savedState === 'true') {
            hideBenchSwitch.classList.add('active');
            benchContainer.classList.add('bench-hidden');
        }
        
        hideBenchSwitch.addEventListener('click', () => {
            // Small delay to ensure the toggle class has been updated
            setTimeout(() => {
                // Check if toggle is active (ON state)
                const isActive = hideBenchSwitch.classList.contains('active');
                
                // Save state to localStorage
                localStorage.setItem('hideBench', isActive.toString());
                
                if (isActive) {
                    // Toggle is ON - hide the bench using CSS class
                    benchContainer.classList.add('bench-hidden');
                } else {
                    // Toggle is OFF - show the bench by removing CSS class
                    benchContainer.classList.remove('bench-hidden');
                }
            }, 10);
        });
    }

    function setupHideConfirmedToggle() {
        const hideConfirmedSwitch = document.getElementById('hide-confirmed-switch');
        if (!hideConfirmedSwitch) return;
        
        // Restore saved state from localStorage (default to OFF)
        const savedState = localStorage.getItem('hideConfirmed');
        if (savedState === 'true') {
            hideConfirmedSwitch.classList.add('active');
        }
        applyConfirmedVisibility(); // Apply initial state
        
        hideConfirmedSwitch.addEventListener('click', () => {
            setTimeout(() => {
                const isActive = hideConfirmedSwitch.classList.contains('active');
                localStorage.setItem('hideConfirmed', isActive.toString());
                applyConfirmedVisibility();
            }, 10);
        });
    }

    // Function to apply visual effects based on in-raid status
    function applyInRaidVisibility() {
        const hideInRaidSwitch = document.getElementById('hide-in-raid-switch');
        const isEnabled = hideInRaidSwitch && hideInRaidSwitch.classList.contains('active');
        
        if (isEnabled) {
            // Set opacity to 20% for players marked as "in raid" - only affect player name, not entire cell
            document.querySelectorAll('.roster-cell.player-filled').forEach(cell => {
                // Try multiple ways to find the user ID
                let userId = null;
                const dropdownItems = cell.querySelectorAll('[data-userid]');
                if (dropdownItems.length > 0) {
                    userId = dropdownItems[0].dataset.userid;
                }
                
                if (userId) {
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userId) || 
                                 currentRosterData.bench?.find(p => p && p.userid === userId);
                    const playerName = cell.querySelector('.player-name');
                    if (player && player.inRaid) {
                        // Only dim the player name, not the entire cell
                        if (playerName) playerName.style.opacity = '0.2';
                    } else {
                        // Reset player name opacity (but check other toggles)
                        applyAllVisibilityEffects(playerName, player);
                    }
                }
            });
        } else {
            // Reset and reapply other visibility effects
            document.querySelectorAll('.roster-cell.player-filled').forEach(cell => {
                const userId = cell.querySelector('[data-userid]')?.dataset.userid;
                if (userId) {
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userId) || 
                                 currentRosterData.bench?.find(p => p && p.userid === userId);
                    const playerName = cell.querySelector('.player-name');
                    applyAllVisibilityEffects(playerName, player);
                }
            });
        }
    }

    // Function to apply visual effects based on confirmed status
    function applyConfirmedVisibility() {
        const hideConfirmedSwitch = document.getElementById('hide-confirmed-switch');
        const isEnabled = hideConfirmedSwitch && hideConfirmedSwitch.classList.contains('active');
        
        if (isEnabled) {
            // Set opacity to 20% for players marked as "confirmed" - only affect player name, not entire cell
            document.querySelectorAll('.roster-cell.player-filled').forEach(cell => {
                // Try multiple ways to find the user ID
                let userId = null;
                const dropdownItems = cell.querySelectorAll('[data-userid]');
                if (dropdownItems.length > 0) {
                    userId = dropdownItems[0].dataset.userid;
                }
                
                if (userId) {
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userId) || 
                                 currentRosterData.bench?.find(p => p && p.userid === userId);
                    const playerName = cell.querySelector('.player-name');
                    if (player && (player.isConfirmed === true || player.isConfirmed === "confirmed")) {
                        // Only dim the player name, not the entire cell
                        if (playerName) playerName.style.opacity = '0.2';
                    } else {
                        // Reset player name opacity (but check other toggles)
                        applyAllVisibilityEffects(playerName, player);
                    }
                }
            });
        } else {
            // Reset and reapply other visibility effects
            document.querySelectorAll('.roster-cell.player-filled').forEach(cell => {
                const userId = cell.querySelector('[data-userid]')?.dataset.userid;
                if (userId) {
                    const player = currentRosterData.raidDrop?.find(p => p && p.userid === userId) || 
                                 currentRosterData.bench?.find(p => p && p.userid === userId);
                    const playerName = cell.querySelector('.player-name');
                    applyAllVisibilityEffects(playerName, player);
                }
            });
        }
    }

    // Function to apply all visibility effects (both in-raid and confirmed)
    function applyAllVisibilityEffects(playerName, player) {
        if (!playerName || !player) return;
        
        const hideInRaidSwitch = document.getElementById('hide-in-raid-switch');
        const hideConfirmedSwitch = document.getElementById('hide-confirmed-switch');
        
        const hideInRaidEnabled = hideInRaidSwitch && hideInRaidSwitch.classList.contains('active');
        const hideConfirmedEnabled = hideConfirmedSwitch && hideConfirmedSwitch.classList.contains('active');
        
        // Check if player should be dimmed by either toggle
        const shouldDimForInRaid = hideInRaidEnabled && player.inRaid;
        const shouldDimForConfirmed = hideConfirmedEnabled && (player.isConfirmed === true || player.isConfirmed === "confirmed");
        
        if (shouldDimForInRaid || shouldDimForConfirmed) {
            playerName.style.opacity = '0.2';
        } else {
            playerName.style.opacity = '1';
        }
    }

    // Player search modal functionality
    let currentSearchTarget = null;

    function openPlayerSearchModal(partyId, slotId) {
        currentSearchTarget = { partyId, slotId };
        const overlay = document.getElementById('player-search-overlay');
        const input = document.getElementById('player-search-input');
        const results = document.getElementById('player-search-results');
        
        // Reset the modal
        input.value = '';
        results.innerHTML = '<div class="player-search-no-results">Type at least 2 characters to search</div>';
        
        // Show the modal
        overlay.style.display = 'flex';
        input.focus();
    }

    function closePlayerSearchModal() {
        const overlay = document.getElementById('player-search-overlay');
        overlay.style.display = 'none';
        currentSearchTarget = null;
    }

    async function searchPlayers(query) {
        if (query.length < 2) {
            const results = document.getElementById('player-search-results');
            results.innerHTML = '<div class="player-search-no-results">Type at least 2 characters to search</div>';
            return;
        }

        try {
            const response = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
            const players = await response.json();
            
            const results = document.getElementById('player-search-results');
            
            if (players.length === 0) {
                results.innerHTML = '<div class="player-search-no-results">No players found</div>';
                return;
            }

            const playersHTML = players.map(player => {
                const canonicalClass = getCanonicalClass(player.class);
                const classColor = getClassColor(canonicalClass);
                const rgb = classColor.split(',').map(Number);
                const textColor = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128 ? 'white' : 'black';
                
                return `
                    <div class="player-search-item" data-discord-id="${player.discord_id}" data-character-name="${player.character_name}" data-class="${player.class}" 
                         style="background-color: rgb(${classColor}); color: ${textColor};">
                        <div>
                            <div class="player-search-item-name">${player.character_name}</div>
                            <div class="player-search-item-class">${player.class}</div>
                        </div>
                    </div>
                `;
            }).join('');

            results.innerHTML = playersHTML;

            // Add click listeners to search results
            results.querySelectorAll('.player-search-item').forEach(item => {
                item.addEventListener('click', () => {
                    const discordId = item.dataset.discordId;
                    const characterName = item.dataset.characterName;
                    const characterClass = item.dataset.class;
                    
                    selectExistingPlayer(discordId, characterName, characterClass);
                });
            });

        } catch (error) {
            console.error('Error searching players:', error);
            const results = document.getElementById('player-search-results');
            results.innerHTML = '<div class="player-search-no-results">Error searching players</div>';
        }
    }

    async function selectExistingPlayer(discordId, characterName, characterClass) {
        if (!currentSearchTarget) return;

        const { partyId, slotId } = currentSearchTarget;

        try {
            // Close the modal first
            closePlayerSearchModal();

            // Add the existing player to the roster using force (bypass duplicate checks)
            const characterData = {
                characterName: characterName,
                class: characterClass,
                discordId: discordId,
                spec: null // Let the system determine default spec
            };

            await addExistingPlayerToRoster(eventId, characterData, partyId, slotId);
            
            // Mark roster as managed and show revert button
            isManaged = true;
            updateRevertButtonVisibility();
            
            // Reload the roster to show the change
            await renderRoster();
            
        } catch (error) {
            console.error('Error adding existing player:', error);
            showAlert('Add Player Error', `Error adding player to roster: ${error.message}`);
        }
    }

    // Placeholder modal functionality
    let currentPlaceholderTarget = null;
    let currentPlaceholderPlayer = null;

    function openAddPlaceholderModal(partyId, slotId) {
        currentPlaceholderTarget = { partyId, slotId };
        const overlay = document.getElementById('add-placeholder-overlay');
        const nameInput = document.getElementById('placeholder-name-input');
        const classSelect = document.getElementById('placeholder-class-select');
        
        nameInput.value = '';
        classSelect.value = '';
        overlay.style.display = 'flex';
        nameInput.focus();
    }

    function closeAddPlaceholderModal() {
        const overlay = document.getElementById('add-placeholder-overlay');
        overlay.style.display = 'none';
        currentPlaceholderTarget = null;
    }

    async function handleAddPlaceholder() {
        const nameInput = document.getElementById('placeholder-name-input');
        const classSelect = document.getElementById('placeholder-class-select');
        
        const characterName = nameInput.value.trim();
        const characterClass = classSelect.value;
        
        if (!characterName || !characterClass) {
            showAlert('Invalid Input', 'Please enter both name and class');
            return;
        }
        
        try {
            const response = await fetch(`/api/roster/${eventId}/add-placeholder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    characterName,
                    characterClass,
                    targetPartyId: currentPlaceholderTarget.partyId,
                    targetSlotId: currentPlaceholderTarget.slotId
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to add placeholder');
            }
            
            closeAddPlaceholderModal();
            isManaged = true;
            updateRevertButtonVisibility();
            await renderRoster();
            showAlert('Success', 'Placeholder added successfully');
        } catch (error) {
            console.error('Error adding placeholder:', error);
            showAlert('Error', error.message);
        }
    }

    async function handleRemovePlaceholder(partyId, slotId) {
        if (!confirm('Remove this placeholder?')) return;
        
        try {
            const response = await fetch(`/api/roster/${eventId}/remove-placeholder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ partyId, slotId })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to remove placeholder');
            }
            
            await renderRoster();
            showAlert('Success', 'Placeholder removed successfully');
        } catch (error) {
            console.error('Error removing placeholder:', error);
            showAlert('Error', error.message);
        }
    }

    function openAddDiscordIdModal(player) {
        currentPlaceholderPlayer = player;
        const overlay = document.getElementById('add-discord-id-overlay');
        const nameDiv = document.getElementById('placeholder-current-name');
        const classDiv = document.getElementById('placeholder-current-class');
        const searchInput = document.getElementById('discord-id-search-input');
        const results = document.getElementById('discord-id-search-results');
        
        nameDiv.textContent = player.mainCharacterName || player.name;
        classDiv.textContent = player.class;
        searchInput.value = '';
        results.innerHTML = '<div class="player-search-no-results">Type at least 2 characters to search</div>';
        
        overlay.style.display = 'flex';
        searchInput.focus();
    }

    function closeAddDiscordIdModal() {
        const overlay = document.getElementById('add-discord-id-overlay');
        overlay.style.display = 'none';
        currentPlaceholderPlayer = null;
    }

    async function searchPlayersForDiscordId(query) {
        if (query.length < 2) {
            const results = document.getElementById('discord-id-search-results');
            results.innerHTML = '<div class="player-search-no-results">Type at least 2 characters to search</div>';
            return;
        }

        try {
            const response = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
            const players = await response.json();
            
            const results = document.getElementById('discord-id-search-results');
            
            if (players.length === 0) {
                results.innerHTML = '<div class="player-search-no-results">No players found</div>';
                return;
            }

            const playersHTML = players.map(player => {
                const canonicalClass = getCanonicalClass(player.class);
                const classColor = getClassColor(canonicalClass);
                const rgb = classColor.split(',').map(Number);
                const textColor = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128 ? 'white' : 'black';
                
                return `
                    <div class="player-search-item" data-discord-id="${player.discord_id}" data-character-name="${player.character_name}" data-class="${player.class}" 
                         style="background-color: rgb(${classColor}); color: ${textColor}; cursor: pointer; padding: 10px; margin: 5px 0; border-radius: 4px;">
                        <div>
                            <div class="player-search-item-name" style="font-weight: bold;">${player.character_name}</div>
                            <div class="player-search-item-class" style="font-size: 12px; opacity: 0.9;">${player.class}</div>
                        </div>
                    </div>
                `;
            }).join('');

            results.innerHTML = playersHTML;

            // Add click listeners to search results
            results.querySelectorAll('.player-search-item').forEach(item => {
                item.addEventListener('click', () => {
                    const discordId = item.dataset.discordId;
                    const characterName = item.dataset.characterName;
                    const characterClass = item.dataset.class;
                    
                    convertPlaceholderToPlayer(discordId, characterName, characterClass);
                });
            });

        } catch (error) {
            console.error('Error searching players:', error);
            const results = document.getElementById('discord-id-search-results');
            results.innerHTML = '<div class="player-search-no-results">Error searching players</div>';
        }
    }

    async function convertPlaceholderToPlayer(discordId, characterName, characterClass) {
        try {
            const response = await fetch(`/api/roster/${eventId}/convert-placeholder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    partyId: currentPlaceholderPlayer.partyId,
                    slotId: currentPlaceholderPlayer.slotId,
                    discordId,
                    characterName,
                    characterClass
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to convert placeholder');
            }
            
            closeAddDiscordIdModal();
            await renderRoster();
            showAlert('Success', 'Placeholder converted to real player successfully');
        } catch (error) {
            console.error('Error converting placeholder:', error);
            showAlert('Error', error.message);
        }
    }

    function setupPlaceholderModals() {
        // Add Placeholder Modal
        const addPlaceholderOverlay = document.getElementById('add-placeholder-overlay');
        const addPlaceholderClose = addPlaceholderOverlay?.querySelector('.add-placeholder-close');
        const placeholderCancel = document.getElementById('placeholder-cancel');
        const placeholderAdd = document.getElementById('placeholder-add');

        if (addPlaceholderClose) addPlaceholderClose.addEventListener('click', closeAddPlaceholderModal);
        if (placeholderCancel) placeholderCancel.addEventListener('click', closeAddPlaceholderModal);
        if (placeholderAdd) placeholderAdd.addEventListener('click', handleAddPlaceholder);
        if (addPlaceholderOverlay) {
            addPlaceholderOverlay.addEventListener('click', (e) => {
                if (e.target === addPlaceholderOverlay) closeAddPlaceholderModal();
            });
        }

        // Add Discord ID Modal
        const addDiscordIdOverlay = document.getElementById('add-discord-id-overlay');
        const addDiscordIdClose = addDiscordIdOverlay?.querySelector('.add-discord-id-close');
        const discordIdCancel = document.getElementById('discord-id-cancel');
        const discordIdSearchInput = document.getElementById('discord-id-search-input');

        if (addDiscordIdClose) addDiscordIdClose.addEventListener('click', closeAddDiscordIdModal);
        if (discordIdCancel) discordIdCancel.addEventListener('click', closeAddDiscordIdModal);
        if (addDiscordIdOverlay) {
            addDiscordIdOverlay.addEventListener('click', (e) => {
                if (e.target === addDiscordIdOverlay) closeAddDiscordIdModal();
            });
        }

        // Search on input
        if (discordIdSearchInput) {
            let searchTimeout;
            discordIdSearchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    searchPlayersForDiscordId(e.target.value.trim());
                }, 300);
            });
        }

        // Close modals on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (addPlaceholderOverlay && addPlaceholderOverlay.style.display === 'flex') {
                    closeAddPlaceholderModal();
                }
                if (addDiscordIdOverlay && addDiscordIdOverlay.style.display === 'flex') {
                    closeAddDiscordIdModal();
                }
            }
        });
    }

    function setupPlayerSearchModal() {
        const overlay = document.getElementById('player-search-overlay');
        const closeBtn = overlay.querySelector('.player-search-close');
        const input = document.getElementById('player-search-input');

        // Close modal when clicking close button
        closeBtn.addEventListener('click', closePlayerSearchModal);

        // Close modal when clicking outside
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closePlayerSearchModal();
            }
        });

        // Close modal when pressing Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display === 'flex') {
                closePlayerSearchModal();
            }
        });

        // Search on input
        let searchTimeout;
        input.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchPlayers(e.target.value.trim());
            }, 300); // Debounce search by 300ms
        });
    }

    // Fix Name modal functionality
    let currentFixTarget = null;

    function openFixNameOverlay(player) {
        currentFixTarget = player;
        const overlay = document.getElementById('fix-name-overlay');
        const input = document.getElementById('fix-name-input');
        const discordDiv = document.getElementById('fix-discord-id');
        const classDiv = document.getElementById('fix-class');
        const roleDiv = document.getElementById('fix-role');

        // Populate values
        discordDiv.textContent = player.userid;
        classDiv.textContent = player.class || '';
        roleDiv.textContent = deriveRole(player.class, player.spec);
        input.value = player.mainCharacterName || player.name || '';

        overlay.style.display = 'flex';
        input.focus();
    }

    function closeFixNameOverlay() {
        const overlay = document.getElementById('fix-name-overlay');
        overlay.style.display = 'none';
        currentFixTarget = null;
    }

    function setupFixNameModal() {
        const overlay = document.getElementById('fix-name-overlay');
        if (!overlay) return;
        const closeBtn = overlay.querySelector('.fix-name-close');
        const cancelBtn = document.getElementById('fix-name-cancel');
        const saveBtn = document.getElementById('fix-name-save');
        const input = document.getElementById('fix-name-input');

        closeBtn.addEventListener('click', closeFixNameOverlay);
        cancelBtn.addEventListener('click', closeFixNameOverlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFixNameOverlay(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.style.display === 'flex') closeFixNameOverlay(); });

        saveBtn.addEventListener('click', async () => {
            if (!currentFixTarget) return;
            const oldName = currentFixTarget.mainCharacterName || currentFixTarget.name || '';
            const newName = (input.value || '').trim();
            if (!newName) {
                showAlert('Invalid name', 'Please enter a valid name.');
                return;
            }
            try {
                await fixPlayerName(currentFixTarget.userid, oldName, newName, currentFixTarget.class, eventId);
                // Update local state and refresh UI
                const rosterPlayer = currentRosterData.raidDrop?.find(p => p && p.userid === currentFixTarget.userid);
                if (rosterPlayer) rosterPlayer.mainCharacterName = newName;
                const benchPlayer = currentRosterData.bench?.find(p => p && p.userid === currentFixTarget.userid);
                if (benchPlayer) benchPlayer.mainCharacterName = newName;
                // Invalidate cached DB characters for this user so border updates without full F5
                try { delete playersDbCache[currentFixTarget.userid]; } catch (e) {}
                closeFixNameOverlay();
                await renderRoster();
            } catch (error) {
                showAlert('Save Error', `Failed to save name: ${error.message}`);
            }
        });
    }

    // Replace assignments modal
    let currentReplaceTarget = null; // player object to replace with
    function openReplaceAssignmentsOverlay(player) {
        currentReplaceTarget = player;
        const overlay = document.getElementById('replace-assignments-overlay');
        const srcInput = document.getElementById('replace-source-input');
        const suggBox = document.getElementById('replace-source-suggestions');
        const tgtDiv = document.getElementById('replace-target-display');
        if (!overlay || !srcInput || !tgtDiv) return;
        const targetName = player.mainCharacterName || player.name || '';
        tgtDiv.textContent = targetName;
        srcInput.value = '';
        if (suggBox) suggBox.style.display = 'none';
        overlay.style.display = 'flex';
        srcInput.focus();
    }
    function closeReplaceAssignmentsOverlay() {
        const overlay = document.getElementById('replace-assignments-overlay');
        if (overlay) overlay.style.display = 'none';
        currentReplaceTarget = null;
    }
    // Wire modal events
    (function setupReplaceAssignmentsModal(){
        const overlay = document.getElementById('replace-assignments-overlay');
        if (!overlay) return;
        const closeBtn = overlay.querySelector('.replace-assignments-close');
        const cancelBtn = document.getElementById('replace-assignments-cancel');
        const runBtn = document.getElementById('replace-assignments-run');
        const srcInput = document.getElementById('replace-source-input');
        const suggBox = document.getElementById('replace-source-suggestions');
        const partialToggle = document.getElementById('replace-partial-toggle');
        closeBtn.addEventListener('click', closeReplaceAssignmentsOverlay);
        cancelBtn.addEventListener('click', closeReplaceAssignmentsOverlay);
        overlay.addEventListener('click', (e)=>{ if (e.target === overlay) closeReplaceAssignmentsOverlay(); });
        document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape' && overlay.style.display === 'flex') closeReplaceAssignmentsOverlay(); });
        const rosterNames = ()=>{
            const names = new Set();
            const push = p=>{ if(!p) return; const n = p.mainCharacterName||p.assigned_char_name||p.character_name||p.name; if(n) names.add(String(n).trim()); };
            (currentRosterData.raidDrop||[]).forEach(push);
            (currentRosterData.bench||[]).forEach(push);
            return Array.from(names).sort((a,b)=>a.localeCompare(b));
        };
        const showSuggestions = (q)=>{
            if (!suggBox) return;
            const list = rosterNames().filter(n=> n.toLowerCase().includes(q.toLowerCase())).slice(0,50);
            if (!q || !list.length) { suggBox.style.display='none'; suggBox.innerHTML=''; return; }
            const esc = s=> String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]||c));
            suggBox.innerHTML = list.map(n=>`<div class="player-dropdown-item">${esc(n)}</div>`).join('');
            suggBox.style.display='block';
            suggBox.querySelectorAll('.player-dropdown-item').forEach(el=>{
                el.addEventListener('mousedown', (e)=>{ e.preventDefault(); });
                el.addEventListener('click', ()=>{ srcInput.value = el.textContent; suggBox.style.display='none'; srcInput.focus(); });
            });
        };
        if (srcInput) {
            let t=null; srcInput.addEventListener('input', ()=>{ clearTimeout(t); const val=srcInput.value||''; t=setTimeout(()=>showSuggestions(val),150); });
            srcInput.addEventListener('focus', ()=>{ const val=srcInput.value||''; showSuggestions(val); });
            srcInput.addEventListener('blur', ()=>{ setTimeout(()=>{ if(suggBox) suggBox.style.display='none'; }, 120); });
        }
        const run = async () => {
            try {
                if (!currentReplaceTarget) return;
                const src = String(srcInput.value||'').trim();
                const tgt = String(currentReplaceTarget.mainCharacterName || currentReplaceTarget.name || '').trim();
                if (!src || !tgt) { showAlert('Invalid input', 'Please enter the name to replace.'); return; }
                runBtn.disabled = true;
                const matchMode = (partialToggle && partialToggle.checked) ? 'partial' : 'exact';
                const { replacedCount, replacedList } = await replaceAssignments(eventId, src, tgt, matchMode);
                closeReplaceAssignmentsOverlay();
                const listHtml = (replacedList||[]).map(r=>`<li>${r.dungeon}${r.wing?` / ${r.wing}`:''} / ${r.boss}${r.assignment?` - ${r.assignment}`:''}</li>`).join('');
                showCustomModal({
                    type: 'alert',
                    title: 'Replace assignments',
                    message: `<p><strong>${src}</strong> was replaced with <strong>${tgt}</strong> in <strong>${replacedCount}</strong> assignments.</p>${replacedCount?`<ul style="margin-top:10px;">${listHtml}</ul>`:''}`,
                    allowHtmlContent: true,
                    buttons: [{ text: 'OK', action: 'confirm', style: 'primary' }]
                });
                // No need to rerender assignments page; roster can stay
            } catch (err) {
                // Close overlay to avoid stacking behind alerts
                closeReplaceAssignmentsOverlay();
                showAlert('Replace failed', err?.message || 'Failed to replace assignments');
            } finally {
                runBtn.disabled = false;
            }
        };
        runBtn.addEventListener('click', run);
        srcInput.addEventListener('keyup', (e)=>{ if (e.key === 'Enter') run(); });
    })();

    function deriveRole(className, specName) {
        if (!className) return 'Unknown';
        const c = (className || '').toLowerCase();
        const s = (specName || '').toLowerCase();
        if (c.includes('paladin')) {
            if (s.includes('holy')) return 'Healer';
            if (s.includes('protection')) return 'Tank';
            return 'DPS';
        }
        if (c.includes('priest')) {
            if (s.includes('shadow')) return 'DPS';
            return 'Healer';
        }
        if (c.includes('druid')) {
            if (s.includes('restoration')) return 'Healer';
            if (s.includes('bear') || s.includes('guardian') || s.includes('feral tank')) return 'Tank';
            return 'DPS';
        }
        if (c.includes('warrior')) {
            if (s.includes('protection')) return 'Tank';
            return 'DPS';
        }
        if (c.includes('shaman')) {
            if (s.includes('restoration')) return 'Healer';
            return 'DPS';
        }
        // Hunter, Mage, Rogue, Warlock default to DPS
        return 'DPS';
    }

    function updateRevertButtonVisibility() {
        revertButton.style.display = isManaged ? 'inline-flex' : 'none';
    }

    revertButton.addEventListener('click', async () => {
        showConfirm(
            'Revert to Unmanaged Roster',
            'Are you sure you want to revert to the unmanaged roster? All local changes will be lost.',
            async () => {
                try {
                    await revertToUnmanaged(eventId);
                    isManaged = false;
                    updateRevertButtonVisibility();
                    renderRoster();
                } catch (error) {
                    showAlert('Revert Error', `Failed to revert: ${error.message}`);
                }
            }
        );
    });

    // Announce invites wired to custom modal (old prompt-based handler removed)

    // Auto assignments runner entrypoint
    if (autoAssignmentsButton) {
        autoAssignmentsButton.addEventListener('click', async () => {
            // Check if raidleader-input has a value
            const raidleaderInput = document.getElementById('raidleader-input');
            if (!raidleaderInput || !raidleaderInput.value.trim()) {
                showAlert('Auto assignments', 'Please enter a name in the Raidleader input field, before doing assignments');
                return;
            }
            try {
                autoAssignmentsButton.disabled = true;
                autoAssignmentsButton.classList.add('active');
                await runAutoAssignmentsEntry();
            } catch (e) {
                console.error('Auto assignments error:', e);
                showAlert('Auto assignments error', e?.message || 'Unexpected error');
            } finally {
                autoAssignmentsButton.disabled = false;
                autoAssignmentsButton.classList.remove('active');
            }
        });
    }

    // Send assignments button handler
    const sendAssignmentsButton = document.getElementById('send-assignments-button');
    if (sendAssignmentsButton) {
        sendAssignmentsButton.addEventListener('click', async () => {
            try {
                sendAssignmentsButton.disabled = true;
                sendAssignmentsButton.classList.add('active');
                await sendAssignmentsDMs();
            } catch (e) {
                console.error('Send assignments error:', e);
                showAlert('Send assignments error', e?.message || 'Unexpected error');
            } finally {
                sendAssignmentsButton.disabled = false;
                sendAssignmentsButton.classList.remove('active');
            }
        });
    }

    async function runAutoAssignmentsEntry() {
        // Load current assignments once to decide warning and proceed
        const assignRes = await fetch(`/api/assignments/${eventId}`);
        const assignData = await assignRes.json();
        if (!assignData || !assignData.success) throw new Error('Failed to load assignments');
        const allPanels = Array.isArray(assignData.panels) ? assignData.panels : [];

        // Check if any MAIN page panel other than Tanking/Healing already has entries
        const hasOtherMain = allPanels.some(p => {
            const boss = String(p.boss || '').toLowerCase();
            const isMainWing = (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main');
            if (!isMainWing) return false;
            if (boss === 'tanking' || boss === 'healing') return false;
            return Array.isArray(p.entries) && p.entries.some(e => (e.character_name||'').trim());
        });

        if (hasOtherMain) {
            showConfirm(
                'Confirm Auto Assignments',
                'Some assignments has already been set, are you sure you want to reset and redo all assignments?',
                async () => { await runAutoAssignments(allPanels); }
            );
            return;
        }

        await runAutoAssignments(allPanels);
    }

    async function runAutoAssignments(preloadedPanels) {
        // Load roster snapshot used by assignments page
        const [rosterRes] = await Promise.all([
            fetch(`/api/assignments/${eventId}/roster`)
        ]);
        const assignData = { success: true, panels: preloadedPanels || [] };
        const rosterWrap = await rosterRes.json();
        const allPanels = Array.isArray(assignData.panels) ? assignData.panels : [];
        const roster = Array.isArray(rosterWrap?.roster) ? rosterWrap.roster : [];

        // Ensure Tanking and Healing panels have data
        const findMainPanel = (name) => allPanels.find(p => String(p.boss||'').toLowerCase() === name && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'));
        const tankPanel = findMainPanel('tanking');
        const healPanel = findMainPanel('healing');
        const tankHas = !!(tankPanel && Array.isArray(tankPanel.entries) && tankPanel.entries.some(e => (e.character_name||'').trim()))
        const healHas = !!(healPanel && Array.isArray(healPanel.entries) && healPanel.entries.some(e => (e.character_name||'').trim()))
        if (!tankHas || !healHas) {
            showAlert('Auto assignments', 'Please go to the main assignment page and do the Tanking and Healing assignments, before you run the auto assignments function');
            return;
        }

        // Helper data and functions mirroring assignments defaults
        const byClass = (cls) => roster.filter(r => String(r.class_name||'').toLowerCase() === cls);
        const sortByGS = (a,b) => ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99));
        const groups = [1,2,3,4,5,6,7,8];
        const contiguousChunks = (count) => {
            if (count <= 0) return [];
            const base = Math.floor(groups.length / count);
            const rem = groups.length % count;
            const chunks = [];
            let idx = 0;
            for (let i=0;i<count;i++) {
                const take = base + (i < rem ? 1 : 0);
                chunks.push(groups.slice(idx, idx+take));
                idx += take;
            }
            return chunks;
        };

        const piIcon = 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_powerinfusion.jpg';
        const iconFort = 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_wordfortitude.jpg';
        const iconInt  = 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_magicalsentry.jpg';
        const iconMotw = 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_regeneration.jpg';
        const iconDecurse = 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_removecurse.jpg';
        const iconDispel  = 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_dispelmagic.jpg';
        const iconCoR = 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_unholystrength.jpg';
        const iconCoE = 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_chilltouch.jpg';
        const iconCoS = 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_curseofachimonde.jpg';
        const iconSS  = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_orb_04.jpg';

        const makeEntry = (r, icon, text) => ({ character_name: r.character_name, class_name: r.class_name, spec_name: r.spec_name, spec_emote: r.spec_emote, marker_icon_url: icon, assignment: text, accept_status: null });

        // Tank targets (names) in order from existing Tanking panel
        const tankTargets = (Array.isArray(tankPanel?.entries) ? tankPanel.entries : [])
            .map(e => (e.character_name||'').trim())
            .filter(Boolean);

        const mages = byClass('mage').sort(sortByGS);
        const priests = byClass('priest').sort(sortByGS);
        const druids = byClass('druid').sort(sortByGS);
        const warlocks = byClass('warlock').sort(sortByGS);

        // Buffs defaults
        const buffsToAdd = (() => {
            const toAdd = [];
            const assignGroups = (players, iconUrl) => {
                if (!players.length) return;
                const chunks = contiguousChunks(players.length);
                const sorted = players.slice().sort(sortByGS).reverse();
                for (let i=0;i<sorted.length;i++) {
                    const r = sorted[i];
                    const chunk = chunks[i] || [];
                    if (!chunk.length) continue;
                    let text = '';
                    if (chunk.length === 8) text = 'All groups';
                    else if (chunk.length === 1) text = `Group ${chunk[0]}`;
                    else if (chunk.length === 2) text = `Group ${chunk[0]} and ${chunk[1]}`;
                    else { const head = chunk.slice(0, -1).join(', '); text = `Group ${head} and ${chunk[chunk.length-1]}`; }
                    toAdd.push(makeEntry(r, iconUrl, text));
                }
            };
            assignGroups(mages, iconInt);
            assignGroups(priests, iconFort);
            assignGroups(druids, iconMotw);
            return toAdd;
        })();

        // Decurse and Dispel defaults
        const cursesDispToAdd = (() => {
            const toAdd = [];
            const assignGroups = (players, iconUrl) => {
                if (!players.length) return;
                const chunks = contiguousChunks(players.length);
                const sorted = players.slice().sort(sortByGS).reverse();
                for (let i=0;i<sorted.length;i++) {
                    const r = sorted[i];
                    const chunk = chunks[i] || [];
                    if (!chunk.length) continue;
                    let text = '';
                    if (chunk.length === 8) text = 'All groups';
                    else if (chunk.length === 1) text = `Group ${chunk[0]}`;
                    else if (chunk.length === 2) text = `Group ${chunk[0]} and ${chunk[1]}`;
                    else { const head = chunk.slice(0, -1).join(', '); text = `Group ${head} and ${chunk[chunk.length-1]}`; }
                    toAdd.push(makeEntry(r, iconUrl, text));
                }
            };
            assignGroups(mages, iconDecurse);
            assignGroups(priests, iconDispel);
            return toAdd;
        })();

        // Curses and Soul Stones defaults
        const cursesSoulToAdd = (() => {
            const toAdd = [];
            if (warlocks[0]) toAdd.push(makeEntry(warlocks[0], iconCoR, 'Curse of Recklessness'));
            if (warlocks[1]) toAdd.push(makeEntry(warlocks[1], iconCoE, 'Curse of the Elements'));
            if (warlocks[2]) toAdd.push(makeEntry(warlocks[2], iconCoS, 'Curse of Shadow'));
            for (let i=0;i<3;i++) {
                if (warlocks[i] && priests[i]) toAdd.push(makeEntry(warlocks[i], iconSS, `Soulstone on ${priests[i].character_name}`));
            }
            return toAdd;
        })();

        // Power Infusion defaults
        const piToAdd = (() => {
            const toAdd = [];
            const pairs = Math.min(priests.length, mages.length);
            for (let i=0;i<pairs;i++) {
                const pr = priests[i];
                const mg = mages[i];
                toAdd.push({ character_name: pr.character_name, class_name: pr.class_name, spec_name: pr.spec_name, spec_emote: pr.spec_emote, marker_icon_url: piIcon, assignment: mg.character_name, accept_status: null });
            }
            return toAdd;
        })();

        function buildPayloadFor(bossName, toAdd) {
            const existing = findMainPanel(bossName.toLowerCase()) || { dungeon: 'Naxxramas', wing: '', boss: bossName, strategy_text: '', entries: [] };
            // Replace existing entries instead of appending
            const entries = [ ...toAdd ];
            return {
                dungeon: existing.dungeon || 'Naxxramas',
                wing: '',
                boss: bossName,
                strategy_text: existing.strategy_text || '',
                image_url: '',
                video_url: '',
                entries
            };
        }

        const payloadPanels = [];
        if (buffsToAdd.length) payloadPanels.push(buildPayloadFor('Buffs', buffsToAdd));
        if (cursesDispToAdd.length) payloadPanels.push(buildPayloadFor('Decurse and Dispel', cursesDispToAdd));
        if (cursesSoulToAdd.length) payloadPanels.push(buildPayloadFor('Curses and Soul Stones', cursesSoulToAdd));
        if (piToAdd.length) payloadPanels.push(buildPayloadFor('Power Infusion', piToAdd));

        if (!payloadPanels.length) {
            showAlert('Auto assignments', 'No defaults could be generated based on current roster.');
            return;
        }

        let saveRes = await fetch(`/api/assignments/${eventId}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ panels: payloadPanels })
        });
        if (!saveRes.ok) {
            const err = await saveRes.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to save assignments');
        }

        // If Naxx channel, continue to per-wing panels. For upcoming raids, default to NAX unless API explicitly says otherwise
        let isNax = true;
        try {
            const flagsRes = await fetch(`/api/events/${eventId}/channel-flags`);
            const flags = await flagsRes.json();
            if (flags && flags.success && typeof flags.isNax === 'boolean' && flags.channelId) {
                isNax = flags.isNax;
            }
        } catch {}

        if (isNax) {
            const payloadWingPanels = [];
            const byWingBoss = (wingSub, bossSub) => allPanels.find(p => String(p.wing||'').toLowerCase().includes(wingSub) && String(p.boss||'').toLowerCase().includes(bossSub));
            const tankMainPanel = allPanels.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main')) || allPanels.find(p => String(p.boss||'').toLowerCase()==='tanking');
            const findByPartySlot = (party, slot) => roster.find(r => Number(r.party_id) === Number(party) && Number(r.slot_id) === Number(slot));
            const findByMarkerFromMain = (markerSubstr) => {
                if (!tankMainPanel || !Array.isArray(tankMainPanel.entries)) return null;
                const entry = tankMainPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                if (!entry || !entry.character_name) return null;
                return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
            };
            const icons = { skull:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png', cross:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png', square:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png', moon:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png', triangle:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png', diamond:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png', circle:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png', star:'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/8_star_kbuiaq.png', death:'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_deathscream.jpg' };

            // Spider: Anub'Rekhan
            try {
                const panel = byWingBoss('spider', 'anub');
                if (panel) {
                    const toAdd = [];
                    const mt = findByPartySlot(1,1);
                    const ot1 = findByPartySlot(1,2);
                    const ot2 = findByPartySlot(1,3);
                    if (mt)  toAdd.push(makeEntry(mt,  icons.skull,  'Main Tank. Pick up the boss and face it away from the raid.'));
                    if (ot1) toAdd.push(makeEntry(ot1, icons.cross,  'Off Tank 1. Pick up the right add. Stack it on the boss and stand with the main tank. Use a FAP if needed.'));
                    if (ot2) toAdd.push(makeEntry(ot2, icons.square, 'Off Tank 2. Pick up the left add. Stack it on the boss and stand with the main tank. Use a FAP if needed.'));
                    payloadWingPanels.push({ dungeon: panel.dungeon||'Naxxramas', wing: panel.wing||'Spider Wing', boss: panel.boss, strategy_text: panel.strategy_text||'', image_url: panel.image_url||'', video_url: panel.video_url||'', entries: toAdd });
                }
            } catch {}

            // Spider: Grand Widow Faerlina
            try {
                const panel = byWingBoss('spider', 'faerlina');
                if (panel) {
                    const toAdd = [];
                    const pSorted = roster.filter(r => String(r.class_name).toLowerCase() === 'priest')
                        .sort((a,b) => (Number(a.party_id)||99) - (Number(b.party_id)||99) || (Number(a.slot_id)||99) - (Number(b.slot_id)||99));
                    const p1 = pSorted[0];
                    const p2 = pSorted[1];
                    const g11 = findByPartySlot(1,1); if (g11) toAdd.push(makeEntry(g11, icons.square,   'Tank the boss'));
                    const g12 = findByPartySlot(1,2); if (g12) toAdd.push(makeEntry(g12, icons.triangle, 'Tank the left 2 adds'));
                    if (g12)                          toAdd.push(makeEntry(g12, icons.moon,     'Tank the left 2 adds'));
                    const g13 = findByPartySlot(1,3); if (g13) toAdd.push(makeEntry(g13, icons.diamond, 'Tank the right 2 adds'));
                    if (g13)                          toAdd.push(makeEntry(g13, icons.circle,  'Tank the right 2 adds'));
                    const g21 = findByPartySlot(2,1); if (g21) toAdd.push(makeEntry(g21, icons.skull,   'Tank Skull'));
                    const g22 = findByPartySlot(2,2); if (g22) toAdd.push(makeEntry(g22, icons.cross,   'Tank Cross (pull it to boss)'));
                    if (p1) toAdd.push(makeEntry(p1, icons.diamond, "Use mind control and Widow's Embrace to dispel Enrage from the boss. Start with Diamond and Circle targets."));
                    if (p1) toAdd.push(makeEntry(p1, icons.circle,  "Use mind control and Widow's Embrace to dispel Enrage from the boss. Start with Diamond and Circle targets."));
                    if (p2) toAdd.push(makeEntry(p2, icons.circle,  'Backup mindcontrol in case the assigned priest dies or fails.'));
                    payloadWingPanels.push({ dungeon: panel.dungeon||'Naxxramas', wing: panel.wing||'Spider Wing', boss: panel.boss, strategy_text: panel.strategy_text||'', image_url: panel.image_url||'', video_url: panel.video_url||'', entries: toAdd });
                }
            } catch {}

            // Spider: Maexxna
            try {
                const panel = byWingBoss('spider', 'maex');
                const toAdd = [];
                const skullEntry = tankMainPanel?.entries?.find(en => String(en.marker_icon_url||'').includes('skull')) || tankMainPanel?.entries?.[0];
                if (skullEntry && skullEntry.character_name) {
                    const rMatch = roster.find(r => String(r.character_name).toLowerCase() === String(skullEntry.character_name).toLowerCase());
                    const rUse = rMatch || { character_name: skullEntry.character_name, class_name: skullEntry.class_name };
                    toAdd.push(makeEntry(rUse, icons.skull, 'Tank the boss (face it away from the raid)'));
                }
                roster.filter(r=>String(r.class_name||'').toLowerCase()==='hunter').forEach(r=>toAdd.push(makeEntry(r, null, 'Kill the webs')));
                roster.filter(r=>String(r.class_name||'').toLowerCase()==='warlock').forEach(r=>toAdd.push(makeEntry(r, null, 'Kill the webs')));
                const magesDesc = roster.filter(r=>String(r.class_name||'').toLowerCase()==='mage')
                    .sort((a,b)=> ((Number(b.party_id)||0)-(Number(a.party_id)||0)) || ((Number(b.slot_id)||0)-(Number(a.slot_id)||0)));
                if (magesDesc[0]) toAdd.push(makeEntry(magesDesc[0], null, 'Kill the webs'));
                if (magesDesc[1]) toAdd.push(makeEntry(magesDesc[1], null, 'Kill the webs'));
                roster.filter(r=>String(r.class_name||'').toLowerCase()==='druid').forEach(r=>toAdd.push(makeEntry(r, null, 'Cleanse poison on Tank before webspray')));
                const shamansAsc = roster.filter(r=>String(r.class_name||'').toLowerCase()==='shaman')
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (shamansAsc[0]) toAdd.push(makeEntry(shamansAsc[0], null, 'Keep poison cleansing totem up for the tank before webspray.'));
                // Use existing panel info if present; otherwise create new panel definition for save
                const wing = (panel && panel.wing) || 'Spider Wing';
                const boss = (panel && panel.boss) || 'Maexxna';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Military: Instructor Razuvious
            try {
                const panel = byWingBoss('military', 'razu');
                const toAdd = [];
                const pickTankByIndex = (idx) => {
                    const en = tankMainPanel?.entries?.[idx-1];
                    if (!en || !en.character_name) return null;
                    return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t2 = pickTankByIndex(2);
                const t3 = pickTankByIndex(3);
                const t4 = pickTankByIndex(4);
                if (t2) toAdd.push(makeEntry(t2, icons.cross,   'Tank the left 2 adds (near but not on top of the priests)'));
                if (t2) toAdd.push(makeEntry(t2, icons.square,  'Tank the left 2 adds (near but not on top of the priests)'));
                if (t3) toAdd.push(makeEntry(t3, icons.moon,    'Tank the right 2 adds (near but not on top of the priests)'));
                if (t4) toAdd.push(makeEntry(t4, icons.diamond, 'Tank the right 2 adds (near but not on top of the priests)'));

                const priestsAsc = roster.filter(r => String(r.class_name||'').toLowerCase()==='priest')
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (priestsAsc[0]) toAdd.push(makeEntry(priestsAsc[0], icons.cross,  'Mind control duty (You pull)'));
                if (priestsAsc[0]) toAdd.push(makeEntry(priestsAsc[0], icons.square, 'Mind control duty'));
                if (priestsAsc[1]) toAdd.push(makeEntry(priestsAsc[1], icons.moon,   'Mind control duty'));
                if (priestsAsc[1]) toAdd.push(makeEntry(priestsAsc[1], icons.diamond,'Mind control duty'));

                const crate = 'https://wow.zamimg.com/images/wow/icons/large/inv_crate_06.jpg';
                const warriorsG2 = roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior' && Number(r.party_id)===2)
                    .sort((a,b)=> (Number(a.slot_id)||99)-(Number(b.slot_id)||99));
                const warriorsG3 = roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior' && Number(r.party_id)===3)
                    .sort((a,b)=> (Number(a.slot_id)||99)-(Number(b.slot_id)||99));
                if (warriorsG2[0]) toAdd.push(makeEntry(warriorsG2[0], crate, 'Target Dummy #1'));
                if (warriorsG2[1]) toAdd.push(makeEntry(warriorsG2[1], crate, 'Target Dummy #2'));
                if (warriorsG2[2]) toAdd.push(makeEntry(warriorsG2[2], crate, 'Target Dummy #3'));
                if (warriorsG3[0]) toAdd.push(makeEntry(warriorsG3[0], crate, 'Target Dummy #4'));
                if (warriorsG3[1]) toAdd.push(makeEntry(warriorsG3[1], crate, 'Target Dummy #5'));
                if (warriorsG3[2]) toAdd.push(makeEntry(warriorsG3[2], crate, 'Target Dummy #6'));

                const wing = (panel && panel.wing) || 'Military';
                const boss = (panel && panel.boss) || 'Razuvious';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Military: Gothik the Harvester
            try {
                const panel = byWingBoss('military', 'goth');
                const toAdd = [];
                const skull    = findByMarkerFromMain('skull');
                const cross    = findByMarkerFromMain('cross');
                const square   = findByMarkerFromMain('square');
                const moon     = findByMarkerFromMain('moon');
                const triangle = findByMarkerFromMain('triangle');
                const diamond  = findByMarkerFromMain('diamond');
                if (skull)    toAdd.push(makeEntry(skull,    icons.skull,    'Tank the middle platform'));
                if (cross)    toAdd.push(makeEntry(cross,    icons.cross,    'Tank the left platform'));
                if (square)   toAdd.push(makeEntry(square,   icons.square,   'Tank the right platform'));
                if (moon)     toAdd.push(makeEntry(moon,     icons.moon,     'Tank the front pile'));
                if (triangle) toAdd.push(makeEntry(triangle, icons.triangle, 'Tank the left pile'));
                if (diamond)  toAdd.push(makeEntry(diamond,  icons.diamond,  'Tank the back right pile'));

                roster.filter(r=>['warlock','hunter'].includes(String(r.class_name||'').toLowerCase()))
                    .forEach(r=> toAdd.push(makeEntry(r, null, 'Place your Pet / Void Walker between the platforms to absorbe charge.')));

                const isHealer = (r) => ['shaman','priest','druid'].includes(String(r.class_name||'').toLowerCase());
                const inGroups = (r, groups) => groups.includes(Number(r.party_id));
                const undeadHealers = roster.filter(r=>isHealer(r) && inGroups(r, [2,3,4,5]));
                const humanHealers  = roster.filter(r=>isHealer(r) && inGroups(r, [1,6,7]));
                undeadHealers.forEach(r=> toAdd.push(makeEntry(r, icons.star,   'Go heal Undead side.')));
                humanHealers.forEach(r=> toAdd.push(makeEntry(r, icons.circle, 'Go heal Human side.')));
                let undeadCount = undeadHealers.length;
                let humanCount = humanHealers.length;
                const group8Healers = roster.filter(r=>isHealer(r) && Number(r.party_id)===8);
                group8Healers.forEach(r => {
                    if (undeadCount <= humanCount) { toAdd.push(makeEntry(r, icons.star,   'Go heal Undead side.')); undeadCount += 1; }
                    else {                           toAdd.push(makeEntry(r, icons.circle, 'Go heal Human side.'));  humanCount += 1; }
                });

                const wing = (panel && panel.wing) || 'Military';
                const boss = (panel && panel.boss) || 'Gothik';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Military: The Four Horsemen
            try {
                const panel = byWingBoss('military', 'horse');
                const toAdd = [];
                const isHealer = (r) => ['shaman','priest','druid'].includes(String(r.class_name||'').toLowerCase());
                const sortByGS = (a,b) => ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99));
                const shamans = roster.filter(r=>isHealer(r) && String(r.class_name||'').toLowerCase()==='shaman').sort(sortByGS);
                const priests = roster.filter(r=>isHealer(r) && String(r.class_name||'').toLowerCase()==='priest').sort(sortByGS);
                const druids  = roster.filter(r=>isHealer(r) && String(r.class_name||'').toLowerCase()==='druid').sort(sortByGS);
                const ordered = [...shamans, ...priests, ...druids].slice(0,12);
                const raidOrder = [
                    { name: 'skull', icon: icons.skull },
                    { name: 'cross', icon: icons.cross },
                    { name: 'square', icon: icons.square },
                    { name: 'moon',  icon: icons.moon }
                ];
                for (let i=0;i<ordered.length;i++) {
                    const block = Math.floor(i/3);
                    const posInBlock = (i%3)+1;
                    const raid = raidOrder[block] || raidOrder[raidOrder.length-1];
                    const r = ordered[i];
                    const text = `Start on ${raid.name} rotate on ${posInBlock}`;
                    toAdd.push(makeEntry(r, raid.icon, text));
                }
                // Build Warriors / Marks (tanking rotation grid) from Main -> Tanking panel
                const getTankByIndex = (idx) => {
                    const en = tankMainPanel?.entries?.[idx-1];
                    if (!en || !en.character_name) return null;
                    return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const indexMap = [null, 3, 2, 1, 4, 5, 6, 7, 8];
                const horsemenTanks = {};
                for (let row=1; row<=8; row++) {
                    const srcIdx = indexMap[row] ?? row;
                    const t = getTankByIndex(srcIdx);
                    const name = t ? t.character_name : null;
                    horsemenTanks[row] = [name];
                    // also persist as hidden entries so UI can derive if object is missing
                    toAdd.push({ character_name: name || '', class_name: null, spec_name: null, spec_emote: null, marker_icon_url: null, assignment: `__HGRID__:${row}:1`, accept_status: null });
                }

                const wing = (panel && panel.wing) || 'Military';
                const boss = (panel && panel.boss) || 'The Four Horsemen';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd, horsemen_tanks: horsemenTanks });
            } catch {}

            // Plague: Noth The Plaguebringer
            try {
                const panel = byWingBoss('plague', 'noth');
                const toAdd = [];
                const getTankByIndex = (idx) => {
                    const en = tankMainPanel?.entries?.[idx-1];
                    if (!en || !en.character_name) return null;
                    return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t1 = getTankByIndex(1);
                const t2 = getTankByIndex(2);
                const t3 = getTankByIndex(3);
                const t4 = getTankByIndex(4);
                if (t1) toAdd.push(makeEntry(t1, icons.skull,  'Tank the boss'));
                if (t2) toAdd.push(makeEntry(t2, null,        'Save Deathwish for the blink and pick up boss after blink and agro reset.'));
                if (t3) toAdd.push(makeEntry(t3, null,        'Pick up adds'));
                if (t4) toAdd.push(makeEntry(t4, null,        'Pick up adds'));
                const wing = (panel && panel.wing) || 'Plague';
                const boss = (panel && panel.boss) || 'Noth The Plaguebringer';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Plague: Heigan The Unclean
            try {
                const panel = byWingBoss('plague', 'heig');
                const toAdd = [];
                const getTankByIndex = (idx) => {
                    const en = tankMainPanel?.entries?.[idx-1];
                    if (!en || !en.character_name) return null;
                    return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t1 = getTankByIndex(1);
                if (t1) toAdd.push(makeEntry(t1, icons.skull, 'Tank the boss'));
                const priests = roster.filter(r => String(r.class_name||'').toLowerCase()==='priest')
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (priests[0]) toAdd.push(makeEntry(priests[0], null, 'Instantly remove disease from the tank.'));
                const wing = (panel && panel.wing) || 'Plague';
                const boss = (panel && panel.boss) || 'Heigan The Unclean';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Plague: Loatheb (includes Spore Groups grid)
            try {
                const panel = byWingBoss('plague', 'loatheb');
                const toAdd = [];
                // Tanks
                const getTankByIndex = (idx) => {
                    const en = tankMainPanel?.entries?.[idx-1];
                    if (!en || !en.character_name) return null;
                    return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t1 = getTankByIndex(1);
                const t2 = getTankByIndex(2);
                if (t1) toAdd.push(makeEntry(t1, icons.skull, "Tank the boss. (turn it 90 degree to it's left and move it a few steps back)"));
                if (t2) toAdd.push(makeEntry(t2, icons.skull, 'Backup tank. Get to 2nd on threat and put on a shield.'));
                // Healers alphabetical
                const healers = roster.filter(r=>['shaman','druid','priest'].includes(String(r.class_name||'').toLowerCase()))
                    .sort((a,b)=> String(a.character_name||'').localeCompare(String(b.character_name||'')));
                healers.forEach(r => toAdd.push(makeEntry(r, null, "Heal the tank when it's your turn to heal.")));

                // Spore Groups auto-fill
                // Exclude 4 tanks from Main->Tanking
                const pickName = (idx) => {
                    const en = tankMainPanel?.entries?.[idx-1];
                    return en?.character_name ? String(en.character_name) : null;
                };
                const tankIds = [pickName(1), pickName(2), pickName(3), pickName(4)].filter(Boolean);
                const mages = roster.filter(r=>String(r.class_name||'').toLowerCase()==='mage');
                const warriorsAll = roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior');
                const warriorNotTanks = warriorsAll.filter(r=>!tankIds.some(n=>String(n).toLowerCase()===String(r.character_name||'').toLowerCase()))
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                const rogues = roster.filter(r=>String(r.class_name||'').toLowerCase()==='rogue');
                const warlocks = roster.filter(r=>String(r.class_name||'').toLowerCase()==='warlock');
                const hunters = roster.filter(r=>String(r.class_name||'').toLowerCase()==='hunter');
                const tanksFinal = tankIds.map(name => roster.find(r=>String(r.character_name).toLowerCase()===String(name).toLowerCase()) || { character_name: name });
                const ordered = [...mages, ...warriorNotTanks, ...rogues, ...warlocks, ...hunters, ...tanksFinal];
                const sporeGroups = { 1:[],2:[],3:[],4:[],5:[],6:[] };
                let ptr = 0;
                for (let g=1; g<=6; g++) {
                    for (let s=1; s<=5; s++) {
                        const r = ordered[ptr++];
                        const name = r ? r.character_name : null;
                        sporeGroups[g][s-1] = name || null;
                        // Hidden entry to persist grid state too
                        toAdd.push({ character_name: name || '', class_name: null, spec_name: null, spec_emote: null, marker_icon_url: null, assignment: `__SPORE__:${g}:${s}`, accept_status: null });
                    }
                }

                const wing = (panel && panel.wing) || 'Plague';
                const boss = (panel && panel.boss) || 'Loatheb';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd, spore_groups: sporeGroups });
            } catch {}

            // Abomination: Patchwerk
            try {
                const panel = byWingBoss('abomination', 'patch');
                const toAdd = [];
                const findByMarker = (markerSubstr) => findByMarkerFromMain(markerSubstr);
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                if (t1) toAdd.push(makeEntry(t1, icons.circle,  'Tank Boss'));
                if (t2) toAdd.push(makeEntry(t2, icons.star,    'Absorb hateful strike'));
                if (t3) toAdd.push(makeEntry(t3, icons.diamond, 'Absorb hateful strike'));
                const isHealer = (r) => ['shaman','priest','druid'].includes(String(r.class_name||'').toLowerCase());
                const healers = roster.filter(isHealer).sort((a,b)=> String(a.character_name||'').localeCompare(String(b.character_name||'')));
                const tankTargets = [ t1?.character_name || '', t2?.character_name || '', t3?.character_name || '' ];
                const tankIcons = [ icons.circle, icons.star, icons.diamond ];
                for (let i=0; i<healers.length; i++) {
                    if (i < 12 && (t1 || t2 || t3)) {
                        const block = Math.floor(i/4);
                        const avail = tankTargets.filter(Boolean).length || 0;
                        const tankIdx = avail ? Math.min(block, avail-1) : 0;
                        const targetName = tankTargets[tankIdx] || '';
                        if (targetName) toAdd.push(makeEntry(healers[i], tankIcons[tankIdx] || null, `Heal ${targetName}`));
                        else toAdd.push(makeEntry(healers[i], null, 'FFA Heal tanks only'));
                    } else {
                        toAdd.push(makeEntry(healers[i], null, 'FFA Heal tanks only'));
                    }
                }
                const wing = (panel && panel.wing) || 'Abomination';
                const boss = (panel && panel.boss) || 'Patchwerk';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Abomination: Grobbulus
            try {
                const panel = byWingBoss('abomination', 'grobb');
                const toAdd = [];
                const t1 = findByMarkerFromMain('skull');
                const t2 = findByMarkerFromMain('cross');
                const t3 = findByMarkerFromMain('square');
                if (t1) toAdd.push(makeEntry(t1, icons.skull, 'Tank Boss'));
                if (t2) toAdd.push(makeEntry(t2, null,        'Tank slimes'));
                if (t3) toAdd.push(makeEntry(t3, null,        'Tank slimes (backup)'));
                const priests = roster.filter(r=>String(r.class_name||'').toLowerCase()==='priest')
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (priests[0]) toAdd.push(makeEntry(priests[0], null, 'Dispel when players is at the edge.'));
                const wing = (panel && panel.wing) || 'Abomination';
                const boss = (panel && panel.boss) || 'Grobbulus';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Abomination: Gluth
            try {
                const panel = byWingBoss('abomination', 'gluth');
                const toAdd = [];
                const t1 = findByMarkerFromMain('skull');
                const t2 = findByMarkerFromMain('cross');
                const t3 = findByMarkerFromMain('square');
                if (t1) toAdd.push(makeEntry(t1, icons.skull, 'Tank Boss'));
                if (t2) toAdd.push(makeEntry(t2, icons.skull, 'Backup Tank Boss (in casee main tank fails fear dodge)'));
                if (t3) toAdd.push(makeEntry(t3, icons.death, 'Piercing Howl Tank adds'));
                const wing = (panel && panel.wing) || 'Abomination';
                const boss = (panel && panel.boss) || 'Gluth';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Abomination: Thaddius
            try {
                const panel = byWingBoss('abomination', 'thadd');
                const toAdd = [];
                const findByMarker = (markerSubstr) => findByMarkerFromMain(markerSubstr);
                const id1 = findByMarker('skull');
                const id2 = findByMarker('cross');
                const id3 = findByMarker('square');
                const id4 = findByMarker('moon');
                if (id1) toAdd.push(makeEntry(id1, icons.skull, 'Tank Stalagg (Left Side)'));
                if (id3) toAdd.push(makeEntry(id3, icons.skull, 'Tank Stalagg (Left Side)'));
                if (id2) toAdd.push(makeEntry(id2, icons.cross, 'Tank Feugen (Right Side)'));
                if (id4) toAdd.push(makeEntry(id4, icons.cross, 'Tank Feugen (Right Side)'));
                if (id1) toAdd.push(makeEntry(id1, icons.skull, 'Tank Boss'));

                const healerClasses = new Set(['shaman','priest','druid']);
                const g8HealersAll = roster
                    .filter(r => Number(r.party_id) === 8 && healerClasses.has(String(r.class_name||'').toLowerCase()))
                    .sort((a,b)=> (Number(a.slot_id)||99) - (Number(b.slot_id)||99));
                const g8Healers = g8HealersAll.slice(0,5);
                if (g8Healers.length > 0) {
                    const classToPlayers = new Map();
                    for (const r of g8Healers) {
                        const cls = String(r.class_name||'').toLowerCase();
                        if (!classToPlayers.has(cls)) classToPlayers.set(cls, []);
                        classToPlayers.get(cls).push(r);
                    }
                    const left = [];
                    const right = [];
                    const placed = new Set();
                    for (const [cls, arr] of classToPlayers.entries()) {
                        if (arr.length >= 2) {
                            const a = arr[0]; const b = arr[1];
                            left.push(a);  placed.add(a.character_name);
                            right.push(b); placed.add(b.character_name);
                        }
                    }
                    const leftovers = g8Healers.filter(r => !placed.has(r.character_name));
                    for (const r of leftovers) {
                        if (left.length < right.length) left.push(r); else right.push(r);
                    }
                    for (const r of left)  toAdd.push(makeEntry(r, null, 'Go left side'));
                    for (const r of right) toAdd.push(makeEntry(r, null, 'Go right side'));
                }

                const wing = (panel && panel.wing) || 'Abomination';
                const boss = (panel && panel.boss) || 'Thaddius';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Frostwyrm Lair: Sapphiron
            try {
                const panel = byWingBoss('frost', 'sapph');
                const toAdd = [];
                const t1 = findByMarkerFromMain('skull');
                const t2 = findByMarkerFromMain('cross');
                if (t1) toAdd.push(makeEntry(t1, icons.skull, 'Tank Boss'));
                if (t2) toAdd.push(makeEntry(t2, icons.skull, 'Backup Tank Boss (Stay 2nd on threat)'));

                const mages = roster.filter(r => String(r.class_name||'').toLowerCase()==='mage');
                const leftCap = Math.floor(mages.length / 2);
                const rightCap = mages.length - leftCap;
                const mageLeft = mages.slice(0, leftCap);
                const mageRight = mages.slice(leftCap, leftCap + rightCap);
                mageLeft.forEach(m => toAdd.push(makeEntry(m, null, 'Decurse Tank + left')));
                mageRight.forEach(m => toAdd.push(makeEntry(m, null, 'Decurse Tank + right')));

                const shamans = roster.filter(r => String(r.class_name||'').toLowerCase()==='shaman');
                const priests = roster.filter(r => String(r.class_name||'').toLowerCase()==='priest');
                const druidsH = roster.filter(r => String(r.class_name||'').toLowerCase()==='druid');
                const healers = [...shamans, ...priests, ...druidsH];
                healers.forEach((r, i) => {
                    let text = '';
                    if (i === 0) text = 'Heal Tank + Group';
                    else if (i <= 4) text = 'Heal Group';
                    else if (i <= 7) text = 'Heal Group + Tank';
                    else if (i <= 11) text = 'Heal Tank';
                    else text = 'Heal Raid';
                    toAdd.push(makeEntry(r, null, text));
                });

                const wing = (panel && panel.wing) || 'Frostwyrm_Lair';
                const boss = (panel && panel.boss) || 'Sapphiron';
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd });
            } catch {}

            // Frostwyrm Lair: Kel'Thuzad (includes Kel Groups grid)
            try {
                const panel = byWingBoss('frost', 'kel');
                const toAdd = [];
                const findByMarker = (markerSubstr) => findByMarkerFromMain(markerSubstr);
                const id1 = findByMarker('skull');
                const id2 = findByMarker('cross');
                const id3 = findByMarker('square');
                const id4 = findByMarker('moon');
                if (id1) toAdd.push(makeEntry(id1, icons.skull, 'Tank Boss'));
                if (id2) toAdd.push(makeEntry(id2, icons.skull, 'Tank Boss'));
                if (id3) toAdd.push(makeEntry(id3, icons.skull, 'Tank Boss'));
                if (id4) toAdd.push(makeEntry(id4, icons.skull, 'Tank Boss'));

                // Build Kel groups: D gets 4 tanks in order; B gets all rogues; remaining warriors spread across A,B,C
                const kelGroups = { 1: [], 2: [], 3: [], 4: [] };
                kelGroups[4] = [id1?.character_name||null, id2?.character_name||null, id3?.character_name||null, id4?.character_name||null].filter(Boolean);
                const rogues = roster.filter(r => String(r.class_name||'').toLowerCase()==='rogue');
                const allWarriors = roster.filter(r => String(r.class_name||'').toLowerCase()==='warrior');
                const tankNamesLower = [id1?.character_name, id2?.character_name, id3?.character_name, id4?.character_name]
                    .filter(Boolean).map(n => String(n).toLowerCase());
                const remainingWarriors = allWarriors.filter(r => !tankNamesLower.includes(String(r.character_name||'').toLowerCase()));
                kelGroups[2] = rogues.map(r => r.character_name);
                const counts = { 1: (kelGroups[1]||[]).length, 2: (kelGroups[2]||[]).length, 3: (kelGroups[3]||[]).length };
                for (const w of remainingWarriors) {
                    const order = [1,3,2];
                    let best = 1;
                    for (const g of order) { if (counts[g] < counts[best]) best = g; }
                    if (!kelGroups[best]) kelGroups[best] = [];
                    kelGroups[best].push(w.character_name);
                    counts[best] += 1;
                }
                // Hidden entries for grid persistence
                Object.entries(kelGroups).forEach(([group, arr]) => {
                    (arr||[]).forEach((name, idx) => {
                        if (!name) return;
                        toAdd.push({ character_name: name, class_name: null, spec_name: null, spec_emote: null, marker_icon_url: null, assignment: `__KEL__:${group}:${idx+1}`, accept_status: null });
                    });
                });

                // Priests: 3 lowest by group/slot with shackle text
                const priests = roster.filter(r => String(r.class_name||'').toLowerCase()==='priest')
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)))
                    .slice(0,3);
                const priestIcons = [icons.star, icons.moon, icons.cross];
                const priestTexts = ['Shackle Left, middle, right.', 'Shackle Left, middle, right.', 'Shackle Left, middle, right.'];
                priests.forEach((p, i) => { toAdd.push(makeEntry(p, priestIcons[i] || null, priestTexts[i])); });

                // Shamans: 4 lowest by group/slot with mark-specific text
                const shamans4 = roster.filter(r => String(r.class_name||'').toLowerCase()==='shaman')
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)))
                    .slice(0,4);
                const shamanIcons = [icons.triangle, icons.diamond, icons.square, icons.circle];
                const shamanMarks = ['Triangle','Diamond','Square','Circle'];
                shamans4.forEach((s, i) => { toAdd.push(makeEntry(s, shamanIcons[i] || null, `NF+Chain Heal on ${shamanMarks[i] || 'Triangle'}`)); });

                const wing = (panel && panel.wing) || 'Frostwyrm_Lair';
                const boss = (panel && panel.boss) || "Kel'Thuzad";
                const dungeon = (panel && panel.dungeon) || 'Naxxramas';
                payloadWingPanels.push({ dungeon, wing, boss, strategy_text: (panel && panel.strategy_text) || '', image_url: (panel && panel.image_url) || '', video_url: (panel && panel.video_url) || '', entries: toAdd, kel_groups: kelGroups });
            } catch {}

            if (payloadWingPanels.length) {
                saveRes = await fetch(`/api/assignments/${eventId}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panels: payloadWingPanels }) });
                if (!saveRes.ok) {
                    const err2 = await saveRes.json().catch(() => ({}));
                    throw new Error(err2.message || 'Failed to save wing assignments');
                }
            }
        }

        showAlert('Auto assignments', 'All assignments has been done');
    }

    function handleAddNewCharacter(targetPartyId, targetSlotId) {
        // Close any open dropdowns
        document.querySelectorAll('.player-details-dropdown.show').forEach(d => d.classList.remove('show'));
        
        // Create and show the add character modal with spec field enabled for roster
        const modal = new AddCharacterModal({
            showSpecField: true,
            onSubmit: async (characterData) => {
                try {
                    // Call the API to add the character to this position
                    await addCharacterToRoster(eventId, characterData, targetPartyId, targetSlotId);
                    
                    // Refresh the roster to show the new character
                    renderRoster();
                    
                    // Mark as managed and show revert button
                    isManaged = true;
                    updateRevertButtonVisibility();
                    
                    // Character added successfully
                } catch (error) {
                    console.error('Error adding character:', error);
                    
                    // Check if this is a conflict error that needs user confirmation
                    if (error.isConflict && error.conflictData) {
                        handleCharacterConflict(error.conflictData, characterData, targetPartyId, targetSlotId);
                        return; // Don't show generic error
                    }
                    
                    showAlert('Add Character Error', `Error adding character: ${error.message}`);
                }
            },
            onCancel: () => {
                // Character addition cancelled
            }
        });
        
        modal.show();
    }

    function getClassColor(className) {
        const classColors = {
            'death knight': '196,30,59',
            'druid': '255,125,10',
            'hunter': '171,212,115',
            'mage': '105,204,240',
            'paladin': '245,140,186',
            'priest': '255,255,255',
            'rogue': '255,245,105',
            'shaman': '0,112,222',
            'warlock': '148,130,201',
            'warrior': '199,156,110'
        };
        const canonical = getCanonicalClass(className);
        return classColors[canonical] || '128,128,128';
    }

    async function handleCharacterConflict(conflictData, characterData, targetPartyId, targetSlotId) {
        const { error, message, existingCharacter, existingCharacters } = conflictData;

        if (error === 'EXACT_DUPLICATE') {
            // Exact duplicate - refuse creation
            showAlert('Cannot Create Character', message);
            return;
        }

        if (error === 'NAME_CONFLICT') {
            // Same name, different class - show confirmation with color-coded classes
            const existingClassColor = getClassColor(existingCharacter.class);
            const newClassColor = getClassColor(characterData.class);
            
            const messageHtml = `
                <p>A character named <strong>"${existingCharacter.name}"</strong> already exists with class 
                <span style="color: rgb(${existingClassColor}); font-weight: bold;">${existingCharacter.class}</span>.</p>
                
                <p>Do you want to create this character with class 
                <span style="color: rgb(${newClassColor}); font-weight: bold;">${characterData.class}</span>?</p>
                
                <p style="color: #f39c12; margin-top: 15px;"><strong>⚠️ This will create two characters with the same name but different classes.</strong></p>
            `;

            showCustomModal({
                type: 'confirm',
                title: 'Character Name Conflict',
                message: messageHtml,
                allowHtmlContent: true,
                buttons: [
                    { text: 'Cancel', action: 'cancel', style: 'secondary' },
                    { text: 'Create Anyway', action: 'confirm', style: 'primary' }
                ],
                onConfirm: () => forceCreateCharacter(characterData, targetPartyId, targetSlotId)
            });
            return;
        }

        if (error === 'DISCORD_ID_CONFLICT') {
            // Multiple characters with same Discord ID - show detailed list with colors
            const characterListHtml = existingCharacters.map(char => {
                const classColor = getClassColor(char.class);
                return `<li style="display: flex; align-items: center; padding: 5px 0;">
                    <div style="width: 12px; height: 12px; background-color: rgb(${classColor}); border-radius: 2px; margin-right: 10px;"></div>
                    <span><strong>${char.name}</strong> <span style="color: rgb(${classColor}); font-weight: bold;">(${char.class})</span></span>
                </li>`;
            }).join('');

            const newCharColor = getClassColor(characterData.class);

            const messageHtml = `
                <p>${message}</p>
                
                <div style="margin: 15px 0;">
                    <strong>Existing characters:</strong>
                    <ul style="list-style: none; padding: 10px 0; margin: 0;">${characterListHtml}</ul>
                </div>
                
                <p>Do you want to create 
                <strong>"${characterData.characterName}"</strong> 
                <span style="color: rgb(${newCharColor}); font-weight: bold;">(${characterData.class})</span> anyway?</p>
            `;

            showCustomModal({
                type: 'confirm',
                title: 'Discord ID Conflict',
                message: messageHtml,
                allowHtmlContent: true,
                buttons: [
                    { text: 'Cancel', action: 'cancel', style: 'secondary' },
                    { text: 'Create Anyway', action: 'confirm', style: 'primary' }
                ],
                onConfirm: () => forceCreateCharacter(characterData, targetPartyId, targetSlotId)
            });
            return;
        }
    }

    async function forceCreateCharacter(characterData, targetPartyId, targetSlotId) {
        try {
            // Use the force creation endpoint
            await addCharacterToRosterForce(eventId, characterData, targetPartyId, targetSlotId);
            
            // Refresh the roster to show the new character
            renderRoster();
            
            // Mark as managed and show revert button
            isManaged = true;
            updateRevertButtonVisibility();
            
                            // Character force-created successfully
        } catch (error) {
            console.error('Error force creating character:', error);
            showAlert('Create Character Error', `Error creating character: ${error.message}`);
        }
    }

    async function sendAssignmentsDMs() {
        // Create and show the overlay
        const { wrap, listWrap, sendBtn, cbAll } = createAssignmentsOverlay();
        await populateAssignmentsOverlayList(listWrap);
        wireAssignmentsSelectAll(cbAll, listWrap);
        sendBtn.onclick = () => { sendAssignmentsBatch(listWrap, sendBtn); };
    }

    function createAssignmentsOverlay() {
        let wrap = document.getElementById('assignmentsDmOverlay');
        if (wrap) {
            wrap.remove();
        }
        wrap = document.createElement('div');
        wrap.id = 'assignmentsDmOverlay';
        wrap.style.position = 'fixed';
        wrap.style.inset = '0';
        wrap.style.background = 'rgba(0,0,0,0.6)';
        wrap.style.zIndex = '1000';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        
        const panel = document.createElement('div');
        panel.style.background = '#111827';
        panel.style.border = '1px solid #374151';
        panel.style.borderRadius = '10px';
        panel.style.width = 'min(720px, 92vw)';
        panel.style.maxHeight = '80vh';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.padding = '14px';
        panel.style.color = '#e5e7eb';
        panel.id = 'assignmentsDmOverlayPanel';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '8px';
        
        const title = document.createElement('div');
        title.textContent = 'Send assignment DMs';
        title.style.fontWeight = '800';
        title.style.fontSize = '18px';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.background = 'transparent';
        closeBtn.style.border = '1px solid #4b5563';
        closeBtn.style.color = '#e5e7eb';
        closeBtn.style.borderRadius = '6px';
        closeBtn.style.padding = '4px 8px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => { document.body.removeChild(wrap); };
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        
        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.alignItems = 'center';
        controls.style.gap = '10px';
        controls.style.margin = '6px 0 10px 0';
        
        const selectAll = document.createElement('label');
        selectAll.style.cursor = 'pointer';
        const cbAll = document.createElement('input');
        cbAll.type = 'checkbox';
        cbAll.checked = true;
        cbAll.style.marginRight = '6px';
        cbAll.style.cursor = 'pointer';
        selectAll.appendChild(cbAll);
        selectAll.appendChild(document.createTextNode('Select all'));
        controls.appendChild(selectAll);
        
        const listWrap = document.createElement('div');
        listWrap.id = 'assignmentsDmOverlayList';
        listWrap.style.overflow = 'auto';
        listWrap.style.border = '1px solid #374151';
        listWrap.style.borderRadius = '8px';
        listWrap.style.padding = '8px';
        listWrap.style.flex = '1 1 auto';
        listWrap.style.maxHeight = '58vh';
        
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.alignItems = 'center';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '10px';
        footer.style.marginTop = '10px';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.background = '#1f2937';
        cancelBtn.style.border = '1px solid #4b5563';
        cancelBtn.style.color = '#e5e7eb';
        cancelBtn.style.borderRadius = '8px';
        cancelBtn.style.padding = '8px 12px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.onclick = () => { document.body.removeChild(wrap); };
        
        const sendBtn = document.createElement('button');
        sendBtn.id = 'assignmentsDmOverlaySendBtn';
        sendBtn.textContent = 'Send to selected';
        sendBtn.style.background = '#2563eb';
        sendBtn.style.border = '1px solid #1d4ed8';
        sendBtn.style.color = '#e5e7eb';
        sendBtn.style.borderRadius = '8px';
        sendBtn.style.padding = '8px 12px';
        sendBtn.style.cursor = 'pointer';
        
        footer.appendChild(cancelBtn);
        footer.appendChild(sendBtn);
        
        panel.appendChild(header);
        panel.appendChild(controls);
        panel.appendChild(listWrap);
        panel.appendChild(footer);
        wrap.appendChild(panel);
        document.body.appendChild(wrap);
        
        return { wrap, listWrap, sendBtn, cbAll };
    }

    async function populateAssignmentsOverlayList(listWrap) {
        listWrap.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">Loading players...</div>';
        
        try {
            // Fetch roster data
            const response = await fetch(`/api/assignments/${eventId}/roster`);
            const data = await response.json();
            
            if (!data || !data.success || !Array.isArray(data.roster)) {
                throw new Error('Failed to load roster');
            }
            
            const players = data.roster
                .filter(p => p.character_name && p.discord_user_id)
                .sort((a, b) => String(a.character_name || '').localeCompare(String(b.character_name || '')));
            
            listWrap.innerHTML = '';
            
            players.forEach(p => {
                const row = document.createElement('div');
                row.style.display = 'grid';
                row.style.gridTemplateColumns = '24px 1fr 140px';
                row.style.gap = '8px';
                row.style.alignItems = 'center';
                row.style.padding = '6px 4px';
                row.style.borderBottom = '1px solid #1f2937';
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = true;
                cb.className = 'assignments-dm-select';
                cb.style.cursor = 'pointer';
                
                const name = document.createElement('div');
                name.textContent = String(p.character_name || '');
                
                const status = document.createElement('div');
                status.textContent = 'pending';
                status.style.color = '#9ca3af';
                status.style.textAlign = 'right';
                status.className = 'assignments-dm-status';
                
                row.dataset.playerName = String(p.character_name || '');
                row.dataset.discordUserId = String(p.discord_user_id || '');
                row.appendChild(cb);
                row.appendChild(name);
                row.appendChild(status);
                listWrap.appendChild(row);
            });
            
            if (players.length === 0) {
                listWrap.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">No players found in roster</div>';
            }
        } catch (error) {
            console.error('Error loading players:', error);
            listWrap.innerHTML = '<div style="text-align: center; padding: 20px; color: #ef4444;">Error loading players</div>';
        }
    }

    function wireAssignmentsSelectAll(cbAll, listWrap) {
        cbAll.addEventListener('change', () => {
            listWrap.querySelectorAll('input.assignments-dm-select:not(:disabled)').forEach(cb => {
                cb.checked = cbAll.checked;
            });
        });
    }

    async function sendAssignmentsBatch(listWrap, sendBtn) {
        const rows = Array.from(listWrap.children);
        const selected = rows.filter(r => r.querySelector('input.assignments-dm-select')?.checked);
        
        if (selected.length === 0) {
            showAlert('No players selected', 'Please select at least one player to send DMs to.');
            return;
        }
        
        const original = sendBtn.textContent;
        sendBtn.textContent = 'Sending…';
        sendBtn.disabled = true;
        
        let delayMs = 250; // 4 msgs/sec
        
        for (let i = 0; i < selected.length; i++) {
            const row = selected[i];
            const discordUserId = row.dataset.discordUserId;
            const playerName = row.dataset.playerName;
            const statusEl = row.querySelector('.assignments-dm-status');
            
            try {
                const response = await fetch(`/api/discord/send-assignment/${eventId}/${discordUserId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.status === 429) {
                    // Rate limited
                    try {
                        const data = await response.json();
                        const ra = Number(data && data.retry_after);
                        if (!isNaN(ra) && ra > 0) {
                            delayMs = Math.max(delayMs * 2, Math.ceil(ra * 1000));
                        } else {
                            delayMs = Math.min(2000, delayMs * 2);
                        }
                    } catch {
                        delayMs = Math.min(2000, delayMs * 2);
                    }
                    statusEl.textContent = 'rate limited';
                    statusEl.style.color = '#f59e0b';
                } else if (response.ok) {
                    statusEl.textContent = 'sent';
                    statusEl.style.color = '#22c55e';
                    // Relax delay after success
                    delayMs = Math.max(200, Math.floor(delayMs * 0.9));
                } else {
                    const result = await response.json();
                    statusEl.textContent = 'failed';
                    statusEl.style.color = '#ef4444';
                    console.error(`Failed to send DM to ${playerName}:`, result.error);
                }
            } catch (error) {
                statusEl.textContent = 'failed';
                statusEl.style.color = '#ef4444';
                console.error(`Error sending DM to ${playerName}:`, error);
            }
            
            await new Promise(r => setTimeout(r, delayMs));
        }
        
        sendBtn.textContent = original;
        sendBtn.disabled = false;
    }

    window.addEventListener('click', () => {
        document.querySelectorAll('.player-details-dropdown.show').forEach(d => d.classList.remove('show'));
    });

    renderRoster();
    // setupNameToggle(); // Now called from inside renderRoster
});