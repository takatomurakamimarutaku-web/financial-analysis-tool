// 画面内ヘルプ・初回ガイド・免責事項の文言。DOMに依存しない純粋関数と定数。
import { INDICATORS, CATEGORIES, formulaText, DEFAULT_DAYS } from './calc.js';
import { guideFor } from './badges.js';

// 免責事項（設定の「このアプリについて」・印刷レポート・初回ガイドで共通に使う）
export const DISCLAIMER = [
  '計算結果・評価バッジは、入力された数値にもとづく参考値です。税務・会計・法務・投資・融資などの判断についての助言ではありません。',
  '重要な判断の前には、元の決算書や専門家の意見で必ずご確認ください。計算の誤りや入力の誤りによって生じた損害について、作成者は責任を負いません。',
  '本アプリは監査・保証や財務デューデリジェンスの代わりにはなりません。',
];

export const PRIVACY = [
  '入力したデータは、この端末のブラウザ内（localStorage）にだけ保存します。外部のサーバーへの送信、アクセス解析、広告は一切ありません。',
  'バックアップファイル（JSON）は暗号化されていません。他人に渡すときやクラウドに置くときは取り扱いにご注意ください。',
  'ブラウザのデータ削除や、iPhoneの空き容量不足などで保存データが消えることがあります。定期的にバックアップを保存してください。',
];

// 著作権・ライセンス（リポジトリ直下の LICENSE と同じ趣旨）
export const COPYRIGHT = 'Copyright (c) 2026 たかと / takatomurakamimarutaku-web. All rights reserved.';
export const LICENSE_TEXT = [
  'アプリの利用は無料です。',
  'ソースコード・デザイン・アイコン・文書の複製・改変・再配布・転載は、著作権者の許可なく行えません。',
];
// 問い合わせ先（未定の間は null。決まったら文字列を入れると「このアプリについて」に表示される）
export const CONTACT = null;

// レポートの注記に入れる1行
export const REPORT_DISCLAIMER = '本レポートは入力データにもとづく参考値であり、税務・会計・投資・融資の判断についての助言、監査・保証や財務デューデリジェンスの結論ではありません。データは作成した端末内でのみ処理しています。';

// 初回ガイド（3画面）
export const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: '数字のミカタへようこそ',
    lines: [
      '決算書の数字を入れるだけで、収益性・安全性などの指標、複数期の比較、図解をスマホで確認できます。',
      'データはこの端末の中だけに保存され、外部には送信しません。',
      '計算結果は参考値です。税務・投資などの判断の助言ではありません。',
    ],
  },
  {
    id: 'howto',
    title: '使い方',
    lines: [
      '①「入力」タブで、期ごとにPL（損益計算書）とBS（貸借対照表）の金額を入れます。',
      '②「比較」タブで最大5期の推移を、「図解」タブで利益や財産の構成を図で見られます。',
      '③ 指標の名前や「?」をタップすると、計算式と評価の目安が出ます。',
      'まずはサンプルデータで試してみましょう。',
    ],
    action: 'sample',
  },
  {
    id: 'protect',
    title: 'データを守る・ホーム画面に追加',
    lines: [
      'データは端末内だけにあるため、機種変更やデータ削除に備えて「入力」タブ下の「バックアップを保存」でファイルに保存してください。',
      'iPhone（Safari）：画面下の共有ボタン（□に↑）→「ホーム画面に追加」で、アプリのように起動でき、オフラインでも使えます。',
      'このガイドは「設定」→「このアプリについて」からもう一度見られます。',
    ],
  },
];

export const ONBOARDING_KEY = 'finAnalysisTool.onboarded';

// 比較表の追加行（INDICATORS にない行）の説明
const EXTRA_HELP = {
  normalizedEbitda: {
    name: '正常化EBITDA', unit: '千円',
    formula: '報告EBITDA（営業利益 + 減価償却費）+ 調整額合計',
    meaning: '役員報酬の水準調整や一過性の損益などを除いた、実力ベースのEBITDA。企業価値評価の基礎に使う。',
  },
  normalizedEbitdaMargin: {
    name: '正常化EBITDAマージン', unit: '%',
    formula: '正常化EBITDA ÷ 売上高',
    meaning: '売上高に対する実力ベースの稼ぐ力。マイナスは調整後でも赤字。',
  },
  workingCapital: {
    name: '運転資本（トレード）', unit: '千円',
    formula: '売上債権 + 棚卸資産 − 仕入債務',
    meaning: '商売を回すために寝ている資金。増えると資金繰りが苦しくなりやすい。',
  },
  workingCapitalRatio: {
    name: '運転資本 ÷ 売上高', unit: '%',
    formula: '運転資本 ÷ 売上高',
    meaning: '売上規模に対する運転資本の重さ。前期と比べて増減を見る。',
  },
  adjustedNetDebt: {
    name: '調整後ネットデット', unit: '千円',
    formula: '有利子負債 + デットライク項目 − 現預金 − キャッシュライク項目',
    meaning: '借入に準じる債務（未払退職金など）と現金に準じる資産（定期預金など）を加味した実質的な借入額。',
  },
  adjustedNetDebtToNormalizedEbitda: {
    name: '調整後ネットデット ÷ 正常化EBITDA', unit: '倍',
    formula: '調整後ネットデット ÷ 正常化EBITDA',
    meaning: '実質的な借入を、実力ベースのEBITDA何年分で返せるか。小さいほど返済余力がある。',
  },
};

