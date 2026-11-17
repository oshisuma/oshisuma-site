import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('./auto-intake.gs',import.meta.url),'utf8');
const headers=['タイムスタンプ','担当スタッフ','お客様来店地域',
  'その他の地域名（その他を選んだ場合のみ）','機種・サービス名','今日の対応内容','写真'];
const imageId='1ZZzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
const cases=[
  ['2026/11/18 11:20:00','staff','水戸市','','iPhone 13','画面交換を実施',
    'https://drive.google.com/open?id='+imageId],
  ['2026/11/18 11:21:00','staff','水戸市','','iPad A16','修理相談だけ',
    'https://drive.google.com/open?id='+imageId]
];
function iter(a){let i=0;return {hasNext:()=>i<a.length,next:()=>a[i++]};}
function mock({enabled=false, start=2, rows=cases, importedRows=[]}={}){
  const props=new Map(Object.entries({
    AUTO_INTAKE_ENABLED:String(enabled), SOURCE_SPREADSHEET_ID:'form',
    MANAGEMENT_SPREADSHEET_ID:'mgmt',HANDOFF_FOLDER_ID:'root',
    AUTO_INTAKE_MIN_ROW:String(start)
  }));
  const photos=new Map(), intake=new Map(), imported=[...importedRows];
  let copied=0;
  const folder={
    getFoldersByName:name=>iter(name==='intake'?[intakeFolder]:name==='photos'?[photosFolder]:[]),
  };
  const intakeFolder={
    getFilesByName:name=>iter(intake.has(name)?[{
      getBlob:()=>({getDataAsString:()=>intake.get(name)})
    }]:[]),
    createFile:(name,content)=>intake.set(name,content)
  };
  const photosFolder={
    getFoldersByName:name=>iter(photos.has(name)?[photos.get(name)]:[]),
    createFolder:name=>{
      const files=new Map();
      const f={
        getFilesByName:n=>iter(files.has(n)?[files.get(n)]:[]),
        getFiles:()=>iter([...files.values()]),
        add:(n,o)=>files.set(n,{...o,getName:()=>n,getSize:()=>1024})
      };
      photos.set(name,f);return f;
    }
  };
  const sheets={
    form:{
      getLastRow:()=>rows.length+1,
      getRange:(r,col,n,num)=>({getValues:()=>{
        if(r===1)return [headers];
        return [rows[r-2]];
      }})
    },
    mgmt:{
      getLastRow:()=>imported.length+1,
      getRange:()=>({getValues:()=>imported}),
      appendRow:r=>imported.push(r)
    }
  };
  const context=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    DriveApp:{
      getFolderById:()=>folder,
      getFileById:()=>({
        getMimeType:()=>'image/jpeg',
        makeCopy:(name,to)=>{copied++;to.add(name,{})}
      })
    },
    SpreadsheetApp:{openById:id=>({getSheetByName:name=>id==='form'?sheets.form:sheets.mgmt})},
    Utilities:{
      DigestAlgorithm:{SHA_256:'SHA256'},Charset:{UTF_8:'UTF8'},
      computeDigest:(algo,s)=>Array.from({length:32},(_,i)=>i+String(s).length%13),
      formatDate:(d,tz,fmt)=>fmt==='yyyyMMdd'?'20261118':'2026-11-18'
    },
    MimeType:{PLAIN_TEXT:'text/plain'},
    Date,Set
  });
  vm.runInContext(src,context,{timeout:1000});
  return {context,props,intake,photos,imported,run:()=>vm.runInContext('oshAutoIntakeTick()',context,{timeout:1500}),get copied(){return copied}};
}
test('default off does not read or write data',()=>{const a=mock();a.run();assert.equal(a.intake.size,0);});
test('field names correspond to the actual form header',()=>{
  const a=mock();
  assert.equal(vm.runInContext('oshIntakeValidateHeader_('+JSON.stringify(headers)+')',a.context),true);
  assert.equal(vm.runInContext("oshIntakeValidateHeader_(['bad'])",a.context),false);
});
test('Japanese spreadsheet timestamp and Google photo URL are recognized',()=>{
  const a=mock();
  const dt=vm.runInContext("oshIntakeDate_('2026/11/18 11:20:00').toISOString()",a.context);
  assert.equal(dt,'2026-11-18T02:20:00.000Z');
  const ids=vm.runInContext("oshIntakePhotos_('https://drive.google.com/open?id="+imageId+"')",a.context);
  assert.equal(ids[0],imageId);
});
test('new rows are imported with photos and audit record only once',()=>{
  const a=mock({enabled:true});
  a.run();a.run();
  assert.equal(a.intake.size,2);
  assert.equal(a.imported.length,2);
  assert.equal(a.copied,2);
  const saved=[...a.intake.values()].map(x=>JSON.parse(x));
  assert(saved.every(x=>x.approval.hp.state==='draft'&&x.media[0].privacyCheck==='pending'));
  assert(saved.every(x=>x.drafts.hp===null));
});
test('already imported row is not duplicated',()=>{
  const a=mock({enabled:true,importedRows:[['old','R-old',2,'','','']]});
  a.run();
  assert.equal(a.intake.size,1);
  assert.equal(a.imported.length,2);
});
test('no photo means no intake, and a failure never writes a completed audit row',()=>{
  const rows=[['2026/11/18 11:20:00','staff','水戸市','','iPhone 13','交換','']];
  const a=mock({enabled:true,rows});
  assert.throws(()=>a.run(),/写真がありません/);
  assert.equal(a.intake.size,0);assert.equal(a.imported.length,0);
});
test('rows below the configured starting point are never imported',()=>{
  const a=mock({enabled:true,start:99});a.run();assert.equal(a.intake.size,0);
});
test('no new field or any approval is created by the intake bridge',()=>{
  const a=mock({enabled:true});a.run();
  const r=JSON.parse([...a.intake.values()][0]);
  assert.equal(r.status,'needs-draft');
  assert.equal(r.drafts.hp,null);
  assert.equal(r.approval.gbp.state,'draft');
  assert.equal(r.publishLog.hp,null);
});

test('device categories match existing repair article conventions',()=>{
 const x=mock();
 const check=s=>vm.runInContext('oshIntakeCategory_('+JSON.stringify(s)+')',x.context);
 assert.equal(check('iPhone 15 Pro'),'iphone');
 assert.equal(check('iPad A16'),'ipad');
 assert.equal(check('Galaxy S23 Ultra'),'android');
 assert.equal(check('Nintendo Switch'),'switch');
});
