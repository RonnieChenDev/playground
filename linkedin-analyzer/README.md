# LinkedIn Job Analyser

LinkedIn version of [seek-analyzer](../seek-analyzer): shows an AI fit badge next to each job on LinkedIn job search.

## How it differs from the SEEK version

- **Full job description.** LinkedIn cards only show title, company and location, so for each job the
  background worker fetches the public posting (`/jobs-guest/jobs/api/jobPosting/{id}`, without cookies)
  and sends the description and criteria (seniority, employment type) to Claude. If that fetch fails it
  falls back to the card text.
- **Cache.** Results are stored in `chrome.storage.local` per job ID for 7 days. Changing your profile
  invalidates them. Opening the same job again costs no API call.
- **Detail pane.** The job detail pane (`currentJobId`) and `/jobs/view/{id}` pages also get a badge,
  expanded by default.
- **Both layouts.** Works on the logged-in jobs UI (`data-occludable-job-id` / `data-job-id`) and on
  public search (`data-entity-urn`).

## Build & install

```bash
npm install
npm run build
```

Go to `chrome://extensions`, turn on Developer mode, click "Load unpacked" and select this folder.
Then fill in your API key and profile on the options page.
