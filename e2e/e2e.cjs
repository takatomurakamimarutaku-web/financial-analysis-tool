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

    if (scheme === 'light') {
      let backupPath;
      await step('バックアップを保存し、クリア→元に戻す→復元できる', async () => {
        await page.click('#tab-input');
        const before = await page.evaluate(() => localStorage.getItem('finAnalysisTool.data'));
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
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
        assert.equal(ws.version, 8);
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

        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportAll')]);
        const allPath = path.join(SHOT_DIR, 'backup-all.json');
        await dl.saveAs(allPath);
        assert.match(dl.suggestedFilename(), /backup-all/);
        assert.equal(JSON.parse(fs.readFileSync(allPath, 'utf8')).data.companies.length, 2);

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

        // 全社のバックアップで置き換え
        await page.setInputFiles('#importFile', allPath);
        await page.waitForTimeout(300);
        assert.deepEqual(await companyNames(), ['サンプル株式会社', 'B商事']);
        await page.click('#tab-input');
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
