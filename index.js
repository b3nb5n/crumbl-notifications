const puppeteer = require('puppeteer');
const twilio = require('twilio');
const app = require('express')();
require('dotenv').config();

app.get('/ack', (req, res) => {
	res.send('ACK');
});

app.post('/', async (req, res) => {
	try {
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

		const recipiant = req.query.recipiant;
		if (!recipiant) return res.send(message);

		const { TWILIO_SID, TWILIO_TOKEN } = process.env;
		const client = twilio(TWILIO_SID, TWILIO_TOKEN);

		await client.messages.create({
			body: message,
			to: recipiant,
			from: '+14804000695',
		});

		return res.send(message);
	} catch (err) {
		console.error(err);
		res.status(500);
		res.end();
	}
});

const port = 8080;
app.listen(port, () => {
	console.log(`listening on port ${port}...`);
});
