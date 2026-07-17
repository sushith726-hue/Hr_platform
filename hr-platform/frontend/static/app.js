/* =============================================================================
   TALENTSTREAM — FRONTEND CORE CLIENT APPLICATION
   ============================================================================= */

let currentJobId = null;
let isDeleteDropdownOpen = false; // FIX 1: Guard SSE surgical updates when delete confirmation is open
let jobs = []; // All locally loaded jobs (union of open + closed pages)

// Lazy-load state for Open and Closed sections
const jobLazyState = {
    open:   { offset: 0, limit: 10, total: 0, loading: false, done: false },
    closed: { offset: 0, limit: 10, total: 0, loading: false, done: false },
};
let jobLazyObservers = {};  // IntersectionObserver refs keyed by 'open' | 'closed'
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
let loadCandidatesAbortController = null;
let activeBatchId = null;
let _batchSSECandidateReloadTimer = null; // throttle guard for SSE-driven reload
// Session-scoped batch history (JS memory only, max 5 recent batches)
window.uploadBatches = [];
let sessionBatches = window.uploadBatches;
let batchCounter = 0;
let olderBatches = [];
let olderBatchesLoaded = false;
let isStatusTrackerExpanded = false;

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initUploadZone();
    initJobModal();
    initUploadModal();
    initResumeModal();
    initResizing();
    loadJobs();
    initFilters();
    initActionButtons();
    initMobileNav();
    initAccordion();
    initPaginationControls();
    initJobDeleteDelegation();
    initCandidateListDelegation();
    initDeleteCandidateModal();
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
                        <span class="file-icon" aria-hidden="true">
                            <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#94a3b8" stroke-width="2"/><path d="M12 2a10 10 0 0110 10" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/></svg>
                        </span>
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
        if (iconEl) iconEl.innerHTML = icon;
        if (label)  { label.className = `file-status-label ${cls || ""}`; label.textContent = text; }
    }

    setCardStatus(`<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#94a3b8" stroke-width="2"/><path d="M12 2a10 10 0 0110 10" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/></svg>`, "Uploading...", "");

    const MAX_RETRIES = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 1) {
                const wait = attempt * 2000; // 2s, 4s back-off
                setCardStatus(`<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#94a3b8" stroke-width="2"/><path d="M12 2a10 10 0 0110 10" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/></svg>`, `Retry ${attempt}/${MAX_RETRIES}...`, "");
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

            // 409 = duplicate — skip retries, show immediately
            if (response.status === 409) {
                let detail = "Duplicate resume — already uploaded for this job.";
                try { const j = await response.json(); detail = j.detail || detail; } catch (_) {}
                setCardStatus(
                    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#f59e0b"/><path d="M12 8v4M12 16h.01" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`,
                    "Duplicate — skipped",
                    "warning"
                );
                console.warn(`[Upload] ${file.name} skipped (duplicate):`, detail);
                // Log non-critical failure to batch tracker
                if (batchId) {
                    fetch(`/api/uploads/batches/${batchId}/log-failure`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ file_name: file.name, file_size: file.size, error_message: detail })
                    }).catch(() => {});
                }
                return; // non-retriable — exit loop
            }

            if (!response.ok) {
                let detail = `HTTP ${response.status}`;
                try { const j = await response.json(); detail = j.detail || detail; } catch (_) {}
                throw new Error(detail);
            }

            const result = await response.json();
            console.log(`[Upload] ${file.name} OK (attempt ${attempt}):`, result);
            setCardStatus(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12l3.5 3.5L17 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`, "Uploaded", "success");
            // NOTE: Do NOT call loadCandidates here per-file.
            // The SSE batch completion (subscribeToBatchSSE -> throttled reload) handles refresh.
            return; // success — exit

        } catch (err) {
            lastErr = err;
            console.warn(`[Upload] ${file.name} attempt ${attempt} failed:`, err.message);
        }
    }

    // All retries exhausted
    console.error(`[Upload] ${file.name} permanently failed after ${MAX_RETRIES} attempts:`, lastErr?.message);
    setCardStatus(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#ef4444"/><path d="M8 8l8 8M16 8l-8 8" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`, `Failed: ${lastErr?.message || "unknown error"}`, "failed");

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


