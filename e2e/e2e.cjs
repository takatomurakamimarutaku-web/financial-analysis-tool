// E2E テスト（Playwright）。主要な操作を iPhone 幅（375px）・ライト／ダークで確認する。
// 実行：node e2e/e2e.cjs [スクリーンショットの保存先]
// Playwright（chromium）が入っている環境が必要です（アプリ本体は Playwright を使いません）。
// アプリのファイルを内蔵のローカルサーバーで配信するだけで、外部には接続しません。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mikata-e2e-'));
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`);
  }
}

async function newPage(browser, base, scheme) {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, colorScheme: scheme,
    serviceWorkers: 'block', acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  return page;
}

async function noHorizontalScroll(page, where) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= w, `${where}：横スクロールが発生（${sw}px > ${w}px）`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();

  for (const scheme of ['light', 'dark']) {
    const page = await newPage(browser, base, scheme);
    const S = scheme === 'dark' ? '（ダーク）' : '';

    await step(`初回ガイドが出て、サンプルで試すと比較タブに進む${S}`, async () => {
      await page.waitForSelector('#modal:not([hidden])');
      assert.equal(await page.textContent('#modalTitle'), '数字のミカタへようこそ');
      await shot(page, `onboarding-${scheme}`);
      await page.click('#modalActions >> text=次へ');
      await page.click('#modalActions >> text=サンプルで試す');
      await page.waitForSelector('#view-compare:not([hidden])');
      assert.ok(await page.isHidden('#modal'));
      assert.ok((await page.$$('#compareTable thead th')).length >= 4, '比較表に3期分の列がある');
      await noHorizontalScroll(page, '比較タブ');
      await shot(page, `compare-${scheme}`);
    });

    await step(`再読み込み後はガイドを出さない${S}`, async () => {
      await page.reload();
      await page.waitForSelector('#results .indicator');
      assert.ok(await page.isHidden('#modal'));
    });

    await step(`入力すると分析結果とバッジが更新される${S}`, async () => {
      await page.click('#tab-input');
      const sales = page.locator('#plFields input').first();
      await sales.fill('200000');
      await sales.press('Tab');
      await page.waitForTimeout(100);
      const text = await page.textContent('#results');
      assert.match(text, /評価基準/);
      assert.ok((await page.$$('#results .badge')).length > 0, 'バッジが表示される');
      await noHorizontalScroll(page, '入力タブ');
      await shot(page, `input-${scheme}`);
    });

    await step(`「?」で計算式・評価の目安のヘルプが開く${S}`, async () => {
      await page.click('#tab-compare');
      await page.click('#compareTable button.help-btn >> nth=0');
      await page.waitForSelector('#modal:not([hidden])');
      const body = await page.textContent('#modalBody');
      assert.match(body, /計算式/);
      assert.match(body, /評価の目安/);
      await shot(page, `help-${scheme}`);
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#modal'));
    });

    await step(`図解・設定タブも横スクロールなし${S}`, async () => {
      await page.click('#tab-diagram');
      await noHorizontalScroll(page, '図解タブ');
      await shot(page, `diagram-${scheme}`);
      await page.click('#tab-settings');
      await page.click('.settings-item >> text=このアプリについて');
      const about = await page.textContent('#settingsBody');
      assert.match(about, /免責事項/);
      assert.match(about, /外部のサーバーへの送信/);
      assert.match(about, /All rights reserved/);
      await noHorizontalScroll(page, '設定タブ');
      await shot(page, `about-${scheme}`);
    });

    await step(`印刷用レポートに免責事項と評価基準が載る${S}`, async () => {
      await page.click('#tab-compare');
      await page.click('#btnReport');
      await page.waitForSelector('#view-report:not([hidden])');
      const text = await page.textContent('#report');
      assert.match(text, /参考値/);
      assert.match(text, /評価バッジの基準/);
      await page.click('#btnReportBack');
    });

    await step(`キャッシュフロー（推計）が入力・比較・図解・レポートに出る${S}`, async () => {
      await page.click('#tab-input');
      await page.click('#periodChips .chip:not(.chip-add) >> nth=2');
      const body = await page.textContent('#cfBody');
      assert.match(body, /営業CF\+9,200/);
      assert.match(body, /検算一致/);
      assert.match(body, /3\.6年/);
      await page.locator('#sec-cf').screenshot({ path: path.join(SHOT_DIR, `cf-input-${scheme}.png`) });
      await page.click('#periodChips .chip:not(.chip-add) >> nth=0');
      assert.match(await page.textContent('#cfBody'), /前の期がないため推計できません/);
      await page.click('#periodChips .chip:not(.chip-add) >> nth=2');
      await page.click('#tab-compare');
      assert.ok(await page.locator('#cfChart rect.bar').count() >= 6);
      assert.match(await page.textContent('#compareTable'), /キャッシュフロー（推計）/);
      assert.match(await page.textContent('#compareTable'), /債務償還年数/);
      await page.locator('#sec-cfc').screenshot({ path: path.join(SHOT_DIR, `cf-compare-${scheme}.png`) });
      await page.click('#tab-diagram');
      assert.match(await page.textContent('#dgCfInsight'), /本業で \+9,200千円/);
      await page.locator('#sec-dg-cf').screenshot({ path: path.join(SHOT_DIR, `cf-diagram-${scheme}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.click('#tab-compare');
      await page.click('#btnReport');
      assert.match(await page.textContent('#report'), /キャッシュフロー（推計）/);
      await page.click('#btnReportBack');
      await page.click('#tab-input');
    });

    await step(`キーボード：タブと期の選択を矢印キーで切り替えられる${S}`, async () => {
      await page.click('#tab-input');
      await page.focus('#tab-input');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getAttribute('#tab-compare', 'aria-selected'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-compare');
      await page.keyboard.press('End');
      assert.equal(await page.getAttribute('#tab-settings', 'aria-selected'), 'true');
      await page.keyboard.press('Home');
      assert.equal(await page.getAttribute('#tab-input', 'aria-selected'), 'true');
      assert.deepEqual(await page.$$eval('.tabs [role="tab"]', (ts) => ts.map((t) => t.tabIndex)), [0, -1, -1, -1]);
      const chips = '#periodChips .chip:not(.chip-add)';
      await page.click(`${chips} >> nth=0`);
      await page.focus(`${chips} >> nth=0`);
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getAttribute(`${chips} >> nth=1`, 'aria-selected'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-selected')), 'true');
      const badge = await page.$('.badge-good');
      if (badge) assert.equal(await badge.evaluate((b) => getComputedStyle(b, '::before').content), '"✓ "');
      await page.click(`${chips} >> nth=2`);
    });

    if (scheme === 'light') {
      await step('Excel（xlsx）を4シートで出力できる', async () => {
        await page.click('#tab-compare');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnXlsx')]);
        assert.match(dl.suggestedFilename(), /^fin-tool-analysis-\d{4}-\d{2}-\d{2}\.xlsx$/);
        const xlsxPath = path.join(SHOT_DIR, 'analysis.xlsx');
        await dl.saveAs(xlsxPath);
        const buf = fs.readFileSync(xlsxPath);
        assert.equal(buf.subarray(0, 2).toString(), 'PK', 'ZIP 形式');
        const text = buf.toString('utf8');
        for (const name of ['xl/workbook.xml', 'xl/worksheets/sheet4.xml', '概要', '比較表', 'EBITDAブリッジ', 'ネットデット内訳']) assert.ok(text.includes(name), name);
      });

      await step('レポート：作成者・所見・表紙・グラフ・ページ番号の設定が反映・保存される', async () => {
        await page.click('#tab-compare');
        await page.click('#btnReport');
        await page.fill('#reportAuthor', '山田 太郎');
        await page.fill('#reportOffice', '○○会計事務所');
        await page.fill('#reportComment', '売上高は増加傾向。');
        await page.waitForTimeout(700);
        assert.match(await page.textContent('#report .report-cover'), /○○会計事務所.*山田 太郎/);
        assert.match(await page.textContent('#report .report-comment'), /売上高は増加傾向/);
        assert.equal(await page.locator('#report .report-chart svg').count(), 8);
        assert.equal(await page.evaluate(() => document.getElementById('report').classList.contains('page-numbers')), true);
        await shot(page, 'report-options');
        await page.uncheck('#reportCover');
        await page.uncheck('#reportCharts');
        assert.equal(await page.locator('#report .report-cover').count(), 0);
        assert.equal(await page.locator('#report .report-chart').count(), 0);
        assert.match(await page.textContent('#report .report-meta'), /作成：○○会計事務所/);
        await page.waitForTimeout(700);
        const ws = JSON.parse(await page.evaluate(() => localStorage.getItem('finAnalysisTool.data')));
        assert.deepEqual(ws.settings.report, { author: '山田 太郎', office: '○○会計事務所', cover: false, charts: false, pageNumbers: true });
        assert.equal(ws.companies.find((c) => c.id === ws.activeId).reportComment, '売上高は増加傾向。');
        await page.check('#reportCover');
        await page.check('#reportCharts');
        await page.waitForTimeout(700);
        await page.click('#btnReportBack');
      });

      let backupPath;
      await step('バックアップを保存し、クリア→元に戻す→復元できる', async () => {
        await page.click('#tab-input');
        const before = await page.evaluate(() => localStorage.getItem('finAnalysisTool.data'));
        await page.click('#btnExport');
        await page.waitForSelector('#modal:not([hidden]) input[type=password]');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#modalActions >> text=パスワードなしで保存')]);
        backupPath = path.join(SHOT_DIR, 'backup.json');
        await dl.saveAs(backupPath);
        assert.equal(JSON.parse(fs.readFileSync(backupPath, 'utf8')).format, 'finAnalysisTool-backup');

        await page.click('#btnClear');
        await page.waitForSelector('#toast.show .toast-action');
        assert.notEqual(await page.evaluate(() => localStorage.getItem('finAnalysisTool.data')), before);
        await page.click('#toast .toast-action');
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => localStorage.getItem('finAnalysisTool.data')), before, '元に戻すでクリア前に戻る');

        await page.click('#btnClear');
        await page.setInputFiles('#importFile', backupPath);
        await page.waitForSelector('#modal:not([hidden])');
        await page.click('#modalActions >> text=に上書き');
        await page.waitForTimeout(300);
        const ws = JSON.parse(await page.evaluate(() => localStorage.getItem('finAnalysisTool.data')));
        assert.equal(ws.version, 10);
        assert.equal(ws.companies.length, 1);
        assert.equal(ws.companies[0].periods.length, 3, '復元で3期に戻る');
      });

      await step('期の削除を元に戻せる（設定画面から）', async () => {
        await page.click('#btnRemovePeriod');
        await page.waitForTimeout(100);
        assert.equal((await page.$$('#periodChips .chip:not(.chip-add)')).length, 2);
        await page.reload();
        await page.click('#tab-settings');
        await page.click('.settings-item >> text=バックアップ・データ管理');
        await page.click('#settingsBody >> text=「期の削除」の前の状態に戻す');
        await page.click('#tab-input');
        assert.equal((await page.$$('#periodChips .chip:not(.chip-add)')).length, 3);
      });

      await step('複数社：追加・切り替え・全社バックアップ・1社分を追加で復元・会社の削除を元に戻す', async () => {
        const companyNames = () => page.evaluate(() => JSON.parse(localStorage.getItem('finAnalysisTool.data')).companies.map((c) => c.companyName));
        await page.click('#companyBar .company-switch');
        await page.click('#modalActions >> text=会社を追加');
        await page.fill('#companyName', 'B商事');
        await page.locator('#plFields input').first().fill('5000');
        await page.locator('#plFields input').first().press('Tab');
        await page.waitForTimeout(400);
        assert.deepEqual(await companyNames(), ['サンプル株式会社', 'B商事']);
        assert.match(await page.textContent('#companyBar'), /B商事.*2\/2/);
        await page.click('#companyBar .company-switch');
        await page.click('.company-pick-item >> text=サンプル株式会社');
        assert.equal(await page.inputValue('#companyName'), 'サンプル株式会社');
        assert.equal((await page.$$('#periodChips .chip:not(.chip-add)')).length, 3);
        await shot(page, 'companies-input');

        // 全社のバックアップはパスワード付きで保存する（短いパスワード・確認の不一致は保存しない）
        await page.click('#btnExportAll');
        const pwInputs = page.locator('#modal:not([hidden]) input[type=password]');
        await pwInputs.nth(0).fill('short');
        await pwInputs.nth(1).fill('short');
        await page.click('#modalActions >> text=パスワード付きで保存');
        assert.match(await page.textContent('#modalBody [role=alert]'), /8文字以上/);
        await pwInputs.nth(0).fill('mikata-pass-1');
        await pwInputs.nth(1).fill('mikata-pass-2');
        await page.click('#modalActions >> text=パスワード付きで保存');
        assert.match(await page.textContent('#modalBody [role=alert]'), /一致しません/);
        await shot(page, 'backup-password');
        await pwInputs.nth(1).fill('mikata-pass-1');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#modalActions >> text=パスワード付きで保存')]);
        const allPath = path.join(SHOT_DIR, 'backup-all-locked.json');
        await dl.saveAs(allPath);
        assert.match(dl.suggestedFilename(), /backup-all-.*-locked\.json$/);
        const locked = fs.readFileSync(allPath, 'utf8');
        assert.equal(JSON.parse(locked).format, 'finAnalysisTool-encrypted-backup');
        assert.ok(!locked.includes('B商事'), '会社名が平文で残らない');

        // 1社分のバックアップを「新しい会社として追加」
        await page.setInputFiles('#importFile', backupPath);
        await page.waitForSelector('#modal:not([hidden])');
        await page.click('#modalActions >> text=新しい会社として追加');
        await page.waitForTimeout(300);
        assert.equal((await companyNames()).length, 3);

        // 設定の会社の管理から削除 → 元に戻す
        await page.click('#tab-settings');
        if (await page.isVisible('.settings-back')) await page.click('.settings-back');
        await page.click('.settings-item >> text=会社の管理');
        await shot(page, 'companies-settings');
        await page.click('.company-row >> nth=1 >> text=削除');
        await page.waitForTimeout(200);
        assert.deepEqual(await companyNames(), ['サンプル株式会社', 'サンプル株式会社']);
        await page.click('#toast .toast-action');
        await page.waitForTimeout(200);
        assert.deepEqual(await companyNames(), ['サンプル株式会社', 'B商事', 'サンプル株式会社']);

        // 全社のバックアップ（パスワード付き）で置き換え。違うパスワードでは復元しない
        await page.setInputFiles('#importFile', allPath);
        await page.waitForSelector('#modal:not([hidden]) input[type=password]');
        await page.fill('#modal input[type=password]', 'wrong-password');
        await page.click('#modalActions >> text=復元へ進む');
        await page.waitForSelector('#modalBody [role=alert]:not([hidden])');
        assert.match(await page.textContent('#modalBody [role=alert]'), /パスワードが違うか/);
        assert.equal((await companyNames()).length, 3);
        await page.fill('#modal input[type=password]', 'mikata-pass-1');
        await page.click('#modalActions >> text=復元へ進む');
        await page.waitForTimeout(1500);
        assert.deepEqual(await companyNames(), ['サンプル株式会社', 'B商事']);
        await page.click('#tab-input');
      });

      await step('試算表CSVを取り込み、合計行の優先・対応表の保存・元に戻すが働く', async () => {
        const csvPath = path.join(SHOT_DIR, 'trial-balance.csv');
        fs.writeFileSync(csvPath, '\uFEFF科目,金額\r\n売上高,"12,345,000"\r\n現金,100000\r\n普通預金,200000\r\n現金及び預金合計,300000\r\n製品売上,5000\r\n');
        const active = () => page.evaluate(() => {
          const ws = JSON.parse(localStorage.getItem('finAnalysisTool.data'));
          return { ws, c: ws.companies.find((x) => x.id === ws.activeId) };
        });
        await page.setInputFiles('#csvFile', csvPath);
        await page.waitForSelector('#modal:not([hidden]) .csv-map');
        assert.equal(await page.locator('.csv-map-row').count(), 5);
        assert.match(await page.textContent('.csv-map-row >> nth=1'), /合計の行を優先/);
        await page.selectOption('.csv-map-row >> nth=4 >> select', 'ignore');
        assert.match(await page.textContent('.csv-preview'), /取り込む項目（2項目）/);
        await shot(page, 'csv-import');
        const { c: before } = await active();
        await page.click('#modalActions >> text=取り込む');
        await page.waitForTimeout(300);
        const { ws, c } = await active();
        const changed = c.periods.findIndex((p, i) => p.pl.sales === 12345 && before.periods[i].pl.sales !== 12345);
        assert.ok(changed >= 0, '選択中の期に売上高 12,345千円が入る');
        assert.equal(c.periods[changed].bs.cash, 300);
        assert.deepEqual(ws.importMap, { '製品売上': 'ignore' });
        await page.click('#toast .toast-action');
        await page.waitForTimeout(200);
        assert.deepEqual((await active()).c.periods, before.periods, '元に戻すで取込前に戻る');
        await page.setInputFiles('#csvFile', csvPath);
        await page.waitForSelector('#modal:not([hidden]) .csv-map');
        assert.match(await page.textContent('.csv-map-row >> nth=4'), /前回の対応/);
        await page.click('#modalActions >> text=キャンセル');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      });

      await step('会計ソフトの試算表CSV（Shift_JIS・借方残高/貸方残高）：列の自動判定・会計ソフトの選択・列の割り当ての変更', async () => {
        const csvPath = path.join(__dirname, '..', 'test', 'fixtures', 'dummy-bugyo.csv');
        await page.setInputFiles('#csvFile', csvPath);
        await page.waitForSelector('#modal:not([hidden]) .csv-map');
        assert.match(await page.textContent('.csv-columns summary'), /Shift_JIS/);
        assert.equal(await page.inputValue('#csvColAmount'), 'dc');
        assert.equal(await page.locator('.csv-map-row').count(), 6);
        assert.match(await page.textContent('.csv-preview'), /買掛金|仕入債務/);
        await page.selectOption('#csvPreset', 'bugyo');
        assert.match(await page.textContent('.csv-howto'), /合計残高試算表/);
        assert.match(await page.textContent('#modalBody'), /未検証/);
        await page.click('.csv-columns summary');
        await page.selectOption('#csvColAmount', '2'); // 「借方合計」の列に変える
        assert.match(await page.textContent('.csv-columns'), /列を手動で選択/);
        assert.match(await page.textContent('.csv-map-row >> nth=0'), /500,000/);
        await shot(page, 'csv-import-preset');
        await page.click('.csv-columns >> text=自動の判定に戻す');
        assert.equal(await page.inputValue('#csvColAmount'), 'dc');
        await page.click('#modalActions >> text=キャンセル');
        assert.equal(await page.evaluate(() => localStorage.getItem('finAnalysisTool.importPreset')), 'bugyo');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      });

      await step('入力の補助：未入力の主な科目・前の期からコピー・入力中の桁区切り', async () => {
        await page.click('#tab-input');
        const chips = () => page.$$('#periodChips .chip:not(.chip-add)');
        const n0 = (await chips()).length;
        await page.click('#periodChips .chip-add');
        assert.equal((await chips()).length, n0 + 1);
        await page.waitForSelector('#missingFields:not([hidden])');
        assert.match(await page.textContent('#missingFields'), /未入力の主な科目（11）/);
        await page.click('#missingFields .missing-item >> text=売上高');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'f-pl-sales');
        await page.keyboard.type('1234567');
        assert.equal(await page.inputValue('#f-pl-sales'), '1,234,567');
        await page.click('#btnCopyPrev');
        await page.waitForSelector('#toast.show .toast-action');
        assert.equal(await page.inputValue('#f-pl-sales'), '1,234,567', '入力済みの欄は変えない');
        assert.notEqual(await page.inputValue('#f-bs-cash'), '');
        assert.equal(await page.isHidden('#missingFields'), true);
        await shot(page, 'input-assist');
        await page.click('#toast .toast-action');
        await page.waitForTimeout(200);
        assert.equal(await page.inputValue('#f-bs-cash'), '');
        await page.click('#btnRemovePeriod');
        await page.waitForTimeout(200);
        assert.equal((await chips()).length, n0);
      });

      await step('保存できないときは画面上部に常に警告を出す', async () => {
        await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
        const name = page.locator('#companyName');
        await name.fill('保存失敗テスト');
        await page.waitForTimeout(500);
        assert.ok(await page.isVisible('#storageBar'), '保存失敗の帯が出る');
        assert.match(await page.textContent('#storageBar'), /保存できませんでした/);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const top = await page.$eval('#storageBar', (e) => e.getBoundingClientRect().top);
        assert.ok(top <= 1, 'スクロールしても上部に表示される');
        await shot(page, 'storage-error');
      });

      await step('想定外のエラーでバックアップ・再読み込みの案内を出す', async () => {
        const p2 = await newPage(browser, base, 'light');
        await p2.evaluate(() => localStorage.setItem('finAnalysisTool.onboarded', 'x'));
        await p2.reload();
        await p2.evaluate(() => setTimeout(() => { throw new Error('テスト用のエラー'); }, 0));
        await p2.waitForSelector('#errorBar:not([hidden])');
        assert.match(await p2.textContent('#errorBar'), /バックアップを保存/);
        assert.match(await p2.textContent('#errorDetail'), /テスト用のエラー/);
        await shot(p2, 'fatal-error');
        await p2.context().close();
      });

      await step('パスコードロック：設定すると起動時に画面を隠し、正しいパスコードで解除・オフにできる', async () => {
        const p3 = await newPage(browser, base, 'light');
        await p3.evaluate(() => localStorage.setItem('finAnalysisTool.onboarded', 'x'));
        await p3.reload();
        assert.ok(await p3.isHidden('#lockScreen'), 'ロックなしでは表示しない');
        await p3.click('#tab-settings');
        await p3.click('.settings-item >> text=パスコードロック');
        await p3.fill('#lockNew', '12');
        await p3.fill('#lockNew2', '12');
        await p3.click('#settingsBody >> text=ロックを設定');
        assert.match(await p3.textContent('#settingsBody [role=alert]'), /4〜12桁/);
        await p3.fill('#lockNew', '2580');
        await p3.fill('#lockNew2', '2580');
        await p3.click('#settingsBody >> text=ロックを設定');
        await p3.waitForSelector('#settingsBody >> text=状態：オン');
        const stored = await p3.evaluate(() => localStorage.getItem('finAnalysisTool.lock'));
        assert.ok(stored && !stored.includes('2580'), 'パスコードそのものは保存しない');
        await p3.reload();
        assert.ok(await p3.isVisible('#lockScreen'), '起動時にロック画面');
        assert.equal(await p3.evaluate(() => getComputedStyle(document.querySelector('.app-main')).visibility), 'hidden', 'アプリの画面は隠れている');
        await p3.fill('#lockInput', '0000');
        await p3.click('#lockSubmit');
        await p3.waitForFunction(() => document.getElementById('lockError').textContent.includes('違います'));
        await shot(p3, 'lock-screen');
        await p3.fill('#lockInput', '2580');
        await p3.click('#lockSubmit');
        await p3.waitForSelector('#lockScreen', { state: 'hidden' });
        assert.equal(await p3.evaluate(() => getComputedStyle(document.querySelector('.app-main')).visibility), 'visible');
        await p3.click('#tab-settings');
        if (await p3.isVisible('.settings-back')) await p3.click('.settings-back');
        await p3.click('.settings-item >> text=パスコードロック');
        await p3.fill('#lockCurrent', '1111');
        await p3.click('#settingsBody >> text=ロックをオフにする');
        await p3.waitForFunction(() => /違います/.test(document.querySelector('#settingsBody [role=alert]').textContent));
        await p3.fill('#lockCurrent', '2580');
        await p3.click('#settingsBody >> text=ロックをオフにする');
        await p3.waitForSelector('#settingsBody >> text=状態：オフ');
        assert.equal(await p3.evaluate(() => localStorage.getItem('finAnalysisTool.lock')), null);
        assert.deepEqual(p3.errors, []);
        await p3.context().close();
      });
    }

    if (scheme === 'dark') {
      await step('更新後の最初の起動で変更点を表示する', async () => {
        await page.evaluate(() => localStorage.setItem('finAnalysisTool.lastVersion', 'v13'));
        await page.reload();
        await page.waitForSelector('#modal:not([hidden])');
        assert.match(await page.textContent('#modalTitle'), /に更新しました/);
        assert.match(await page.textContent('#modalBody'), /v14/);
        await page.click('#modalActions >> text=閉じる');
        await page.reload();
        assert.ok(await page.isHidden('#modal'), '2回目は出さない');
      });
    }

    await step(`画面のエラーが出ていない${S}`, async () => {
      const errs = page.errors.filter((m) => !/QuotaExceededError/.test(m));
      assert.deepEqual(errs, []);
    });
    await page.context().close();
  }

  await step('Service Worker 有効時もアプリはオフラインで開け、feedback/ はアプリに置き換わらない', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'allow' });
    const p = await ctx.newPage();
    await p.goto(base);
    await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await p.reload();
    await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await p.goto(`${base}feedback/`);
    assert.equal(await p.title(), '数字のミカタ 感想フォーム');
    await ctx.setOffline(true);
    await p.goto(base);
    assert.equal(await p.title(), '数字のミカタ');
    await ctx.setOffline(false);
    await ctx.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} 件中 ${results.length - failed.length} 件 OK${failed.length ? `、${failed.length} 件 NG` : ''}`);
  console.log(`スクリーンショット：${SHOT_DIR}`);
  process.exit(failed.length ? 1 : 0);
})();
