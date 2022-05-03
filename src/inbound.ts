import * as functions from 'firebase-functions'
import { twiml as Twiml } from 'twilio'

type InboundMessageHandler = (msg: string) => string | Promise<string>

const addFavorite: InboundMessageHandler = (msg) => {
	return 'Im glad you like it'
}

const actions: Record<string, InboundMessageHandler> = {
	'❤️': addFavorite,
}

export const inbound_message_handler = functions.https.onRequest(
	async (req, res) => {
		const twiml = new Twiml.MessagingResponse()
		const msg = req.body?.Body
		if (typeof msg !== 'string') {
			res.send(twiml.toString())
			return
		}

		const handler = actions[msg[0]]
		if (!handler) {
			res.send(twiml.toString())
			return
		}

		try {
			res.send(twiml.message(await handler(msg.slice(1))))
		} catch (error) {
			console.error(`There was an issue handling an incoming message: ${error}`)
			res.send(
				twiml.message(
					"I couldn't do that right now for some reason, could you ask me again in a couple minutes?"
				)
			)
		}
	}
)
