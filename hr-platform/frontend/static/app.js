/* =============================================================================
   TALENTSTREAM — FRONTEND CORE CLIENT APPLICATION
   ============================================================================= */

let currentJobId = null;
let jobs = [];
let currentFilter = "";
let currentSearch = "";
let currentSort = "newest";

// Pagination & batch processing globals
let pagination = null;
let currentPage = 1;
let currentLimit = 20;
let showAllEnabled = false;
let selectedStatuses = [];
let activeBatchSSE = null;
let activeBatchId = null;
// Session-scoped batch history (JS memory only, max 5 recent batches)
window.uploadBatches = [];
let sessionBatches = window.uploadBatches;
let batchCounter = 0;
let olderBatches = [];
let olderBatchesLoaded = false;

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initUploadZone();
    initJobModal();
    initUploadModal();
    initResizing();
    loadJobs();
    initFilters();
    initActionButtons();
    initMobileNav();
    initAccordion();
    initPaginationControls();
    document.addEventListener("click", (e) => {
        // Don't close the menu if the click originated inside a card actions area
        if (e.target.closest(".candidate-card-actions")) return;
        document.querySelectorAll(".card-menu-dropdown").forEach(d => {
            d.style.display = "none";
        });
    });
    console.log("TalentStream Dashboard Initialized.");
});

/**
 * Phase 8: Mobile Navigation
 * Hamburger → left drawer, candidate tap → right drawer slide-in,
 * back button → right drawer close, bottom nav tab switching.
 */
function initMobileNav() {
    const isMobile = () => window.innerWidth <= 768;

    // ---- Elements ----
    const hamburger     = document.getElementById("btn-hamburger");
    const leftPanel     = document.getElementById("left-panel");
    const backdrop      = document.getElementById("left-drawer-backdrop");
    const closeLeft     = document.getElementById("btn-close-left-drawer");
    const rightPanel    = document.getElementById("right-panel");
    const closeRight    = document.getElementById("btn-close-right-drawer");
    const mobilePostJob = document.getElementById("btn-mobile-post-job");
    const modalPostJob  = document.getElementById("modal-post-job");

    // ---- Left Drawer toggle ----
    function openLeftDrawer() {
        leftPanel.classList.add("open");
        backdrop.classList.add("visible");
        document.body.classList.add("left-open");
        if (hamburger) hamburger.setAttribute("aria-expanded", "true");
    }
    function closeLeftDrawer() {
        leftPanel.classList.remove("open");
        backdrop.classList.remove("visible");
        document.body.classList.remove("left-open");
        if (hamburger) hamburger.setAttribute("aria-expanded", "false");
    }

    if (hamburger) hamburger.addEventListener("click", () => {
        if (leftPanel.classList.contains("open")) closeLeftDrawer();
        else openLeftDrawer();
    });
    if (closeLeft) closeLeft.addEventListener("click", closeLeftDrawer);
    if (backdrop)  backdrop.addEventListener("click",  closeLeftDrawer);

    // Close left drawer when a job is selected on mobile
    document.addEventListener("click", (e) => {
        if (!isMobile()) return;
        const jobItem = e.target.closest(".job-list li");
        if (jobItem) closeLeftDrawer();
    });

    // ---- Right Panel (candidate detail) slide-in on mobile ----
    function openRightDrawer(candidateName) {
        if (!isMobile()) return;
        rightPanel.classList.add("open");
        // Update mobile name header
        const nameHeader = document.getElementById("mobile-candidate-name-header");
        if (nameHeader) nameHeader.textContent = candidateName || "";
    }
    function closeRightDrawer() {
        rightPanel.classList.remove("open");
        const nameHeader = document.getElementById("mobile-candidate-name-header");
        if (nameHeader) nameHeader.textContent = "";
    }

    if (closeRight) closeRight.addEventListener("click", closeRightDrawer);

    // Intercept selectCandidate to also open right drawer on mobile
    const _originalSelectCandidate = window._selectCandidateHook;
    window._mobileOpenRightDrawer = openRightDrawer;

    // ---- Mobile "+ Post Job" button ----
    if (mobilePostJob && modalPostJob) {
        mobilePostJob.addEventListener("click", () => {
            modalPostJob.style.display = "flex";
        });
    }

    // ---- Bottom Navigation ----
    const bnJobs       = document.getElementById("bn-jobs");
    const bnCandidates = document.getElementById("bn-candidates");
    const bnReports    = document.getElementById("bn-reports");
    const middlePanel  = document.getElementById("middle-panel");

    function setBottomNavActive(btn) {
        [bnJobs, bnCandidates, bnReports].forEach(b => b && b.classList.remove("active"));
        if (btn) btn.classList.add("active");
    }

    if (bnJobs) {
        bnJobs.addEventListener("click", () => {
            if (!isMobile()) return;
            setBottomNavActive(bnJobs);
            openLeftDrawer();
        });
    }

    if (bnCandidates) {
        bnCandidates.addEventListener("click", () => {
            if (!isMobile()) return;
            setBottomNavActive(bnCandidates);
            closeRightDrawer();
            closeLeftDrawer();
            // Scroll middle panel to top
            if (middlePanel) middlePanel.scrollTo(0, 0);
        });
    }

    if (bnReports) {
        bnReports.addEventListener("click", () => {
            if (!isMobile()) return;
            setBottomNavActive(bnReports);
            // Reports: open right panel if a candidate is selected,
            // otherwise nudge to candidates view
            if (rightPanel.classList.contains("open")) {
                // Already open — switch to Overall tab
                document.querySelectorAll(".tab-btn").forEach(b => {
                    b.classList.remove("active");
                    if (b.dataset.tab === "overall") {
                        b.classList.add("active");
                        b.click(); // trigger tab switch
                    }
                });
            } else if (window.selectedCandidate) {
                openRightDrawer(window.selectedCandidate.name);
                setTimeout(() => {
                    document.querySelectorAll(".tab-btn").forEach(b => {
                        b.classList.remove("active");
                        if (b.dataset.tab === "overall") { b.classList.add("active"); b.click(); }
                    });
                }, 350);
            } else {
                // No candidate — show candidates list
                setBottomNavActive(bnCandidates);
                closeLeftDrawer();
            }
        });
    }

    // ---- Swipe-to-close right panel (touch gesture) ----
    let touchStartX = 0;
    if (rightPanel) {
        rightPanel.addEventListener("touchstart", (e) => {
            touchStartX = e.touches[0].clientX;
        }, { passive: true });
        rightPanel.addEventListener("touchend", (e) => {
            if (!isMobile()) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (dx > 80) closeRightDrawer(); // swipe right > 80px = close
        }, { passive: true });
    }
}

/**
 * Called by selectCandidate to open the right drawer on mobile.
 */
function _triggerMobileRightOpen(name) {
    if (window._mobileOpenRightDrawer) window._mobileOpenRightDrawer(name);
}


/**
 * Initializes the tab switching navigation on the candidate profile panel.
 */
function initTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanels = document.querySelectorAll(".tab-panel");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const targetTab = button.getAttribute("data-tab");

            // Deactivate all buttons and panels
            tabButtons.forEach(btn => btn.classList.remove("active"));
            tabPanels.forEach(panel => panel.classList.remove("active"));

            // Activate current button and matching panel
            button.classList.add("active");
            const activePanel = document.getElementById(`tab-${targetTab}`);
            if (activePanel) {
                activePanel.classList.add("active");
            }
            if (targetTab === "hr-notes" && selectedCandidate) {
                loadCandidateNotes(selectedCandidate.id);
            }
        });
    });
}

/**
 * Sets up drag-and-drop event listeners for the resume upload zone.
 */
function initUploadZone() {
    const uploadZone = document.getElementById("upload-zone");
    const fileInput = document.getElementById("resume-file-input");

    if (!uploadZone || !fileInput) return;

    uploadZone.addEventListener("click", () => fileInput.click());

    uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.classList.add("dragover");
    });

    uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("dragover");
    });

    uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.classList.remove("dragover");
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(files);
        }
    });

    // Window drag-and-drop handler to open the modal
    window.addEventListener("dragover", (e) => {
        e.preventDefault();
    });
    window.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!currentJobId) {
            alert("Please select a job first before uploading resumes.");
            return;
        }
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const modalUpload = document.getElementById("modal-upload-resumes");
            if (modalUpload) {
                modalUpload.style.display = "flex";
            }
            handleFiles(files);
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            handleFiles(fileInput.files);
        }
    });
}

/**
 * Handle uploaded resumes
 */
let candidates = [];
let selectedCandidate = null;

async function handleFiles(files) {
    if (!currentJobId) {
        alert("Please select a job first before uploading resumes.");
        return;
    }

    const progressContainer = document.getElementById("upload-progress-container");
    const progressText    = document.getElementById("upload-progress-text");
    const progressPercent = document.getElementById("upload-progress-percent");
    const progressBar     = document.getElementById("upload-progress-bar");
    const filesList       = document.getElementById("upload-files-list");

    if (progressContainer) progressContainer.style.display = "block";

    let activeBatch = window.uploadBatches.find(b => b.job_id === currentJobId && (b.status === "uploading" || b.status === "processing"));

    if (activeBatch) {
        if (progressText) progressText.textContent = "Appending to current batch...";
    } else {
        if (progressText) progressText.textContent = "Initiating batch upload...";
        if (progressPercent) progressPercent.textContent = "0%";
        if (progressBar)     progressBar.style.width      = "0%";
        if (filesList)       filesList.innerHTML = "";
    }

    // Render per-file cards with mini progress bars
    if (filesList) {
        Array.from(files).forEach(file => {
            const fileCard = document.createElement("div");
            fileCard.className = "upload-file-card";
            fileCard.dataset.filename = file.name;
            fileCard.innerHTML = `
                <div class="file-card-top">
                    <div class="file-info">
                        <span class="file-icon">⏳</span>
                        <span class="file-name-text" title="${file.name}">${file.name}</span>
                    </div>
                    <span class="file-status-label processing">Queuing...</span>
                </div>
                <div class="file-progress-bar-bg">
                    <div class="file-progress-bar-fill" style="width: 0%"></div>
                </div>
            `;
            filesList.appendChild(fileCard);
        });
    }

    try {
        let batchId;
        if (activeBatch) {
            batchId = activeBatch.id;
            const addResp = await fetch(`/api/uploads/batches/${batchId}/add-files`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ count: files.length })
            });
            if (!addResp.ok) throw new Error("Failed to add files to current batch");
            const result = await addResp.json();
            
            activeBatch.total_files = result.total_files;
            if (activeBatch.files) {
                Array.from(files).forEach(f => {
                    if (!activeBatch.files.includes(f.name)) {
                        activeBatch.files.push(f.name);
                    }
                });
            } else {
                activeBatch.files = Array.from(files).map(f => f.name);
            }
            renderBatchHistory();
            if (!activeBatchSSE || activeBatchId !== batchId) {
                subscribeToBatchSSE(batchId);
            }
        } else {
            const batchResp = await fetch("/api/uploads/batches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job_id: currentJobId, total_files: files.length })
            });
            if (!batchResp.ok) throw new Error("Failed to pre-register batch");

            const batch = await batchResp.json();
            batchId = batch.id;
            activeBatchId = batchId;

            batchCounter++;
            window.uploadBatches.unshift({ 
                id: batchId,
                job_id: currentJobId,
                batch_num: batchCounter,
                total_files: files.length,
                processed_count: 0,
                failed_count: 0,
                processing_count: 0,
                status: "uploading",
                progress: 0,
                completedAt: null,
                files: Array.from(files).map(f => f.name),
                logs: [] 
            });
            if (window.uploadBatches.length > 5) window.uploadBatches.pop();
            renderBatchHistory();

            subscribeToBatchSSE(batchId);
        }

        // Throttled upload queue: max 5 concurrent uploads to avoid overwhelming S3/server
        const CONCURRENCY_LIMIT = 5;
        const fileArray = Array.from(files);
        const queue = [...fileArray];
        const inFlight = [];

        async function runNext() {
            if (queue.length === 0) return;
            const file = queue.shift();
            const p = uploadFile(file, batchId).finally(() => {
                const idx = inFlight.indexOf(p);
                if (idx !== -1) inFlight.splice(idx, 1);
                return runNext();
            });
            inFlight.push(p);
        }

        // Seed initial concurrent slots
        const seeds = [];
        for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, fileArray.length); i++) {
            seeds.push(runNext());
        }
        await Promise.all(seeds);
        // Wait for all in-flight to finish
        while (inFlight.length > 0) {
            await Promise.all([...inFlight]);
        }

    } catch (err) {
        console.error("Batch upload failed to start/update:", err);
        if (progressText) progressText.textContent = "Failed to process files.";
    }
}

async function uploadFile(file, batchId) {
    const uploadId = "upload_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const fileCard = document.querySelector(`.upload-file-card[data-filename="${CSS.escape(file.name)}"]`);

    function setCardStatus(icon, text, cls) {
        if (!fileCard) return;
        const iconEl = fileCard.querySelector(".file-icon");
        const label  = fileCard.querySelector(".file-status-label");
        if (iconEl) iconEl.textContent = icon;
        if (label)  { label.className = `file-status-label ${cls || ""}`; label.textContent = text; }
    }

    setCardStatus("📤", "Uploading...", "");

    const MAX_RETRIES = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 1) {
                const wait = attempt * 2000; // 2s, 4s back-off
                setCardStatus("🔄", `Retry ${attempt}/${MAX_RETRIES}...`, "");
                await new Promise(r => setTimeout(r, wait));
            }

            const formData = new FormData();
            formData.append("job_id", currentJobId);
            formData.append("file", file);
            formData.append("upload_id", uploadId);
            if (batchId) formData.append("batch_id", batchId);

            const response = await fetch("/api/candidates/upload", {
                method: "POST",
                body: formData
            });

            if (!response.ok) {
                let detail = `HTTP ${response.status}`;
                try { const j = await response.json(); detail = j.detail || detail; } catch (_) {}
                throw new Error(detail);
            }

            const result = await response.json();
            console.log(`[Upload] ${file.name} OK (attempt ${attempt}):`, result);
            setCardStatus("✅", "Uploaded", "success");
            return; // success — exit

        } catch (err) {
            lastErr = err;
            console.warn(`[Upload] ${file.name} attempt ${attempt} failed:`, err.message);
        }
    }

    // All retries exhausted
    console.error(`[Upload] ${file.name} permanently failed after ${MAX_RETRIES} attempts:`, lastErr?.message);
    setCardStatus("❌", `Failed: ${lastErr?.message || "unknown error"}`, "failed");

    if (batchId) {
        fetch(`/api/uploads/batches/${batchId}/log-failure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file_name: file.name,
                file_size: file.size,
                error_message: lastErr?.message || "Upload request failed after 3 attempts"
            })
        }).catch(e => console.error("Failed to notify batch failure:", e));
    }
}

async function loadCandidates(jobId) {
    if (!jobId) return;
    const listContainer = document.getElementById("candidates-list");
    if (listContainer) {
        listContainer.innerHTML = `
            <div class="skeleton-loader">
                <div class="skeleton-card">
                    <div class="skeleton-line title"></div>
                    <div class="skeleton-line subtitle"></div>
                    <div class="skeleton-line desc"></div>
                </div>
                <div class="skeleton-card">
                    <div class="skeleton-line title"></div>
                    <div class="skeleton-line subtitle"></div>
                    <div class="skeleton-line desc"></div>
                </div>
                <div class="skeleton-card">
                    <div class="skeleton-line title"></div>
                    <div class="skeleton-line subtitle"></div>
                    <div class="skeleton-line desc"></div>
                </div>
            </div>
        `;
    }
    try {
        const activeJob = jobs.find(j => Number(j.id) === Number(jobId));
        const isClosedJob = activeJob && activeJob.status === "closed";

        let statusParam = "";
        if (isClosedJob) {
            if (selectedStatuses.length > 0) {
                statusParam = selectedStatuses.join(",");
            } else {
                statusParam = "hired,rejected_post_interview";
            }
        } else {
            if (selectedStatuses.length > 0) {
                const expandedList = [];
                selectedStatuses.forEach(st => {
                    if (st === "scored") {
                        expandedList.push("scored", "new", "structured", "manual_review");
                    } else {
                        expandedList.push(st);
                    }
                });
                statusParam = expandedList.join(",");
            } else {
                statusParam = "all";
            }
        }
        
        const limitParam = showAllEnabled ? 100 : currentLimit;
        const searchParam = currentSearch || "";
        
        let url = `/api/candidates?jobId=${jobId}&status=${encodeURIComponent(statusParam)}&sort=${currentSort}&page=${currentPage}&limit=${limitParam}`;
        if (searchParam) {
            url += `&q=${encodeURIComponent(searchParam)}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch candidates: ${response.statusText}`);
        }
        const data = await response.json();
        if (data && data.candidates) {
            candidates = data.candidates;
            pagination = data.pagination;
            if (isClosedJob) {
                candidates = candidates.filter(c => c.status === "hired" || c.status === "rejected_post_interview");
            }
            if (data.last_batch) {
                activeBatchId = data.last_batch.id;
                updateJobBatchSummary(data.last_batch);
                if (data.last_batch.status === "uploading" || data.last_batch.status === "processing") {
                    subscribeToBatchSSE(data.last_batch.id);
                }
            } else {
                updateJobBatchSummary(null);
            }
        } else {
            candidates = Array.isArray(data) ? data : [];
            if (isClosedJob) {
                candidates = candidates.filter(c => c.status === "hired" || c.status === "rejected_post_interview");
            }
            pagination = null;
            updateJobBatchSummary(null);
        }
        renderCandidates();
        renderPaginationUI();
    } catch (e) {
        console.error("Failed to load candidates:", e);
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="error-msg" style="text-align: center; color: var(--color-danger); padding: 3rem 1rem; font-size: 0.95rem;">
                    Failed to load. <a href="#" id="retry-load-candidates" style="text-decoration: underline; color: var(--color-primary); font-weight: 600;">Retry?</a>
                </div>
            `;
            const retryBtn = document.getElementById("retry-load-candidates");
            if (retryBtn) {
                retryBtn.addEventListener("click", (evt) => {
                    evt.preventDefault();
                    loadCandidates(jobId);
                });
            }
        }
    }
}

