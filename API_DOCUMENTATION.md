# 🚀 JobBoard REST API Documentation

This guide provides comprehensive documentation for connecting to and interacting with the **JobBoard REST API** from local applications, scripts, CLI tools, or external services on your network.

---

## 🛰️ 1. Service Connection Overview

| Setting | Details |
| :--- | :--- |
| **Base URL (Local)** | `http://localhost:3000` |
| **Base URL (Network)** | `http://<your-local-ip>:3000` (e.g., `http://192.168.50.x:3000`) |
| **Host Listener** | `0.0.0.0` (accepts all local network connections) |
| **CORS Policy** | **Enabled (`*`)**. Any origin or port can fetch without cross-origin blocking. |
| **Authentication** | None required for local network usage. |
| **Data Format** | JSON (`Content-Type: application/json`) |

---

## 📋 2. REST API Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check endpoint returning API version, status, and job count. |
| `GET` | `/api/jobs` | Retrieve all job entries (optional `?status=applied` filter). |
| `GET` | `/api/jobs/search?q=term` | Search jobs matching a query keyword in company, title, URL, or notes. |
| `GET` | `/api/jobs/:id` | Fetch a single job entry by unique ID. |
| `POST` | `/api/jobs` | Add a new job entry. |
| `PUT` | `/api/jobs/:id` | Full update of existing job entry. |
| `PATCH` | `/api/jobs/:id` | Partial update of specific fields (e.g., status or title). |
| `DELETE` | `/api/jobs/:id` | Delete a job entry and its cached files. |
| `POST` | `/api/jobs/:id/notes` | Add a timestamped note to a job entry. |
| `DELETE` | `/api/jobs/:id/notes/:noteId` | Remove a note from a job entry. |
| `POST` | `/api/jobs/:id/emails` | Attach an email log to a job entry. |
| `DELETE` | `/api/jobs/:id/emails/:emailId` | Remove an email log from a job entry. |

---

## 📩 3. Endpoint Specifications & Data Models

### `GET /api/health`
Returns system status and job database metrics.
```json
{
  "status": "ok",
  "service": "JobBoard API",
  "version": "1.1.6",
  "jobCount": 12,
  "timestamp": "2026-09-09T18:25:41.000Z",
  "uptime": 3600
}
```

---

### `GET /api/jobs`
Returns an array of all job application objects.
- **Query Parameter**: `status` *(optional)* — Filter by job stage (`applied`, `screening`, `interview`, `offer`, `rejected`). Example: `GET /api/jobs?status=interview`.

---

### `POST /api/jobs` — Create Job
Send a JSON payload to add a new job entry.

**Request Payload:**
```json
{
  "company": "Acme Technologies",
  "title": "Staff Software Engineer",
  "url": "https://example.com/careers/staff-engineer",
  "status": "applied",
  "dateApplied": "2026-09-09"
}
```

**Response (`201 Created`):**
```json
{
  "id": "e4a71b82-91f3-42d8-b391-76a0d4c9f110",
  "company": "Acme Technologies",
  "title": "Staff Software Engineer",
  "url": "https://example.com/careers/staff-engineer",
  "dateApplied": "2026-09-09",
  "status": "applied",
  "notes": [],
  "emails": [],
  "screenshots": [],
  "attachments": [],
  "cached": false,
  "createdAt": "2026-09-09T18:25:41.000Z",
  "updatedAt": "2026-09-09T18:25:41.000Z"
}
```

---

### `GET /api/jobs/:id` — Fetch Single Job
Returns details for a specific job entry. Returns `404 Not Found` if the job ID does not exist.

---

### `PATCH /api/jobs/:id` — Partial Update
Update specific fields of a job without overwriting unaffected fields (e.g. moving a job to `interview` or `offer`).

**Request Payload:**
```json
{
  "status": "interview"
}
```

---

### `PUT /api/jobs/:id` — Full Update
Replaces writable job fields with the provided object payload.

---

### `DELETE /api/jobs/:id` — Remove Job
Deletes a job record and cleans up all associated cached PDFs, screenshots, and attachments on disk.

**Response (`200 OK`):**
```json
{
  "success": true
}
```

---

## 💻 4. Client Code Examples

### JavaScript / Node.js (`fetch`)
```javascript
// Add a new job
async function addJob() {
  const res = await fetch('http://localhost:3000/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: 'OpenAI',
      title: 'Systems Engineer',
      url: 'https://openai.com/careers',
      status: 'applied'
    })
  });
  const data = await res.json();
  console.log('Created Job:', data);
}

// Update status via PATCH
async function updateStatus(jobId, newStatus) {
  const res = await fetch(`http://localhost:3000/api/jobs/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  return await res.json();
}
```

### Python (`requests`)
```python
import requests

BASE_URL = "http://localhost:3000/api"

# Get all jobs
jobs = requests.get(f"{BASE_URL}/jobs").json()
print(f"Total jobs: {len(jobs)}")

# Create a job
new_job = {
    "company": "Anthropic",
    "title": "Backend Developer",
    "url": "https://anthropic.com/jobs",
    "status": "applied"
}
response = requests.post(f"{BASE_URL}/jobs", json=new_job)
job_data = response.json()
print("Created:", job_data["id"])

# Update job status
job_id = job_data["id"]
requests.patch(f"{BASE_URL}/jobs/{job_id}", json={"status": "screening"})
```

### cURL (Terminal / Command Line)
```bash
# 1. Health Check
curl http://localhost:3000/api/health

# 2. View all jobs
curl http://localhost:3000/api/jobs

# 3. Add a new job entry
curl -X POST http://localhost:3000/api/jobs \
     -H "Content-Type: application/json" \
     -d '{
       "company": "Stripe",
       "title": "API Engineer",
       "url": "https://stripe.com/jobs/api-engineer",
       "status": "applied"
     }'

# 4. Update status to 'interview'
curl -X PATCH http://localhost:3000/api/jobs/<JOB_ID> \
     -H "Content-Type: application/json" \
     -d '{"status": "interview"}'

# 5. Delete a job entry
curl -X DELETE http://localhost:3000/api/jobs/<JOB_ID>
```
