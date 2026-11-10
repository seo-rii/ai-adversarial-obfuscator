import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { browserFixtureConfig } from '../../fixtures/browser/vite.config.mjs';

const CSP = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'";
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8'
};

async function serveBuilds(builds) {
    const server = createServer(async (request, response) => {
        response.setHeader('Content-Security-Policy', CSP);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-store');
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            const [, variant, ...segments] = pathname.split('/');
            if (!Object.hasOwn(builds, variant)) {
                response.writeHead(pathname === '/favicon.ico' ? 204 : 404).end();
                return;
            }
            const root = builds[variant];
            const file = resolve(root, segments.join('/') || 'index.html');
            const path = relative(root, file);
            if (path === '..' || path.startsWith(`..${sep}`)) {
                response.writeHead(404).end();
                return;
            }
            const content = await readFile(file);
            response.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
            response.writeHead(200).end(content);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('Chromium preserves DOM, default preload, dynamic imports, and Workers under a strict CSP', { timeout: 60000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiob-browser-'));
    const builds = { original: join(root, 'original'), protected: join(root, 'protected') };
    let browser;
    let server;
    try {
        for (const [variant, outDir] of Object.entries(builds)) {
            await build({
                ...browserFixtureConfig({ protectedBuild: variant === 'protected', outDir }),
                configFile: false
            });
        }
        const serving = await serveBuilds(builds);
        server = serving.server;
        browser = await chromium.launch({ headless: true });
        const results = {};
        for (const variant of Object.keys(builds)) {
            const context = await browser.newContext();
            const failures = [];
            const workerUrls = [];
            const scriptUrls = new Set();
            try {
                await context.addInitScript(() => {
                    globalThis.__AIOB_CSP_VIOLATIONS__ = [];
                    document.addEventListener('securitypolicyviolation', event => {
                        globalThis.__AIOB_CSP_VIOLATIONS__.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
                    });
                });
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                page.on('pageerror', error => failures.push(error.message));
                page.on('requestfailed', request => failures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
                page.on('console', message => {
                    if (message.type() === 'error') failures.push(message.text());
                });
                page.on('worker', worker => workerUrls.push(worker.url()));
                page.on('request', request => {
                    if (new URL(request.url()).pathname.endsWith('.js')) scriptUrls.add(request.url());
                });
                const response = await page.goto(`${serving.origin}/${variant}/`, { waitUntil: 'networkidle' });
                assert.equal(response.status(), 200);
                assert.equal(response.headers()['content-security-policy'], CSP);
                await page.locator('#run[data-ready="true"]').click();
                await page.locator('#result[data-state="ready"]').waitFor();
                results[variant] = JSON.parse(await page.locator('#result').textContent());
                assert.deepEqual(await page.evaluate(() => globalThis.__AIOB_CSP_VIOLATIONS__), [], variant);
                assert.deepEqual(failures, [], variant);
                assert.equal(workerUrls.length, 1, 'the fixture must create and run a real Worker');
                assert.ok([...scriptUrls].some(url => /\/lazy-[^/]+\.js$/.test(new URL(url).pathname)),
                    'the click must fetch a code-split dynamic import');
                if (variant === 'protected') {
                    for (const url of [...scriptUrls, ...workerUrls]) {
                        const path = new URL(url).pathname.slice(`/${variant}/`.length);
                        const code = await readFile(join(builds[variant], path), 'utf8');
                        assert.match(code, /AI_ANALYSIS_DECOY/, path);
                    }
                }
            } finally {
                await context.close();
            }
        }
        assert.deepEqual(results.original, {
            invoice: 66,
            lazy: { label: 'Loaded 7', squares: [1, 4, 9] },
            worker: { total: 30, runtime: 'worker' }
        });
        assert.deepEqual(results.protected, results.original);
    } finally {
        if (browser) await browser.close();
        if (server) {
            server.closeAllConnections();
            await new Promise(resolveClose => server.close(resolveClose));
        }
        await rm(root, { recursive: true, force: true });
    }
});
