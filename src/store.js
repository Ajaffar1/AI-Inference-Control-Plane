import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateEvent } from './index.js';

export class EventStore {
  constructor(path) { this.path = path; this.tail = Promise.resolve(); }
  async list() {
    await this.tail;
    try {
      const events = (await readFile(this.path, 'utf8')).split('\n').filter(Boolean).map(line => validateEvent(JSON.parse(line)));
      let outcomes = [];
      try { outcomes = (await readFile(this.path + '.outcomes', 'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const latest = new Map(outcomes.map(o => [o.executionId, o.accepted]));
      return events.map(e => latest.has(e.executionId) ? {...e, accepted:latest.get(e.executionId)} : e);
    }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  recordOutcome(executionId, accepted) {
    if (typeof executionId !== 'string' || ![true,false].includes(accepted)) throw new TypeError('Outcome requires executionId and boolean accepted');
    const write = this.tail.then(async () => {
      const events = (await readFile(this.path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
      if (!events.some(e => e.executionId === executionId)) throw new TypeError('Unknown execution');
      await appendFile(this.path + '.outcomes', JSON.stringify({executionId,accepted,timestamp:new Date().toISOString()}) + '\n', {mode:0o600});
    });
    this.tail = write.catch(() => {});
    return write;
  }
  append(event) {
    validateEvent(event);
    const write = this.tail.then(async () => {
      let existing = [];
      try { existing = (await readFile(this.path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const duplicate = existing.find(e => e.id === event.id);
      if (duplicate) {
        if (JSON.stringify(duplicate) !== JSON.stringify(event)) throw new Error('Conflicting event ID');
        return;
      }
      const attempts = existing.filter(e => e.executionId === event.executionId);
      if (attempts.some(e => ['project','task','provider','model'].some(k => e[k] !== event[k]))) throw new Error('Execution attribution/configuration cannot change');
      await mkdir(dirname(this.path), {recursive:true});
      await appendFile(this.path, JSON.stringify(event) + '\n', {mode:0o600});
    });
    this.tail = write.catch(() => {});
    return write;
  }
}