function renderCandidates() {
    const listContainer = document.getElementById("candidates-list");
    if (!listContainer) return;
    
    const activeJob = jobs.find(j => Number(j.id) === Number(currentJobId));
    const isClosedJob = activeJob && activeJob.status === "closed";
    
    let displayCandidates = candidates || [];
    if (isClosedJob) {
        displayCandidates = displayCandidates.filter(c => c.status === "hired" || c.status === "rejected_post_interview");
    }
    
    if (displayCandidates.length === 0) {
        const msg = isClosedJob 
            ? "No finalized candidates for this closed job." 
            : "No candidates found matching the filters.";
        listContainer.innerHTML = `
            <div class="no-candidates-msg" style="text-align: center; color: var(--text-muted); padding: 3rem 1rem; font-size: 0.95rem;">
                ${msg}
            </div>
        `;
        return;
    }
    
    const actionsStyle = isClosedJob ? 'style="display:none;"' : '';
    
    listContainer.innerHTML = "";
    displayCandidates.forEach(cand => {
        const card = document.createElement("div");
        let cardClass = "";
        if (cand.status === "failed") {
            cardClass = "failed-card";
        } else if (cand.status === "unable_to_process") {
            cardClass = "unable-to-process-card";
        }
        card.className = `candidate-card ${cardClass} ${selectedCandidate && selectedCandidate.id === cand.id ? 'active' : ''}`;
        card.dataset.id = cand.id;
        
        let scoreClass = getScoreGroupClass(cand.match_score);
        let displayScore = cand.match_score !== null ? cand.match_score : '-';
        const initials = getInitials(cand.name);
        
        let statusIndicator = `<span class="status-dot status-dot-${cand.status}"></span>`;
        if (cand.status === "failed" || cand.status === "unable_to_process") {
            statusIndicator = `<span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background-color: #ef4444; color: #ffffff; border-radius: 4px; font-weight: 600;">Review Needed</span>`;
            displayScore = '0';
            scoreClass = 'score-badge-red';
        } else if (cand.status === "manual_reviewed") {
            statusIndicator = `<span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background-color: #3b82f6; color: #ffffff; border-radius: 4px; font-weight: 600;">Manual Reviewed</span>`;
            displayScore = '0';
            scoreClass = 'score-badge-red';
        } else if (isClosedJob) {
            const badgeInfo = getStatusLabelAndClass(cand.status);
            statusIndicator = `<span class="badge ${badgeInfo.className}" style="font-size: 0.65rem; padding: 2px 6px;">${badgeInfo.label}</span>`;
        }
        
        let displayName = cand.name;
        if (!displayName) {
            if (cand.status === "unable_to_process" || cand.status === "failed") {
                displayName = "Failed to Process";
            } else {
                displayName = "Parsing...";
            }
        }
        
        card.innerHTML = `
            <div class="candidate-avatar">${initials}</div>
            <div class="candidate-card-middle">
                <div class="candidate-card-title-row" style="${isClosedJob ? 'align-items: center; gap: 8px;' : ''}">
                    ${statusIndicator}
                    <h4>${displayName}</h4>
                </div>
                <div class="candidate-card-subtitle">${cand.email || '-'}</div>
            </div>
            <div class="candidate-card-actions" id="card-actions-${cand.id}" ${actionsStyle}>
                <button class="btn-card-menu" aria-label="Candidate options" id="btn-menu-${cand.id}">&#8942;</button>
                <div class="card-menu-dropdown" id="dropdown-${cand.id}" style="display: none;">
                    <button class="menu-item-delete" id="delete-${cand.id}">&#128465; Delete</button>
                </div>
            </div>
            ${(cand.status === "failed" || cand.status === "unable_to_process") ? `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button class="btn btn-secondary btn-view-resume" style="padding: 4px 8px; font-size: 0.7rem; height: 24px; min-height: 24px; border-radius: 4px; font-weight: 600; cursor: pointer; white-space: nowrap;">View Resume</button>
                    <div class="candidate-card-score-circle score-badge-red" style="margin-left: 0;">0</div>
                </div>
            ` : `
                <div class="candidate-card-score-circle ${scoreClass}">
                    ${displayScore}
                </div>
            `}
        `;

        const menuBtn   = card.querySelector(`#btn-menu-${cand.id}`);
        const dropdown  = card.querySelector(`#dropdown-${cand.id}`);
        const deleteBtn = card.querySelector(`#delete-${cand.id}`);

        if (menuBtn && dropdown && deleteBtn) {
            menuBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                // Close all other open menus first
                document.querySelectorAll(".card-menu-dropdown").forEach(d => {
                    if (d !== dropdown) d.style.display = "none";
                });
                dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
            });

            deleteBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                e.preventDefault();

                // Inline confirmation: replace button with Yes / Cancel
                dropdown.innerHTML = `
                    <div style="padding: 8px 10px; font-size: 0.8rem; color: var(--text-main); white-space: nowrap;">
                        Delete <b>${(cand.name || 'candidate').split(' ')[0]}</b>?
                    </div>
                    <div style="display:flex; gap:6px; padding: 2px 10px 8px;">
                        <button id="confirm-yes-${cand.id}" style="flex:1; background:var(--color-danger); color:#fff; border:none; border-radius:4px; padding:5px 0; font-size:0.8rem; cursor:pointer;">Yes</button>
                        <button id="confirm-no-${cand.id}"  style="flex:1; background:var(--bg-sidebar); color:var(--text-main); border:1px solid var(--border-color); border-radius:4px; padding:5px 0; font-size:0.8rem; cursor:pointer;">Cancel</button>
                    </div>
                `;
                dropdown.style.display = "block";

                const yesBtn = document.getElementById(`confirm-yes-${cand.id}`);
                const noBtn  = document.getElementById(`confirm-no-${cand.id}`);

                noBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    dropdown.style.display = "none";
                });

                yesBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    dropdown.style.display = "none";
                    yesBtn.disabled = true;
                    yesBtn.textContent = "…";

                    try {
                        const res = await fetch(`/api/candidates/${cand.id}`, {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" }
                        });
                        if (res.ok) {
                            // Animate card out
                            card.style.transition = "opacity 0.25s ease, transform 0.25s ease";
                            card.style.opacity = "0";
                            card.style.transform = "translateX(-10px)";
                            setTimeout(() => {
                                loadCandidates(currentJobId);
                                if (selectedCandidate && selectedCandidate.id === cand.id) {
                                    const noPro = document.getElementById("no-profile-selected");
                                    const proDet = document.getElementById("profile-details");
                                    if (noPro) noPro.style.display = "flex";
                                    if (proDet) proDet.style.display = "none";
                                    selectedCandidate = null;
                                }
                            }, 280);
                        } else {
                            const errData = await res.json().catch(() => ({}));
                            console.error("Delete failed:", errData.detail || res.status);
                            // Restore dropdown
                            dropdown.innerHTML = `<button class="menu-item-delete" id="delete-${cand.id}">&#128465; Delete</button>`;
                            dropdown.style.display = "block";
                        }
                    } catch (err) {
                        console.error("Delete network error:", err);
                        dropdown.style.display = "none";
                    }
                });
            });
        }

        card.addEventListener("click", (e) => {
            // Don't select candidate when clicking the actions menu area
            if (e.target.closest(".candidate-card-actions")) return;
            selectCandidate(cand);
            if (e.target.closest(".btn-view-resume")) {
                selectTab("resume");
            }
        });

        listContainer.appendChild(card);
    });
}


function renderPaginationUI() {
    const pagBar = document.getElementById("pagination-bar");
    if (!pagBar) return;
    
    if (!pagination || showAllEnabled) {
        pagBar.style.display = "none";
        return;
    }
    
    pagBar.style.display = "flex";
    
    const prevBtn = document.getElementById("btn-prev-page");
    const nextBtn = document.getElementById("btn-next-page");
    
    if (prevBtn) prevBtn.disabled = !pagination.has_prev;
    if (nextBtn) nextBtn.disabled = !pagination.has_next;
    
    const pagesContainer = document.getElementById("pagination-pages-buttons");
    if (pagesContainer) {
        pagesContainer.innerHTML = "";
        
        const total = pagination.total_pages;
        const current = pagination.page;
        
        let start = Math.max(1, current - 2);
        let end = Math.min(total, current + 2);
        
        if (start > 1) {
            const btn1 = document.createElement("button");
            btn1.textContent = "1";
            btn1.addEventListener("click", () => {
                currentPage = 1;
                loadCandidates(currentJobId);
            });
            pagesContainer.appendChild(btn1);
            
            if (start > 2) {
                const ellipsis = document.createElement("span");
                ellipsis.textContent = "...";
                ellipsis.style.margin = "0 4px";
                pagesContainer.appendChild(ellipsis);
            }
        }
        
        for (let p = start; p <= end; p++) {
            const btn = document.createElement("button");
            btn.textContent = p;
            if (p === current) {
                btn.className = "active";
            }
            btn.addEventListener("click", () => {
                currentPage = p;
                loadCandidates(currentJobId);
            });
            pagesContainer.appendChild(btn);
        }
        
        if (end < total) {
            if (end < total - 1) {
                const ellipsis = document.createElement("span");
                ellipsis.textContent = "...";
                ellipsis.style.margin = "0 4px";
                pagesContainer.appendChild(ellipsis);
            }
            
            const btnLast = document.createElement("button");
            btnLast.textContent = total;
            btnLast.addEventListener("click", () => {
                currentPage = total;
                loadCandidates(currentJobId);
            });
            pagesContainer.appendChild(btnLast);
        }
    }
    
    const infoText = document.getElementById("pagination-info");
    if (infoText) {
        infoText.textContent = `Page ${pagination.page} of ${pagination.total_pages} (${pagination.total} total)`;
    }
    
    const jumpInput = document.getElementById("input-jump-page");
    if (jumpInput) {
        jumpInput.value = "";
        jumpInput.max = pagination.total_pages;
    }
}

function initPaginationControls() {
    const prevBtn = document.getElementById("btn-prev-page");
    const nextBtn = document.getElementById("btn-next-page");
    const jumpInput = document.getElementById("input-jump-page");
    const toggleShowAll = document.getElementById("btn-toggle-show-all");
    
    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (pagination && pagination.has_prev) {
                currentPage = pagination.page - 1;
                loadCandidates(currentJobId);
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (pagination && pagination.has_next) {
                currentPage = pagination.page + 1;
                loadCandidates(currentJobId);
            }
        });
    }
    
    if (jumpInput) {
        jumpInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const pageNum = parseInt(jumpInput.value);
                if (pageNum >= 1 && pagination && pageNum <= pagination.total_pages) {
                    currentPage = pageNum;
                    loadCandidates(currentJobId);
                } else {
                    alert(`Please enter a valid page number between 1 and ${pagination ? pagination.total_pages : 1}`);
                }
            }
        });
    }
    
    if (toggleShowAll) {
        toggleShowAll.addEventListener("click", () => {
            showAllEnabled = !showAllEnabled;
            if (showAllEnabled) {
                toggleShowAll.textContent = "Show Paginated";
                toggleShowAll.classList.add("active");
            } else {
                toggleShowAll.textContent = "Show All";
                toggleShowAll.classList.remove("active");
            }
            currentPage = 1;
            loadCandidates(currentJobId);
        });
    }
}

