/**
 * 既存のオシスマ「承認.gs / applyDraft_」へAIの結果を渡す差分JSON生成。
 * 【本番未導入】既存の修理報告を上書きせず、下書きの受け渡し形式だけ作る。
 * - 元写真/スタッフ名/個人情報/承認状態/公開記録は出力に含めない。
 * - 相談のみ・結果が未確認なら下書きを出さず、オーナーによる確認待ちにする。
 * - 写真のaltは画像の中身を見ずに生成しない（空配列で既存値を維持）。
 * - 写真が未確認でも下書きは作れる。ただし公開承認は既存のphotoOk_で拒否。
 */
function oshLegacyPatchSlug_(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
}
function oshLegacyPatchString_(value,max) {
  return typeof value==='string' ? value.trim().slice(0,max) : '';
}
function oshLegacyCreateDraftPatch_(report, ai, date) {
  const fail=message=>{throw new Error('下書きの形式を確認してください：'+message);};
  if (!report || !/^R-\d{8}-[a-z0-9]{8}$/i.test(report.reportId||'') ||
      report.source?.mode!=='production' || report.status!=='needs-draft' ||
      !report.intake?.reportText || report.drafts?.hp ||
      report.approval?.hp?.state!=='draft' || report.publishLog?.hp)
    fail('元報告が下書き作成待ちではありません');
  if (!ai || ai.ready!==true) return null; // 修理未完了なら何も生成しない
  if (!report.facts?.area?.name || !report.facts?.area?.slug ||
      !report.facts?.device?.name || !report.facts?.device?.slug)
    fail('地域または機種が未確認です');
  if (!Array.isArray(report.media) || !report.media.length ||
      report.media.length>5 || !report.media.every(m=>/^p[1-5]$/.test(m.id||'')))
    fail('元写真の情報が不正です');
  const works=Array.isArray(ai.works)?ai.works.map(x=>oshLegacyPatchString_(x,80)):[];
  const result=oshLegacyPatchString_(ai.result,500);
  if (!works.length || works.some(x=>!x) || !result) fail('修理内容・結果が未確認です');
  const hp=ai.hp||{},gbp=ai.gbp||{};
  const services=Array.isArray(hp.titleServices)?hp.titleServices.map(x=>oshLegacyPatchString_(x,80)):[];
  if(!services.length || !services.every(x=>x && works.includes(x)))
    fail('タイトルの修理内容と実施した作業が一致しません');
  if(!Array.isArray(hp.sections) || hp.sections.length!==3 ||
     hp.sections.map(s=>s.heading).join('|')!=='ご相談|修理内容|修理後')
    fail('記事見出しの構成が違います');
  const sections=hp.sections.map(s=>({
    heading:s.heading,
    paragraphs:Array.isArray(s.paragraphs)?s.paragraphs.map(p=>oshLegacyPatchString_(p,3000)):[]
  }));
  if(sections.some(s=>!s.paragraphs.length||s.paragraphs.some(p=>!p)))fail('記事本文が不完全です');
  const summary=oshLegacyPatchString_(gbp.summary,1501);
  if(!summary || summary.length>1500 || /https?:\/\/|(?:\btel:)/i.test(summary) ||
     /0\d{1,4}[-‐－ー]?\d{1,4}[-‐－ー]?\d{3,4}/.test(summary))
    fail('Google投稿本文に不備があります');
  const description=oshLegacyPatchString_(hp.description,1500);
  const cardSummary=oshLegacyPatchString_(hp.cardSummary,500);
  if(!description||!cardSummary)fail('記事の紹介文がありません');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))fail('掲載日の形式が不正です');
  const areaSlug=oshLegacyPatchSlug_(report.facts.area.slug);
  const deviceSlug=oshLegacyPatchSlug_(report.facts.device.slug);
  const workSlug=oshLegacyPatchSlug_(services.join('-'))||'repair';
  if(!areaSlug||!deviceSlug)fail('URL用の英字表記がありません');
  const slug=date+'-'+areaSlug+'-'+deviceSlug+'-'+workSlug+'-'+report.reportId.slice(-8);
  if(!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(slug))fail('記事URLを生成できません');
  const photo1=report.media[0].id;
  const photo2=report.media[1]?.id||photo1;
  const existing=Array.isArray(report.facts.uncertain)?report.facts.uncertain:[];
  const uncertain=[...existing,
    ...(Array.isArray(ai.uncertain)?ai.uncertain.map(x=>oshLegacyPatchString_(x,300)):[])];
  return {
    reportId:report.reportId,
    facts:{
      consultation:oshLegacyPatchString_(ai.consultation,800),
      works,result,staffComment:oshLegacyPatchString_(ai.staffComment,500),uncertain
    },
    media:[], // 元写真を見ていないのでalt/caption/showsは作らない
    drafts:{
      hp:{
        slug,date,titleArea:report.facts.area.name,titleDevice:report.facts.device.name,
        titleServices:services,description,cardSummary,sections,
        featureMedia:photo1,cardMedia:photo2
      },
      gbp:{summary,media:photo1}
    }
  };
}
