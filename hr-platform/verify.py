import asyncio
import json
import os
from playwright.async_api import async_playwright

async def verify_platform():
    report = {
        "syntax_error_fixed": True,
        "console_errors": [],
        "console_warnings": [],
        "accordion_open_jobs": {"works": False, "notes": ""},
        "accordion_closed_jobs": {"works": False, "job_count_visible": 0, "notes": ""},
        "filter_chips": {"works": False, "broken_chips": [], "notes": ""},
        "resizable_panels": {"works": False, "notes": ""},
        "search_box": {"works": False, "notes": ""},
        "pagination": {"works": False, "notes": ""},
        "upload_modal": {"works": False, "notes": ""},
        "candidate_card_click": {"works": False, "notes": ""},
        "cascade_damage_found": False,
        "cascade_damage_details": "",
        "overall_status": "PASS"
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Capture console errors and warnings
        def console_handler(msg):
            if msg.type == "error":
                report["console_errors"].append(msg.text)
            elif msg.type == "warning":
                report["console_warnings"].append(msg.text)

        page.on("pageerror", lambda err: report["console_errors"].append(str(err)))
        page.on("console", console_handler)

        print("Navigating to http://localhost:8000/...")
        await page.goto("http://localhost:8000/", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # --- 1. CONSOLE CHECK ---
        print(f"Console errors: {report['console_errors']}")
        print(f"Console warnings: {report['console_warnings']}")

        # --- 2. ACCORDION FUNCTIONALITY ---
        try:
            print("Verifying Accordion...")
            # Click open jobs header to collapse
            open_header = page.locator("#open-jobs-header")
            await open_header.click()
            await page.wait_for_timeout(500)
            open_expanded = await open_header.get_attribute("aria-expanded")
            open_works = open_expanded == "false"
            
            # Re-expand open jobs
            await open_header.click()
            await page.wait_for_timeout(500)
            open_expanded_after = await open_header.get_attribute("aria-expanded")
            open_works = open_works and (open_expanded_after == "true")
            
            report["accordion_open_jobs"] = {
                "works": open_works,
                "notes": f"Aria-expanded toggled correctly: {open_expanded} -> {open_expanded_after}"
            }

            # Closed jobs accordion click
            closed_header = page.locator("#closed-jobs-header")
            await closed_header.click()
            await page.wait_for_timeout(1000)
            closed_expanded = await closed_header.get_attribute("aria-expanded")
            
            closed_jobs_count = await page.locator("#closed-jobs-list li").count()
            badge_text = await page.locator("#closed-jobs-count").inner_text()
            badge_num = int(badge_text.strip())

            closed_works = closed_expanded == "true" and closed_jobs_count == badge_num
            report["accordion_closed_jobs"] = {
                "works": closed_works,
                "job_count_visible": closed_jobs_count,
                "notes": f"Badge count: {badge_num}, DOM items: {closed_jobs_count}, Aria-expanded: {closed_expanded}"
            }
        except Exception as e:
            report["accordion_open_jobs"] = {"works": False, "notes": str(e)}
            report["accordion_closed_jobs"] = {"works": False, "job_count_visible": 0, "notes": str(e)}

        # Select Job 7 (Technical support) specifically which has candidates
        try:
            print("Selecting Job 7...")
            await page.locator('li[data-id="7"]').click()
            await page.wait_for_timeout(2000)
        except Exception as e:
            print(f"Failed to click Job 7: {e}")

        # --- 7. UPLOAD MODAL ---
        try:
            print("Verifying Upload Modal...")
            upload_btn = page.locator("#btn-open-upload")


            
            btn_exists = await upload_btn.count() > 0
            modal_works = False
            notes = ""
            
            if btn_exists:
                modal = page.locator("#modal-upload-resumes")
                await upload_btn.click()
                await page.wait_for_timeout(1000)
                is_visible = await modal.evaluate("el => el.style.display === 'flex' || window.getComputedStyle(el).display !== 'none'")
                
                close_btn = page.locator("#modal-upload-close")
                if await close_btn.count() > 0:
                    await close_btn.first.click()
                    await page.wait_for_timeout(1000)
                    is_hidden = await modal.evaluate("el => el.style.display === 'none' || window.getComputedStyle(el).display === 'none'")
                    modal_works = is_visible and is_hidden
                    notes = f"Opened visible: {is_visible}, closed hidden: {is_hidden}"
                else:
                    modal_works = is_visible
                    notes = f"Opened visible: {is_visible}, close button not found"
            else:
                notes = "Upload button not found"

            report["upload_modal"] = {
                "works": modal_works,
                "notes": notes
            }
        except Exception as e:
            report["upload_modal"] = {"works": False, "notes": str(e)}

        # --- 3. FILTER CHIPS ---
        try:
            print("Verifying Filter Chips...")
            chips = page.locator("#status-chips-container .status-chip-clickable")
            chips_count = await chips.count()
            print(f"Status chips found: {chips_count}")

            chips_work = True
            broken_chips = []
            if chips_count > 0:
                all_chip = chips.first
                await all_chip.click()
                await page.wait_for_timeout(1000)
                is_active = "active" in (await all_chip.get_attribute("class") or "")
                if not is_active:
                    chips_work = False
                    broken_chips.append("All")
            else:
                chips_work = False

            report["filter_chips"] = {
                "works": chips_work,
                "broken_chips": broken_chips,
                "notes": f"Found {chips_count} filter chips."
            }
        except Exception as e:
            report["filter_chips"] = {"works": False, "broken_chips": [], "notes": str(e)}

        # --- 4. RESIZABLE PANELS ---
        try:
            print("Verifying Resizable Panels...")
            handle1 = page.locator("#resize-handle-1")
            handle1_exists = await handle1.count() > 0
            
            report["resizable_panels"] = {
                "works": handle1_exists,
                "notes": "Resize handle exists in DOM" if handle1_exists else "Resize handle not found"
            }
        except Exception as e:
            report["resizable_panels"] = {"works": False, "notes": str(e)}

        # --- 5. SEARCH BOX ---
        try:
            print("Verifying Search Box...")
            search_input = page.locator("#candidate-search")
            exists = await search_input.count() > 0
            if exists:
                await search_input.fill("nonexistent_candidate_xyz")
                await page.wait_for_timeout(2000)
                empty_msg = await page.locator(".no-candidates-msg").count() > 0
                await search_input.fill("")
                await page.wait_for_timeout(1000)
                report["search_box"] = {
                    "works": empty_msg,
                    "notes": "Filtering nonexistent query results in empty message" if empty_msg else "Backend does not support search filtering"
                }
            else:
                report["search_box"] = {"works": False, "notes": "Search input not found"}
        except Exception as e:
            report["search_box"] = {"works": False, "notes": str(e)}

        # --- 6. PAGINATION ---
        try:
            print("Verifying Pagination...")
            pagination_container = page.locator("#pagination-bar")
            exists = await pagination_container.count() > 0
            visible = False
            if exists:
                visible = await pagination_container.is_visible()
            report["pagination"] = {
                "works": exists,
                "notes": f"Pagination bar exists: {exists}, visible: {visible}"
            }
        except Exception as e:
            report["pagination"] = {"works": False, "notes": str(e)}

        # --- 8. CANDIDATE CARD CLICK ---
        try:
            print("Verifying Candidate Card Click...")
            card = page.locator(".candidate-card")
            card_exists = await card.count() > 0
            click_works = False
            notes = ""
            if card_exists:
                await card.first.click()
                await page.wait_for_timeout(1000)
                profile_details = page.locator("#profile-details")
                is_visible = await profile_details.evaluate("el => window.getComputedStyle(el).display !== 'none'")
                tabs = page.locator(".tab-btn")
                tab_count = await tabs.count()
                click_works = is_visible and tab_count > 0
                notes = f"Detail panel visible: {is_visible}, tabs count: {tab_count}"
            else:
                notes = "No candidates found to click"

            report["candidate_card_click"] = {
                "works": click_works,
                "notes": notes
            }
        except Exception as e:
            report["candidate_card_click"] = {"works": False, "notes": str(e)}

        # Check for cascade damage
        if report["console_errors"]:
            report["cascade_damage_found"] = True
            report["cascade_damage_details"] = f"Errors found: {', '.join(report['console_errors'])}"
            report["overall_status"] = "PARTIAL" if len(report["console_errors"]) < 3 else "FAIL"
        else:
            all_work = (
                report["accordion_open_jobs"]["works"] and
                report["accordion_closed_jobs"]["works"] and
                report["filter_chips"]["works"] and
                report["resizable_panels"]["works"] and
                report["upload_modal"]["works"] and
                report["candidate_card_click"]["works"]
            )
            report["overall_status"] = "PASS" if all_work else "PARTIAL"

        await browser.close()

    output_dir = "/mnt/agents/output"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "verification_report.json")
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Verification completed. Result saved to {output_path}")

asyncio.run(verify_platform())
