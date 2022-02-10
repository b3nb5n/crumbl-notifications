import * as axios from 'axios';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { JSDOM } from 'jsdom';
import twilio from 'twilio';

type Flavors = string[];

interface Recipient {
	name: string;
	phone: string;
}

const firebase = admin.initializeApp();
const CRUMBL_URL = 'crumblcookies.com';
const runtimeOptions: functions.RuntimeOptions = {
	memory: '512MB',
	timeoutSeconds: 60,
};

const getRecipients = async () => {
	const db = admin.firestore(firebase);
	const recipientsSnap = await db.collection('recipients').get();
	return recipientsSnap.docs.map((doc) => doc.data() as Recipient);
};

const getFlavors = async (): Promise<Flavors> => {
	const { data } = await axios.default.get(`https://${CRUMBL_URL}`);
	if (typeof data !== 'string') throw TypeError('Invalid response data');
	const dom = new JSDOM(data);

	const flavors = Array.from(dom.window.document.querySelectorAll('#weekly-cookie-flavors h3'))
		.map((element) => element.textContent?.trim())
		.filter((flavor) => typeof flavor === 'string')
		.slice(0, 6);

	return flavors as string[];
};

const formatFlavors = (name: string, flavors: Flavors) => {
	const greeting = `Hey ${name}, this weeks crumbl flavors are:`;
	const flavorsString = flavors.map((flavor) => `🍪 ${flavor}`).join('\n');
	return `${greeting}\n\n${flavorsString}\n\n${CRUMBL_URL}`;
};

const getTwilioClient = () => {
	const { sid, token } = functions.config().twilio;
	return twilio(sid, token);
};

const notify = async (smsClient: twilio.Twilio, from: string, to: string, body: string) => {
	try {
		functions.logger.debug(`Notifying ${to}`);
		await smsClient.messages.create({ from, to, body });
	} catch (e) {
		functions.logger.error(`Error notifying ${to}:`, e);
	}
};

const crumblNotifier = async (recipients: Recipient[]) => {
	if (recipients.length === 0) return;

	const flavors = await getFlavors();
	const smsClient = getTwilioClient();
	const { sender } = functions.config().twilio;

	for (const { name, phone } of recipients) {
		const message = formatFlavors(name, flavors);
		await notify(smsClient, sender, phone, message);
	}
};

exports.flavors = functions.runWith(runtimeOptions).https.onRequest(async (_, res) => {
	try {
		const flavors = await getFlavors();
		res.send(flavors);
	} catch (e) {
		res.status(500).send({ error: e });
	}
});

exports.notify = functions.runWith(runtimeOptions).https.onRequest(async (req, res) => {
	try {
		const { name, phone } = req.query;
		const recipients =
			typeof name === 'string' && typeof phone === 'string'
				? [{ name, phone }]
				: await getRecipients();

		await crumblNotifier(recipients);
		res.sendStatus(200);
	} catch (e) {
		res.status(500).send(e);
	}
});

exports.notifier = functions
	.runWith(runtimeOptions)
	.pubsub.schedule('30 18 * * 0')
	.timeZone('America/Phoenix')
	.onRun(async () => {
		console.log('Running notifier');
		const recipients = await getRecipients();
		await crumblNotifier(recipients);
	});
