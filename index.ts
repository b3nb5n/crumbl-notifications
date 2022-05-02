import * as axios from 'axios'
import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { JSDOM } from 'jsdom'
import twilio from 'twilio'
import { z } from 'zod'

const recipientSchema = z.object({
	name: z.string(),
	lastName: z.string().optional(), // Not actually used anywhere just so I can tell whos who
	phone: z.string().regex(/^\+1\d{10}$/),
})

type Recipient = z.TypeOf<typeof recipientSchema>

const firebase = admin.initializeApp()
const CRUMBL_URL = 'crumblcookies.com'

// Retrieves the recipients from the database
const fetchRecipients = async () => {
	const db = admin.firestore(firebase)
	const recipientsSnap = await db.collection('recipients').get()
	return recipientsSnap.docs.map((doc) => doc.data() as Recipient)
}

// Retrieves the names of the current flavors from the crumbl website
const fetchFlavors = async (): Promise<string[]> => {
	const { data, status } = await axios.default.get(`https://${CRUMBL_URL}`)
	if (status != 200) throw new Error('Error fetching crumbl homepage')

	// Parse the names of the cookies from the response
	const dom = new JSDOM(data)
	const flavors = Array.from(
		dom.window.document.querySelectorAll('#weekly-cookie-flavors h3')
	)
		.map((element) => element.textContent?.trim())
		.filter((flavor) => typeof flavor === 'string')
		.slice(0, 6)

	return flavors as string[]
}

// Formats a recipient and a list of flavors into a text message body
const formatMessage = (recipient: Recipient, flavors: string[]) => {
	const greeting = `Hey ${recipient.name}, this weeks crumbl flavors are:`
	const flavorsString = flavors.map((flavor) => `🍪 ${flavor}`).join('\n')
	return `${greeting}\n\n${flavorsString}\n\n${CRUMBL_URL}`
}

const notify = (message: string, recipient: Recipient) => {
	const { sid, token, sender } = functions.config().twilio
	const smsClient = twilio(sid, token)
	return smsClient.messages.create({
		from: sender,
		to: recipient.phone,
		body: message,
	})
}

// Sends a formatted message containing the given `flavors` to each of the given `recipients`
const crumblNotifier = (flavors: string[], recipients: Recipient[]) => {
	const { sid, token, sender } = functions.config().twilio
	const smsClient = twilio(sid, token)
	const messages = recipients.map((recipient) =>
		smsClient.messages.create({
			from: sender,
			to: recipient.phone,
			body: formatMessage(recipient, flavors),
		})
	)

	// Return a promise that will wait for every message to be sent
	return Promise.all(messages)
}

// Every sunday at 6:30pm send the crumbl flavors to the stored recipients
export const notifier = functions.pubsub
	.schedule('30 18 * * 0')
	.timeZone('America/Phoenix')
	.onRun(async () => {
		const recipients = await fetchRecipients()
		const flavors = await fetchFlavors()

		try {
			await crumblNotifier(flavors, recipients)
		} catch (error) {
			console.error(`There was an issue notifying the recipients: ${error}`)
		}

		try {
			await firebase.firestore().collection('history').add({
				flavors,
				time: admin.firestore.FieldValue.serverTimestamp(),
			})
		} catch (error) {
			console.error(`There was an issue storing the flavor history: ${error}`)
		}
	})

// Notifies new recipients as soon as they are added
export const newMemberNotifier = functions.firestore
	.document('recipients/{id}')
	.onCreate(async (doc, ctx) => {
		const recipient = recipientSchema.parse(doc.data())
		const flavors = await fetchFlavors()

		try {
			const message = formatMessage(recipient, flavors)
			await notify(message, recipient)
		} catch (error) {
			console.error(`There was an issue notifying a new recipient: ${error}`)
		}
	})