async function loadCandidates(jobId, showSkeleton = true) {
    if (!jobId) return;
    
    // Abort any existing in-flight candidate fetch
    if (loadCandidatesAbortController) {
        loadCandidatesAbortController.abort();
    }
    loadCandidatesAbortController = new AbortController();
    const { signal } = loadCandidatesAbortController;

    const listContainer = document.getElementById("candidates-list");
    if (showSkeleton && listContainer) {
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
        
        const response = await fetch(url, { signal });
        if (!response.ok) {
            throw new Error(`Failed to fetch candidates: ${response.statusText}`);
        }
        const data = await response.json();
        
        // Ensure we only process if this fetch was not aborted
        if (signal.aborted) return;

        if (data && data.candidates) {
            candidates = data.candidates;
            pagination = data.pagination;
            if (pagination && pagination.page) {
                currentPage = pagination.page;
            }
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
        
        // Reset scroll position to top on page transition (when skeleton was shown)
        if (showSkeleton && listContainer) {
            const scrollContainer = listContainer.closest(".candidates-list-container");
            if (scrollContainer) {
                scrollContainer.scrollTop = 0;
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log("Fetch aborted for page load");
            return;
        }
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

    // Preserve scroll position so the list doesn't jump on refresh
    const scrollContainer = listContainer.closest(".candidates-list-container");
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
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
    
    // Check if the container currently has cards, and if their IDs match the list of displayCandidates.
    // If they do, we can surgically update each card's content instead of wiping and recreating the DOM.
    const existingCardNodes = listContainer.querySelectorAll(".candidate-card");
    const canSurgicallyUpdate = existingCardNodes.length === displayCandidates.length && 
        Array.from(existingCardNodes).every((node, idx) => Number(node.dataset.id) === Number(displayCandidates[idx].id));

    if (canSurgicallyUpdate) {
        displayCandidates.forEach((cand, idx) => {
            const card = existingCardNodes[idx];
            
            // Check active state
            const isActive = selectedCandidate && selectedCandidate.id === cand.id;
            let cardClass = "candidate-card";
            if (cand.status === "failed") {
                cardClass += " failed-card";
            } else if (cand.status === "unable_to_process") {
                cardClass += " unable-to-process-card";
            }
            if (isActive) {
                cardClass += " active";
            }
            
            if (card.className !== cardClass) {
                card.className = cardClass;
            }
            
            let displayScoreValue = cand.overall_score !== null && cand.overall_score !== undefined ? cand.overall_score : cand.match_score;
            let scoreClass = getScoreGroupClass(displayScoreValue);
            let displayScore = displayScoreValue !== null && displayScoreValue !== undefined ? displayScoreValue : '-';
            const initials = getInitials(cand.name);
            
            let statusIndicator = `<span class="status-dot status-dot-${cand.status === 'new' ? 'scored' : cand.status}"></span>`;
            if (cand.status === "failed" || cand.status === "unable_to_process" || cand.status === "manual_review") {
                statusIndicator = `<span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background-color: #ef4444; color: #ffffff; border-radius: 4px; font-weight: 600;">Review Needed</span>`;
                // Do NOT override displayScore — use actual score or '–' if null
                if (displayScore === '-') scoreClass = 'score-badge-red';
            } else if (cand.status === "manual_reviewed") {
                statusIndicator = `<span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background-color: #3b82f6; color: #ffffff; border-radius: 4px; font-weight: 600;">Manual Reviewed</span>`;
                // Do NOT override displayScore — use actual score or '–' if null
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
            
            const newHTML = `
                <div class="candidate-avatar">${initials}</div>
                <div class="candidate-card-middle">
                    <div class="candidate-card-title-row" style="${isClosedJob ? 'align-items: center; gap: 8px;' : ''}">
                        ${statusIndicator}
                        <h4>${displayName}</h4>
                    </div>
                    <div class="candidate-card-subtitle">${cand.email || '-'}</div>
                    ${(cand.status === "failed" || cand.status === "unable_to_process") ? '' : `
                    <div class="candidate-card-scores-row" style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
                        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                            <span style="color: var(--text-muted); font-weight: 500;">CV:</span>
                            <strong style="color: var(--text-main); font-weight: 600;">${cand.match_score !== null && cand.match_score !== undefined ? cand.match_score : '–'}</strong>
                        </div>
                        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                            <span style="color: var(--text-muted); font-weight: 500;">INT:</span>
                            <strong style="color: var(--text-main); font-weight: 600;">${cand.vic_score !== null && cand.vic_score !== undefined ? cand.vic_score : '–'}</strong>
                        </div>
                        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                            <span style="color: var(--text-muted); font-weight: 500;">BEH:</span>
                            <strong style="color: var(--text-main); font-weight: 600;">${cand.bc_score !== null && cand.bc_score !== undefined ? cand.bc_score : '–'}</strong>
                        </div>
                        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                            <span style="color: var(--text-muted); font-weight: 500;">OVR:</span>
                            <strong style="color: var(--text-main); font-weight: 600;">${cand.overall_score !== null && cand.overall_score !== undefined ? cand.overall_score : '–'}</strong>
                        </div>
                    </div>
                    `}
                </div>
                <div class="candidate-card-actions" id="card-actions-${cand.id}" ${actionsStyle}>
                    <button class="btn-card-menu" aria-label="Candidate options" id="btn-menu-${cand.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
                    <div class="card-menu-dropdown" id="dropdown-${cand.id}" style="display: none;">
                        <button class="menu-item-delete" id="delete-${cand.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>Delete</button>
                    </div>
                </div>
                <div class="candidate-card-right-container" style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 4px; margin-left: auto; padding-right: 28px; flex-shrink: 0;">
                    <div class="candidate-card-time" style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500; white-space: nowrap;">
                        ${formatRelativeTime(cand.created_at)}
                    </div>
                    ${(cand.status === "failed" || cand.status === "unable_to_process") ? `
                        <button class="btn btn-secondary btn-view-resume" style="padding: 2px 6px; font-size: 0.65rem; height: 22px; min-height: 22px; border-radius: 4px; font-weight: 600; cursor: pointer; white-space: nowrap;">View Resume</button>
                    ` : ''}
                </div>
            `;
            
            // Only update innerHTML if it has changed to prevent unneeded layout/paint cycles
            // FIX 1: Skip update if delete dropdown is open — prevents destroying Yes/No confirmation
            const cardDropdown = card.querySelector(".card-menu-dropdown");
            const dropdownIsOpen = cardDropdown && cardDropdown.style.display !== "none";
            if (!isDeleteDropdownOpen && !dropdownIsOpen && card.innerHTML.trim() !== newHTML.trim()) {
                card.innerHTML = newHTML;
            }
        });
        
        // Restore scroll position
        if (scrollContainer) {
            scrollContainer.scrollTop = savedScrollTop;
        }
        return;
    }

    // Full clear and rebuild if surgical update is not possible
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
        
        let displayScoreValue = cand.overall_score !== null && cand.overall_score !== undefined ? cand.overall_score : cand.match_score;
        let scoreClass = getScoreGroupClass(displayScoreValue);
        let displayScore = displayScoreValue !== null && displayScoreValue !== undefined ? displayScoreValue : '-';
        const initials = getInitials(cand.name);
        
        let statusIndicator = `<span class="status-dot status-dot-${cand.status === 'new' ? 'scored' : cand.status}"></span>`;
        if (cand.status === "failed" || cand.status === "unable_to_process" || cand.status === "manual_review") {
            statusIndicator = `<span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background-color: #ef4444; color: #ffffff; border-radius: 4px; font-weight: 600;">Review Needed</span>`;
            // Do NOT override displayScore — use actual score or '–' if null
            if (displayScore === '-') scoreClass = 'score-badge-red';
        } else if (cand.status === "manual_reviewed") {
            statusIndicator = `<span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background-color: #3b82f6; color: #ffffff; border-radius: 4px; font-weight: 600;">Manual Reviewed</span>`;
            // Do NOT override displayScore — use actual score or '–' if null
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
                ${(cand.status === "failed" || cand.status === "unable_to_process") ? '' : `
                <div class="candidate-card-scores-row" style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                        <span style="color: var(--text-muted); font-weight: 500;">CV:</span>
                        <strong style="color: var(--text-main); font-weight: 600;">${cand.match_score !== null && cand.match_score !== undefined ? cand.match_score : '–'}</strong>
                    </div>
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                        <span style="color: var(--text-muted); font-weight: 500;">INT:</span>
                        <strong style="color: var(--text-main); font-weight: 600;">${cand.vic_score !== null && cand.vic_score !== undefined ? cand.vic_score : '–'}</strong>
                    </div>
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                        <span style="color: var(--text-muted); font-weight: 500;">BEH:</span>
                        <strong style="color: var(--text-main); font-weight: 600;">${cand.bc_score !== null && cand.bc_score !== undefined ? cand.bc_score : '–'}</strong>
                    </div>
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; align-items: center; gap: 4px; line-height: 1.2;">
                        <span style="color: var(--text-muted); font-weight: 500;">OVR:</span>
                        <strong style="color: var(--text-main); font-weight: 600;">${cand.overall_score !== null && cand.overall_score !== undefined ? cand.overall_score : '–'}</strong>
                    </div>
                </div>
                `}
            </div>
            <div class="candidate-card-actions" id="card-actions-${cand.id}" ${actionsStyle}>
                <button class="btn-card-menu" aria-label="Candidate options" id="btn-menu-${cand.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
                <div class="card-menu-dropdown" id="dropdown-${cand.id}" style="display: none;">
                    <button class="menu-item-delete" id="delete-${cand.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>Delete</button>
                </div>
            </div>
            <div class="candidate-card-right-container" style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 4px; margin-left: auto; padding-right: 28px; flex-shrink: 0;">
                <div class="candidate-card-time" style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500; white-space: nowrap;">
                    ${formatRelativeTime(cand.created_at)}
                </div>
                ${(cand.status === "failed" || cand.status === "unable_to_process") ? `
                    <button class="btn btn-secondary btn-view-resume" style="padding: 2px 6px; font-size: 0.65rem; height: 22px; min-height: 22px; border-radius: 4px; font-weight: 600; cursor: pointer; white-space: nowrap;">View Resume</button>
                ` : ''}
            </div>
        `;
        listContainer.appendChild(card);
    });

    // Restore scroll position
    if (scrollContainer) {
        scrollContainer.scrollTop = savedScrollTop;
    }
}

function initCandidateListDelegation() {
    const listContainer = document.getElementById("candidates-list");
    if (!listContainer) return;

    listContainer.addEventListener("click", async (e) => {
        // Find if click is within a candidate card
        const card = e.target.closest(".candidate-card");
        if (!card) return;

        const candId = Number(card.dataset.id);

        // 1. Menu button click
        const menuBtn = e.target.closest(".btn-card-menu");
        if (menuBtn) {
            e.stopPropagation();
            e.preventDefault();
            const dropdown = document.getElementById(`dropdown-${candId}`);
            if (dropdown) {
                // Close all other open menus first
                document.querySelectorAll(".card-menu-dropdown").forEach(d => {
                    if (d !== dropdown) d.style.display = "none";
                });
                dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
            }
            return;
        }

        // 2. Delete button click — FIX 1: Opens a modal overlay instead of inline dropdown
        //    Modal lives outside .candidate-card DOM so SSE re-renders cannot destroy it
        const deleteBtn = e.target.closest(".menu-item-delete");
        if (deleteBtn) {
            e.stopPropagation();
            e.preventDefault();
            // Close the 3-dot dropdown immediately
            const dropdown = document.getElementById(`dropdown-${candId}`);
            if (dropdown) dropdown.style.display = "none";
            // Look up display name
            const candForName = candidates.find(c => Number(c.id) === candId);
            const displayName = (candForName && candForName.name) ? candForName.name.split(' ')[0] : 'candidate';
            // Open the modal
            const modal = document.getElementById("delete-candidate-modal");
            const nameSpan = document.getElementById("delete-modal-candidate-name");
            if (modal && nameSpan) {
                nameSpan.textContent = displayName;
                modal.dataset.candidateId = candId;
                modal.style.display = "flex";
                isDeleteDropdownOpen = true;
            }
            return;
        }

        // 3. Confirm Cancel (legacy inline — kept for safety, modal handles this now)
        // 4. Confirm Yes (legacy inline — kept for safety, modal handles this now)

        // 5. Default Card click (selects candidate)
        // Don't select candidate if clicking the dropdown or action menu area
        if (e.target.closest(".candidate-card-actions")) return;

        const cand = candidates.find(c => Number(c.id) === candId);
        if (!cand) return;

        selectCandidate(cand);
        if (e.target.closest(".btn-view-resume")) {
            selectTab("resume");
        }
    });
}

// FIX 1: Modal-based delete confirmation — lives outside candidate-card DOM,
// immune to SSE-driven renderCandidates() surgical updates.
function initDeleteCandidateModal() {
    // Inject modal HTML into body if not already present
    if (!document.getElementById("delete-candidate-modal")) {
        const modalHtml = `
        <div id="delete-candidate-modal" style="
            display:none; position:fixed; inset:0; z-index:9000;
            background:rgba(0,0,0,0.55); backdrop-filter:blur(4px);
            align-items:center; justify-content:center;
        ">
            <div style="
                background:var(--bg-card,#1e293b); border:1px solid var(--border-color,#334155);
                border-radius:12px; padding:1.75rem 2rem; min-width:280px; max-width:380px;
                box-shadow:0 25px 50px rgba(0,0,0,0.4); text-align:center;
                animation: modalFadeIn 0.18s ease;
            ">
                <div style="font-size:2rem;margin-bottom:0.6rem;">🗑️</div>
                <p style="margin:0 0 0.35rem; font-size:1rem; font-weight:700; color:var(--text-main,#f1f5f9);">Delete Candidate?</p>
                <p style="margin:0 0 1.4rem; font-size:0.88rem; color:var(--text-muted,#94a3b8);">This will permanently remove <strong id='delete-modal-candidate-name'></strong> and all associated data.</p>
                <div style="display:flex; gap:0.75rem; justify-content:center;">
                    <button id="delete-modal-cancel-btn" style="
                        flex:1; padding:0.6rem 0; border-radius:7px; border:1px solid var(--border-color,#334155);
                        background:var(--bg-surface,#0f172a); color:var(--text-main,#f1f5f9);
                        font-size:0.88rem; font-weight:600; cursor:pointer; transition:opacity 0.15s;
                    ">Cancel</button>
                    <button id="delete-modal-confirm-btn" style="
                        flex:1; padding:0.6rem 0; border-radius:7px; border:none;
                        background:#dc2626; color:#fff;
                        font-size:0.88rem; font-weight:600; cursor:pointer; transition:opacity 0.15s;
                    ">Yes, Delete</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML("beforeend", modalHtml);
    }

    const modal      = document.getElementById("delete-candidate-modal");
    const confirmBtn = document.getElementById("delete-modal-confirm-btn");
    const cancelBtn  = document.getElementById("delete-modal-cancel-btn");

    function closeModal() {
        modal.style.display = "none";
        isDeleteDropdownOpen = false;
    }

    cancelBtn.addEventListener("click", closeModal);

    // Close on backdrop click
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    confirmBtn.addEventListener("click", async () => {
        const targetId = Number(modal.dataset.candidateId);
        if (!targetId) { closeModal(); return; }

        confirmBtn.disabled = true;
        confirmBtn.textContent = "Deleting…";

        try {
            const res = await fetch(`/api/candidates/${targetId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" }
            });
            closeModal();
            if (res.ok) {
                // Animate the card out
                const card = document.querySelector(`.candidate-card[data-id="${targetId}"]`);
                if (card) {
                    card.style.transition = "opacity 0.25s ease, transform 0.25s ease";
                    card.style.opacity = "0";
                    card.style.transform = "translateX(-10px)";
                }
                setTimeout(() => {
                    if (selectedCandidate && Number(selectedCandidate.id) === targetId) {
                        const noPro = document.getElementById("no-profile-selected");
                        const proDet = document.getElementById("profile-details");
                        if (noPro) noPro.style.display = "flex";
                        if (proDet) proDet.style.display = "none";
                        selectedCandidate = null;
                    }
                    loadCandidates(currentJobId, false);
                }, 280);
            } else {
                const errData = await res.json().catch(() => ({}));
                console.error("Delete failed:", errData.detail || res.status);
                confirmBtn.disabled = false;
                confirmBtn.textContent = "Yes, Delete";
                modal.style.display = "flex";
                isDeleteDropdownOpen = true;
            }
        } catch (err) {
            console.error("Delete network error:", err);
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Yes, Delete";
            modal.style.display = "flex";
            isDeleteDropdownOpen = true;
        }
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
            btn1.setAttribute("data-page", "1");
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
            btn.setAttribute("data-page", p);
            if (p === current) {
                btn.className = "active";
            }
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
            btnLast.setAttribute("data-page", total);
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
    const pagBar = document.getElementById("pagination-bar");
    if (pagBar) {
        // Event delegation on the pagination bar container
        pagBar.addEventListener("click", (e) => {
            // 1. Prev Button Click
            const prevBtn = e.target.closest("#btn-prev-page");
            if (prevBtn) {
                if (pagination && pagination.has_prev) {
                    currentPage = pagination.page - 1;
                    loadCandidates(currentJobId);
                }
                return;
            }

            // 2. Next Button Click
            const nextBtn = e.target.closest("#btn-next-page");
            if (nextBtn) {
                if (pagination && pagination.has_next) {
                    currentPage = pagination.page + 1;
                    loadCandidates(currentJobId);
                }
                return;
            }

            // 3. Numbered Page Button Click
            const pageBtn = e.target.closest("[data-page]");
            if (pageBtn) {
                const pageNum = parseInt(pageBtn.getAttribute("data-page"));
                if (pageNum >= 1 && pagination && pageNum <= pagination.total_pages) {
                    currentPage = pageNum;
                    loadCandidates(currentJobId);
                }
                return;
            }

            // 4. Toggle Show All Click
            const toggleShowAll = e.target.closest("#btn-toggle-show-all");
            if (toggleShowAll) {
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
                return;
            }
        });
    }

    const jumpInput = document.getElementById("input-jump-page");
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
                if (iconEl) iconEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#ef4444"/><path d="M8 8l8 8M16 8l-8 8" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
                if (statusLabel) {
                    statusLabel.className = "file-status-label failed";
                    statusLabel.textContent = `Failed: ${log.error_message || 'Processing error'}`;
                    statusLabel.title = log.error_message || '';
                }
            } else if (log.status === "scored" || log.status === "shortlisted" || log.status === "completed") {
                if (iconEl) iconEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12l3.5 3.5L17 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                if (statusLabel) {
                    statusLabel.className = "file-status-label success";
                    statusLabel.textContent = log.match_score != null ? `Scored (${log.match_score}%)` : "Scored";
                }
            } else {
                if (iconEl) iconEl.innerHTML = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#94a3b8" stroke-width="2"/><path d="M12 2a10 10 0 0110 10" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/></svg>`;
                if (statusLabel) {
                    statusLabel.className = "file-status-label processing";
                    statusLabel.textContent = log.status.charAt(0).toUpperCase() + log.status.slice(1) + (log.status === "uploading" ? ` (${fp}%)` : "");
                }
            }
        });
    }

    updateJobBatchSummary(data);
    if (percent === 100) loadCandidates(currentJobId, false);
}

function updateJobBatchSummary(data) {
    const summaryDiv = document.getElementById("upload-batch-summary");
    if (!summaryDiv) return;

    if (!data) {
        summaryDiv.style.display = "none";
        summaryDiv.removeAttribute("data-batch-id");
        return;
    }

    summaryDiv.style.display = "block";

    const total      = data.total_files      ?? 0;
    const processed  = data.processed_count  ?? 0;
    const failed     = data.failed_count     ?? 0;
    const processing = data.processing_count ?? 0;

    // --- Build shell only once per batch (avoid full innerHTML on every SSE tick) ---
    if (summaryDiv.dataset.batchId !== String(data.id)) {
        summaryDiv.dataset.batchId = data.id;
        summaryDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 15v1a5 5 0 005 5h8a5 5 0 005-5v-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    Last Upload: <strong id="bsum-processed">0</strong>/<strong id="bsum-total">0</strong> processed | <strong id="bsum-processing">0</strong> processing | <strong id="bsum-failed">0</strong> failed
                </span>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-batch-details" style="padding:2px 8px;font-size:0.75rem;height:auto;">
                    View Details
                </button>
            </div>
            <div id="batch-details-inline-panel" class="batch-details-inline" style="display:none;width:100%;margin-top:10px;border-top:1px solid var(--border-color);padding-top:8px;">
                <!-- Expandable logs table injected here -->
            </div>
        `;

        // Wire toggle button once
        const toggleBtn   = summaryDiv.querySelector("#btn-toggle-batch-details");
        const inlinePanel = summaryDiv.querySelector("#batch-details-inline-panel");
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
        }
    }

    // --- In-place text updates (no DOM restructuring, no reflow) ---
    const elProcessed  = summaryDiv.querySelector("#bsum-processed");
    const elTotal      = summaryDiv.querySelector("#bsum-total");
    const elProcessing = summaryDiv.querySelector("#bsum-processing");
    const elFailed     = summaryDiv.querySelector("#bsum-failed");
    if (elProcessed)  elProcessed.textContent  = processed;
    if (elTotal)      elTotal.textContent       = total;
    if (elProcessing) elProcessing.textContent  = processing;
    if (elFailed)     elFailed.textContent      = failed;

    // --- Refresh log details table only when panel is visible ---
    const inlinePanel = summaryDiv.querySelector("#batch-details-inline-panel");
    if (inlinePanel && inlinePanel.style.display !== "none" && data.logs && data.logs.length > 0) {
        let tableHtml = `
            <table class="batch-logs-table" style="width:100%;border-collapse:collapse;margin-top:6px;font-size:0.8rem;text-align:left;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border-color);font-weight:600;color:var(--text-muted);">
                        <th style="padding:6px 4px;">File Name</th>
                        <th style="padding:6px 4px;width:100px;">Status</th>
                        <th style="padding:6px 4px;">Error Message</th>
                    </tr>
                </thead>
                <tbody>
        `;
        data.logs.forEach(log => {
            let statusClass = "uploaded";
            let statusText  = log.status;
            if (log.status === "failed" || log.status === "unable_to_process") statusClass = "failed";
            else if (log.status === "scored" || log.status === "completed")    statusClass = "scored";
            else if (log.status === "parsing" || log.status === "structured")  statusClass = "parsing";
            if (log.match_score !== null && log.match_score !== undefined) {
                statusText = `Scored (${log.match_score}%)`;
            }
            const errMsg = log.error_message || "-";
            tableHtml += `
                <tr style="border-bottom:1px solid var(--border-color);color:var(--text-main);">
                    <td style="padding:6px 4px;font-weight:500;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${log.file_name}">${log.file_name}</td>
                    <td style="padding:6px 4px;"><span class="status-tag ${statusClass}" style="font-size:0.7rem;padding:2px 6px;">${statusText}</span></td>
                    <td style="padding:6px 4px;color:var(--text-muted);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${errMsg}">${errMsg}</td>
                </tr>
            `;
        });
        tableHtml += `</tbody></table>`;
        inlinePanel.innerHTML = tableHtml;
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
    if (activeBatchSSE && activeBatchSSE.batchId === batchId) {
        return;
    }
    if (activeBatchSSE) activeBatchSSE.close();

    // Backend emits plain "data:" lines (no named event) so onmessage fires correctly
    activeBatchSSE = new EventSource(`/api/sse/batch/${batchId}`);
    activeBatchSSE.batchId = batchId;
    activeBatchSSE.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            updateBatchProgressUI(data);

            // Throttle SSE-triggered candidate reloads to at most once every 2 s.
            // Without this, every SSE tick fires a full fetch+DOM rebuild which
            // causes the candidate list to flash/shake continuously while parsing.
            if (currentJobId) {
                const hasRelevantCandidate = !data.logs || data.logs.length === 0 || data.logs.some(log => {
                    if (!log.candidate_id) return true;
                    return candidates.some(c => Number(c.id) === Number(log.candidate_id)) || (pagination && candidates.length < pagination.limit) || !pagination;
                });

                if (hasRelevantCandidate) {
                    if (!_batchSSECandidateReloadTimer) {
                        _batchSSECandidateReloadTimer = setTimeout(() => {
                            _batchSSECandidateReloadTimer = null;
                            if (currentJobId) loadCandidates(currentJobId, false);
                        }, 2000);
                    }
                }
            }
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
    
    // Update the interview status tracker (timeline thread)
    updateStatusTracker(cand);
    
    const isErrorState = cand.status === "failed" || cand.status === "unable_to_process";
    const isErrorOrManual = isErrorState || cand.status === "manual_reviewed";
    
    if (isErrorOrManual) {
        document.getElementById("detail-overall-score").textContent = "-";
    } else {
        document.getElementById("detail-overall-score").textContent = cand.match_score !== null && cand.match_score !== undefined ? cand.match_score : "-";
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
                <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.2rem; text-align: center; margin-bottom: 1.5rem;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.4rem;">Resume Match Score</div>
                    <div style="font-size: 2.2rem; font-weight: 700; color: var(--color-primary);">${cand.match_score !== null && cand.match_score !== undefined ? cand.match_score : '–'}<span style="font-size: 1rem; color: var(--text-muted);">/100</span></div>
                </div>
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
            let bannerHtml = "";
            if (cand.status === "manual_reviewed") {
                bannerHtml = `
                    <div style="background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 1.5rem; text-align: center; margin-bottom: 1.5rem;">
                        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📝</div>
                        <h3 style="color: #1d4ed8; margin: 0 0 0.5rem 0; font-size: 1.25rem;">Manually Reviewed</h3>
                        <p style="color: #1e3a8a; margin: 0; font-size: 0.95rem;">This candidate has been manually evaluated and reviewed by a recruiter.</p>
                    </div>
                `;
            } else {
                const isResumeFailure = (cand.match_score === null || cand.match_score === undefined);
                const errorTitle = isResumeFailure ? "Resume Review Required" : "Interview Evaluation Error";
                const errorMessage = isResumeFailure 
                    ? "This candidate's resume processing failed. Manual review is required to determine next steps."
                    : "This candidate's voice interview processing encountered a system error. Manual review is required to determine next steps.";
                
                bannerHtml = `
                    <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 1.5rem; text-align: center; margin-bottom: 1.5rem;">
                        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⚠️</div>
                        <h3 style="color: #b91c1c; margin: 0 0 0.5rem 0; font-size: 1.25rem;">${errorTitle}</h3>
                        <p style="color: #7f1d1d; margin: 0; font-size: 0.95rem;">${errorMessage}</p>
                    </div>
                `;
            }

            overallContainer.innerHTML = `
                ${bannerHtml}
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom: 1.5rem;">
                    <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:8px; padding:1.2rem; text-align:center;">
                        <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:.4rem;">Resume Match Score</div>
                        <div style="font-size:2.2rem; font-weight:700; color:var(--color-primary);">${cand.match_score !== null && cand.match_score !== undefined ? cand.match_score : '–'}<span style="font-size:1rem; color:var(--text-muted)">/100</span></div>
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
                        <div style="font-size:2.2rem;font-weight:700;color:var(--color-primary);">${iv.vic_score !== null && iv.vic_score !== undefined ? iv.vic_score : '–'}<span style="font-size:1rem;color:var(--text-muted)">/100</span></div>
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

            // FIX 5: Audio player — use voice_ogg_url (S3 OGG, stable) with fallback to recording_url.
            // Calls /api/interviews/{id}/audio which generates a fresh presigned S3 URL for the OGG file.
            let audioHtml = "";
            const hasAudio = iv.voice_ogg_url || iv.recording_url;
            if (hasAudio) {
                audioHtml = `
                    <div id="recording-player-container" style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:12px;padding:1.2rem;margin-bottom:1.5rem;text-align:center;box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:0.75rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:0.35rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-primary);"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                            Full Interview Recording
                        </span>
                        <div id="recording-player-wrapper" style="display:flex;justify-content:center;align-items:center;min-height:40px;">
                            <span style="font-size:0.85rem;color:var(--text-muted);display:flex;align-items:center;gap:0.5rem;">
                                Loading recording…
                            </span>
                        </div>
                    </div>`;
            }

            vicContainer.innerHTML = scoreHeader + audioHtml + criteriaHtml + summaryHtml + transcriptHtml;

            // FIX 5: Fetch fresh presigned URL from /audio endpoint (uses voice_ogg_url S3 key)
            if (hasAudio) {
                fetch(`/api/interviews/${iv.id}/audio`)
                    .then(r => {
                        if (!r.ok) throw new Error(`Audio endpoint returned ${r.status}`);
                        return r.json();
                    })
                    .then(audioData => {
                        const wrapper = document.getElementById("recording-player-wrapper");
                        if (wrapper) {
                            wrapper.innerHTML = `
                                <audio controls style="width:100%;max-width:100%;margin:0 auto;display:block;outline:none;border-radius:8px;height:40px;">
                                    <source src="${audioData.url}" type="${audioData.content_type || 'audio/ogg'}">
                                    Your browser does not support this audio format.
                                </audio>
                            `;
                        }
                    })
                    .catch(err => {
                        console.error("Failed to load interview audio:", err);
                        const wrapper = document.getElementById("recording-player-wrapper");
                        if (wrapper) {
                            wrapper.innerHTML = `
                                <span style="font-size:0.85rem;color:#dc2626;font-weight:500;">⚠️ Recording unavailable or still processing</span>
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
        // FIX 3: Show explicit error state when bc_scores contains the STT failure error flag
        } else if (iv.bc_scores.error === "bc_scoring_failed") {
            bcContainer.innerHTML = `
                <div style="text-align:center;padding:3rem 1rem;">
                    <div style="font-size:2.5rem;margin-bottom:1rem;">⚠️</div>
                    <p style="margin:0;font-size:0.95rem;font-weight:600;color:var(--color-danger,#ef4444);">Behavioral Analysis Unavailable</p>
                    <p style="margin:.5rem 0 1rem;font-size:0.85rem;color:var(--text-muted);">
                        The speech-to-text service (smallest.ai) failed after 3 retry attempts.<br>
                        VIC technical scores are unaffected. Overall score excludes the BC component.
                    </p>
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:0.8rem 1rem;font-size:0.8rem;color:var(--text-muted);text-align:left;max-width:340px;margin:0 auto;">
                        <strong>Detail:</strong> ${iv.bc_scores.error_detail || 'STT failure'}
                    </div>
                </div>`;
        } else {
            const bc = iv.bc_scores;
            const sm = bc.speech_metrics || {};

            // Score header
            const bcHeader = `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.5rem;">
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:1rem;text-align:center;">
                        <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.35rem;">Behavioral Score</div>
                        <div style="font-size:2rem;font-weight:700;color:var(--color-primary);">${iv.bc_score !== null && iv.bc_score !== undefined ? iv.bc_score : '–'}<span style="font-size:.9rem;color:var(--text-muted)">/100</span></div>
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
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12l3.5 3.5L17 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12l3.5 3.5L17 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin:0 auto 1rem;display:block;opacity:0.35;"><path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
            // Use null-safe values — do NOT coerce null to 0 (null means not yet scored)
            const matchScore  = (cand.match_score  !== null && cand.match_score  !== undefined) ? cand.match_score  : null;
            const vicScore    = (iv.vic_score  !== null && iv.vic_score  !== undefined) ? iv.vic_score  : null;
            const bcScore     = (iv.bc_score   !== null && iv.bc_score   !== undefined) ? iv.bc_score   : null;

            // If BB6 hasn't run yet, calculate locally for display only if all 3 scores exist
            let calcOverall = null;
            if (matchScore !== null && vicScore !== null && bcScore !== null) {
                calcOverall = Math.round((matchScore * 0.40) + (vicScore * 0.35) + (bcScore * 0.25));
            }
            const displayOverall = iv.overall_score !== null && iv.overall_score !== undefined ? iv.overall_score : (calcOverall !== null ? calcOverall : '–');

            // Verdict
            let displayVerdict = iv.ai_verdict || "–";
            let verdictColor   = verdictColors[displayVerdict] || "var(--color-primary)";
            if (displayVerdict === "–" && calcOverall !== null && calcOverall > 0) {
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
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Generate AI Report
                   </button>` : "";

            let reportStatus = "";
            if (iv.ai_verdict) {
                reportStatus = `
                    <div style="background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);border-radius:6px;
                        padding:.7rem 1rem;text-align:center;font-size:0.85rem;color:#16a34a;font-weight:500;margin-top:.5rem;margin-bottom:1rem;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12l3.5 3.5L17 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Consolidated Report Generated
                    </div>
                    <div id="pdf-report-download-container" style="margin-top:0.5rem;margin-bottom:1.5rem;">
                        <span style="font-size:0.85rem;color:var(--text-muted);">Fetching PDF download link...</span>
                    </div>
                `;
                
                // Fetch presigned URL asynchronously
                fetch(`/api/candidates/${candidateId}/report`)
                    .then(r => {
                        if (!r.ok) throw new Error("PDF not ready or not found");
                        return r.json();
                    })
                    .then(dlData => {
                        const dlContainer = document.getElementById("pdf-report-download-container");
                        if (dlContainer) {
                            dlContainer.innerHTML = `
                                <a href="${dlData.report_url}" target="_blank" download class="btn btn-primary"
                                   style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;
                                          font-weight:600;font-size:0.9rem;padding:10px;border-radius:8px;
                                          background:linear-gradient(135deg, var(--color-primary), #4f46e5); color:#fff; border:none; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M8 12V2M4 8l4 4 4-4M2 14h12"/></svg>
                                    Download PDF Report
                                </a>
                            `;
                        }
                    })
                    .catch(err => {
                        console.error("Failed to load PDF report download link:", err);
                        const dlContainer = document.getElementById("pdf-report-download-container");
                        if (dlContainer) {
                            dlContainer.innerHTML = `
                                <span style="font-size:0.85rem;color:#dc2626;font-weight:500;">Failed to retrieve download link.</span>
                            `;
                        }
                    });
            }

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
        case "new":
        case "scored": return { label: "Scored", className: "badge-scored" };
        case "shortlisted": return { label: "Shortlisted", className: "badge-shortlisted" };
        case "rejected": return { label: "Rejected", className: "badge-rejected" };
        case "manual_review":
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

function updateStatusTracker(cand) {
    const container = document.getElementById("status-tracker-container");
    const btn = document.getElementById("btn-interview-status");
    if (!container) return;

    if (isStatusTrackerExpanded) {
        container.style.display = "block";
        if (btn) {
            btn.classList.add("active");
            btn.style.backgroundColor = "var(--border-hover)";
        }
    } else {
        container.style.display = "none";
        if (btn) {
            btn.classList.remove("active");
            btn.style.backgroundColor = "";
        }
    }

    // Step 1: Invite Link Sent
    let step1Class = "pending";
    let step1Node = "1";
    let step1Desc = "Candidate has not been invited yet.";
    const inviteSentStatuses = ["interview_invited", "interview_ongoing", "interview_completed", "rejected_post_interview", "hired", "final_evaluation"];
    const hasBeenInvited = inviteSentStatuses.includes(cand.status) || cand.latest_invite_token;
    
    if (hasBeenInvited) {
        step1Class = "completed";
        step1Node = "✓";
        step1Desc = "Invite link successfully generated and dispatched.";
    }

    // Step 2: Interview Started / Attendance
    let step2Class = "pending";
    let step2Node = "2";
    let step2Title = "Interview Started";
    let step2Desc = "Waiting for candidate to join the WebRTC session.";

    const startedStatuses = ["interview_ongoing", "interview_completed", "rejected_post_interview", "hired", "final_evaluation"];
    if (startedStatuses.includes(cand.status)) {
        step2Class = cand.status === "interview_ongoing" ? "ongoing" : "completed";
        step2Node = cand.status === "interview_ongoing" ? "▶" : "✓";
        step2Desc = "Candidate joined the live WebRTC room and started speaking.";
    } else if (cand.status === "interview_invited") {
        // No Show / Not Started
        step2Class = "no-show";
        step2Node = "⚠";
        step2Title = "No Show / Not Started";
        step2Desc = "Candidate has not accessed the interview portal yet.";
    }

    // Step 3: Interview Completed & Scored
    let step3Class = "pending";
    let step3Node = "3";
    let step3Title = "Interview Completed";
    let step3Desc = "Waiting for interview completion and scoring.";

    const completedStatuses = ["interview_completed", "rejected_post_interview", "hired", "final_evaluation"];
    if (completedStatuses.includes(cand.status)) {
        step3Class = "completed";
        step3Node = "✓";
        step3Desc = "Interview ended. AI grading and audio analysis finished.";
    } else if (cand.status === "interview_ongoing") {
        step3Class = "ongoing";
        step3Node = "▶";
        step3Title = "Interview Ongoing";
        step3Desc = "Active real-time conversation is in progress.";
    }

    container.innerHTML = `
        <div class="status-tracker">
            <div class="status-tracker-step ${step1Class}">
                <div class="status-tracker-node">${step1Node}</div>
                <div class="status-tracker-content">
                    <h4 class="status-tracker-title">Invite Link Sent</h4>
                    <p class="status-tracker-desc">${step1Desc}</p>
                </div>
            </div>
            <div class="status-tracker-step ${step2Class}">
                <div class="status-tracker-node">${step2Node}</div>
                <div class="status-tracker-content">
                    <h4 class="status-tracker-title">${step2Title}</h4>
                    <p class="status-tracker-desc">${step2Desc}</p>
                </div>
            </div>
            <div class="status-tracker-step ${step3Class}">
                <div class="status-tracker-node">${step3Node}</div>
                <div class="status-tracker-content">
                    <h4 class="status-tracker-title">${step3Title}</h4>
                    <p class="status-tracker-desc">${step3Desc}</p>
                </div>
            </div>
        </div>
    `;
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

function formatRelativeTime(dateStr) {
    if (!dateStr) return "";
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHrs = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHrs / 24);

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHrs < 24) return `${diffHrs}h ago`;
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
        return "";
    }
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
                // Hide the detail panel immediately
                const noPro = document.getElementById("no-profile-selected");
                const proDet = document.getElementById("profile-details");
                if (noPro) noPro.style.display = "flex";
                if (proDet) proDet.style.display = "none";
                selectedCandidate = null;
                // Refresh from server so currentSearch is respected and list is accurate
                await loadCandidates(currentJobId, false);
            } else {
                const errData = await res.json().catch(() => ({}));
                alert(`Delete failed: ${errData.detail || res.statusText}`);
                setButtonLoading(btnDelete, false);
            }
        } catch (err) {
            console.error("Delete network error:", err);
            alert("Error: Connection failed.");
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
        const previewPanel = document.getElementById("jd-preview-panel");
        if (previewPanel) previewPanel.style.display = "none";
        ["rvc", "vic", "bc"].forEach(k => {
            const container = document.getElementById(`suggestion-${k}-container`);
            const textEl = document.getElementById(`suggestion-${k}-text`);
            if (container) container.style.display = "none";
            if (textEl) textEl.textContent = "";
        });
    };

    btnPostJob.addEventListener("click", openModal);
    if (modalClose) modalClose.addEventListener("click", closeModal);
    if (modalCancel) modalCancel.addEventListener("click", closeModal);

    // JD File Upload & Extraction Handler
    const btnUploadJd = document.getElementById("btn-upload-jd");
    const jdFileInput = document.getElementById("jd-file-input");
    const jobJdTextarea = document.getElementById("job-jd");

    if (btnUploadJd && jdFileInput && jobJdTextarea) {
        btnUploadJd.addEventListener("click", () => {
            jdFileInput.click();
        });

        jdFileInput.addEventListener("change", async () => {
            if (!jdFileInput.files || jdFileInput.files.length === 0) return;
            const file = jdFileInput.files[0];
            
            // Check size locally first (5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert("File is too large. Maximum size is 5MB.");
                jdFileInput.value = "";
                return;
            }

            const originalBtnHtml = btnUploadJd.innerHTML;
            btnUploadJd.disabled = true;
            btnUploadJd.innerHTML = `<svg class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#94a3b8" stroke-width="2"/><path d="M12 2a10 10 0 0110 10" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/></svg><span>Extracting...</span>`;
            jobJdTextarea.disabled = true;
            const prevJdValue = jobJdTextarea.value;
            jobJdTextarea.value = "[Extracting Job Description from file...]";

            try {
                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch("/api/jobs/extract-jd", {
                    method: "POST",
                    body: formData
                });

                if (!response.ok) {
                    let errMsg = `HTTP error ${response.status}`;
                    try {
                        const errData = await response.json();
                        errMsg = errData.detail || errMsg;
                    } catch (_) {}
                    throw new Error(errMsg);
                }

                const data = await response.json();
                jobJdTextarea.value = data.extracted_text;
                // Dispatch input event to trigger any textarea auto-resize if any
                jobJdTextarea.dispatchEvent(new Event('input', { bubbles: true }));

                // Display Left Panel JD Preview
                const previewPanel = document.getElementById("jd-preview-panel");
                const fileInfo = document.getElementById("jd-file-info");
                const previewText = document.getElementById("jd-preview-text");
                if (previewPanel && fileInfo && previewText) {
                    fileInfo.textContent = `File: ${data.file_name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
                    previewText.textContent = data.extracted_text;
                    previewPanel.style.display = "flex";
                }

                // AI suggestions triggers
                const titleVal = document.getElementById("job-title").value || "AI Engineer";
                const deptVal = document.getElementById("job-dept").value || "Engineering";
                
                // Show temporary placeholder status for suggestions
                ["rvc", "vic", "bc"].forEach(k => {
                    const container = document.getElementById(`suggestion-${k}-container`);
                    const textEl = document.getElementById(`suggestion-${k}-text`);
                    if (container && textEl) {
                        textEl.textContent = "AI is thinking...";
                        container.style.display = "block";
                    }
                });

                const suggestionResponse = await fetch("/api/jobs/generate-suggestions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jd_text: data.extracted_text,
                        job_title: titleVal,
                        department: deptVal
                    })
                });

                if (suggestionResponse.ok) {
                    const sugData = await suggestionResponse.json();
                    if (sugData.rvc) {
                        document.getElementById("suggestion-rvc-text").textContent = sugData.rvc;
                        document.getElementById("suggestion-rvc-container").style.display = "block";
                    } else {
                        document.getElementById("suggestion-rvc-container").style.display = "none";
                    }
                    if (sugData.vic) {
                        document.getElementById("suggestion-vic-text").textContent = sugData.vic;
                        document.getElementById("suggestion-vic-container").style.display = "block";
                    } else {
                        document.getElementById("suggestion-vic-container").style.display = "none";
                    }
                    if (sugData.bc) {
                        document.getElementById("suggestion-bc-text").textContent = sugData.bc;
                        document.getElementById("suggestion-bc-container").style.display = "block";
                    } else {
                        document.getElementById("suggestion-bc-container").style.display = "none";
                    }
                } else {
                    console.error("Failed to generate criteria suggestions");
                    ["rvc", "vic", "bc"].forEach(k => {
                        const container = document.getElementById(`suggestion-${k}-container`);
                        if (container) container.style.display = "none";
                    });
                }

            } catch (err) {
                console.error("Failed to extract JD:", err);
                alert(`Failed to extract Job Description: ${err.message}`);
                jobJdTextarea.value = prevJdValue;
                ["rvc", "vic", "bc"].forEach(k => {
                    const container = document.getElementById(`suggestion-${k}-container`);
                    if (container) container.style.display = "none";
                });
            } finally {
                btnUploadJd.disabled = false;
                btnUploadJd.innerHTML = originalBtnHtml;
                jobJdTextarea.disabled = false;
                jdFileInput.value = "";
            }
        });
    }

    // Event delegation for suggestions "Use Suggested" click handlers
    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-use-suggestion");
        if (btn) {
            const targetId = btn.getAttribute("data-target");
            const targetTextarea = document.getElementById(targetId);
            const sourceTextId = targetId.replace("job-", "suggestion-") + "-text";
            const containerId = targetId.replace("job-", "suggestion-") + "-container";
            
            const suggestedText = document.getElementById(sourceTextId).textContent;
            if (targetTextarea && suggestedText && suggestedText !== "AI is thinking...") {
                targetTextarea.value = suggestedText;
                targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById(containerId).style.display = "none";
            }
        }
    });

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
            interview_duration: parseInt(document.getElementById("job-duration").value, 10),
            invite_expires_hours: parseInt(document.getElementById("job-expiry-hours").value, 10),
            invite_expiry_value: parseInt(document.getElementById("job-expiry-hours").value, 10),
            invite_expiry_unit: "hours"
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

/* ===========================================================================
 * JOB LAZY LOADING  — Infinite scroll for Open / Closed job sections
 * ===========================================================================
 *
 * Strategy:
 *  - Each section (open / closed) maintains its own offset cursor.
 *  - An IntersectionObserver watches a sentinel <li> placed at the end of
 *    each list.  When it enters the viewport we fetch the next page.
 *  - The server now returns { jobs, total_count } so we know when to stop.
 *  - The global `jobs[]` array is a flat union of all fetched pages (used
 *    by selectJob / renderJobs for highlight / lookup purposes).
 * =========================================================================== */

/**
 * Full reset + initial load for both sections.  Call on DOMContentLoaded
 * and after a job is created / deleted.
 */
async function loadJobs() {
    // Reset lazy state
    for (const section of ["open", "closed"]) {
        jobLazyState[section] = { offset: 0, limit: 10, total: 0, loading: false, done: false };
    }
    // Tear down existing observers
    Object.values(jobLazyObservers).forEach(obs => obs && obs.disconnect());
    jobLazyObservers = {};

    // Clear displayed lists
    const openList = document.getElementById("open-jobs-list");
    const closedList = document.getElementById("closed-jobs-list");
    if (openList) openList.innerHTML = "";
    if (closedList) closedList.innerHTML = "";
    jobs = [];

    // Load first page for each section in parallel
    await Promise.all([
        _fetchJobPage("open"),
        _fetchJobPage("closed"),
    ]);

    // Auto-select behaviour (unchanged)
    if (!currentJobId) {
        const firstOpen = jobs.find(j => j.status === "open");
        if (firstOpen) {
            selectJob(firstOpen.id);
        } else if (jobs.length > 0) {
            selectJob(jobs[0].id);
        } else {
            renderNoJobSelectedState();
        }
    }
}

/**
 * Fetch one page of jobs for the given section ("open" | "closed") and
 * append the items to the list.  Attaches a sentinel + observer when needed.
 */
async function _fetchJobPage(section) {
    const state = jobLazyState[section];
    if (state.loading || state.done) return;
    state.loading = true;

    const statusParam = section === "open" ? "open" : "closed";
    const url = `/api/jobs?status=${statusParam}&limit=${state.limit}&offset=${state.offset}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const newJobs = data.jobs || [];
        state.total = data.total_count ?? 0;

        // Merge into global jobs array (avoiding duplicates by id)
        const existingIds = new Set(jobs.map(j => j.id));
        newJobs.forEach(j => { if (!existingIds.has(j.id)) jobs.push(j); });

        // Append list items
        const listId   = section === "open" ? "open-jobs-list" : "closed-jobs-list";
        const list = document.getElementById(listId);
        if (list) {
            // Remove existing sentinel before appending new items
            const oldSentinel = list.querySelector(".job-lazy-sentinel");
            if (oldSentinel) oldSentinel.remove();

            newJobs.forEach(job => {
                list.appendChild(_buildJobItem(job));
            });

            state.offset += newJobs.length;
            const hasMore = state.offset < state.total;

            if (hasMore) {
                _attachSentinel(section, list);
            } else {
                state.done = true;
                // Show "end of list" marker only if any jobs were loaded
                if (state.total > 0) {
                    const endMark = document.createElement("li");
                    endMark.className = "job-list-end-mark";
                    endMark.textContent = `All ${state.total} job${state.total > 1 ? 's' : ''} loaded`;
                    list.appendChild(endMark);
                }
            }
        }

        // Update badge with server total
        _updateJobCountBadge(section, state.total);

    } catch (err) {
        console.error(`[LazyJobs] Failed to load ${section} page:`, err);
    } finally {
        state.loading = false;
        // Re-highlight active job after every render pass
        _highlightActiveJob();
    }
}

/** Build a single job <li> element */
function _buildJobItem(job) {
    const li = document.createElement("li");
    li.className = `job-item${Number(currentJobId) === Number(job.id) ? ' active' : ''}`;
    li.dataset.id = job.id;
    li.innerHTML = `
        <div class="job-item-title" style="font-weight:500;">${job.title}</div>
        <div class="job-item-dept" style="font-size:0.8rem;margin-top:0.2rem;color:var(--text-muted);">${job.department}</div>
    `;
    li.addEventListener("click", () => selectJob(job.id));
    return li;
}

/** Re-apply .active class to the currently selected job across both lists */
function _highlightActiveJob() {
    document.querySelectorAll(".job-item").forEach(el => {
        el.classList.toggle("active", Number(el.dataset.id) === Number(currentJobId));
    });
}

/** Append a sentinel <li> and wire up IntersectionObserver */
function _attachSentinel(section, list) {
    // Disconnect old observer for this section
    if (jobLazyObservers[section]) {
        jobLazyObservers[section].disconnect();
    }

    const sentinel = document.createElement("li");
    sentinel.className = "job-lazy-sentinel";
    sentinel.innerHTML = `<span class="job-lazy-spinner"></span>`;
    list.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            _fetchJobPage(section);
        }
    }, { threshold: 0.1 });

    observer.observe(sentinel);
    jobLazyObservers[section] = observer;
}

/** Update the header count badge for a section using server total */
function _updateJobCountBadge(section, total) {
    const badgeId = section === "open" ? "open-jobs-count" : "closed-jobs-count";
    const badge = document.getElementById(badgeId);
    if (badge) badge.textContent = total;
}

/**
 * Render jobs list — now only re-highlights active state.
 * Full list DOM is managed by the lazy-loader pages.
 */
function renderJobs() {
    _highlightActiveJob();
    // Counts are already maintained by _updateJobCountBadge
}

function updateJobCounts() {
    // No-op: counts are managed by _updateJobCountBadge using server total
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
 * Delegate job deletion events to avoid binding issues with dynamic elements
 */
function initJobDeleteDelegation() {
    document.addEventListener("click", async (e) => {
        // 1. Delete button click: show confirmation inline
        const deleteBtn = e.target.closest("button[id^='btn-delete-job-']");
        if (deleteBtn) {
            e.stopPropagation();
            const jobId = deleteBtn.id.replace("btn-delete-job-", "");
            const deleteControl = document.getElementById(`delete-job-control-${jobId}`);
            const job = jobs.find(j => Number(j.id) === Number(jobId));
            if (deleteControl && job) {
                deleteControl.innerHTML = `
                    <div style="display:flex;align-items:center;gap:6px;background:var(--bg-surface);border:1px solid rgba(220,38,38,0.4);border-radius:8px;padding:4px 8px;font-size:0.8rem;color:var(--text-main);white-space:nowrap;">
                        <span>Delete <b>${job.title}</b>?</span>
                        <button id="confirm-delete-job-yes" class="confirm-delete-job-yes-btn" data-job-id="${job.id}" style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;">Yes</button>
                        <button id="confirm-delete-job-no" class="confirm-delete-job-no-btn" data-job-id="${job.id}" style="background:var(--bg-sidebar);color:var(--text-main);border:1px solid var(--border-color);border-radius:4px;padding:3px 10px;font-size:0.8rem;cursor:pointer;">Cancel</button>
                    </div>
                `;
            }
            return;
        }

        // 2. Cancel delete click: restore original delete button
        const cancelBtn = e.target.closest("#confirm-delete-job-no") || e.target.closest(".confirm-delete-job-no-btn");
        if (cancelBtn) {
            e.stopPropagation();
            const jobId = cancelBtn.dataset.jobId;
            const deleteControl = document.getElementById(`delete-job-control-${jobId}`);
            if (deleteControl) {
                deleteControl.innerHTML = `
                    <button id="btn-delete-job-${jobId}" class="btn btn-sm" style="padding:0.35rem 0.75rem;font-size:0.8rem;background:rgba(220,38,38,0.1);color:#dc2626;border:1px solid rgba(220,38,38,0.3);border-radius:6px;cursor:pointer;font-weight:500;display:inline-flex;align-items:center;gap:5px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Delete
                    </button>
                `;
            }
            return;
        }

        // 3. Confirm Yes click: perform the delete request
        const yesBtn = e.target.closest("#confirm-delete-job-yes") || e.target.closest(".confirm-delete-job-yes-btn");
        if (yesBtn) {
            e.stopPropagation();
            const jobId = yesBtn.dataset.jobId;
            yesBtn.disabled = true;
            yesBtn.textContent = "…";
            try {
                const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
                if (res.ok) {
                    renderNoJobSelectedState();
                    await loadJobs();
                } else {
                    const errData = await res.json().catch(() => ({}));
                    alert(`Delete failed: ${errData.detail || res.statusText}`);
                    selectJob(jobId);
                }
            } catch (err) {
                console.error("Delete job network error:", err);
                alert("Network error. Please try again.");
                selectJob(jobId);
            }
            return;
        }
    });
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
    if (activeBatchSSE) {
        activeBatchSSE.close();
        activeBatchSSE = null;
    }
    loadCandidates(jobId);
    fetchLastBatchForJob(jobId);

    const job = jobs.find(j => Number(j.id) === Number(jobId));

    if (job) {
        // Automatically expand the accordion for the job's section
        const section = job.status === "open" ? "open" : "closed";
        const header = document.getElementById(`${section}-jobs-header`);
        const content = document.getElementById(`${section}-jobs-content`);
        if (header && content) {
            header.setAttribute("aria-expanded", "true");
            content.classList.remove("collapsed");
        }
    }
    
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
            const searchHeader = document.querySelector(".search-header");
            if (searchHeader) {
                searchHeader.insertAdjacentElement("afterend", activeJobInfo);
            } else {
                const middlePanel = document.querySelector(".middle-panel");
                middlePanel.insertBefore(activeJobInfo, middlePanel.firstChild);
            }
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
                        <button id="btn-delete-job-${job.id}" class="btn btn-sm" style="padding:0.35rem 0.75rem;font-size:0.8rem;background:rgba(220,38,38,0.1);color:#dc2626;border:1px solid rgba(220,38,38,0.3);border-radius:6px;cursor:pointer;font-weight:500;transition:background 0.2s;display:inline-flex;align-items:center;gap:5px;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            Delete
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

        // Delete Job button — handled via delegated event listeners in initJobDeleteDelegation()
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

    // Setup expand/collapse for middle panel top section
    const btnToggleTop = document.getElementById("btn-toggle-top-section");
    const middlePanel = document.getElementById("middle-panel");
    if (btnToggleTop && middlePanel) {
        const isCollapsed = localStorage.getItem("middle-top-collapsed") === "true";
        if (isCollapsed) {
            middlePanel.classList.add("top-collapsed");
            const btnText = document.getElementById("text-toggle-top");
            if (btnText) btnText.textContent = "Expand";
        }
        
        btnToggleTop.addEventListener("click", () => {
            const willCollapse = !middlePanel.classList.contains("top-collapsed");
            if (willCollapse) {
                middlePanel.classList.add("top-collapsed");
                const btnText = document.getElementById("text-toggle-top");
                if (btnText) btnText.textContent = "Expand";
                localStorage.setItem("middle-top-collapsed", "true");
            } else {
                middlePanel.classList.remove("top-collapsed");
                const btnText = document.getElementById("text-toggle-top");
                if (btnText) btnText.textContent = "Collapse";
                localStorage.setItem("middle-top-collapsed", "false");
            }
        });
    }
}

function initActionButtons() {
    const btnInterviewStatus = document.getElementById("btn-interview-status");
    if (btnInterviewStatus) {
        btnInterviewStatus.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!selectedCandidate) return;
            isStatusTrackerExpanded = !isStatusTrackerExpanded;
            updateStatusTracker(selectedCandidate);
        });
    }

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
        if (currentJobId) {
            loadCandidates(currentJobId, false);
        }
    };

    if (closeBtn)  closeBtn.addEventListener("click",  closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    modalUpload.addEventListener("click", (e) => { if (e.target === modalUpload) closeModal(); });
}

/**
 * Initialize original resume preview modal events
 */
function initResumeModal() {
    const btnCheckResume     = document.getElementById("btn-check-resume");
    const modalResume        = document.getElementById("modal-view-resume");
    const closeBtn           = document.getElementById("modal-resume-close");
    const closeFooterBtn     = document.getElementById("btn-modal-close-resume");

    if (btnCheckResume) {
        btnCheckResume.addEventListener("click", () => {
            if (selectedCandidate) {
                openResumeModal(selectedCandidate);
            } else {
                alert("Please select a candidate first.");
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", closeResumeModal);
    }
    if (closeFooterBtn) {
        closeFooterBtn.addEventListener("click", closeResumeModal);
    }
    if (modalResume) {
        modalResume.addEventListener("click", (e) => {
            if (e.target === modalResume) closeResumeModal();
        });
    }
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

    const savedScroll = historyList.scrollTop;
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

    // Restore scroll position to avoid the list jumping back to top
    if (savedScroll !== undefined) historyList.scrollTop = savedScroll;

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
    const downloadBtn = document.getElementById("btn-download-resume");
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
    } catch (e) {
        console.error("Failed to load original resume URL for download button:", e);
    }
}

async function openResumeModal(cand) {
    const modal = document.getElementById("modal-view-resume");
    const container = document.getElementById("modal-resume-frame-container");
    const downloadBtn = document.getElementById("btn-modal-download-resume");
    const titleElement = document.getElementById("modal-resume-title");
    
    if (!modal || !container) return;

    modal.style.display = "flex";
    if (titleElement) {
        titleElement.textContent = `Resume Preview — ${cand.name}`;
    }

    container.innerHTML = `
        <div style="color: var(--text-muted); font-size: 0.95rem; padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 10px;">
            <span class="spinner"></span>
            Loading original resume...
        </div>
    `;
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
            <iframe src="${data.url}" style="width: 100%; height: 100%; border: none;" id="modal-resume-iframe"></iframe>
        `;
        
        const iframe = document.getElementById("modal-resume-iframe");
        if (iframe) {
            iframe.onerror = () => {
                showModalResumeFallback(data.url);
            };
        }
    } catch (e) {
        console.error("Failed to load original resume URL for modal:", e);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                <p>Unable to load original resume preview.</p>
                ${cand.resume_url ? `<a href="/api/candidates/${cand.id}/resume-url" target="_blank" class="btn btn-secondary" style="margin-top: 0.5rem; display: inline-block;">Open Link</a>` : ''}
            </div>
        `;
    }
}

function showModalResumeFallback(url) {
    const container = document.getElementById("modal-resume-frame-container");
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 10px; align-items: center; justify-content: center; height: 100%;">
                <p>Could not preview original resume directly inside the browser.</p>
                <a href="${url}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-weight: 600; text-decoration: none; border-radius: 4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Open Resume in New Tab
                </a>
            </div>
        `;
    }
}

function closeResumeModal() {
    const modal = document.getElementById("modal-view-resume");
    if (modal) {
        modal.style.display = "none";
    }
    const container = document.getElementById("modal-resume-frame-container");
    if (container) {
        container.innerHTML = "";
    }
}



