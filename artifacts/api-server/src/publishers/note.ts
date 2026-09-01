import { chromium } from "playwright";
import type { Locator, Page } from "playwright";
import type { Publisher } from "./types";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function firstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function fillFirst(page: Page, selectors: string[], value: string) {
  const locator = await firstVisible(page, selectors);
  if (!locator) throw new Error(`Could not find a form field: ${selectors.join(", ")}`);
  await locator.fill(value);
  return locator;
}

async function clickFirst(page: Page, selectors: string[]) {
  const locator = await firstVisible(page, selectors);
  if (!locator) throw new Error(`Could not find a button: ${selectors.join(", ")}`);
  await locator.click();
  return locator;
}

async function login(page: Page, email: string, password: string) {
  const loginUrl = process.env["NOTE_LOGIN_URL"]?.trim() ?? "https://note.com/login";
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page
    .locator('input[type="password"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);

  const emailField = await firstVisible(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="login"]',
    'input[autocomplete="username"]',
    'input[type="text"]',
  ]);
  if (!emailField) return;

  await emailField.fill(email);
  await fillFirst(
    page,
    ['input[type="password"]', 'input[name="password"]', 'input[autocomplete="current-password"]'],
    password,
  );
  await clickFirst(page, [
    'button:has-text("ログイン")',
    'button:has-text("Log in")',
    'button[type="submit"]',
  ]);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(2_000);
  if (new URL(page.url()).pathname === "/login") {
    const alertText = (await page.locator('[role="alert"]').allTextContents())
      .map((text) => text.trim())
      .filter(Boolean)
      .join(" ");
    throw new Error(`note login failed${alertText ? `: ${alertText}` : ""}`);
  }
}

async function fillEditor(page: Page, body: string) {
  const editor = await firstVisible(page, [
    '[contenteditable="true"]',
    'textarea[placeholder*="本文"]',
    'textarea[aria-label*="本文"]',
  ]);
  if (!editor) throw new Error("Could not find the note article editor");
  await editor.click();
  await editor.fill(body).catch(async () => {
    await page.keyboard.insertText(body);
  });
}

async function uploadImage(page: Page, imagePath: string) {
  const inputSelector = process.env["NOTE_IMAGE_INPUT_SELECTOR"]?.trim() ?? 'input[type="file"]';
  const input = page.locator(inputSelector).first();
  if (await input.count()) {
    await input.setInputFiles(imagePath);
  }
}

function findPublishedUrl(page: Page) {
  const url = page.url();
  if (/^https:\/\/note\.com\/.+\/n\/.+/.test(url)) return url;
  return null;
}

export const publishToNote: Publisher = async ({ article }) => {
  const email = requiredEnv("NOTE_EMAIL");
  const password = requiredEnv("NOTE_PASSWORD");
  const newArticleUrl =
    process.env["NOTE_NEW_ARTICLE_URL"]?.trim() ?? "https://note.com/notes/new";
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await login(page, email, password);
    await page.goto(newArticleUrl, { waitUntil: "domcontentloaded" });

    await fillFirst(
      page,
      [
        'input[placeholder*="タイトル"]',
        'input[aria-label*="タイトル"]',
        'input[name="title"]',
        'textarea[placeholder*="タイトル"]',
        '[contenteditable="true"][data-placeholder*="タイトル"]',
        '[contenteditable="true"][aria-label*="タイトル"]',
      ],
      article.title,
    );
    await fillEditor(page, article.body);
    if (article.imagePath) await uploadImage(page, article.imagePath);

    await clickFirst(page, [
      'button:has-text("公開")',
      'button:has-text("Publish")',
      '[role="button"]:has-text("公開")',
    ]);
    await page.waitForTimeout(500);
    await clickFirst(page, [
      'button:has-text("公開する")',
      'button:has-text("Publish")',
      'button:has-text("投稿する")',
    ]).catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const publishedUrl = findPublishedUrl(page);
    if (!publishedUrl) throw new Error("note publish completed without a note entry URL");
    return { publishedUrl };
  } finally {
    await browser.close();
  }
};