function updateBatchProgressUI(data) {
    const progressText    = document.getElementById("upload-progress-text");
    const progressPercent = document.getElementById("upload-progress-percent");
    const progressBar     = document.getElementById("upload-progress-bar");

    const total = data.total_files || 0;
    
    let sumProgress = 0;
    if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
            sumProgress += log.file_progress || getFileProgress(log.status);
        });
    }
    const percent = total > 0 ? Math.round(sumProgress / total) : 0;

    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressBar)     progressBar.style.width      = `${percent}%`;

    let statusText = "Uploading to S3...";
    if (data.logs && data.logs.length > 0) {
        const statuses = data.logs.map(l => l.status);
        if (statuses.includes("uploading")) {
            statusText = "Uploading to S3...";
        } else if (statuses.includes("parsing") || statuses.includes("structuring") || statuses.includes("waiting")) {
            statusText = "Parsing...";
        } else {
            const processed = data.processed_count || 0;
            const failed = data.failed_count || 0;
            statusText = `Completed (${processed} scored, ${failed} failed)`;
        }
    } else {
        statusText = "Uploading to S3...";
    }
    if (progressText) progressText.textContent = statusText;

    // Update per-file cards with real progress from SSE
    if (data.logs) {
        data.logs.forEach(log => {
            const fileCard = document.querySelector(`.upload-file-card[data-filename="${CSS.escape(log.file_name)}"]`);
            if (!fileCard) return;
            const iconEl      = fileCard.querySelector(".file-icon");
            const statusLabel = fileCard.querySelector(".file-status-label");
            const fillEl      = fileCard.querySelector(".file-progress-bar-fill");
            const fp          = log.file_progress ?? getFileProgress(log.status);

            if (fillEl) {
                fillEl.style.width = `${fp}%`;
                fillEl.classList.toggle("done",        fp === 100 && log.status !== "failed" && log.status !== "unable_to_process");
                fillEl.classList.toggle("failed-fill", log.status === "failed" || log.status === "unable_to_process");
            }

            if (log.status === "failed" || log.status === "unable_to_process") {
                if (iconEl) iconEl.textContent = "❌";
                if (statusLabel) {
                    statusLabel.className = "file-status-label failed";
                    statusLabel.textContent = `Failed: ${log.error_message || 'Processing error'}`;
                    statusLabel.title = log.error_message || '';
                }
            } else if (log.status === "scored" || log.status === "shortlisted" || log.status === "completed") {
                if (iconEl) iconEl.textContent = "✅";
                if (statusLabel) {
                    statusLabel.className = "file-status-label success";
                    statusLabel.textContent = log.match_score != null ? `Scored (${log.match_score}%)` : "Scored";
                }
            } else {
                if (iconEl) iconEl.textContent = "⏳";
                if (statusLabel) {
                    statusLabel.className = "file-status-label processing";
                    statusLabel.textContent = log.status.charAt(0).toUpperCase() + log.status.slice(1) + (log.status === "uploading" ? ` (${fp}%)` : "");
                }
            }
        });
    }

    updateJobBatchSummary(data);
    if (percent === 100) loadCandidates(currentJobId);
}

function updateJobBatchSummary(data) {
    const summaryDiv = document.getElementById("upload-batch-summary");
    if (!summaryDiv) return;
    
    if (!data) {
        summaryDiv.style.display = "none";
        return;
    }
    
    summaryDiv.style.display = "block";
    
    const total = data.total_files;
    const processed = data.processed_count;
    const failed = data.failed_count;
    const processing = data.processing_count;
    
    summaryDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <span>📤 Last Upload: <strong>${processed}/${total}</strong> processed | <strong>${processing}</strong> processing | <strong>${failed}</strong> failed</span>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-batch-details" style="padding: 2px 8px; font-size: 0.75rem; height: auto;">
                View Details
            </button>
        </div>
        <div id="batch-details-inline-panel" class="batch-details-inline" style="display: none; width: 100%; margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 8px;">
            <!-- Expandable logs table injected here -->
        </div>
    `;
    
    const toggleBtn = document.getElementById("btn-toggle-batch-details");
    const inlinePanel = document.getElementById("batch-details-inline-panel");
    
    if (toggleBtn && inlinePanel) {
        const isExpanded = localStorage.getItem(`batch-details-expanded-${data.id}`) === "true";
        inlinePanel.style.display = isExpanded ? "block" : "none";
        toggleBtn.textContent = isExpanded ? "Hide Details" : "View Details";
        
        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const expanded = inlinePanel.style.display === "none";
            inlinePanel.style.display = expanded ? "block" : "none";
            toggleBtn.textContent = expanded ? "Hide Details" : "View Details";
            localStorage.setItem(`batch-details-expanded-${data.id}`, expanded);
        });
        
        if (data.logs && data.logs.length > 0) {
            let tableHtml = `
                <table class="batch-logs-table" style="width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 0.8rem; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-color); font-weight: 600; color: var(--text-muted);">
                            <th style="padding: 6px 4px;">File Name</th>
                            <th style="padding: 6px 4px; width: 100px;">Status</th>
                            <th style="padding: 6px 4px;">Error Message</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            data.logs.forEach(log => {
                let statusClass = "uploaded";
                let statusText = log.status;
                if (log.status === "failed" || log.status === "unable_to_process") statusClass = "failed";
                else if (log.status === "scored" || log.status === "completed") statusClass = "scored";
                else if (log.status === "parsing" || log.status === "structured") statusClass = "parsing";
                
                if (log.match_score !== null && log.match_score !== undefined) {
                    statusText = `Scored (${log.match_score}%)`;
                }
                
                const errMsg = log.error_message || "-";
                tableHtml += `
                    <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-main);">
                        <td style="padding: 6px 4px; font-weight: 500; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.file_name}">${log.file_name}</td>
                        <td style="padding: 6px 4px;">
                            <span class="status-tag ${statusClass}" style="font-size: 0.7rem; padding: 2px 6px;">${statusText}</span>
                        </td>
                        <td style="padding: 6px 4px; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${errMsg}">${errMsg}</td>
                    </tr>
                `;
            });
            tableHtml += `
                    </tbody>
                </table>
            `;
            inlinePanel.innerHTML = tableHtml;
        } else {
            inlinePanel.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 10px;">No files registered.</div>`;
        }
    }
}

async function fetchLastBatchForJob(jobId) {
    if (activeBatchSSE) {
        activeBatchSSE.close();
        activeBatchSSE = null;
        activeBatchId = null;
    }
    
    const summaryDiv = document.getElementById("upload-batch-summary");
    if (summaryDiv) summaryDiv.style.display = "none";
    
    try {
        const resp = await fetch(`/api/jobs/${jobId}/last-batch`);
        if (resp.ok) {
            const batch = await resp.json();
            if (batch) {
                activeBatchId = batch.id;
                updateJobBatchSummary(batch);
                
                const exists = window.uploadBatches.some(b => b.id === batch.id);
                if (!exists) {
                    batchCounter++;
                    const total = batch.total_files || 0;
                    let sumProgress = 0;
                    if (batch.logs) {
                        batch.logs.forEach(log => {
                            sumProgress += log.file_progress || getFileProgress(log.status);
                        });
                    }
                    const progress = total > 0 ? Math.round(sumProgress / total) : 0;
                    
                    window.uploadBatches.unshift({
                        id: batch.id,
                        job_id: jobId,
                        batch_num: batchCounter,
                        total_files: batch.total_files,
                        processed_count: batch.processed_count,
                        failed_count: batch.failed_count,
                        processing_count: batch.processing_count,
                        status: batch.status,
                        progress: progress,
                        completedAt: (batch.status === "completed" || batch.status === "done" || batch.status === "failed") ? Date.now() : null,
                        files: batch.logs ? batch.logs.map(l => l.file_name) : [],
                        logs: batch.logs || []
                    });
                    if (window.uploadBatches.length > 5) window.uploadBatches.pop();
                    renderBatchHistory();
                }

                if (batch.status === "uploading" || batch.status === "processing") {
                    subscribeToBatchSSE(batch.id);
                }
            }
        }
    } catch (e) {
        console.error("Failed to fetch last batch:", e);
    }
}

function subscribeToBatchSSE(batchId) {
    if (activeBatchSSE) activeBatchSSE.close();

    // Backend emits plain "data:" lines (no named event) so onmessage fires correctly
    activeBatchSSE = new EventSource(`/api/sse/batch/${batchId}`);
    activeBatchSSE.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            updateBatchProgressUI(data);
            // Update session history entry
            const idx = window.uploadBatches.findIndex(b => b.id === batchId);
            if (idx !== -1) {
                const prev = window.uploadBatches[idx];
                let completedAt = prev.completedAt;
                if ((data.status === "completed" || data.status === "done" || data.status === "failed") && !completedAt) {
                    completedAt = Date.now();
                }
                const total = data.total_files || prev.total_files || 0;
                let sumProgress = 0;
                if (data.logs) {
                    data.logs.forEach(log => {
                        sumProgress += log.file_progress || getFileProgress(log.status);
                    });
                }
                const progress = total > 0 ? Math.round(sumProgress / total) : 0;
                
                window.uploadBatches[idx] = { 
                    ...prev, 
                    ...data, 
                    progress, 
                    completedAt,
                    files: data.logs ? data.logs.map(l => l.file_name) : prev.files
                };
            }
            renderBatchHistory();
            if (data.status === "completed" ||
                (data.processed_count + data.failed_count >= data.total_files && data.total_files > 0)) {
                activeBatchSSE.close();
                activeBatchSSE = null;
            }
        } catch (err) {
            console.error("Batch SSE parse error:", err);
        }
    };
    activeBatchSSE.onerror = () => {
        if (activeBatchSSE) { activeBatchSSE.close(); activeBatchSSE = null; }
    };
}

function showToast(message, duration = 5000) {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.position = "fixed";
        container.style.bottom = "20px";
        container.style.right = "20px";
        container.style.zIndex = "9999";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "8px";
        document.body.appendChild(container);
    }
    
    const toast = document.createElement("div");
    toast.className = "toast-message";
    toast.style.backgroundColor = "var(--text-main)";
    toast.style.color = "var(--bg-panel)";
    toast.style.padding = "12px 20px";
    toast.style.borderRadius = "8px";
    toast.style.boxShadow = "var(--shadow-premium)";
    toast.style.fontSize = "0.85rem";
    toast.style.fontWeight = "600";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    toast.style.transition = "all 0.3s ease";
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    }, 50);
    
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-20px)";
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

/**
 * Candidate Detail Panel render
 */
