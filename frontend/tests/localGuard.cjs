// Smoke-check harness only: block non-local proxy, DNS and HTTP destinations.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const attempts = { socket: 0, dns: 0, http: 0 };
const report = path.join(__dirname, '../screenshots/', process.env.DEMO_GUARD_REPORT || 'demoViteGuard.json');
function saveReport() { fs.writeFileSync(report, JSON.stringify(attempts) + '\n'); }
function localHost(host) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host); }
function reject(category) { attempts[category] += 1; saveReport(); throw new Error('Non-local connection prohibited.'); }
const originalConnect = net.Socket.prototype.connect;
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...argumentsList) {
  // Vite probes ephemeral ports on wildcard bind addresses. Constrain even those
  // temporary listeners to loopback; they are local binds, not outbound DNS.
  if (typeof argumentsList[0] === 'object' && argumentsList[0].host) {
    if (['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000'].includes(argumentsList[0].host)) argumentsList[0] = { ...argumentsList[0], host: '127.0.0.1' };
    if (!localHost(argumentsList[0].host)) reject('socket');
  } else if (typeof argumentsList[1] === 'string') {
    if (['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000'].includes(argumentsList[1])) argumentsList[1] = '127.0.0.1';
    if (!localHost(argumentsList[1])) reject('socket');
  }
  return originalListen.apply(this, argumentsList);
};
net.Socket.prototype.connect = function (...argumentsList) {
  const first = argumentsList[0];
  const options = Array.isArray(first) ? first[0] : first;
  if (typeof options === 'object' && options.path) return originalConnect.apply(this, argumentsList);
  if (typeof options === 'string' && options.startsWith('\\\\.\\pipe\\')) return originalConnect.apply(this, argumentsList);
  const host = typeof options === 'object' ? options.host || 'localhost' : typeof argumentsList[1] === 'string' ? argumentsList[1] : 'localhost';
  if (!localHost(host)) reject('socket');
  return originalConnect.apply(this, argumentsList);
};
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) {
  const original = dns[method];
  dns[method] = function (host, ...argumentsList) { if (!localHost(host)) reject('dns'); return original.call(this, host, ...argumentsList); };
}
for (const owner of [http, https]) {
  const original = owner.request;
  owner.request = function (address, ...argumentsList) {
    const host = typeof address === 'string' || address instanceof URL ? new URL(address).hostname : address.hostname || address.host || 'localhost';
    if (!localHost(host)) reject('http');
    return original.call(this, address, ...argumentsList);
  };
}
const originalFetch = global.fetch;
global.fetch = function (address, ...argumentsList) {
  if (!localHost(new URL(typeof address === 'string' ? address : address.url || address).hostname)) reject('http');
  return originalFetch(address, ...argumentsList);
};
saveReport();
process.on('exit', saveReport);
