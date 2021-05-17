const admin = require('firebase-admin');
const puppeteer = require('puppeteer');
const twilio = require('twilio');
const app = require('express')();
require('dotenv').config();

admin.initializeApp({
	credential: admin.credential.applicationDefault(),
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

		const { TWILIO_SID, TWILIO_TOKEN } = process.env;
		const client = twilio(TWILIO_SID, TWILIO_TOKEN);

		const recipiantsSnap = await admin.firestore().collection('recipiants').get();
		recipiantsSnap.forEach(async (doc) => {
			const { phone, name } = doc.data();
			console.log(`sending to ${name} at ${phone}`);

			try {
				await client.messages.create({
					body: message,
					to: phone,
					from: '+14804000695',
				});
			} catch (err) {
				throw `Error sending message: ${err}`;
			}
		});

		return res.send(message);
	} catch (err) {
		console.error(err);
		res.status(500);
		res.end();
	}
});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
	console.log(`listening on port ${port}...`);
});