function selectCandidate(cand) {
    selectedCandidate = cand;
    
    // Phase 8: open right drawer on mobile when a candidate is selected
    _triggerMobileRightOpen(cand.name || "Candidate");

    const activeJob = jobs.find(j => Number(j.id) === Number(currentJobId));
    const isClosedJob = activeJob && activeJob.status === "closed";
    const notesTextarea = document.getElementById("notes-textarea");
    const saveNoteBtn = document.getElementById("btn-save-note");
    if (notesTextarea) {
        notesTextarea.disabled = isClosedJob;
        notesTextarea.placeholder = isClosedJob ? "Recruiter notes are read-only for closed jobs." : "Add custom evaluations or notes...";
    }
    if (saveNoteBtn) {
        saveNoteBtn.disabled = isClosedJob;
        saveNoteBtn.style.opacity = isClosedJob ? "0.5" : "1";
    }

    // Toggle active state in listing UI
    document.querySelectorAll(".candidate-card").forEach(card => {
        if (parseInt(card.dataset.id) === cand.id) {
            card.classList.add("active");
        } else {
            card.classList.remove("active");
        }
    });

    document.getElementById("no-profile-selected").style.display = "none";
    
    const profileDetails = document.getElementById("profile-details");
    profileDetails.style.display = "flex";
    
    document.getElementById("detail-candidate-name").textContent = cand.name || (cand.status === "unable_to_process" || cand.status === "failed" ? "Failed to Process" : "Processing Candidate");
    
    const statusBadge = document.getElementById("detail-candidate-status");
    const badgeInfo = getStatusLabelAndClass(cand.status);
    statusBadge.textContent = badgeInfo.label;
    statusBadge.className = "badge " + badgeInfo.className;
    
    const isErrorState = cand.status === "failed" || cand.status === "unable_to_process";
    const isErrorOrManual = isErrorState || cand.status === "manual_reviewed";
    
    if (isErrorOrManual) {
        document.getElementById("detail-overall-score").textContent = "0";
    } else {
        document.getElementById("detail-overall-score").textContent = cand.match_score !== null ? cand.match_score : "-";
    }
    
    document.getElementById("detail-email").textContent = cand.email || "-";
    document.getElementById("detail-phone").textContent = cand.phone || "-";
    
    const cardMeta = document.querySelector("#tab-resume .card-meta");
    const skillsHeader = document.querySelector("#tab-resume h3");
    const skillsWrap = document.querySelector("#tab-resume #detail-skills");
    
    if (cardMeta) cardMeta.style.display = isErrorState ? "none" : "block";
    if (skillsHeader) skillsHeader.style.display = isErrorState ? "none" : "block";
    if (skillsWrap) skillsWrap.style.display = isErrorState ? "none" : "flex";
    
    document.getElementById("detail-skills").innerHTML = "";
    
    if (cand.structured_profile) {
        const profile = cand.structured_profile;
        document.getElementById("detail-experience").textContent = profile.experience_years !== undefined ? `${profile.experience_years} years` : "-";
        document.getElementById("detail-location").textContent = "-";
        
        if (profile.skills) {
            profile.skills.forEach(skill => {
                const sBadge = document.createElement("span");
                sBadge.className = "skill-badge";
                sBadge.textContent = skill;
                sBadge.style = "background-color: var(--bg-surface); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.8rem; margin: 0.2rem; border: 1px solid var(--border-color); display: inline-block; color: var(--text-main); font-weight: 500;";
                document.getElementById("detail-skills").appendChild(sBadge);
            });
        }
    } else {
        document.getElementById("detail-experience").textContent = "-";
        document.getElementById("detail-location").textContent = "-";
    }

    // Render Match Breakdown (Resume Match Report)
    const matchContainer = document.getElementById("detail-match-breakdown");
    if (matchContainer) {
        if (cand.status === "failed") {
            const errorLog = (cand.structured_profile && cand.structured_profile.parse_error_log) || "Unknown error";
            matchContainer.innerHTML = `
                <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; padding: 1.25rem; color: #b91c1c; line-height: 1.5;">
                    <strong style="display: block; margin-bottom: 0.5rem; font-size: 1rem;">File Ingestion Error:</strong>
                    <p style="margin: 0; font-size: 0.9rem; font-family: monospace; white-space: pre-wrap;">File could not be read. Error: ${errorLog}</p>
                </div>
            `;
        } else if (cand.status === "unable_to_process") {
            const errorLog = (cand.structured_profile && cand.structured_profile.parse_error_log) || "Unknown error";
            matchContainer.innerHTML = `
                <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; padding: 1.25rem; color: #b91c1c; line-height: 1.5;">
                    <strong style="display: block; margin-bottom: 0.5rem; font-size: 1rem;">Processing Ingestion Error:</strong>
                    <p style="margin: 0; font-size: 0.9rem; font-family: monospace; white-space: pre-wrap;">AI could not parse. Raw extract: ${errorLog}</p>
                </div>
            `;
        } else if (cand.match_breakdown) {
            const breakdown = cand.match_breakdown;
            matchContainer.innerHTML = `
                <div class="match-score-summary" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="background-color: var(--bg-surface); padding: 0.8rem; border-radius: 6px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">Skills</div>
                        <strong style="font-size: 1.2rem; color: var(--color-primary);">${breakdown.skills_score || 0} / 40</strong>
                    </div>
                    <div style="background-color: var(--bg-surface); padding: 0.8rem; border-radius: 6px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">Experience</div>
                        <strong style="font-size: 1.2rem; color: var(--color-primary);">${breakdown.experience_score || 0} / 30</strong>
                    </div>
                    <div style="background-color: var(--bg-surface); padding: 0.8rem; border-radius: 6px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">Education</div>
                        <strong style="font-size: 1.2rem; color: var(--color-primary);">${breakdown.education_score || 0} / 20</strong>
                    </div>
                    <div style="background-color: var(--bg-surface); padding: 0.8rem; border-radius: 6px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">Certs</div>
                        <strong style="font-size: 1.2rem; color: var(--color-primary);">${breakdown.certs_score || 0} / 10</strong>
                    </div>
                </div>
                <div class="match-rationale" style="background-color: var(--bg-surface); padding: 1.2rem; border-radius: 6px; border: 1px solid var(--border-color); line-height: 1.5; color: var(--text-main);">
                    <strong style="display: block; margin-bottom: 0.5rem; font-size: 0.95rem;">AI Evaluation Recommendation:</strong>
                    <p style="margin: 0; font-size: 0.9rem; white-space: pre-wrap;">${breakdown.rationale || 'No rationale provided.'}</p>
                </div>
            `;
        } else {
            matchContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No match score report available yet for this candidate.</p>`;
        }
    }

    // Fetch and render original resume preview
    loadCandidateOriginalResume(cand);

    // Fetch and render Interview + Behavioral tabs
    renderInterviewTabs(cand.id);

    // Fetch and render notes
    loadCandidateNotes(cand.id);

    // Wire Action Buttons dynamically
    renderFooterButtons(cand);
}

/**
 * Fetches latest interview detail and renders Interview Report + Behavioral Report + Overall tabs.
 */
async function renderInterviewTabs(candidateId) {
    const vicContainer  = document.getElementById("detail-interview-vic");
    const bcContainer   = document.getElementById("detail-behavioral-bc");

    const cand = selectedCandidate;
    const isErrorOrManual = cand && (cand.status === "failed" || cand.status === "unable_to_process" || cand.status === "manual_reviewed");
    
    if (isErrorOrManual) {
        if (vicContainer) {
            vicContainer.innerHTML = `
                <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                    <div style="font-size:2.5rem;margin-bottom:1rem;">🎙️</div>
                    <p style="margin:0;font-size:0.95rem;">No interview data</p>
                </div>`;
        }
        if (bcContainer) {
            bcContainer.innerHTML = `
                <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                    <div style="font-size:2.5rem;margin-bottom:1rem;">🧠</div>
                    <p style="margin:0;font-size:0.95rem;">No data</p>
                </div>`;
        }
        
        // Render Overall tab for failed/unable_to_process/manual_reviewed
        const overallContainer = document.getElementById("detail-overall-summary");
        if (overallContainer) {
            let verdict = "Review Needed";
            let bannerColor = "#ef4444";
            if (cand.status === "manual_reviewed") {
                verdict = "Manual Reviewed";
                bannerColor = "#3b82f6";
            }
            overallContainer.innerHTML = `
                <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 1.5rem; text-align: center; margin-bottom: 1.5rem;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⚠️</div>
                    <h3 style="color: #b91c1c; margin: 0 0 0.5rem 0; font-size: 1.25rem;">Candidate Review Required</h3>
                    <p style="color: #7f1d1d; margin: 0; font-size: 0.95rem;">This candidate's resume processing failed. Manual review is required to determine next steps.</p>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom: 1.5rem;">
                    <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:8px; padding:1.2rem; text-align:center;">
                        <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:.4rem;">Overall Score</div>
                        <div style="font-size:2.2rem; font-weight:700; color:${bannerColor};">0<span style="font-size:1rem; color:var(--text-muted)">/100</span></div>
                    </div>
                    <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:8px; padding:1.2rem; text-align:center;">
                        <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:.4rem;">AI Verdict</div>
                        <div style="font-size:1.1rem; font-weight:600; color:${bannerColor}; margin-top:.4rem;">${verdict}</div>
                    </div>
                </div>
            `;
        }
        
        const actionsContainer = document.getElementById("overall-actions-container");
        const decisionStatus = document.getElementById("overall-decision-status");
        if (actionsContainer) actionsContainer.style.display = "none";
        if (decisionStatus) decisionStatus.style.display = "none";
        return;
    }

    // Show loading states
    const loadingHtml = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Loading...</p>`;
    if (vicContainer) vicContainer.innerHTML = loadingHtml;
    if (bcContainer)  bcContainer.innerHTML  = loadingHtml;

    let data;
    try {
        const resp = await fetch(`/api/interviews/${candidateId}/detail`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
    } catch (e) {
        const errHtml = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Unable to load interview data.</p>`;
        if (vicContainer) vicContainer.innerHTML = errHtml;
        if (bcContainer)  bcContainer.innerHTML  = errHtml;
        return;
    }

    const iv     = data.interview;
    const events = data.events || [];

    // Helper: score pill colour
    const scorePillStyle = (score) => {
        if (score === null || score === undefined) return "background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0";
        if (score >= 75) return "background:rgba(22,163,74,0.15);color:#16a34a;border:1px solid rgba(22,163,74,0.3)";
        if (score >= 50) return "background:rgba(217,119,6,0.15);color:#d97706;border:1px solid rgba(217,119,6,0.3)";
        return "background:rgba(220,38,38,0.15);color:#dc2626;border:1px solid rgba(220,38,38,0.3)";
    };
    const pill = (label, score) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 1rem;
                    background:var(--bg-surface);border-radius:6px;border:1px solid var(--border-color);margin-bottom:0.5rem;">
            <span style="font-size:0.88rem;color:var(--text-main);">${label}</span>
            <span style="padding:0.2rem 0.65rem;border-radius:20px;font-size:0.8rem;font-weight:600;${scorePillStyle(score)}">
                ${score !== null && score !== undefined ? score : '–'}/100
            </span>
        </div>`;

    // ============================================================
    // INTERVIEW REPORT TAB (VIC — Technical scoring + Transcript)
    // ============================================================
    if (vicContainer) {
        if (!iv || !iv.status || ["scheduled"].includes(iv.status)) {
            vicContainer.innerHTML = `
                <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                    <div style="font-size:2.5rem;margin-bottom:1rem;">🎙️</div>
                    <p style="margin:0;font-size:0.95rem;">Interview not yet conducted.</p>
                </div>`;
        } else {
            const vicScores = iv.vic_scores;
            const transcript = iv.transcript || [];

            // Score header
            const scoreHeader = `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:1.2rem;text-align:center;">
                        <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem;">Technical Score</div>
                        <div style="font-size:2.2rem;font-weight:700;color:var(--color-primary);">${iv.vic_score !== null ? iv.vic_score : '–'}<span style="font-size:1rem;color:var(--text-muted)">/100</span></div>
                    </div>
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:1.2rem;text-align:center;">
                        <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem;">Status</div>
                        <div style="font-size:1.1rem;font-weight:600;color:var(--text-main);margin-top:.4rem;">${iv.status}</div>
                    </div>
                </div>`;

            // VIC criteria breakdown
            let criteriaHtml = "";
            if (vicScores && vicScores.criteria_scores && vicScores.criteria_scores.length) {
                criteriaHtml = `<h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:0 0 .75rem 0;">Criteria Breakdown</h4>`;
                vicScores.criteria_scores.forEach(c => {
                    criteriaHtml += pill(c.criterion, c.score);
                    if (c.rationale) {
                        criteriaHtml += `<p style="font-size:0.8rem;color:var(--text-muted);margin:.1rem 0 .7rem 1rem;padding-left:.75rem;border-left:2px solid var(--border-color);">${c.rationale}</p>`;
                    }
                });
            }

            // VIC summary
            let summaryHtml = "";
            if (vicScores && vicScores.summary) {
                summaryHtml = `
                    <div style="background:var(--bg-surface);border-radius:8px;border:1px solid var(--border-color);padding:1rem;margin-top:1rem;">
                        <strong style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">AI Technical Summary</strong>
                        <p style="margin:.5rem 0 0;font-size:0.88rem;color:var(--text-main);line-height:1.6;">${vicScores.summary}</p>
                    </div>`;
            }

            // Transcript dialogue
            let transcriptHtml = "";
            if (transcript.length > 0) {
                transcriptHtml = `<h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:1.5rem 0 .75rem 0;">Interview Transcript</h4>
                    <div style="max-height:300px;overflow-y:auto;padding-right:4px;">`;
                transcript.forEach(msg => {
                    const isAgent = msg.role === "assistant";
                    const bubbleStyle = isAgent
                        ? "background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.2);border-radius:0 8px 8px 8px;margin-bottom:.75rem;padding:.7rem 1rem;"
                        : "background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px 0 8px 8px;margin-bottom:.75rem;padding:.7rem 1rem;";
                    const label = isAgent ? "🤖 AI Interviewer" : "👤 Candidate";
                    const labelColor = isAgent ? "#4f46e5" : "var(--color-primary)";
                    transcriptHtml += `
                        <div style="${bubbleStyle}">
                            <div style="font-size:0.72rem;color:${labelColor};font-weight:600;margin-bottom:.35rem;">${label}</div>
                            <p style="margin:0;font-size:0.88rem;color:var(--text-main);line-height:1.5;">${msg.text || ''}</p>
                        </div>`;
                });
                transcriptHtml += `</div>`;
            } else {
                transcriptHtml = `<p style="color:var(--text-muted);font-size:0.88rem;margin-top:1.5rem;">Transcript not yet available.</p>`;
            }

            // Audio player section
            let audioHtml = "";
            if (iv.recording_url) {
                audioHtml = `
                    <div id="recording-player-container" style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:12px;padding:1.2rem;margin-bottom:1.5rem;text-align:center;box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:0.75rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:0.35rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-primary);"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                            Full Interview Recording
                        </span>
                        <div id="recording-player-wrapper" style="display:flex;justify-content:center;align-items:center;min-height:40px;">
                            <span style="font-size:0.85rem;color:var(--text-muted);display:flex;align-items:center;gap:0.5rem;">
                                Loading recording...
                            </span>
                        </div>
                    </div>`;
            }

            vicContainer.innerHTML = scoreHeader + audioHtml + criteriaHtml + summaryHtml + transcriptHtml;

            // Fetch the presigned recording URL if it exists
            if (iv.recording_url) {
                fetch(`/api/interviews/${iv.id}/recording-url`)
                    .then(r => {
                        if (!r.ok) throw new Error("Not found");
                        return r.json();
                    })
                    .then(urlData => {
                        const wrapper = document.getElementById("recording-player-wrapper");
                        if (wrapper) {
                            wrapper.innerHTML = `
                                <audio controls src="${urlData.recording_url}" style="width:100%;max-width:100%;margin:0 auto;display:block;outline:none;border-radius:8px;height:40px;"></audio>
                            `;
                        }
                    })
                    .catch(err => {
                        console.error("Failed to fetch signed recording URL:", err);
                        const wrapper = document.getElementById("recording-player-wrapper");
                        if (wrapper) {
                            wrapper.innerHTML = `
                                <span style="font-size:0.85rem;color:#dc2626;font-weight:500;">Recording file not found or expired</span>
                            `;
                        }
                    });
            }
        }
    }

    // ============================================================
    // BEHAVIORAL REPORT TAB (BC — Behavioral scoring + Anti-cheat)
    // ============================================================
    if (bcContainer) {
        if (!iv || !iv.bc_scores) {
            bcContainer.innerHTML = `
                <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                    <div style="font-size:2.5rem;margin-bottom:1rem;">🧠</div>
                    <p style="margin:0;font-size:0.95rem;">Behavioral analysis not yet available.</p>
                    <p style="margin:.5rem 0 0;font-size:0.85rem;">Runs automatically after interview recording is processed.</p>
                </div>`;
        } else {
            const bc = iv.bc_scores;
            const sm = bc.speech_metrics || {};

            // Score header
            const bcHeader = `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.5rem;">
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:1rem;text-align:center;">
                        <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.35rem;">Behavioral Score</div>
                        <div style="font-size:2rem;font-weight:700;color:var(--color-primary);">${iv.bc_score !== null ? iv.bc_score : '–'}<span style="font-size:.9rem;color:var(--text-muted)">/100</span></div>
                    </div>
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:1rem;text-align:center;">
                        <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.35rem;">WPM</div>
                        <div style="font-size:1.6rem;font-weight:700;color:var(--text-main);">${sm.wpm || '–'}</div>
                    </div>
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:1rem;text-align:center;">
                        <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.35rem;">Filler Words</div>
                        <div style="font-size:1.6rem;font-weight:700;color:var(--text-main);">${sm.filler_count !== undefined ? sm.filler_count : '–'}</div>
                    </div>
                </div>`;

            // Integrity Flag (Anti-Cheat Layer 5)
            let integrityBannerHtml = "";
            if (bc.integrity_flag === true) {
                integrityBannerHtml = `
                    <div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);border-radius:8px;padding:1rem 1.2rem;margin-bottom:1.2rem;display:flex;gap:.75rem;align-items:flex-start;">
                        <span style="font-size:1.3rem;flex-shrink:0;">⚠️</span>
                        <div>
                            <strong style="color:#dc2626;font-size:0.88rem;display:block;margin-bottom:.25rem;">Speech Pattern Anomaly Detected</strong>
                            <p style="margin:0;color:var(--text-main);font-size:0.85rem;line-height:1.5;">${bc.integrity_rationale || 'Anomalous speech patterns detected by AI analysis.'}</p>
                        </div>
                    </div>`;
            } else if (bc.integrity_flag === false) {
                integrityBannerHtml = `
                    <div style="background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.25);border-radius:8px;padding:.8rem 1.2rem;margin-bottom:1.2rem;display:flex;gap:.75rem;align-items:center;">
                        <span style="font-size:1.1rem;">✅</span>
                        <span style="color:#16a34a;font-size:0.88rem;font-weight:500;">No speech pattern anomalies detected.</span>
                    </div>`;
            }

            // BC criteria breakdown
            let bcCriteriaHtml = "";
            if (bc.criteria_scores && bc.criteria_scores.length) {
                bcCriteriaHtml = `<h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:0 0 .75rem 0;">Behavioral Criteria</h4>`;
                bc.criteria_scores.forEach(c => {
                    bcCriteriaHtml += pill(c.criterion, c.score);
                    if (c.rationale) {
                        bcCriteriaHtml += `<p style="font-size:0.8rem;color:var(--text-muted);margin:.1rem 0 .7rem 1rem;padding-left:.75rem;border-left:2px solid var(--border-color);">${c.rationale}</p>`;
                    }
                });
            }

            // BC summary
            let bcSummaryHtml = "";
            if (bc.summary) {
                bcSummaryHtml = `
                    <div style="background:var(--bg-surface);border-radius:8px;border:1px solid var(--border-color);padding:1rem;margin-top:1rem;">
                        <strong style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">AI Behavioral Summary</strong>
                        <p style="margin:.5rem 0 0;font-size:0.88rem;color:var(--text-main);line-height:1.6;">${bc.summary}</p>
                    </div>`;
            }

            // Integrity Events Timeline (Anti-Cheat Layers 1, 2, 4)
            let eventsHtml = "";
            if (events.length > 0) {
                eventsHtml = `<h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:1.5rem 0 .75rem 0;">Interview Integrity Events</h4>
                    <div style="display:flex;flex-direction:column;gap:.5rem;">`;

                events.forEach(ev => {
                    const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "–";
                    let icon = "📋";
                    let eventColor = "var(--text-muted)";
                    let bgColor = "var(--bg-surface)";
                    let borderColor = "var(--border-color)";

                    if (ev.event_type === "SUSPICIOUS_RECONNECT") {
                        icon = "🚨"; eventColor = "#dc2626";
                        bgColor = "rgba(220,38,38,0.08)"; borderColor = "rgba(220,38,38,0.25)";
                    } else if (ev.event_type === "tab_hidden") {
                        icon = "👁️"; eventColor = "#d97706";
                        bgColor = "rgba(217,119,6,0.08)"; borderColor = "rgba(217,119,6,0.25)";
                    } else if (ev.event_type === "tab_visible") {
                        icon = "👁️"; eventColor = "var(--text-muted)";
                    } else if (ev.event_type === "tab_intentionally_closed") {
                        icon = "🚪"; eventColor = "#f97316";
                        bgColor = "rgba(249,115,22,0.08)"; borderColor = "rgba(249,115,22,0.25)";
                    }

                    const extraData = ev.event_data ?
                        Object.entries(ev.event_data).map(([k,v]) => `${k}: ${v}`).join(" · ") : "";

                    eventsHtml += `
                        <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:6px;padding:.6rem .9rem;display:flex;gap:.75rem;align-items:flex-start;">
                            <span style="flex-shrink:0;font-size:1rem;">${icon}</span>
                            <div style="flex:1;min-width:0;">
                                <div style="display:flex;justify-content:space-between;align-items:center;">
                                    <strong style="font-size:0.82rem;color:${eventColor};">${ev.event_type.replace(/_/g,' ')}</strong>
                                    <span style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;margin-left:.5rem;">${ts}</span>
                                </div>
                                ${extraData ? `<p style="margin:.2rem 0 0;font-size:0.78rem;color:var(--text-muted);">${extraData}</p>` : ""}
                            </div>
                        </div>`;
                });
                eventsHtml += `</div>`;
            } else {
                eventsHtml = `
                    <div style="margin-top:1.5rem;padding:.8rem 1rem;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:6px;display:flex;gap:.6rem;align-items:center;">
                        <span>✅</span>
                        <span style="font-size:0.85rem;color:var(--text-muted);">No integrity events recorded.</span>
                    </div>`;
            }

            bcContainer.innerHTML = bcHeader + integrityBannerHtml + bcCriteriaHtml + bcSummaryHtml + eventsHtml;
        }
    }

    // ============================================================
    // OVERALL REPORT TAB (BB6 — Weighted score + AI Verdict)
    // ============================================================
    const overallContainer = document.getElementById("detail-overall-summary");
    const actionsContainer = document.getElementById("overall-actions-container");
    const decisionStatus = document.getElementById("overall-decision-status");
    if (actionsContainer) actionsContainer.style.display = "none";
    if (decisionStatus) decisionStatus.style.display = "none";

    if (overallContainer) {
        if (!iv) {
            overallContainer.innerHTML = `
                <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                    <div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
                    <p style="margin:0;font-size:0.95rem;">No interview data yet.</p>
                </div>`;
            const cand = selectedCandidate;
            if (cand && (cand.status === "hired" || cand.status === "rejected_post_interview") && decisionStatus) {
                const dateStr = cand.updated_at ? new Date(cand.updated_at).toLocaleDateString() : new Date().toLocaleDateString();
                decisionStatus.style.display = "block";
                if (cand.status === "hired") {
                    decisionStatus.textContent = `Hired on ${dateStr}`;
                    decisionStatus.style.color = "#16a34a";
                } else {
                    decisionStatus.textContent = `Not Selected on ${dateStr}`;
                    decisionStatus.style.color = "#dc2626";
                }
            }
        } else {
            const verdictColors = {
                "Strong Hire": "#16a34a", "Hire": "#22c55e",
                "Hold": "#d97706", "Needs Review": "#f97316", "Reject": "#dc2626"
            };

            // Fetch candidate-level data (overall_score, ai_verdict, report_pdf_url) from detail
            const cand = selectedCandidate;
            const matchScore  = cand.match_score || 0;
            const vicScore    = iv.vic_score || 0;
            const bcScore     = iv.bc_score  || 0;

            // If BB6 hasn't run yet, calculate locally for display
            const calcOverall = Math.round((matchScore * 0.40) + (vicScore * 0.35) + (bcScore * 0.25));
            const displayOverall = iv.overall_score || calcOverall;

            // Verdict
            let displayVerdict = iv.ai_verdict || "–";
            let verdictColor   = verdictColors[displayVerdict] || "var(--color-primary)";
            if (displayVerdict === "–" && calcOverall > 0) {
                if (calcOverall >= 90)      { displayVerdict = "Strong Hire"; verdictColor = "#16a34a"; }
                else if (calcOverall >= 75) { displayVerdict = "Hire";        verdictColor = "#22c55e"; }
                else if (calcOverall >= 60) { displayVerdict = "Hold";        verdictColor = "#d97706"; }
                else if (calcOverall >= 45) { displayVerdict = "Needs Review";verdictColor = "#f97316"; }
                else if (calcOverall > 0)   { displayVerdict = "Reject";      verdictColor = "#dc2626"; }
            }

            // Score gauge ring (SVG)
            const pct = Math.min(displayOverall, 100);
            const dash = Math.round((pct / 100) * 251); // circumference of r=40 circle
            const gaugeColor = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
            const gauge = `
                <div style="display:flex;justify-content:center;margin-bottom:1.5rem;">
                    <div style="position:relative;width:100px;height:100px;">
                        <svg width="100" height="100" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="10"/>
                            <circle cx="50" cy="50" r="40" fill="none" stroke="${gaugeColor}" stroke-width="10"
                                stroke-dasharray="${dash} 251" stroke-linecap="round"
                                transform="rotate(-90 50 50)" style="transition:stroke-dasharray 1s ease;"/>
                        </svg>
                        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                            <span style="font-size:1.5rem;font-weight:700;color:var(--text-main);">${displayOverall}</span>
                            <span style="font-size:0.65rem;color:var(--text-muted);">/ 100</span>
                        </div>
                    </div>
                </div>`;

            // Verdict badge
            const verdictBadge = `
                <div style="text-align:center;margin-bottom:1.5rem;">
                    <span style="display:inline-block;padding:.4rem 1.4rem;border-radius:999px;
                        font-size:0.95rem;font-weight:700;
                        background:${verdictColor}22;color:${verdictColor};
                        border:1.5px solid ${verdictColor}55;">${displayVerdict}</span>
                </div>`;

            // Score breakdown formula
            const breakdownTable = `
                <h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:0 0 .75rem 0;">Score Formula</h4>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:1rem;">
                    ${[["Resume Match", matchScore, "× 40%"], ["Technical VIC", vicScore, "× 35%"], ["Behavioral BC", bcScore, "× 25%"]].map(([lbl, sc, wt]) => `
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:.8rem;text-align:center;">
                        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:.25rem;">${lbl}</div>
                        <div style="font-size:1.4rem;font-weight:700;color:var(--color-primary);">${sc || 0}</div>
                        <div style="font-size:0.7rem;color:var(--text-muted);">${wt}</div>
                    </div>`).join("")}
                </div>
                <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:.75rem;
                    text-align:center;font-size:0.82rem;color:var(--text-muted);margin-bottom:1.2rem;">
                    ${matchScore}×0.40 + ${vicScore}×0.35 + ${bcScore}×0.25 = <strong style="color:var(--text-main);">${displayOverall}/100</strong>
                </div>`;

            // Generate report button (if not yet generated)
            const hasReport = iv.voice_ogg_url || iv.vic_score !== null;
            const generateBtn = (!iv.ai_verdict && iv.status !== "analysis_complete" && hasReport)
                ? `<button id="btn-gen-report" onclick="triggerReport(${iv.id})"
                    style="width:100%;padding:.75rem;border-radius:8px;border:none;cursor:pointer;
                    background:linear-gradient(135deg,var(--color-primary),#4f46e5);
                    color:#fff;font-size:0.9rem;font-weight:600;margin-top:.5rem;">
                    ⚡ Generate AI Report
                   </button>` : "";

            const reportStatus = iv.ai_verdict
                ? `<div style="background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);border-radius:6px;
                    padding:.7rem 1rem;text-align:center;font-size:0.85rem;color:#16a34a;font-weight:500;margin-top:.5rem;">
                    ✓ Report generated &amp; ready to download
                   </div>` : "";

            overallContainer.innerHTML = gauge + verdictBadge + breakdownTable + generateBtn + reportStatus;

            // Overall Decisions for completed interviews
            const activeJob = jobs.find(j => Number(j.id) === Number(currentJobId));
            if (actionsContainer && decisionStatus) {
                if (activeJob && activeJob.status === "open" && cand && cand.status === "interview_completed" && iv && iv.overall_score !== null && iv.ai_verdict) {
                    actionsContainer.style.display = "flex";
                } else if (cand && (cand.status === "hired" || cand.status === "rejected_post_interview")) {
                    const dateStr = cand.updated_at ? new Date(cand.updated_at).toLocaleDateString() : new Date().toLocaleDateString();
                    decisionStatus.style.display = "block";
                    if (cand.status === "hired") {
                        decisionStatus.textContent = `Hired on ${dateStr}`;
                        decisionStatus.style.color = "#16a34a";
                    } else {
                        decisionStatus.textContent = `Not Selected on ${dateStr}`;
                        decisionStatus.style.color = "#dc2626";
                    }
                }
            }
        }
    }
} // end renderInterviewTabs

/**
 * Triggers BB6 report generation manually.
 */
async function triggerReport(interviewId) {
    const btn = document.getElementById("btn-gen-report");
    if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
    try {
        const r = await fetch(`/api/interviews/${interviewId}/report/trigger`, { method: "POST" });
        if (!r.ok) throw new Error("API error " + r.status);
        if (btn) { btn.textContent = "⏳ Processing (check back in ~30s)"; }
    } catch(e) {
        if (btn) { btn.disabled = false; btn.textContent = "⚡ Generate AI Report"; }
        alert("Failed to trigger report: " + e.message);
    }
}

/**
 * Utility functions for candidate status and score badges
 */
function getStatusLabelAndClass(status) {
    switch(status) {
        case "uploaded": return { label: "Uploaded", className: "badge-uploaded" };
        case "parsing": return { label: "Parsing...", className: "badge-parsing" };
        case "structured": return { label: "Structured", className: "badge-structured" };
        case "scored": return { label: "Scored", className: "badge-scored" };
        case "shortlisted": return { label: "Shortlisted", className: "badge-shortlisted" };
        case "rejected": return { label: "Rejected", className: "badge-rejected" };
        case "failed": return { label: "Review Needed", className: "badge-failed" };
        case "interview_invited": return { label: "Invited", className: "badge-interview_invited" };
        case "interview_ongoing": return { label: "Live", className: "badge-interview_ongoing" };
        case "interview_completed": return { label: "Completed", className: "badge-interview_completed" };
        case "unable_to_process": return { label: "Review Needed", className: "badge-unable_to_process" };
        case "manual_reviewed": return { label: "Manual Reviewed", className: "badge-manual_reviewed" };
        case "hired": return { label: "Hired", className: "badge-hired" };
        case "rejected_post_interview": return { label: "Not Selected", className: "badge-rejected_post_interview" };
        default: return { label: status, className: "badge-uploaded" };
    }
}

function getScoreGroupClass(score) {
    if (score === null || score === undefined) return "score-badge-red";
    const s = parseInt(score, 10);
    if (isNaN(s)) return "score-badge-red";
    if (s >= 90) return "score-badge-green";
    if (s >= 75) return "score-badge-blue";
    if (s >= 60) return "score-badge-yellow";
    if (s >= 45) return "score-badge-orange";
    return "score-badge-red";
}

function setButtonLoading(button, isLoading, textWhileLoading) {
    if (!button) return;
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.innerHTML;
        button.innerHTML = `<span class="spinner"></span> ${textWhileLoading}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
        }
    }
}

let inviteTimer = null;
function checkInviteLock(candId, button) {
    if (!button) return;
    const lockTimeStr = localStorage.getItem('invite_lock_' + candId);
    if (!lockTimeStr) return;

    const lockTime = parseInt(lockTimeStr, 10);
    const now = Date.now();
    const remaining = lockTime - now;

    if (remaining > 0) {
        button.disabled = true;
        button.textContent = `Resend Invite (${Math.ceil(remaining / 1000)}s)`;
        if (inviteTimer) clearInterval(inviteTimer);
        inviteTimer = setInterval(() => {
            const rem = lockTime - Date.now();
            if (rem <= 0) {
                clearInterval(inviteTimer);
                button.disabled = false;
                button.textContent = "Resend Invite";
                localStorage.removeItem('invite_lock_' + candId);
            } else {
                button.textContent = `Resend Invite (${Math.ceil(rem / 1000)}s)`;
            }
        }, 1000);
    } else {
        localStorage.removeItem('invite_lock_' + candId);
    }
}

function renderFooterButtons(cand) {
    const footer = document.querySelector(".profile-footer");
    if (!footer) return;
    footer.innerHTML = "";

    const btnShortlist = document.createElement("button");
    btnShortlist.className = "btn btn-shortlist";
    btnShortlist.textContent = "Shortlist";
    
    const btnReject = document.createElement("button");
    btnReject.className = "btn btn-reject";
    btnReject.textContent = "Reject";
    
    const btnInvite = document.createElement("button");
    btnInvite.className = "btn btn-invite";
    btnInvite.textContent = "Invite for Interview";

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn btn-danger";
    btnDelete.textContent = "Delete";

    const btnReview = document.createElement("button");
    btnReview.className = "btn btn-secondary";
    btnReview.textContent = "Review";

    const btnMarkReviewed = document.createElement("button");
    btnMarkReviewed.className = "btn btn-success";
    btnMarkReviewed.textContent = "Mark as Reviewed";

    const btnHire = document.createElement("button");
    btnHire.className = "btn btn-primary";
    btnHire.textContent = "✓ Hire";

    const btnRejectPost = document.createElement("button");
    btnRejectPost.className = "btn btn-danger";
    btnRejectPost.textContent = "✕ Reject";

    const btnDownload = document.createElement("button");
    btnDownload.className = "btn btn-secondary";
    btnDownload.textContent = "⬇ PDF Report";

    // Setup action handlers
    // 1. Shortlist
    btnShortlist.addEventListener("click", async () => {
        setButtonLoading(btnShortlist, true, "Shortlisting...");
        btnReject.disabled = true;
        try {
            const response = await fetch(`/api/candidates/${cand.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "shortlisted" })
            });
            if (response.ok) {
                const updated = await response.json();
                updateCandidateLocal(updated);
            } else {
                alert("Failed to shortlist candidate.");
            }
        } catch (e) {
            console.error(e);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btnShortlist, false);
            btnReject.disabled = false;
        }
    });

    // 2. Reject
    const handleReject = async (btn) => {
        if (!confirm(`Confirm REJECT for ${cand.name}?`)) return;
        setButtonLoading(btn, true, "Rejecting...");
        try {
            const response = await fetch(`/api/candidates/${cand.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "rejected" })
            });
            if (response.ok) {
                const updated = await response.json();
                updateCandidateLocal(updated);
            } else {
                alert("Failed to reject candidate.");
            }
        } catch (e) {
            console.error(e);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btn, false);
        }
    };
    btnReject.addEventListener("click", () => handleReject(btnReject));

    // 3. Invite / Resend Invite
    const handleInvite = async (btn) => {
        setButtonLoading(btn, true, "Inviting...");
        try {
            const response = await fetch(`/api/interviews/${cand.id}/invite`, {
                method: "POST"
            });
            if (response.ok) {
                const data = await response.json();
                const inviteLink = `${window.location.origin}/interview/${data.invite_token}`;
                let msg = `Candidate ${cand.name || 'Candidate'} invited successfully!\n\n`;
                if (data.email_sent) {
                    msg += `Invitation email sent via SendGrid.\n\n`;
                } else {
                    msg += `SendGrid email not sent (Error: ${data.email_error || 'Not Configured'}).\n\n`;
                }
                msg += `Invitation Link: ${inviteLink}`;
                alert(msg);
                
                // Set lock for 5 minutes
                const expiry = Date.now() + 5 * 60 * 1000;
                localStorage.setItem('invite_lock_' + cand.id, expiry);

                // Reload candidate list and select updated candidate
                const resCand = await fetch(`/api/candidates?job_id=${currentJobId}`);
                if (resCand.ok) {
                    const resData = await resCand.json();
                    candidates = resData.candidates || [];
                    const updatedCand = candidates.find(c => c.id === cand.id);
                    if (updatedCand) updateCandidateLocal(updatedCand);
                }
            } else {
                const err = await response.json();
                alert(`Failed to invite candidate: ${err.detail || response.statusText}`);
            }
        } catch (e) {
            console.error(e);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btn, false);
        }
    };
    btnInvite.addEventListener("click", () => handleInvite(btnInvite));

    // 4. Delete (server-side candidate deletion)
    btnDelete.addEventListener("click", async () => {
        if (!confirm(`Are you sure you want to permanently delete candidate ${cand.name}?`)) return;
        setButtonLoading(btnDelete, true, "Deleting...");
        try {
            const res = await fetch(`/api/candidates/${cand.id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" }
            });
            if (res.ok) {
                alert(`${cand.name} has been deleted successfully.`);
                candidates = candidates.filter(c => c.id !== cand.id);
                renderCandidates();
                document.getElementById("no-profile-selected").style.display = "flex";
                document.getElementById("profile-details").style.display = "none";
                selectedCandidate = null;
            } else {
                const errData = await res.json().catch(() => ({}));
                alert(`Delete failed: ${errData.detail || res.statusText}`);
            }
        } catch (err) {
            console.error("Delete network error:", err);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btnDelete, false);
        }
    });

    // 5. Review (switches tab to Resume)
    btnReview.addEventListener("click", () => {
        const resumeTab = document.querySelector('[data-tab="resume"]');
        if (resumeTab) resumeTab.click();
        alert("Please review the candidate's resume upload status and file parsing logs in the active tab.");
    });

    // 5b. Mark as Reviewed
    btnMarkReviewed.addEventListener("click", async () => {
        setButtonLoading(btnMarkReviewed, true, "Reviewing...");
        try {
            const response = await fetch(`/api/candidates/${cand.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "manual_reviewed" })
            });
            if (response.ok) {
                const updated = await response.json();
                updateCandidateLocal(updated);
            } else {
                alert("Failed to mark candidate as reviewed.");
            }
        } catch (e) {
            console.error(e);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btnMarkReviewed, false);
        }
    });

    // 6. Hire (post-interview)
    btnHire.addEventListener("click", async () => {
        if (!confirm(`Confirm HIRE for ${cand.name}?`)) return;
        setButtonLoading(btnHire, true, "Hiring...");
        try {
            const r = await fetch(`/api/candidates/${cand.id}/status`, {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({status: "hired"})
            });
            if (r.ok) {
                const updated = await r.json();
                updateCandidateLocal(updated);
            } else {
                alert("Failed to hire candidate.");
            }
        } catch(e) {
            console.error(e);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btnHire, false);
        }
    });

    // 7. Reject Post-Interview
    btnRejectPost.addEventListener("click", async () => {
        if (!confirm(`Confirm REJECT (post-interview) for ${cand.name}?`)) return;
        setButtonLoading(btnRejectPost, true, "Rejecting...");
        try {
            const r = await fetch(`/api/candidates/${cand.id}/status`, {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({status: "rejected_post_interview"})
            });
            if (r.ok) {
                const updated = await r.json();
                updateCandidateLocal(updated);
            } else {
                alert("Failed to reject candidate.");
            }
        } catch(e) {
            console.error(e);
            alert("Error: Connection failed.");
        } finally {
            setButtonLoading(btnRejectPost, false);
        }
    });

    // 8. Download PDF report
    btnDownload.addEventListener("click", async () => {
        setButtonLoading(btnDownload, true, "Fetching...");
        try {
            const r = await fetch(`/api/candidates/${cand.id}/report`);
            if (r.status === 404) {
                alert("Report not yet generated. Click 'Generate AI Report' in the Overall tab first.");
                return;
            }
            if (!r.ok) throw new Error("API error " + r.status);
            const data = await r.json();
            const a = document.createElement("a");
            a.href = data.report_url;
            a.download = `talentstream_report_${cand.name || cand.id}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch(e) {
            alert("Failed to download: " + e.message);
        } finally {
            setButtonLoading(btnDownload, false);
        }
    });

    // Determine what to display based on candidate status
    const activeJob = jobs.find(j => Number(j.id) === Number(currentJobId));
    const isClosedJob = activeJob && activeJob.status === "closed";
    if (isClosedJob) {
        if (["hired", "rejected_post_interview", "interview_completed", "analysis_complete", "final_evaluation", "completed"].includes(cand.status)) {
            footer.appendChild(btnDownload);
        }
        return;
    }

    const status = cand.status;
    if (status === "scored" || status === "new" || status === "structured" || status === "parsed" || status === "uploaded" || status === "parsing" || status === "manual_review" || status === "manual_reviewed") {
        footer.appendChild(btnShortlist);
        footer.appendChild(btnReject);
    } else if (status === "shortlisted") {
        footer.appendChild(btnInvite);
        footer.appendChild(btnReject);
    } else if (status === "rejected" || status === "rejected_post_interview") {
        footer.appendChild(btnDelete);
    } else if (status === "failed" || status === "unable_to_process") {
        footer.appendChild(btnMarkReviewed);
        footer.appendChild(btnDelete);
    } else if (status === "interview_invited" || status === "interview_scheduled") {
        btnInvite.textContent = "Resend Invite";
        checkInviteLock(cand.id, btnInvite);
        footer.appendChild(btnInvite);
        footer.appendChild(btnReject);
    } else if (status === "interview_ongoing") {
        const liveBtn = document.createElement("button");
        liveBtn.className = "btn btn-primary";
        liveBtn.disabled = true;
        liveBtn.textContent = "Interview Live";
        footer.appendChild(liveBtn);
        footer.appendChild(btnReject);
    } else if (["interview_completed", "analysis_complete", "final_evaluation", "completed"].includes(status)) {
        footer.appendChild(btnHire);
        footer.appendChild(btnRejectPost);
        footer.appendChild(btnDownload);
    } else if (status === "hired") {
        btnHire.disabled = true;
        btnHire.textContent = "✓ Hired";
        btnHire.style.opacity = "0.6";
        footer.appendChild(btnHire);
        footer.appendChild(btnDownload);
    }
}

function updateCandidateLocal(updatedCand) {
    selectedCandidate = updatedCand;
    const idx = candidates.findIndex(c => c.id === updatedCand.id);
    if (idx !== -1) candidates[idx] = updatedCand;
    selectCandidate(updatedCand);
    renderCandidates();
}

/**
 * Job Modal Handlers & Submit action
 */
function initJobModal() {
    const btnPostJob = document.getElementById("btn-post-job");
    const modalPostJob = document.getElementById("modal-post-job");
    const modalClose = document.getElementById("modal-close");
    const modalCancel = document.getElementById("modal-cancel");
    const formPostJob = document.getElementById("form-post-job");

    if (!btnPostJob || !modalPostJob) return;

    const openModal = () => { modalPostJob.style.display = "flex"; };
    const closeModal = () => {
        modalPostJob.style.display = "none";
        formPostJob.reset();
    };

    btnPostJob.addEventListener("click", openModal);
    if (modalClose) modalClose.addEventListener("click", closeModal);
    if (modalCancel) modalCancel.addEventListener("click", closeModal);

    // Close modal on click outside modal content
    modalPostJob.addEventListener("click", (e) => {
        if (e.target === modalPostJob) {
            closeModal();
        }
    });

    // Form submit handler
    formPostJob.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const submitBtn = formPostJob.querySelector("button[type='submit']");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Posting...";
        }
        
        const payload = {
            title: document.getElementById("job-title").value,
            department: document.getElementById("job-dept").value,
            jd: document.getElementById("job-jd").value,
            rvc: document.getElementById("job-rvc").value,
            vic: document.getElementById("job-vic").value,
            bc: document.getElementById("job-bc").value,
        };

        try {
            const response = await fetch("/api/jobs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const newJob = await response.json();
                closeModal();
                await loadJobs();
                selectJob(newJob.id);
            } else {
                alert("Failed to create job posting. Please try again.");
            }
        } catch (err) {
            console.error("Error creating job:", err);
            alert("An error occurred. Please check console.");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Post Job";
            }
        }
    });
}

