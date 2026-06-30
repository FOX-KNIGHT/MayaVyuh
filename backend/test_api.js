const http = require('http');

const data = JSON.stringify({
  teamName: 'Test Team',
  player1: 'Alice',
  player2: 'Bob',
  role: 'creator'
});

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/game/teams/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Body: ${body}`);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
  process.exit(1);
});

req.write(data);
req.end();
