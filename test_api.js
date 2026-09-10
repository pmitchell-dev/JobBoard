/**
 * JobBoard REST API Verification Script
 * Run against a running server: node test_api.js [port]
 */

const http = require('http');

const PORT = process.argv[2] || 3000;
const BASE_URL = `http://localhost:${PORT}`;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log(`\n🧪 Testing JobBoard REST API at ${BASE_URL}...\n`);
  let createdJobId = null;

  try {
    // 1. Health check
    console.log('1️⃣  GET /api/health');
    const health = await request('GET', '/api/health');
    console.log(`   Status: ${health.status} | Service: ${health.body.service} | Jobs: ${health.body.jobCount}`);
    if (health.status !== 200) throw new Error('Health check failed');

    // 2. GET all jobs
    console.log('\n2️⃣  GET /api/jobs');
    const list = await request('GET', '/api/jobs');
    console.log(`   Status: ${list.status} | Total jobs returned: ${Array.isArray(list.body) ? list.body.length : 'N/A'}`);
    if (list.status !== 200) throw new Error('GET /api/jobs failed');

    // 3. POST create job
    console.log('\n3️⃣  POST /api/jobs');
    const newJobPayload = {
      company: 'Acme Test Corp',
      title: 'Senior Automation Engineer',
      url: 'https://example.com/jobs/automation-engineer',
      status: 'screening',
      dateApplied: new Date().toISOString().split('T')[0]
    };
    const created = await request('POST', '/api/jobs', newJobPayload);
    console.log(`   Status: ${created.status} | Created ID: ${created.body.id} | Company: ${created.body.company}`);
    if (created.status !== 201 && created.status !== 200) throw new Error('POST /api/jobs failed');
    createdJobId = created.body.id;

    // 4. GET single job by ID
    console.log(`\n4️⃣  GET /api/jobs/${createdJobId}`);
    const getOne = await request('GET', `/api/jobs/${createdJobId}`);
    console.log(`   Status: ${getOne.status} | Title: ${getOne.body.title} | Status: ${getOne.body.status}`);
    if (getOne.status !== 200 || getOne.body.id !== createdJobId) throw new Error('GET /api/jobs/:id failed');

    // 5. PATCH partial update job status
    console.log(`\n5️⃣  PATCH /api/jobs/${createdJobId}`);
    const patchRes = await request('PATCH', `/api/jobs/${createdJobId}`, { status: 'interview' });
    console.log(`   Status: ${patchRes.status} | Updated Status: ${patchRes.body.status}`);
    if (patchRes.status !== 200 || patchRes.body.status !== 'interview') throw new Error('PATCH /api/jobs/:id failed');

    // 6. PUT full update job
    console.log(`\n6️⃣  PUT /api/jobs/${createdJobId}`);
    const putRes = await request('PUT', `/api/jobs/${createdJobId}`, {
      company: 'Acme Global Robotics',
      title: 'Principal Automation Architect',
      status: 'interview',
      url: 'https://example.com/jobs/principal-automation-architect'
    });
    console.log(`   Status: ${putRes.status} | New Company: ${putRes.body.company}`);
    if (putRes.status !== 200 || putRes.body.company !== 'Acme Global Robotics') throw new Error('PUT /api/jobs/:id failed');

    // 7. GET search jobs query
    console.log('\n7️⃣  GET /api/jobs/search?q=Robotics');
    const searchRes = await request('GET', '/api/jobs/search?q=Robotics');
    console.log(`   Status: ${searchRes.status} | Matches: ${searchRes.body.length}`);
    if (searchRes.status !== 200 || searchRes.body.length === 0) throw new Error('GET /api/jobs/search failed');

    // 8. DELETE created test job
    console.log(`\n8️⃣  DELETE /api/jobs/${createdJobId}`);
    const deleteRes = await request('DELETE', `/api/jobs/${createdJobId}`);
    console.log(`   Status: ${deleteRes.status} | Success: ${deleteRes.body.success}`);
    if (deleteRes.status !== 200 || !deleteRes.body.success) throw new Error('DELETE /api/jobs/:id failed');

    console.log('\n✅ ALL API TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error(`\n❌ TEST FAILED: ${err.message}\n`);
    process.exit(1);
  }
}

runTests();