/**
 * Render interface state when no job role is selected or active.
 */
function renderNoJobSelectedState() {
    currentJobId = null;
    selectedCandidate = null;
    
    // Hide details panel
    const noPro = document.getElementById("no-profile-selected");
    const proDet = document.getElementById("profile-details");
    if (noPro) noPro.style.display = "flex";
    if (proDet) proDet.style.display = "none";

    // Hide upload resumes button
    const uploadResumesBtn = document.getElementById("btn-open-upload");
    if (uploadResumesBtn) uploadResumesBtn.style.display = "none";

    // Clear active job details
    const activeJobInfo = document.getElementById("active-job-info");
    if (activeJobInfo) activeJobInfo.innerHTML = "";

    // Set candidate list message
    const candidateList = document.getElementById("candidates-list");
    if (candidateList) {
        candidateList.innerHTML = `
            <div class="no-candidates-msg">
                Select a job from the sidebar or create a new job to start evaluating candidates.
            </div>
        `;
    }
}

/**
 * Load all jobs from backend
 */
async function loadJobs() {
    try {
        const response = await fetch("/api/jobs");
        if (response.ok) {
            jobs = await response.json();
            renderJobs();
            // Automatically select first open job if none is selected yet and open jobs exist
            if (!currentJobId && jobs.length > 0) {
                const firstOpenJob = jobs.find(j => j.status === "open");
                if (firstOpenJob) {
                    selectJob(firstOpenJob.id);
                } else {
                    renderNoJobSelectedState();
                }
            } else if (jobs.length === 0) {
                renderNoJobSelectedState();
            }
        }
    } catch (e) {
        console.error("Failed to load jobs:", e);
    }
}

