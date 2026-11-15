// send one command to a recon daemon (multi-instance via env) and wait for result
// env: ALI_CMD / ALI_RES / ALI_STATUS / ALI_CTR / READY_TIMEOUT / CMD_TIMEOUT
// usage: node cmd.mjs '{"action":"goto","url":"https://www.alibaba.com/","name":"home"}'
import fs from 'node:fs';

const CMD = process.env.ALI_CMD || '/tmp/ali-cmd.json';
const RES = process.env.ALI_RES || '/tmp/ali-res.json';
const STATUS = process.env.ALI_STATUS || '/tmp/ali-daemon.json';
const CTR = process.env.ALI_CTR || CMD.replace(/\.json$/, '-id.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node cmd.mjs <json>');
  process.exit(2);
}
const cmd = JSON.parse(arg);

const readyDeadline = Date.now() + Number(process.env.READY_TIMEOUT || 90000);
for (;;) {
  try {
    const st = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
    if (st.state === 'failed') { console.error('DAEMON FAILED: ' + st.error); process.exit(4); }
    if (st.state === 'ready') break;
  } catch {}
  if (Date.now() > readyDeadline) { console.error('TIMEOUT waiting daemon ready'); process.exit(5); }
  await sleep(500);
}

let id = 1;
try { id = JSON.parse(fs.readFileSync(CTR, 'utf8')).id + 1; } catch {}
fs.writeFileSync(CTR, JSON.stringify({ id }));
cmd.id = id;
try { fs.unlinkSync(RES); } catch {}
fs.writeFileSync(CMD, JSON.stringify(cmd));

const deadline = Date.now() + Number(process.env.CMD_TIMEOUT || 240000);
while (Date.now() < deadline) {
  await sleep(300);
  try {
    const res = JSON.parse(fs.readFileSync(RES, 'utf8'));
    if (res.id === id) {
      console.log(JSON.stringify(res, null, 1));
      process.exit(res.ok ? 0 : 1);
    }
  } catch {}
}
console.error('TIMEOUT waiting for daemon result');
process.exit(3);
