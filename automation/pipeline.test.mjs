import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sources = ['auto-intake.gs', 'auto-draft.gs', 'sheet-sync.gs']
  .map(name => readFileSync(new URL('./' + name, import.meta.url), 'utf8'));
const HEADERS = ['タイムスタンプ', '担当スタッフ', 'お客様来店地域',
  'その他の地域名（その他を選んだ場合のみ）', '機種・サービス名', '今日の対応内容', '写真'];
const MGR_HEADERS = ['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
const IMPORT_HEADERS = ['報告キー','報告ID','回答の行','報告日時','取り込み日時','担当スタッフ（非公開）'];
const IMAGE = '1ABCDEFGHIJKLMNOpqrstuvwxyz0123';
const MESSAGE = 'iPhone 13の充電不良を修理。充電できるようになりました。';
const ANSWER = {
  ready:true, consultation:'充電ができない', works:['充電口修理'],
  result:'充電できるようになった',staffComment:'',uncertain:[],
  hp:{titleServices:['充電口修理'],description:'水戸市から充電不良のご相談',
    cardSummary:'iPhone 13充電口修理',sections:[
      {heading:'ご相談',paragraphs:['充電できないとのご相談']},
      {heading:'修理内容',paragraphs:['充電口修理を実施']},
      {heading:'修理後',paragraphs:['充電できるようになりました']}
    ]},
  gbp:{summary:'水戸市からiPhone 13の充電不良をご相談いただきました。'}
};
function iterator(a){let i=0;return {hasNext:()=>i<a.length,next:()=>a[i++]};}
function fakeFile(name,content,mime='text/plain',date=new Date('2026-11-18T04:00:00Z')){
  return {
    getName:()=>name,
    getDateCreated:()=>date,
    getMimeType:()=>mime,
    getSize:()=>String(content).length || 1,
    getBlob:()=>({getDataAsString:()=>content})
  };
}
function fakeFolder(name) {
  const files=new Map(),dirs=new Map();
  return {
    name,files,dirs,
    getFiles:()=>iterator([...files.values()]),
    getFilesByName:n=>iterator(files.has(n)?[files.get(n)]:[]),
    getFoldersByName:n=>iterator(dirs.has(n)?[dirs.get(n)]:[]),
    createFolder:n=>{const f=fakeFolder(n);dirs.set(n,f);return f;},
    createFile:(n,c)=>{const f=fakeFile(n,c);files.set(n,f);return f;},
    addFile:(n,c,mime)=>{const f=fakeFile(n,c,mime);files.set(n,f);return f;}
  };
}
function sheet(header, rows) {
  return {
    getLastRow:()=>rows.length+1,
    getRange:(row,col,count,width)=>({
      getValues:()=>row===1?[header.slice(col-1,col-1+width)]:
        rows.slice(row-2,row-2+count).map(r=>r.slice(col-1,col-1+width))
    }),
    appendRow:r=>rows.push(r)
  };
}
function setup({enabled=true,consent=true,hold='',start=2,alreadyImported=[]}={}) {
  const formRows=[['2026/11/18 12:30:00','staff','水戸市','','iPhone 13',MESSAGE,
    'https://drive.google.com/open?id='+IMAGE]];
  const importRows=alreadyImported.map(x=>x.slice());
  const draftRows=[];
  const properties=new Map(Object.entries({
    AUTO_INTAKE_ENABLED:String(enabled),
    AUTO_DRAFT_ENABLED:String(enabled),
    AUTO_DRAFT_SHEET_SYNC_ENABLED:String(enabled),
    AI_DATA_SHARING_APPROVED:String(consent),
    SOURCE_SPREADSHEET_ID:'form',
    MANAGEMENT_SPREADSHEET_ID:'management',
    HANDOFF_FOLDER_ID:'root',
    OWNER_EMAIL:'owner@example.test',
    APPROVAL_URL:'https://example.test/approval',
    ANTHROPIC_API_KEY:'test-key',ANTHROPIC_MODEL:'test-model',
    AUTO_INTAKE_MIN_ROW:String(start),AUTO_START_AFTER:'2026-11-17T00:00:00Z',
    MAX_AI_CALLS_PER_DAY:'3',HOLD_REPORT_IDS:hold
  }));
  const root=fakeFolder('root');
  const intake=root.createFolder('intake'),drafts=root.createFolder('drafts');
  const photos=root.createFolder('photos');
  const email=[],api=[];
  const sheets={
    form:{'フォームの回答 1':sheet(HEADERS,formRows)},
    management:{
      '取り込み済み':sheet(IMPORT_HEADERS,importRows),
      '下書き':sheet(MGR_HEADERS,draftRows)
    }
  };
  const context=vm.createContext({
    Date,JSON,Set,
    PropertiesService:{getScriptProperties:()=>({
      getProperty:key=>properties.get(key)??null,
      setProperty:(key,value)=>properties.set(key,value)
    })},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    SpreadsheetApp:{openById:id=>({
      getSheetByName:n=>sheets[id]?.[n]||null
    })},
    DriveApp:{getFolderById:()=>root,getFileById:fid=>({
      getMimeType:()=>'image/jpeg',
      makeCopy:(filename,folder)=>folder.addFile(filename,'image-bytes','image/jpeg')
    })},
    Utilities:{
      DigestAlgorithm:{SHA_256:'SHA-256'},Charset:{UTF_8:'UTF-8'},
      computeDigest:(algorithm,seed)=>[...createHash('sha256').update(seed).digest()],
      formatDate:(d,tz,fmt)=>fmt==='yyyyMMdd'?'20261118':'2026-11-18'
    },
    MimeType:{PLAIN_TEXT:'text/plain'},
    UrlFetchApp:{fetch:(url,options)=>{
      api.push({url,options});
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
        content:[{type:'text',text:JSON.stringify(ANSWER)}]
      })};
    }},
    MailApp:{sendEmail:(...args)=>email.push(args)},
    Logger:{log:()=>{}}
  });
  for(const src of sources)vm.runInContext(src,context,{timeout:1000});
  return {
    root,intake,drafts,photos,email,api,importRows,draftRows,formRows,properties,
    run:()=>vm.runInContext('oshAutoPipelineTick()',context,{timeout:2000})
  };
}
test('all three stages exchange a synthetic report and photo exactly once',()=>{
  const a=setup();a.run();a.run();
  assert.equal(a.intake.files.size,1);
  assert.equal(a.photos.dirs.size,1);
  assert.equal(a.drafts.files.size,1);
  assert.equal(a.importRows.length,1);
  assert.equal(a.draftRows.length,1);
  assert.equal(a.api.length,1);
  assert.equal(a.email.length,1);
  assert.match(a.email[0][1], /下書きを保存/);
  assert.equal(a.email[0][0], 'owner@example.test');
  const saved=JSON.parse(a.draftRows[0][4]);
  assert.equal(saved.status,'needs-photo-review');
  assert.equal(saved.approval.hp.state,'draft');
  assert.equal(saved.approval.gbp.state,'draft');
  assert.equal(saved.publishLog.hp,null);
  assert.equal(saved.media[0].privacyCheck,'pending');
  assert.equal(saved.media[0].contentMatch,'pending');
});
test('consent disabled: intake permitted, AI request forbidden, no approval row',()=>{
  const a=setup({consent:false});
  assert.throws(()=>a.run(),/未承認/);
  assert.equal(a.intake.files.size,1);
  assert.equal(a.api.length,0);
  assert.equal(a.draftRows.length,0);
  assert.equal(a.email.length,0);
});
test('all switches OFF: no report, photo, email, API or sheet change',()=>{
  const a=setup({enabled:false});a.run();
  assert.equal(a.intake.files.size,0);
  assert.equal(a.photos.dirs.size,0);
  assert.equal(a.draftRows.length,0);
  assert.equal(a.api.length,0);
  assert.equal(a.email.length,0);
});
test('already imported form row is never ingested a second time',()=>{
  const a=setup({alreadyImported:[['old','old',2,'','','']]});
  a.run();
  assert.equal(a.importRows.length,1);
  assert.equal(a.intake.files.size,0);
});
