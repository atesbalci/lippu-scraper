import puppeteer, { Browser, type Page } from 'puppeteer-core'
import dotenv from 'dotenv'
import { Telegraf } from 'telegraf'

interface Item {
    id: string | null
    text: string
}

dotenv.config()
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN ?? '')
const cache: Item[] = []

async function sendMessage(text: string) {
    await bot.telegram.sendMessage(parseInt(process.env.TELEGRAM_CHAT_ID ?? ''), text)
}

function timeout(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isNewItem(item: Item) {
    const retVal = !cache.some(cachedItem => cachedItem.id === item.id)
    if (retVal) {
        cache.push(item)
    }
    if (cache.length > 100) {
        cache.shift()
    }
    return retVal
}

async function shutdown(signal: string, browser: Browser) {
    console.log(`Received ${signal}, shutting down...`)
    await browser.disconnect()
    console.log('Browser disconnected on exit')
    process.exit(0)
}

async function main() {
    sendMessage('Bot started')
    const browser = await puppeteer.connect({
        protocol: 'webDriverBiDi',
        browserWSEndpoint: 'ws://127.0.0.1:9222/session',
        defaultViewport: null,
    })
    process.on('SIGINT', () => { shutdown('SIGINT', browser).catch(console.error); });
    process.on('SIGTERM', () => { shutdown('SIGTERM', browser).catch(console.error); });
    const pages = await browser.pages()
    const page: Page = pages.find((p) => p.url() === process.env.EVENT_URL) ?? (await browser.newPage())

    while (true) {
        try {
            await page.goto(process.env.EVENT_URL ?? '', { waitUntil: 'domcontentloaded', timeout: 60_000 })
            await page.waitForSelector('.listing-container')
            const items = await page.$eval('.listing-container', (el) =>
                Array.from(el.children).map((child) => ({
                    id: child.children[0]!.children[0]!.getAttribute('data-offerid'),
                    text: (child as HTMLElement).innerText.trim(),
                } as Item)),
            )
            let counter: number = 0
            for (const item of items) {
                if (isNewItem(item)) {
                    await sendMessage(item.text)
                    counter++
                }
            }
            console.log(`New items found: ${counter}`)
            await timeout(process.env.INTERVAL ? parseInt(process.env.INTERVAL) : 300000)
        } catch (error) {
            console.error(error)
        }
    }

    await browser.disconnect()
    console.log('Browser disconnected on exit')
}

main()