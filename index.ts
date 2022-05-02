import * as axios from 'axios'
import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { JSDOM } from 'jsdom'
import twilio from 'twilio'

interface Recipient {
	name: string
	phone: string
}

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

// Every sunday at 6:30pm send the crumbl flavors to the stored recipients
export const notifier = functions.pubsub
	.schedule('30 18 * * 0')
	.timeZone('America/Phoenix')
	.onRun(async () => {
		const recipients = await fetchRecipients()
		const flavors = await fetchFlavors()

		try {
			const messages = recipients.map((recipient) => {
				const message = formatMessage(recipient, flavors)
				return notify(message, recipient)
			})

			// Wait for every message to send before continuing
			await Promise.all(messages)
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
