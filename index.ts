import * as axios from 'axios'
import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { JSDOM } from 'jsdom'
import twilio from 'twilio'
import { z } from 'zod'

const recipientSchema = z.object({
	firstName: z.string(),
	lastName: z.string().optional(), // Not actually used anywhere just so I can tell whos who
	phone: z.string().regex(/^\+1\d{10}$/),
	favorites: z.array(z.string()).optional(),
	notifications: z.object({
		weekly: z.boolean(),
	}),
})

type Recipient = z.TypeOf<typeof recipientSchema>

const CRUMBL_URL = 'crumblcookies.com'

// Initialize twilio and firebase
const { sid, token, sender } = functions.config().twilio
const smsClient = twilio(sid, token)
const firebase = admin.initializeApp()

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

const formatFlavors = (flavors: string[]) =>
	flavors.map((flavor) => `🍪 ${flavor}`).join('\n')

// Sends a formatted message containing the given `flavors` to each of the given `recipients`
const flavorNotifier = (flavors: string[], recipients: Recipient[]) => {
	const messages = recipients.map((recipient) => {
		const greeting = `Hey ${recipient.firstName}, this weeks crumbl flavors are:`

		return smsClient.messages.create({
			from: sender,
			to: recipient.phone,
			body: `${greeting}\n\n${formatFlavors(flavors)}\n\n${CRUMBL_URL}`,
		})
	})

	// Return a promise that will wait for every message to be sent
	return Promise.all(messages)
}

// Sends each of the given `recipients` a message listing each of their favorite
// flavors that are included in the `flavors` list
const favoriteNotifier = (flavors: string[], recipients: Recipient[]) => {
	const messages = recipients.map((recipient) => {
		if (!recipient.favorites) return
		const greeting = `Hey ${recipient.firstName}, crumbl has some of your favorites this week`
		const available = recipient.favorites.filter((favorite) =>
			flavors.includes(favorite)
		)

		return smsClient.messages.create({
			from: sender,
			to: recipient.phone,
			body: `${greeting}:\n\n${formatFlavors(available)}\n\n${CRUMBL_URL}`,
		})
	})

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
			const weeklyRecipients = recipients.filter(
				(recipient) => recipient.notifications.weekly
			)

			await flavorNotifier(flavors, weeklyRecipients)
		} catch (error) {
			console.error(`There was an issue sending flavors notifications: ${error}`)
		}

		try {
			const favoritesRecipients = recipients.filter(
				(recipient) => !recipient.notifications
			)

			await favoriteNotifier(flavors, favoritesRecipients)
		} catch (error) {
			console.error(`There was an issue sending favorites notifications: ${error}`)
		}
	})

// Notifies new recipients as soon as they are added
export const newMemberNotifier = functions.firestore
	.document('recipients/{id}')
	.onCreate(async (doc) => {
		const recipient = recipientSchema.parse(doc.data())
		const flavors = await fetchFlavors()

		try {
			await flavorNotifier(flavors, [recipient])
		} catch (error) {
			console.error(`There was an issue notifying a new recipient: ${error}`)
		}
	})
