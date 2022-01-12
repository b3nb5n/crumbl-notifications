import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import puppeteer from 'puppeteer';
import twilio from 'twilio';

const firebase = admin.initializeApp();

const getRecipients = async () => {
	const db = admin.firestore(firebase);
	const recipientsSnap = await db.collection('recipients').get();
	return recipientsSnap.docs.map((doc) => doc.data().phone as string);
};

interface Flavors {
	cookies: string[];
	iceCream: string[];
}

const getFlavors = async (): Promise<Flavors> => {
	const browser = await puppeteer.launch();
	const page = (await browser.pages())[0] ?? (await browser.newPage());

	await page.goto('https://crumblcookies.com/');
	const flavors = (await page.evaluate(() =>
		Array.from(
			document.querySelectorAll('#weekly-cookie-flavors h3:nth-child(-n+6)')
		)
			.map((element) => element.textContent?.trim())
			.filter((flavor) => typeof flavor === 'string')
	)) as string[];

	await page.close();
	await browser.close();

	return {
		cookies: flavors.slice(0, 6),
		iceCream: flavors.slice(6),
	};
};

const formatFlavors = (flavors: Flavors) => {
	const cookieFlavors = flavors.cookies.map((flavor) => `🍪 ${flavor}`).join('\n');
	const iceCreamFlavors = flavors.iceCream
		.map((flavor) => `🍦 ${flavor}`)
		.join('\n');

	const TITLE = 'This weeks crumbl flavors are:';
	const URL = 'crumblcookies.com';
	return `${TITLE}\n\n${cookieFlavors}\n\n${iceCreamFlavors}\n\n${URL}`;
};

const getTwilioClient = () => {
	const { sid, token } = functions.config().twilio;
	return twilio(sid, token);
};

const notify = async (
	smsClient: twilio.Twilio,
	from: string,
	to: string,
	body: string
) => {
	try {
		functions.logger.debug(`Notifying ${to}`);
		await smsClient.messages.create({ from, to, body });
	} catch (e) {
		functions.logger.error(`Error notifying ${to}:`, e);
	}
};

const crumblNotifier = async (recipients: string[]) => {
	if (recipients.length === 0) return;

	const flavors = await getFlavors();
	const message = formatFlavors(flavors);
	const smsClient = getTwilioClient();
	const { sender } = functions.config().twilio;

	for (const phone of recipients) {
		await notify(smsClient, sender, phone, message);
	}
};

const runtimeOptions: functions.RuntimeOptions = {
	memory: '256MB',
	timeoutSeconds: 30,
	maxInstances: 1,
};

if (process.env.FUNCTIONS_EMULATOR) {
	exports.getFlavors = functions
		.runWith(runtimeOptions)
		.https.onRequest(async (_, res) => {
			try {
				const flavors = await getFlavors();
				res.send(flavors);
			} catch (e) {
				res.status(500).send({ error: e });
			}
		});

	exports.notify = functions
		.runWith(runtimeOptions)
		.https.onRequest(async (req, res) => {
			if (
				typeof req.body !== 'object' ||
				!Array.isArray(req.body.recipients) ||
				!req.body.recipients.every(
					(recipient: any) => typeof recipient === 'string'
				)
			) {
				res.status(400).send({ error: 'Invalid request body' });
				return;
			}

			try {
				const recipients = req.body.recipients as string[];
				await crumblNotifier(recipients);
				res.sendStatus(200);
			} catch (e) {
				res.status(500).send(e);
			}
		});
}

exports.notifier = functions
	.runWith(runtimeOptions)
	.pubsub.schedule('30 18 * * 0')
	.timeZone('America/Phoenix')
	.onRun(async () => {
		const recipients = await getRecipients();
		await crumblNotifier(recipients);
	});