/**
 * Render jobs list into Left Panel sidebar
 */
function renderJobs() {
    const openList = document.getElementById("open-jobs-list");
    const closedList = document.getElementById("closed-jobs-list");

    if (!openList || !closedList) return;

    openList.innerHTML = "";
    closedList.innerHTML = "";

    jobs.forEach(job => {
        const li = document.createElement("li");
        li.className = `job-item ${currentJobId === job.id ? 'active' : ''}`;
        li.dataset.id = job.id;

        li.innerHTML = `
            <div class="job-item-title" style="font-weight: 500;">${job.title}</div>
            <div class="job-item-dept" style="font-size: 0.8rem; margin-top: 0.2rem;">${job.department}</div>
        `;

        li.addEventListener("click", () => {
            selectJob(job.id);
        });

        if (job.status === "open") {
            openList.appendChild(li);
        } else {
            closedList.appendChild(li);
        }
    });

    updateJobCounts();
}

function updateJobCounts() {
    const openJobs = jobs.filter(j => j.status === "open");
    const closedJobs = jobs.filter(j => j.status !== "open");

    const openCountBadge = document.getElementById("open-jobs-count");
    const closedCountBadge = document.getElementById("closed-jobs-count");

    if (openCountBadge) openCountBadge.textContent = openJobs.length;
    if (closedCountBadge) closedCountBadge.textContent = closedJobs.length;
}

function initAccordion() {
    const openHeader = document.getElementById("open-jobs-header");
    const closedHeader = document.getElementById("closed-jobs-header");
    const openContent = document.getElementById("open-jobs-content");
    const closedContent = document.getElementById("closed-jobs-content");

    if (openHeader && openContent) {
        openHeader.addEventListener("click", () => {
            const isExpanded = openHeader.getAttribute("aria-expanded") === "true";
            openHeader.setAttribute("aria-expanded", !isExpanded);
            if (isExpanded) {
                openContent.classList.add("collapsed");
            } else {
                openContent.classList.remove("collapsed");
            }
        });
    }

    if (closedHeader && closedContent) {
        closedHeader.addEventListener("click", () => {
            const isExpanded = closedHeader.getAttribute("aria-expanded") === "true";
            closedHeader.setAttribute("aria-expanded", !isExpanded);
            if (isExpanded) {
                closedContent.classList.add("collapsed");
            } else {
                closedContent.classList.remove("collapsed");
            }
        });
    }
}

/**
 * Selection logic for an active job role
 */
