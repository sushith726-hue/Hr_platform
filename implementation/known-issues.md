# Known Issues

| # | Issue | Severity | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | Buttons look like "stool rectangles" | HIGH | FIXED | UI iteration completed successfully |
| 2 | Shortlist button not working | HIGH | FIXED | Dynamic footer button rendering and pipeline wired |
| 3 | Job tree not accordion dropdown | MEDIUM | FIXED | Job Tree accordion fully interactive |
| 4 | CSS background-clip compatibility warning | LOW | FIXED | Standardized property prefixes |
| 5 | Resume upload bulk processing visibility | HIGH | FIXED | Batch progress bar, logs panel, and toast notification added |
| 6 | Lack of pagination for high candidate volume | HIGH | FIXED | Hybrid pagination (cursor backend / page number translation, frontend pagination bar and Jump controls) implemented |
| 7 | Dashboard status inconsistencies for failed / unable_to_process states | HIGH | FIXED | Standardized statuses, fixed filter queries and candidate lists rendering |
| 8 | Lack of resume view for failed ingestion states | HIGH | FIXED | Integrated resume-viewer-container loading presigned resume URL for all candidate states in Panel 3 |
| 9 | Upload resume button allowed uploading without an active job context | HIGH | FIXED | Checked for job_id presence, showing validation alerts on frontend, enforcing server-side check |
| 10 | Manual review flow for parsed-failed candidates | HIGH | FIXED | Added manual review action button, transition candidate status to manual_reviewed, and updated overall summary report |
