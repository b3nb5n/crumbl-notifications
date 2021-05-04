const puppeteer = require('puppeteer');
const twilio = require('twilio');
const app = require('express')();
require('dotenv').config();

app.post('/', async (_, res) => {
	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-gpu'],
	});
	const page = await browser.newPage();

	await page.goto('https://crumblcookies.com/');

	const cookies = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#weekly-cookie-flavors h3')).map((element) =>
			element.innerText.trim()
		)
	);

	await page.close();
	await browser.close();

	const cookieList = cookies.map((name) => `🍪 ${name}`).join('\n');
	const message = `This weeks Crumbl flavors are:\n${cookieList}\n\n`;

	const { TWILIO_SID, TWILIO_TOKEN, RECIPIANT_PHONE } = process.env;
	const client = twilio(TWILIO_SID, TWILIO_TOKEN);

	res.send(message);
	await client.messages.create({
		body: message,
		to: RECIPIANT_PHONE,
		from: '+14804000695',
	});
});

const port = 80;
app.listen(port, () => {
	console.log(`listening on port ${port}...`);
});