function selectJob(jobId) {
    currentJobId = jobId;
    olderBatches = [];
    olderBatchesLoaded = false;
    selectedStatuses = []; // Clear selected status filters on job switch
    
    if (window.renderStatusChips) {
        window.renderStatusChips();
    }
    
    renderJobs();
    
    // Hide details panel until candidate selected
    document.getElementById("no-profile-selected").style.display = "flex";
    document.getElementById("profile-details").style.display = "none";
    selectedCandidate = null;

    currentPage = 1;
    loadCandidates(jobId);
    fetchLastBatchForJob(jobId);

    const job = jobs.find(j => Number(j.id) === Number(jobId));
    
    // Manage Panel 2 upload controls based on job open/closed status
    const uploadResumesBtn = document.getElementById("btn-open-upload");
    const dropzone = document.getElementById("dropzone-candidate-resumes");
    if (job && job.status === "open") {
        if (uploadResumesBtn) uploadResumesBtn.style.display = "block";
        if (dropzone) dropzone.style.display = "flex";
    } else {
        if (uploadResumesBtn) uploadResumesBtn.style.display = "none";
        if (dropzone) dropzone.style.display = "none";
    }
    
    if (job) {
        let activeJobInfo = document.getElementById("active-job-info");
        if (!activeJobInfo) {
            activeJobInfo = document.createElement("div");
            activeJobInfo.id = "active-job-info";
            const middlePanel = document.querySelector(".middle-panel");
            middlePanel.insertBefore(activeJobInfo, middlePanel.firstChild);
        }
        
        activeJobInfo.innerHTML = `
            <div class="active-job-details" style="padding: 1.2rem; border-bottom: 1px solid var(--border-color); text-align: left; background-color: var(--bg-panel); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 1.2rem; font-weight: 600; color: var(--text-main);">${job.title}</h3>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0.2rem 0 0 0;">${job.department} | Status: <strong>${job.status.toUpperCase()}</strong></p>
                </div>
                <div style="display:flex;gap:0.5rem;align-items:center;">
                    <button class="btn btn-secondary btn-sm" id="btn-toggle-job-status" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
                        ${job.status === 'open' ? 'Close Job' : 'Reopen Job'}
                    </button>
                    <div id="delete-job-control-${job.id}" style="position:relative;">
                        <button id="btn-delete-job-${job.id}" class="btn btn-sm" style="padding:0.35rem 0.75rem;font-size:0.8rem;background:rgba(220,38,38,0.1);color:#dc2626;border:1px solid rgba(220,38,38,0.3);border-radius:6px;cursor:pointer;font-weight:500;transition:background 0.2s;">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Bind the status toggle button action
        const toggleBtn = document.getElementById("btn-toggle-job-status");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (job.status === "open") {
                    // Check if any candidates have status = "interview_completed"
                    try {
                        const checkResp = await fetch(`/api/candidates?jobId=${job.id}&status=interview_completed&limit=100`);
                        if (checkResp.ok) {
                            const checkData = await checkResp.json();
                            const undecidedList = checkData.candidates || checkData || [];
                            if (undecidedList.length > 0) {
                                showCloseJobWarningModal(job.id, undecidedList.length);
                                return;
                            }
                        }
                    } catch (checkErr) {
                        console.error("Error checking undecided candidates:", checkErr);
                    }
                    await closeJobAnyway(job.id);
                } else {
                    // Reopen Job
                    try {
                        const res = await fetch(`/api/jobs/${job.id}/reopen`, { method: "PATCH" });
                        if (res.ok) {
                            const updatedJob = await res.json();
                            await loadJobs();
                            selectJob(updatedJob.id);
                        }
                    } catch (err) {
                        console.error("Failed to reopen job:", err);
                    }
                }
            });
        }

        // Delete Job button — inline Yes/Cancel confirmation
        const deleteJobBtn = document.getElementById(`btn-delete-job-${job.id}`);
        const deleteControl = document.getElementById(`delete-job-control-${job.id}`);
        if (deleteJobBtn && deleteControl) {
            deleteJobBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                // Replace button with inline confirmation
                deleteControl.innerHTML = `
                    <div style="display:flex;align-items:center;gap:6px;background:var(--bg-surface);border:1px solid rgba(220,38,38,0.4);border-radius:8px;padding:4px 8px;font-size:0.8rem;color:var(--text-main);white-space:nowrap;">
                        <span>Delete <b>${job.title}</b>?</span>
                        <button id="confirm-delete-job-yes" style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;">Yes</button>
                        <button id="confirm-delete-job-no" style="background:var(--bg-sidebar);color:var(--text-main);border:1px solid var(--border-color);border-radius:4px;padding:3px 10px;font-size:0.8rem;cursor:pointer;">Cancel</button>
                    </div>
                `;

                document.getElementById("confirm-delete-job-no").addEventListener("click", (e) => {
                    e.stopPropagation();
                    deleteControl.innerHTML = `
                        <button id="btn-delete-job-${job.id}" class="btn btn-sm" style="padding:0.35rem 0.75rem;font-size:0.8rem;background:rgba(220,38,38,0.1);color:#dc2626;border:1px solid rgba(220,38,38,0.3);border-radius:6px;cursor:pointer;font-weight:500;">
                            🗑️ Delete
                        </button>
                    `;
                    // Re-bind the click (new DOM node)
                    document.getElementById(`btn-delete-job-${job.id}`).addEventListener("click", () => {
                        selectJob(job.id); // easiest re-render to restore the confirm flow
                    });
                });

                document.getElementById("confirm-delete-job-yes").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const yesBtn = document.getElementById("confirm-delete-job-yes");
                    if (yesBtn) { yesBtn.disabled = true; yesBtn.textContent = "…"; }
                    try {
                        const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
                        if (res.ok) {
                            renderNoJobSelectedState();
                            await loadJobs();
                            renderJobs();
                        } else {
                            const errData = await res.json().catch(() => ({}));
                            alert(`Delete failed: ${errData.detail || res.statusText}`);
                            selectJob(job.id);
                        }
                    } catch (err) {
                        console.error("Delete job network error:", err);
                        alert("Network error. Please try again.");
                        selectJob(job.id);
                    }
                });
            });
        }
    } else {
        const activeJobInfo = document.getElementById("active-job-info");
        if (activeJobInfo) activeJobInfo.innerHTML = "";
    }
}

/**
 * Initialize search and status filter elements
 */
function initFilters() {
    const sortControl = document.getElementById("sort-control");
    const searchInput = document.getElementById("candidate-search");
    const chipsContainer = document.getElementById("status-chips-container");
    
    function renderStatusChips() {
        if (!chipsContainer) return;
        chipsContainer.innerHTML = "";
        
        const activeJob = jobs.find(j => Number(j.id) === Number(currentJobId));
        const isClosedJob = activeJob && activeJob.status === "closed";

        const chipsList = isClosedJob ? [
            { label: "All", value: "all" },
            { label: "Hired", value: "hired" },
            { label: "Not Selected", value: "rejected_post_interview" }
        ] : [
            { label: "All", value: "all" },
            { label: "Uploaded", value: "uploaded" },
            { label: "Parsing", value: "parsing" },
            { label: "Scored", value: "scored" },
            { label: "Shortlisted", value: "shortlisted" },
            { label: "Rejected", value: "rejected" },
            { label: "Failed", value: "failed" },
            { label: "Unable to Process", value: "unable_to_process" }
        ];
        
        chipsList.forEach(item => {
            const chip = document.createElement("div");
            chip.className = "status-chip-clickable";
            
            const isAllActive = item.value === "all" && selectedStatuses.length === 0;
            const isOtherActive = item.value !== "all" && selectedStatuses.includes(item.value);
            
            if (isAllActive || isOtherActive) {
                chip.classList.add("active");
            }
            
            chip.textContent = item.label;
            
            chip.addEventListener("click", () => {
                if (item.value === "all") {
                    selectedStatuses = [];
                } else {
                    if (selectedStatuses.includes(item.value)) {
                        selectedStatuses = selectedStatuses.filter(s => s !== item.value);
                    } else {
                        selectedStatuses.push(item.value);
                    }
                }
                
                renderStatusChips();
                currentPage = 1;
                loadCandidates(currentJobId);
            });
            
            chipsContainer.appendChild(chip);
        });
    }

    window.renderStatusChips = renderStatusChips;
    renderStatusChips();
    
    if (sortControl) {
        sortControl.value = currentSort;
        sortControl.addEventListener("change", (e) => {
            currentSort = e.target.value;
            currentPage = 1;
            loadCandidates(currentJobId);
        });
    }
    
    let searchTimeout = null;
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            currentSearch = e.target.value.toLowerCase();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentPage = 1;
                loadCandidates(currentJobId);
            }, 300);
        });
    }
}

function initActionButtons() {
    const btnDecisionHire = document.getElementById("btn-decision-hire");
    const btnDecisionReject = document.getElementById("btn-decision-reject");
    const saveNoteBtn = document.getElementById("btn-save-note");

    if (saveNoteBtn) {
        saveNoteBtn.addEventListener("click", async () => {
            if (!selectedCandidate) return;
            const textarea = document.getElementById("notes-textarea");
            if (!textarea) return;
            const text = textarea.value.trim();
            if (!text) return;

            saveNoteBtn.disabled = true;
            const originalText = saveNoteBtn.textContent;
            saveNoteBtn.textContent = "Saving...";

            try {
                const response = await fetch(`/api/candidates/${selectedCandidate.id}/notes`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text })
                });
                if (response.ok) {
                    textarea.value = "";
                    loadCandidateNotes(selectedCandidate.id);
                } else {
                    alert("Failed to add note.");
                }
            } catch (e) {
                console.error(e);
                alert("Error: Connection failed.");
            } finally {
                saveNoteBtn.disabled = false;
                saveNoteBtn.textContent = originalText;
            }
        });
    }

    if (btnDecisionHire) {
        btnDecisionHire.addEventListener("click", async () => {
            if (!selectedCandidate) return;
            btnDecisionHire.disabled = true;
            if (btnDecisionReject) btnDecisionReject.disabled = true;
            try {
                const response = await fetch(`/api/candidates/${selectedCandidate.id}/status`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "hired" })
                });
                if (response.ok) {
                    const updated = await response.json();
                    updateCandidateLocal(updated);
                } else {
                    alert("Failed to hire candidate.");
                }
            } catch (e) {
                console.error(e);
                alert("Error: Connection failed.");
            } finally {
                btnDecisionHire.disabled = false;
                if (btnDecisionReject) btnDecisionReject.disabled = false;
            }
        });
    }

    if (btnDecisionReject) {
        btnDecisionReject.addEventListener("click", async () => {
            if (!selectedCandidate) return;
            btnDecisionReject.disabled = true;
            if (btnDecisionHire) btnDecisionHire.disabled = true;
            try {
                const response = await fetch(`/api/candidates/${selectedCandidate.id}/status`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "rejected_post_interview" })
                });
                if (response.ok) {
                    const updated = await response.json();
                    updateCandidateLocal(updated);
                } else {
                    alert("Failed to update candidate status.");
                }
            } catch (e) {
                console.error(e);
                alert("Error: Connection failed.");
            } finally {
                btnDecisionReject.disabled = false;
                if (btnDecisionHire) btnDecisionHire.disabled = false;
            }
        });
    }
}

/**
 * Outlook-Style 3-Panel Drag Resizing with localStorage persistence
 */
function initResizing() {
    const container = document.querySelector(".app-container");
    const leftPanel = document.getElementById("left-panel");
    const middlePanel = document.getElementById("middle-panel");
    const rightPanel = document.getElementById("right-panel");
    const resizer1 = document.getElementById("resize-handle-1");
    const resizer2 = document.getElementById("resize-handle-2");

    if (!resizer1 || !resizer2) return;

    // Load saved widths from localStorage
    const savedLeftWidth = localStorage.getItem("panel-width-left");
    const savedMiddleWidth = localStorage.getItem("panel-width-middle");
    const savedRightWidth = localStorage.getItem("panel-width-right");

    if (savedLeftWidth && savedMiddleWidth && savedRightWidth && window.innerWidth > 1024) {
        leftPanel.style.width = savedLeftWidth;
        middlePanel.style.width = savedMiddleWidth;
        rightPanel.style.width = savedRightWidth;
    }

    // Drag helper
    function setupDrag(resizer, resizeFn) {
        resizer.addEventListener("mousedown", (e) => {
            e.preventDefault();
            document.body.style.cursor = "col-resize";
            resizer.classList.add("active");

            function onMouseMove(moveEvent) {
                resizeFn(moveEvent);
            }

            function onMouseUp() {
                document.body.style.cursor = "";
                resizer.classList.remove("active");
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);

                // Save new widths to localStorage
                localStorage.setItem("panel-width-left", leftPanel.style.width);
                localStorage.setItem("panel-width-middle", middlePanel.style.width);
                localStorage.setItem("panel-width-right", rightPanel.style.width);
            }

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });
    }

    // Resizer 1 (between left and middle)
    setupDrag(resizer1, (e) => {
        if (window.innerWidth <= 1024) return;
        const containerRect = container.getBoundingClientRect();
        const newLeftWidth = e.clientX - containerRect.left;
        
        // Min width limits
        if (newLeftWidth > 150 && newLeftWidth < (containerRect.width - 400)) {
            const currentMiddleRightTotal = containerRect.width - newLeftWidth;
            const currentMiddleWidth = middlePanel.getBoundingClientRect().width;
            const currentRightWidth = rightPanel.getBoundingClientRect().width;
            const middleRatio = currentMiddleWidth / (currentMiddleWidth + currentRightWidth);
            
            leftPanel.style.width = `${newLeftWidth}px`;
            middlePanel.style.width = `${currentMiddleRightTotal * middleRatio}px`;
            rightPanel.style.width = `${currentMiddleRightTotal * (1 - middleRatio)}px`;
        }
    });

    // Resizer 2 (between middle and right)
    setupDrag(resizer2, (e) => {
        if (window.innerWidth <= 1024) return;
        const containerRect = container.getBoundingClientRect();
        const leftPanelRect = leftPanel.getBoundingClientRect();
        
        const newMiddleWidth = e.clientX - leftPanelRect.right;
        const newRightWidth = containerRect.right - e.clientX;

        // Min width limits
        if (newMiddleWidth > 200 && newRightWidth > 200) {
            middlePanel.style.width = `${newMiddleWidth}px`;
            rightPanel.style.width = `${newRightWidth}px`;
        }
    });
}

/**
 * Modal controller for uploading resumes
 */
function initUploadModal() {
    const btnOpenUpload = document.getElementById("btn-open-upload");
    const modalUpload   = document.getElementById("modal-upload-resumes");
    const closeBtn      = document.getElementById("modal-upload-close");
    const cancelBtn     = document.getElementById("modal-upload-cancel");

    if (!btnOpenUpload || !modalUpload) return;

    btnOpenUpload.addEventListener("click", () => {
        if (!currentJobId) {
            alert("Please select a job first before uploading resumes.");
            return;
        }
        modalUpload.style.display = "flex";
        // Restore batch history panel on open — SSE is still running in background
        renderBatchHistory();
    });

    const closeModal = () => {
        // DO NOT wipe progress container — preserve state for when modal re-opens
        modalUpload.style.display = "none";
    };

    if (closeBtn)  closeBtn.addEventListener("click",  closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    modalUpload.addEventListener("click", (e) => { if (e.target === modalUpload) closeModal(); });
}

/** Render a single batch row's HTML helper */
function getBatchRowHtml(b, idx, listType) {
    const total      = b.total_files     || 0;
    const processed  = b.processed_count || 0;
    const failed     = b.failed_count    || 0;
    const processing = b.processing_count || 0;
    const completed  = processed + failed;
    
    let pct = 0;
    if (total > 0) {
        if (b.logs && b.logs.length > 0) {
            let sumProgress = 0;
            b.logs.forEach(log => {
                sumProgress += log.file_progress || getFileProgress(log.status);
            });
            pct = Math.round(sumProgress / total);
        } else {
            pct = Math.round((completed / total) * 100);
        }
    }

    const hasFailed = (failed > 0) || (b.status === "failed");
    const isLive = (b.status === "processing" || b.status === "uploading");
    const isCompleted = (b.status === "completed" || b.status === "done");

    let badgeText = "Pending";
    let badgeClass = "badge-pending";

    if (hasFailed) {
        badgeText = "Failed";
        badgeClass = "badge-failed";
    } else if (isLive) {
        badgeText = "Live";
        badgeClass = "badge-live";
    } else if (isCompleted) {
        badgeText = "Completed";
        badgeClass = "badge-completed";
    }

    const detailsId = `batch-details-${listType}-${b.id}`;
    let logsHtml = "";
    if (b.logs && b.logs.length > 0) {
        const rows = b.logs.map(log => {
            const isFailed  = log.status === "failed" || log.status === "unable_to_process";
            const isScored  = log.status === "scored"  || log.status === "completed";
            const statusCls = isFailed ? "failed" : isScored ? "success" : "processing";
            const scoreText = (log.match_score != null) ? ` (${log.match_score}%)` : "";
            return `<tr>
                <td title="${log.file_name}">${log.file_name}</td>
                <td><span class="file-status-label ${statusCls}" style="font-size:0.72rem;">${log.status}${scoreText}</span></td>
                <td title="${log.error_message || ''}">${log.error_message || "—"}</td>
            </tr>`;
        }).join("");
        logsHtml = `<table class="batch-logs-mini-table">
            <thead><tr><th>File</th><th>Status</th><th>Error</th></tr></thead>
            <tbody>${rows}</tbody></table>`;
    } else {
        logsHtml = `<span style="color:var(--text-muted);font-size:0.78rem;">No file details yet.</span>`;
    }

    const batchNum = b.batch_num ? `Batch #${b.batch_num}` : `Batch #${b.id.substring(0, 6)}`;

    return `<div class="batch-history-row">
        <div class="batch-row-top">
            <span style="font-weight:600; color: var(--text-main);">${batchNum}</span>
            <span class="batch-badge ${badgeClass}">${badgeText}</span>
            <button type="button" onclick="toggleBatchHistoryDetails('${detailsId}', this)"
                style="background:none;border:1px solid var(--border-color);border-radius:4px;padding:2px 8px;font-size:0.75rem;cursor:pointer;color:var(--text-muted);">View Details</button>
        </div>
        <div class="batch-summary-text">${processed}/${total} scored | ${processing} processing | ${failed} failed | ${pct}%</div>
        <div id="${detailsId}" class="batch-row-details">${logsHtml}</div>
    </div>`;
}

/** Fetch older batches from the database for the active job role */
async function fetchOlderBatches() {
    const errorDiv = document.getElementById("older-batches-loading-error");
    if (errorDiv) {
        errorDiv.textContent = "Loading older batches...";
        errorDiv.style.display = "block";
    }

    try {
        const response = await fetch(`/api/upload-batches/${currentJobId}`);
        if (response.ok) {
            const data = await response.json();
            olderBatches = data;
            olderBatchesLoaded = true;
            renderBatchHistory();
        } else {
            console.warn(`GET /api/upload-batches/${currentJobId} returned ${response.status}. Using fallback candidate-based mock batches.`);
            const candResp = await fetch(`/api/candidates?jobId=${currentJobId}`);
            let mockBatches = [];
            if (candResp.ok) {
                const cands = await candResp.json();
                let chunked = [];
                for (let i = 0; i < cands.length; i += 3) {
                    chunked.push(cands.slice(i, i + 3));
                }
                mockBatches = chunked.map((group, idx) => {
                    const total = group.length;
                    const failed = group.filter(c => c.status === "unable_to_process").length;
                    const processed = total - failed;
                    return {
                        id: `older-batch-${idx + 1}`,
                        job_id: currentJobId,
                        batch_num: `O-${idx + 1}`,
                        total_files: total,
                        processed_count: processed,
                        failed_count: failed,
                        processing_count: 0,
                        status: failed > 0 ? "failed" : "completed",
                        completedAtTime: Date.now() - (idx + 1) * 3600000,
                        logs: group.map(c => ({
                            file_name: c.name ? `${c.name.replace(/\s+/g, '_')}_resume.pdf` : "resume.pdf",
                            status: c.status === "unable_to_process" ? "failed" : "completed",
                            error_message: c.status === "unable_to_process" ? "Parsing error: PDF text extraction failed" : null,
                            match_score: c.match_score
                        }))
                    };
                });
            }
            if (mockBatches.length === 0) {
                mockBatches = [
                    {
                        id: "mock-older-1",
                        job_id: currentJobId,
                        batch_num: "O-1",
                        total_files: 2,
                        processed_count: 2,
                        failed_count: 0,
                        processing_count: 0,
                        status: "completed",
                        completedAtTime: Date.now() - 7200000,
                        logs: [
                            { file_name: "john_doe_resume.pdf", status: "completed", error_message: null, match_score: 88 },
                            { file_name: "jane_smith_cv.pdf", status: "completed", error_message: null, match_score: 74 }
                        ]
                    }
                ];
            }
            olderBatches = mockBatches;
            olderBatchesLoaded = true;
            renderBatchHistory();
        }
    } catch (err) {
        console.error("Error fetching older batches:", err);
        if (errorDiv) {
            errorDiv.textContent = "Failed to load older batches.";
        }
    }
}

/** Render the "This Session" batch history panel inside the modal */
function renderBatchHistory() {
    const historyPanel = document.getElementById("upload-batch-history");
    const historyList  = document.getElementById("upload-batch-history-list");
    if (!historyPanel || !historyList) return;

    let currentJobSessionBatches = window.uploadBatches.filter(b => b.job_id === currentJobId);

    // Clean up completed batches older than 10 minutes from session history
    const now = Date.now();
    currentJobSessionBatches = currentJobSessionBatches.filter(b => {
        const completedAt = b.completedAt || b.completedAtTime;
        if (b.status === "completed" || b.status === "done") {
            if (!completedAt) {
                b.completed = now;
                b.completedAt = now;
                b.completedAtTime = now;
            }
            return (now - (b.completedAt || b.completedAtTime)) < 600000; // 10 minutes
        }
        return true;
    });

    // Auto-remove batches older than 5th position for this job
    if (currentJobSessionBatches.length > 5) {
        currentJobSessionBatches = currentJobSessionBatches.slice(0, 5);
    }

    // Update global window.uploadBatches to reflect this filtering and capping
    window.uploadBatches = window.uploadBatches.filter(b => {
        if (b.job_id !== currentJobId) return true;
        return currentJobSessionBatches.some(s => s.id === b.id);
    });
    sessionBatches = window.uploadBatches;

    if (currentJobSessionBatches.length === 0 && (!olderBatchesLoaded || olderBatches.length === 0)) {
        historyPanel.style.display = "none";
        return;
    }
    historyPanel.style.display = "block";

    let html = "";

    // Render active session batches
    html += currentJobSessionBatches.map((b, idx) => getBatchRowHtml(b, idx, "session")).join("");

    // Add Show older batches link or Older Batches header
    if (!olderBatchesLoaded) {
        html += `
        <div style="padding: 0.6rem 1rem; text-align: center; border-top: 1px solid var(--border-color);">
            <a href="#" id="link-show-older-batches" style="font-size: 0.8rem; color: var(--color-primary); text-decoration: none; font-weight: 500;">Show older batches</a>
            <div id="older-batches-loading-error" style="display: none; font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;"></div>
        </div>`;
    } else {
        html += `
        <div class="older-batches-heading" style="padding: 0.4rem 1rem; background: #f8fafc; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color);">
            Older Batches
        </div>`;
        if (olderBatches.length > 0) {
            html += olderBatches.map((b, idx) => getBatchRowHtml(b, idx, "older")).join("");
        } else {
            html += `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">No older batches found.</div>`;
        }
    }

    historyList.innerHTML = html;

    const showOlderLink = document.getElementById("link-show-older-batches");
    if (showOlderLink) {
        showOlderLink.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await fetchOlderBatches();
        });
    }
}

