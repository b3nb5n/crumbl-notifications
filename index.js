"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const twilio_1 = __importDefault(require("twilio"));
const firebase = admin.initializeApp();
const getRecipients = () => __awaiter(void 0, void 0, void 0, function* () {
    const db = admin.firestore(firebase);
    const recipientsSnap = yield db.collection('recipients').get();
    return recipientsSnap.docs.map((doc) => doc.data().phone);
});
const getFlavors = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const browser = yield puppeteer_1.default.launch();
    const page = (_a = (yield browser.pages())[0]) !== null && _a !== void 0 ? _a : (yield browser.newPage());
    yield page.goto('https://crumblcookies.com/');
    const flavors = (yield page.evaluate(() => Array.from(document.querySelectorAll('#weekly-cookie-flavors h3:nth-child(-n+6)'))
        .map((element) => { var _a; return (_a = element.textContent) === null || _a === void 0 ? void 0 : _a.trim(); })
        .filter((flavor) => typeof flavor === 'string')));
    yield page.close();
    yield browser.close();
    return {
        cookies: flavors.slice(0, 6),
        iceCream: flavors.slice(6),
    };
});
const formatFlavors = (flavors) => {
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
    return (0, twilio_1.default)(sid, token);
};
const notify = (smsClient, from, to, body) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        functions.logger.debug(`Notifying ${to}`);
        yield smsClient.messages.create({ from, to, body });
    }
    catch (e) {
        functions.logger.error(`Error notifying ${to}:`, e);
    }
});
const crumblNotifier = (recipients) => __awaiter(void 0, void 0, void 0, function* () {
    if (recipients.length === 0)
        return;
    const flavors = yield getFlavors();
    const message = formatFlavors(flavors);
    const smsClient = getTwilioClient();
    const { sender } = functions.config().twilio;
    for (const phone of recipients) {
        yield notify(smsClient, sender, phone, message);
    }
});
const runtimeOptions = {
    memory: '256MB',
    timeoutSeconds: 30,
    maxInstances: 1,
};
if (process.env.FUNCTIONS_EMULATOR) {
    exports.getFlavors = functions
        .runWith(runtimeOptions)
        .https.onRequest((_, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const flavors = yield getFlavors();
            res.send(flavors);
        }
        catch (e) {
            res.status(500).send({ error: e });
        }
    }));
    exports.notify = functions
        .runWith(runtimeOptions)
        .https.onRequest((req, res) => __awaiter(void 0, void 0, void 0, function* () {
        if (typeof req.body !== 'object' ||
            !Array.isArray(req.body.recipients) ||
            !req.body.recipients.every((recipient) => typeof recipient === 'string')) {
            res.status(400).send({ error: 'Invalid request body' });
            return;
        }
        try {
            const recipients = req.body.recipients;
            yield crumblNotifier(recipients);
            res.sendStatus(200);
        }
        catch (e) {
            res.status(500).send(e);
        }
    }));
}
exports.notifier = functions
    .runWith(runtimeOptions)
    .pubsub.schedule('30 18 * * 0')
    .timeZone('America/Phoenix')
    .onRun(() => __awaiter(void 0, void 0, void 0, function* () {
    const recipients = yield getRecipients();
    yield crumblNotifier(recipients);
}));
