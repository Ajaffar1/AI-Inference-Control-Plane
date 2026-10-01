import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EventStore } from './store.js';
import { summarize, frontier, validateEvent } from './index.js';
import { demoEvents } from './demo.js';

export function createServer({store, demo = false, token}) {
  const fixtures = demoEvents();
  return http.createServer(async (req, res) => {
    const json = (status, value) => {res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!demo && (!token || req.headers.authorization !== `Bearer ${token}`)) return json(401,{error:'Bearer token required'});
        if (req.method === 'GET' && url.pathname === '/api/report') {
          let events = demo ? fixtures : await store.list();
          for (const key of ['project','task']) if (url.searchParams.get(key)) events = events.filter(e=>e[key]===url.searchParams.get(key));
          const rows = summarize(events);
          return json(200,{demo, events, rows, frontier:frontier(rows), projects:[...new Set((demo ? fixtures : await store.list()).map(e=>e.project))]});
        }
        if (req.method === 'POST' && ['/api/events','/api/outcomes'].includes(url.pathname)) {
          if (demo) return json(403,{error:'Demo mode is read-only'});
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body)>65536) return json(413,{error:'Event exceeds 64 KiB'});
          }
          if (url.pathname === '/api/outcomes') {const outcome=JSON.parse(body);await store.recordOutcome(outcome.executionId,outcome.accepted);return json(201,{recorded:true});}
          const event = validateEvent(JSON.parse(body));
          await store.append(event);
          return json(201,{id:event.id});
        }
        return json(404,{error:'Unknown endpoint'});
      }
      const files = {'/':'index.html','/app.js':'app.js','/style.css':'style.css','/simulation.js':'../src/simulation.js'};
      if (req.method !== 'GET' || !files[url.pathname]) return json(404,{error:'Not found'});
      const data = await readFile(new URL(`../web/${files[url.pathname]}`,import.meta.url));
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});
      res.end(data);
    } catch (error) {
      const badInput = error instanceof TypeError || error instanceof SyntaxError || error.message === 'Conflicting event ID' || error.message === 'Execution attribution/configuration cannot change';
      json(badInput ? 400 : 500,{error:badInput ? error.message : 'Storage or server failure'});
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo');
  const token = process.env.IEOP_TOKEN;
  if (!demo && (!token || token.length < 24)) throw new Error('Set IEOP_TOKEN to at least 24 characters, or use npm run demo');
  const port = Number(process.env.PORT ?? 3000);
  createServer({store:new EventStore(process.env.IEOP_DATA ?? './data/events.jsonl'),demo,token}).listen(port,'127.0.0.1',()=>console.log(`Inference Control Plane: http://127.0.0.1:${port} (${demo?'illustrative demo':'local data'})`));
}