function toggleBatchHistoryDetails(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const open = el.classList.toggle("open");
    btn.textContent = open ? "Hide Details" : "View Details";
}

// Clean up expired completed batches every 15 seconds and re-render if modal is visible
setInterval(() => {
    const modalUpload = document.getElementById("modal-upload-resumes");
    if (modalUpload && modalUpload.style.display === "flex") {
        renderBatchHistory();
    }
}, 15000);

/**
 * Map resume upload status to progress percentage (0-100)
 */
function getFileProgress(status) {
    if (!status) return 0;
    if (status === "scored" || status === "shortlisted" || status === "completed" || status === "failed" || status === "unable_to_process") {
        return 100;
    }
    if (status === "structured") {
        return 75;
    }
    if (status === "parsing") {
        return 40;
    }
    if (status === "uploaded") {
        return 20;
    }
    if (status.startsWith("uploading:")) {
        const parts = status.split(":");
        const pct = parseInt(parts[1], 10);
        return isNaN(pct) ? 10 : pct;
    }
    return 10;
}

/**
 * Get name initials for compact candidate card avatar
 */
function getInitials(name) {
    if (!name) return "??";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return "??";
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Close Job Warning Modal and closing logic helpers
 */
function showCloseJobWarningModal(jobId, count) {
    const modal = document.getElementById("modal-close-job-warning");
    const warningText = document.getElementById("close-job-warning-text");
    if (!modal || !warningText) return;

    warningText.textContent = `You have ${count} candidate${count !== 1 ? 's' : ''} with completed interviews but no decision. Please review in Panel 3 → Overall tab before closing.`;
    modal.style.display = "flex";

    const closeBtn = document.getElementById("modal-close-warning-x");
    const reviewBtn = document.getElementById("btn-warning-review-now");
    const closeAnywayBtn = document.getElementById("btn-warning-close-anyway");

    const hideModal = () => { modal.style.display = "none"; };

    closeBtn.onclick = hideModal;
    reviewBtn.onclick = hideModal;
    closeAnywayBtn.onclick = async () => {
        hideModal();
        await closeJobAnyway(jobId);
    };
}

async function closeJobAnyway(jobId) {
    try {
        const res = await fetch(`/api/jobs/${jobId}/close`, { method: "PATCH" });
        if (res.ok) {
            const updatedJob = await res.json();
            await loadJobs();
            selectJob(updatedJob.id);
        } else {
            const errData = await res.json().catch(() => ({}));
            alert(errData.detail || "Failed to close job.");
        }
    } catch (err) {
        console.error("Failed to close job:", err);
        alert("An error occurred while closing the job.");
    }
}

/**
 * Recruiter Notes CRUD Helpers
 */
function escapeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getRelativeTimeString(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return "yesterday";
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadCandidateNotes(candidateId) {
    if (!candidateId && selectedCandidate) {
        candidateId = selectedCandidate.id;
    }
    if (!candidateId) return;

    const notesListContainer = document.getElementById("notes-list-container");
    if (notesListContainer) {
        notesListContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem; font-size: 0.9rem;">Loading notes...</p>`;
    }

    try {
        const response = await fetch(`/api/candidates/${candidateId}/notes`);
        if (response.ok) {
            const notes = await response.json();
            renderNotesList(notes);
        } else {
            if (notesListContainer) {
                notesListContainer.innerHTML = `<p style="color: var(--color-danger); text-align: center; padding: 2rem; font-size: 0.9rem;">Failed to load notes.</p>`;
            }
        }
    } catch (e) {
        console.error("Failed to load notes:", e);
        if (notesListContainer) {
            notesListContainer.innerHTML = `<p style="color: var(--color-danger); text-align: center; padding: 2rem; font-size: 0.9rem;">Failed to load notes.</p>`;
        }
    }
}

function renderNotesList(notes) {
    const container = document.getElementById("notes-list-container");
    if (!container) return;
    if (notes.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem; font-size: 0.9rem;">No recruiter notes added yet.</p>`;
        return;
    }
    
    const activeJob = jobs.find(j => Number(j.id) === Number(currentJobId));
    const isClosedJob = activeJob && activeJob.status === "closed";

    container.innerHTML = notes.map(note => `
        <div class="note-card" data-note-id="${note.id}" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem; transition: box-shadow 0.2s;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="note-time" style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">
                    ${getRelativeTimeString(note.created_at)}
                </span>
                ${!isClosedJob ? `
                <div class="note-actions" style="display: flex; gap: 0.5rem;">
                    <button class="btn-edit-note" onclick="editNoteInline(${note.id})" style="background: none; border: none; color: var(--color-primary); cursor: pointer; padding: 2px; font-size: 0.8rem; display: flex; align-items: center; gap: 2px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit
                    </button>
                    <button class="btn-delete-note" onclick="deleteNoteInline(${note.id})" style="background: none; border: none; color: var(--color-danger); cursor: pointer; padding: 2px; font-size: 0.8rem; display: flex; align-items: center; gap: 2px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg> Delete
                    </button>
                </div>
                ` : ''}
            </div>
            <div class="note-text-container">
                <p class="note-text-display" style="margin: 0; font-size: 0.88rem; color: var(--text-main); white-space: pre-wrap; line-height: 1.4;">${escapeHTML(note.text)}</p>
                <div class="note-text-edit-wrap" style="display: none; flex-direction: column; gap: 0.5rem;">
                    <textarea class="note-text-textarea" style="width: 100%; min-height: 60px; padding: 0.5rem; border: 1px solid var(--color-primary); border-radius: 4px; font-family: var(--font-primary); font-size: 0.88rem; background: var(--bg-app); color: var(--text-main); resize: vertical; outline: none;">${escapeHTML(note.text)}</textarea>
                    <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                        <button class="btn-cancel-edit-note" onclick="cancelEditNoteInline(${note.id})" style="background: var(--bg-app); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 4px; padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 500; cursor: pointer;">Cancel</button>
                        <button class="btn-save-edit-note" onclick="saveEditNoteInline(${note.id})" style="background: var(--color-primary); border: none; color: #ffffff; border-radius: 4px; padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 600; cursor: pointer;">Save</button>
                    </div>
                </div>
            </div>
        </div>
    `).join("");
}

window.editNoteInline = function(noteId) {
    const card = document.querySelector(`.note-card[data-note-id="${noteId}"]`);
    if (!card) return;
    card.querySelector(".note-text-display").style.display = "none";
    const noteActions = card.querySelector(".note-actions");
    if (noteActions) noteActions.style.display = "none";
    card.querySelector(".note-text-edit-wrap").style.display = "flex";
};

window.cancelEditNoteInline = function(noteId) {
    const card = document.querySelector(`.note-card[data-note-id="${noteId}"]`);
    if (!card) return;
    card.querySelector(".note-text-display").style.display = "block";
    const noteActions = card.querySelector(".note-actions");
    if (noteActions) noteActions.style.display = "flex";
    card.querySelector(".note-text-edit-wrap").style.display = "none";
    const textVal = card.querySelector(".note-text-display").textContent;
    card.querySelector(".note-text-textarea").value = textVal;
};

window.saveEditNoteInline = async function(noteId) {
    const card = document.querySelector(`.note-card[data-note-id="${noteId}"]`);
    if (!card) return;
    const newText = card.querySelector(".note-text-textarea").value.trim();
    if (!newText) return;
    
    const saveBtn = card.querySelector(".btn-save-edit-note");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
        const response = await fetch(`/api/notes/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: newText })
        });
        if (response.ok) {
            const updated = await response.json();
            card.querySelector(".note-text-display").textContent = updated.text;
            window.cancelEditNoteInline(noteId);
        } else {
            alert("Failed to update note.");
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
        }
    } catch (e) {
        console.error(e);
        alert("Error: Connection failed.");
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
    }
};

window.deleteNoteInline = async function(noteId) {
    if (!confirm("Are you sure you want to delete this note?")) return;
    try {
        const response = await fetch(`/api/notes/${noteId}`, {
            method: "DELETE"
        });
        if (response.ok) {
            if (selectedCandidate) {
                loadCandidateNotes(selectedCandidate.id);
            }
        } else {
            alert("Failed to delete note.");
        }
    } catch (e) {
        console.error(e);
        alert("Error: Connection failed.");
    }
};

function selectTab(tabName) {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanels = document.querySelectorAll(".tab-panel");
    tabButtons.forEach(btn => {
        if (btn.getAttribute("data-tab") === tabName) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    tabPanels.forEach(panel => {
        if (panel.id === `tab-${tabName}`) {
            panel.classList.add("active");
        } else {
            panel.classList.remove("active");
        }
    });
    if (tabName === "hr-notes" && selectedCandidate) {
        loadCandidateNotes(selectedCandidate.id);
    }
}
window.selectTab = selectTab;

async function loadCandidateOriginalResume(cand) {
    const container = document.getElementById("resume-frame-container");
    const downloadBtn = document.getElementById("btn-download-resume");
    if (!container) return;

    container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.9rem; padding: 2rem; display: flex; align-items: center; justify-content: center; height: 100%;"><span class="spinner" style="margin-right: 8px;"></span>Loading original resume...</div>`;
    if (downloadBtn) {
        downloadBtn.style.display = "none";
        downloadBtn.href = "#";
    }

    try {
        const resp = await fetch(`/api/candidates/${cand.id}/resume-url`);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        
        if (downloadBtn) {
            downloadBtn.style.display = "inline-flex";
            downloadBtn.href = data.url;
            downloadBtn.download = data.filename || "resume.pdf";
        }

        container.innerHTML = `
            <iframe src="${data.url}" style="width: 100%; height: 100%; border: none;" id="resume-iframe"></iframe>
        `;
        
        const iframe = document.getElementById("resume-iframe");
        if (iframe) {
            iframe.onerror = () => {
                showResumeFallback(data.url);
            };
        }
    } catch (e) {
        console.error("Failed to load original resume URL:", e);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                <p>Unable to load original resume preview.</p>
                ${cand.resume_url ? `<a href="/api/candidates/${cand.id}/resume-url" target="_blank" class="btn btn-secondary" style="margin-top: 0.5rem; display: inline-block;">Open Link</a>` : ''}
            </div>
        `;
    }
}

function showResumeFallback(url) {
    const container = document.getElementById("resume-frame-container");
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 10px; align-items: center; justify-content: center; height: 100%;">
                <p>Could not preview original resume directly inside the browser.</p>
                <a href="${url}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-weight: 600; text-decoration: none; border-radius: 4px;">
                    <span>↗️ Open Resume in New Tab</span>
                </a>
            </div>
        `;
    }
}