// キャッシュフロー（推計）の指標。前期のBSが必要なものがあるため、INDICATORS とは別に持つ
const CF_HELP = {
  operatingCf: {
    name: '営業CF（推計）', unit: '千円',
    formula: '当期純利益 + 減価償却費 − Δ売上債権 − Δ棚卸資産 + Δ仕入債務 − Δその他流動資産 + Δその他負債（Δ＝当期末−前期末）',
    meaning: '本業で生んだお金。その他流動資産＝流動資産−現預金−売上債権−棚卸資産、その他負債＝流動負債＋固定負債−仕入債務−有利子負債。マイナスが続くと資金繰りに注意（「標準」の基準で注意のバッジ）。',
  },
  investingCf: {
    name: '投資CF（推計）', unit: '千円',
    formula: '−（Δ固定資産合計 + 減価償却費）',
    meaning: '設備投資などに使ったお金（マイナスが支出）。固定資産の売却や保険積立金・貸付金の増減もここに入る簡易な推計。',
  },
  financingCf: {
    name: '財務CF（推計）', unit: '千円',
    formula: 'Δ有利子負債 +（Δ純資産 − 当期純利益）',
    meaning: '借入の増減と、利益以外の純資産の動き（増資はプラス、配当はマイナス）。営業・投資・財務の合計は現預金の増減と一致する。',
  },
  fcf: {
    name: 'フリー・キャッシュフロー（FCF）', unit: '千円',
    formula: '営業CF + 投資CF',
    meaning: '借入の返済や配当に回せるお金の目安。',
  },
  simpleCf: {
    name: '簡易CF', unit: '千円',
    formula: '当期純利益 + 減価償却費',
    meaning: '金融機関がよく使う返済原資の目安。前期がなくても計算できる。',
  },
  operatingCfMargin: {
    name: '営業CFマージン', unit: '%',
    formula: '営業CF ÷ 売上高',
    meaning: '売上高のうち、お金として残った割合。営業利益率と比べると、利益が現金になっているかが分かる。',
  },
  capex: {
    name: '設備投資額（推計）', unit: '千円',
    formula: 'Δ固定資産合計 + 減価償却費',
    meaning: '固定資産の増加と減価償却費から推計した設備投資の額。売却や除却があると実際より小さく出る。',
  },
  debtRedemptionYears: {
    name: '債務償還年数', unit: '年',
    formula: '有利子負債 ÷ 簡易CF（簡易CFが0以下なら参考外）',
    meaning: '借入を今の稼ぎ（簡易CF）で何年で返せるか。金融機関によって式が異なる（例：有利子負債から現預金や正常運転資金を差し引く）。「標準」の基準では10年以下で良好、20年超で注意（金融機関の一般的な目安。公的な基準ではない）。',
  },
  normalizedEbitdaLessCapex: {
    name: '正常化EBITDA − 設備投資額（参考）', unit: '千円',
    formula: '正常化EBITDA − 設備投資額（推計）',
    meaning: 'M&Aの財務デューデリジェンスでよく見る、買収後に返済などに回せるお金の目安。運転資本の増減と税金は含まない。',
  },
};

// 計算できない場合の表示の説明（一覧の末尾に出す）
export const NA_RULES = [
  '「—」：分母が0、または計算に必要な項目が未入力',
  '「参考外」：債務超過（純資産がマイナス）のときの ROE・D/Eレシオ・固定比率、固定長期適合率で「自己資本＋固定負債」がマイナス、ネットデット倍率でEBITDAがマイナス',
  '自己資本比率は債務超過でもマイナスのまま表示します',
];

// 指標 id のヘルプ。{ id, name, unit, category, formula, meaning, guide: guideFor の戻り値 | null }。不明な id は null
export function indicatorHelp(id, { days = DEFAULT_DAYS, evaluation } = {}) {
  const ind = INDICATORS.find((i) => i.id === id);
  const extra = EXTRA_HELP[id];
  const cf = CF_HELP[id];
  if (cf) return { id, name: cf.name, unit: cf.unit, category: 'キャッシュフロー（推計）', formula: cf.formula, meaning: cf.meaning, guide: null };
  if (!ind && !extra) return null;
  const guide = evaluation ? guideFor(id, evaluation) : null;
  if (ind) {
    return {
      id, name: ind.name, unit: ind.unit,
      category: CATEGORIES.find((c) => c.id === ind.category)?.name ?? '',
      formula: formulaText(ind, days), meaning: ind.guide, guide,
    };
  }
  return { id, name: extra.name, unit: extra.unit, category: 'M&A', formula: extra.formula, meaning: extra.meaning, guide };
}

export function hasHelp(id) {
  return INDICATORS.some((i) => i.id === id) || id in EXTRA_HELP || id in CF_HELP;
}

// 指標の解説一覧（設定の「指標の解説」ページ）：区分ごとの配列
export function helpCatalog(options = {}) {
  const groups = CATEGORIES.map((c) => ({
    name: c.name,
    items: INDICATORS.filter((i) => i.category === c.id).map((i) => indicatorHelp(i.id, options)),
  }));
  groups.find((g) => g.name === 'M&A')?.items.push(...Object.keys(EXTRA_HELP).map((id) => indicatorHelp(id, options)));
  groups.push({ name: 'キャッシュフロー（推計）', items: Object.keys(CF_HELP).map((id) => indicatorHelp(id, options)) });
  return groups;
}
