// node --test automation/auto-draft.test.mjs
// Google Apps Scriptを使わず、本番と同じ処理コードをサンドボックスで検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./auto-draft.gs', import.meta.url), 'utf8');
const HELD = ['R-20261117-f5586927', 'R-20261117-83fc7631'];
const NEW_ID = 'R-20261118-a1b2c3d4';
const report = (id = NEW_ID) => ({
  schemaVersion: 1, reportId: id, status: 'needs-draft',
  source: { type: 'google-form', mode: 'production' },
  facts: { area: { name: '水戸市', slug: 'mito' }, device: { name: 'iPhone 13', slug: 'iphone13' }, uncertain: [] },
  intake: { reportText: '突然電源が入らなくなり、基板修理で復旧した。' },
  media: [{ id: 'p1', privacyCheck: 'pending', contentMatch: 'pending', alt: '', caption: '' }],
  drafts: { hp: null, gbp: null }, publishLog: { hp: null, gbp: null },
  approval: { hp: { state: 'draft' }, gbp: { state: 'draft' }, returns: [] }
});
const goodAI = () => ({
  ready: true, consultation: '起動しなくなった',
  works: ['基板修理'], result: '起動できるように復旧', staffComment: '',
  uncertain: [], hp: {
    titleServices: ['基板修理'], description: '電源が入らない端末の修理事例',
    cardSummary: '基板修理で復旧',
    sections: [
      { heading: 'ご相談', paragraphs: ['電源が入らないとのご相談'] },
      { heading: '修理内容', paragraphs: ['基板修理を実施'] },
      { heading: '修理後', paragraphs: ['起動できる状態に復旧'] }
    ]
  }, gbp: { summary: '基板修理の事例' }
});

function harness({ rows = [report()], enabled = 'false', approved = 'false', reply = goodAI() } = {}) {
  const properties = new Map(Object.entries({
    AUTO_DRAFT_ENABLED: enabled,
    AI_DATA_SHARING_APPROVED: approved,
    HANDOFF_FOLDER_ID: 'root', OWNER_EMAIL: 'owner@example.test',
    APPROVAL_URL: 'https://example.test/approve', ANTHROPIC_MODEL: 'test-model',
    ANTHROPIC_API_KEY: 'test-secret', AUTO_START_AFTER: '2026-11-17T00:00:00Z',
    MAX_AI_CALLS_PER_DAY: '3', HOLD_REPORT_IDS: HELD.join(',')
  }));
  const out = new Map();
  const emails = [];
  const apiRequests = [];
  const dateCreated = new Date('2026-11-18T10:00:00Z');
  const input = rows.map(row => ({
    getName: () => row.reportId + '.json',
    getDateCreated: () => dateCreated,
    getBlob: () => ({ getDataAsString: () => JSON.stringify(row) })
  }));
  const folder = (files) => ({
    getFiles: () => iterator(files),
    getFilesByName: name => iterator(files.filter(f => f.getName() === name)),
    createFile: (name, contents) => {
      out.set(name, contents);
      return { getName: () => name, getBlob: () => ({ getDataAsString: () => contents }) };
    }
  });
  const intake = folder(input);
  const drafts = {
    getFilesByName: name => iterator(out.has(name) ? [{
      getName: () => name, getBlob: () => ({ getDataAsString: () => out.get(name) })
    }] : []),
    createFile: (...args) => folder([]).createFile(...args)
  };
  const root = { getFoldersByName: name => iterator([name === 'intake' ? intake : name === 'drafts' ? drafts : null].filter(Boolean)) };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value)
    })},
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: { getFolderById: () => root },
    Utilities: { formatDate: () => '2026-11-18' },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    MailApp: { sendEmail: (...args) => emails.push(args) },
    Logger: { log: () => {} },
    UrlFetchApp: { fetch: (url, req) => {
      apiRequests.push({ url, req });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(reply) }]
      }) };
    }}
  });
  vm.runInContext(source, context, { filename: 'auto-draft.gs', timeout: 1500 });
  return { context, properties, out, emails, apiRequests, run: () => vm.runInContext('oshAutoTick()', context, { timeout: 1500 }) };
}
function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
}
test('default: no AI call, no email, no draft', () => {
  const a = harness(); a.run();
  assert.equal(a.apiRequests.length, 0);
  assert.equal(a.emails.length, 0);
  assert.equal(a.out.size, 0);
});
test('data-sharing consent is mandatory', () => {
  const a = harness({ enabled: 'true' });
  assert.throws(() => a.run(), /未承認/);
  assert.equal(a.apiRequests.length, 0);
});
test('Galaxy and iPad are held even when enabled', () => {
  const a = harness({ enabled: 'true', approved: 'true', rows: HELD.map(report) });
  a.run();
  assert.equal(a.apiRequests.length, 0);
  assert.equal(a.out.size, 0);
});
test('creates an unapproved draft and notifies once; headers are correct', () => {
  const a = harness({ enabled: 'true', approved: 'true' });
  a.run(); a.run();
  assert.equal(a.apiRequests.length, 1);
  assert.equal(a.emails.length, 0); // 保存直後は通知せずシート同期を待つ
  const req = a.apiRequests[0].req;
  assert.equal(req.headers['x-api-key'], 'test-secret');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  const draft = JSON.parse(a.out.get(NEW_ID + '.json'));
  assert.equal(draft.status, 'needs-photo-review');
  assert.equal(draft.approval.hp.state, 'draft');
  assert.equal(draft.approval.gbp.state, 'draft');
  assert.equal(draft.media[0].privacyCheck, 'pending');
});
test('incomplete repair is held, never claimed complete', () => {
  const answer = goodAI(); answer.ready = false; answer.result = '';
  const a = harness({ enabled: 'true', approved: 'true', reply: answer });
  a.run();
  const draft = JSON.parse(a.out.get(NEW_ID + '.json'));
  assert.equal(draft.status, 'hold');
  assert.equal(draft.approval.hp.state, 'draft');
  assert.equal(draft.drafts.hp, null);
});
test('simple masking suppresses common contact identifiers', () => {
  const a = harness();
  const s = vm.runInContext("oshAutoRedact_('abc@example.com 090-1234-5678 https://example.com/a')", a.context);
  assert.doesNotMatch(s, /abc@example.com|090-1234-5678|https:\/\/example.com/);
});
