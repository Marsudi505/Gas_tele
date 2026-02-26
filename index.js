/**
 * 🚀 TEAMPICK PROJECT - V20 (BACKEND RELAY BOT)
 * Fitur: /stok, /fair, 3-Min Tracker, CDN Image, & Menu Mewah BAWX Style.
 */

const TG_API_ID = 30042890; 
const TG_API_HASH = "1012659099f45a9315c3b56aeff66be6"; 
const TARGET_TG_BOT = "idm_help_bot";
const TARGET_POINKU_BOT = "IPOINKUBOT"; 

// 🔒 GRUP AKSES
const TARGET_GROUP_IDS = [
    "120363406018124885@g.us", 
    "120363424305896248@g.us"  
]; 

// 👑 ADMIN
const ADMIN_IDS = [
    "175058655965193@lid", 
    "7289096413331@lid"    
];

const TARGET_CEK_STOK_GROUP = "120363405903708624@g.us"; 
const DB_FILE = './database_produk.json';

// 🖼️ URL GAMBAR MENU (Silakan ganti link di dalam tanda kutip ini dengan link gambar Bapak)
const MENU_IMAGE = "https://files.catbox.moe/auxswj.jpg";

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require('telegram/events');
const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const Tesseract = require('tesseract.js'); 
const bwipjs = require('bwip-js'); 
const input = require('input'); 

let wa, tg, tgEntityIDM, tgEntityPoinku;
let userSessions = new Map();
let pendingRequests = new Map();

function printBanner() {
    process.stdout.write('\x1Bc');
    console.log("\x1b[36m%s\x1b[0m", `
  ╔╦╗╔═╗╔═╗╔╦╗╔═╗╦╔═╗╦╔═
   ║ ║╣ ╠═╣║║║╠═╝║║  ╠╩╗
   ╩ ╚═╝╩ ╩╩ ╩╩  ╩╚═╝╩ ╩
      P R O J E C T
    `);
    console.log("\x1b[32m%s\x1b[0m", `  STATUS: READY | MODE: V20 (BACKEND RELAY ACTIVE)`);
    console.log("\x1b[37m%s\x1b[0m", "  --------------------------------------------------\n");
}

function saveToDatabase(nama, plu, barcode) {
    if (!plu) return; 

    let db = [];
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            db = JSON.parse(data);
        } catch (e) {
            console.log("Error membaca database, membuat file baru...");
            db = [];
        }
    }

    const isDuplicate = db.some(item => item.plu === plu);
    
    if (!isDuplicate) {
        db.push({ nama: nama, plu: plu, barcode: barcode || "GAGAL_BACA" });
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        console.log(`\x1b[32m[DB]\x1b[0m Tersimpan Baru: ${nama} (PLU: ${plu})`);
    } else {
        console.log(`\x1b[33m[DB]\x1b[0m Skip Double: PLU ${plu} sudah ada di database.`);
    }
}

async function startProgressBar(jid, customText = "Memproses data...") {
    let { key } = await wa.sendMessage(jid, { text: `[▒▒▒▒▒▒▒▒▒▒] 0% - ${customText}` });
    let progress = 0;
    const interval = setInterval(async () => {
        progress += 10;
        if (progress > 90) progress = 90;
        let bar = "█".repeat(progress / 10) + "▒".repeat(10 - (progress / 10));
        try {
            await wa.sendMessage(jid, { text: `[${bar}] ${progress}% - ${customText}`, edit: key });
        } catch (e) { clearInterval(interval); }
    }, 2000);
    return { interval, key };
}

function extractProductInfo(rawText) {
    const nameMatch = rawText.match(/🛒\s*(.*)/);
    const pluMatch = rawText.match(/PLU:\s*(\d+)/);
    return {
        nama: nameMatch ? nameMatch[1].trim() : "Produk Tidak Dikenal",
        plu: pluMatch ? pluMatch[1].trim() : null
    };
}

async function downloadCDNImage(plu) {
    const url = `https://cdn-klik.klikindomaret.com/klik-catalog/product/${plu}_1.jpg`;
    const path = `./temp_cdn_${plu}.jpg`;
    try {
        const response = await axios({ 
            url, 
            method: 'GET', 
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.klikindomaret.com/',
                'Origin': 'https://www.klikindomaret.com'
            },
            timeout: 5000
        });
        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(path);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        return path;
    } catch (e) { return null; }
}

async function extractBarcodeNumber(imagePath) {
    try {
        const { data: { text } } = await Tesseract.recognize(imagePath, 'eng');
        const numbersOnly = text.replace(/\s+/g, '').match(/\d+/g);
        if (numbersOnly && numbersOnly.length > 0) {
            const longestNumber = numbersOnly.reduce((a, b) => a.length > b.length ? a : b);
            if (longestNumber.length >= 8) return longestNumber;
        }
        return null;
    } catch (error) { return null; }
}

async function generateNewBarcode(number) {
    const outputPath = `./new_barcode_${Date.now()}.png`;
    try {
        const buffer = await bwipjs.toBuffer({
            bcid: 'code128',       
            text: number,          
            scale: 3,              
            height: 15,            
            includetext: true,     
            textxalign: 'center',  
            backgroundcolor: 'FFFFFF', 
            padding: 10                
        });
        fs.writeFileSync(outputPath, buffer);
        return outputPath;
    } catch (err) { return null; }
}

// ✨ MENU BAWX PROJECT (TANPA EMOJI)
async function sendFakeMenu(jid, sender) {
    const hr = new Date().getHours();
    let sapaan = "Malam";
    if (hr < 10) sapaan = "Pagi";
    else if (hr < 15) sapaan = "Siang";
    else if (hr < 18) sapaan = "Sore";
    
    // Ambil nomor WA saja untuk di-tag
    const userId = sender.split('@')[0];
    const waktu = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }).replace(/:/g, '.');

    const menuText = `
┏━━◪ *BAWX PROJECT*
┃
┣ Halo, @${userId}
┣ Selamat ${sapaan}
┣ ${waktu} WIB
┃
┣ /plu - Detail produk
┣ /stok (plu) (toko) - Cek Stok
┣ /fair - Fair / Klik
┣ /caritoko - Cari detail toko
┣ /scan - Scan Member Poinku
┃
┣ [ ADMIN MODE ]
┣ /export - Download Database JSON
┃
┗━━◪ _Power by BAWX PROJECT_`.trim();

    const fakeQuote = {
        key: { fromMe: false, participant: "0@s.whatsapp.net", remoteJid: "0@s.whatsapp.net" },
        message: { contactMessage: { displayName: "WhatsApp", vcard: "BEGIN:VCARD\nVERSION:3.0\nN:;WhatsApp;;;\nFN:WhatsApp\nORG:WhatsApp\nEND:VCARD" } }
    };

    await wa.sendMessage(jid, { 
        image: { url: MENU_IMAGE }, 
        caption: menuText,
        mentions: [sender] // Tag warna hijau
    }, { quoted: fakeQuote });
}

async function initTG() {
    const session = new StringSession(fs.existsSync('tg_session.txt') ? fs.readFileSync('tg_session.txt', 'utf8') : "");
    tg = new TelegramClient(session, parseInt(TG_API_ID), TG_API_HASH, { connectionRetries: 5 });

    await tg.start({
        phoneNumber: async () => await input.text("📱 Masukkan Nomor Telegram (+62...): "),
        password: async () => await input.text("🔑 Masukkan Password 2FA (jika ada): "),
        phoneCode: async () => await input.text("📩 Masukkan Kode OTP Telegram: "),
        onError: (err) => console.log(err),
    });
    
    fs.writeFileSync('tg_session.txt', tg.session.save());
    
    tgEntityIDM = await tg.getEntity(TARGET_TG_BOT);
    try { tgEntityPoinku = await tg.getEntity(TARGET_POINKU_BOT); } catch (e) { console.log("ERROR: Bot IPOINKUBOT belum dikenali."); }

    tg.addEventHandler(async (ev) => {
        const msg = ev.message;
        const senderId = msg.peerId?.userId?.value;
        const isFromIDM = tgEntityIDM && senderId === tgEntityIDM.id.value;
        const isFromPoinku = tgEntityPoinku && senderId === tgEntityPoinku.id.value;

        if (!isFromIDM && !isFromPoinku) return; 

        let waJid;
        for (let [jid] of userSessions) { waJid = jid; break; }
        if (!waJid) return;

        const sessionData = userSessions.get(waJid);
        const text = msg.message || "";

        const spamTexts = ["Sedang mencari detail toko", "Mencari produk dengan PLU", "Total PLU:", "Selesai diproses total:", "SEDANG DI PROSES", "SILAKAN DI TUNGGU"];
        if (spamTexts.some(spam => text.toUpperCase().includes(spam.toUpperCase()))) return; 

        if (isFromPoinku) {
            if (sessionData && sessionData.pbar) {
                clearInterval(sessionData.pbar.interval);
                await wa.sendMessage(waJid, { text: "Proses Selesai.", edit: sessionData.pbar.key });
                sessionData.pbar = null;
            }
            if (msg.media) {
                const tgImagePath = await tg.downloadMedia(msg, { outputFile: `./temp_poinku_${Date.now()}.jpg` });
                await wa.sendMessage(waJid, { image: { url: tgImagePath }, caption: "QR Code Member Poinku" });
                if (fs.existsSync(tgImagePath)) fs.unlinkSync(tgImagePath);
                userSessions.delete(waJid); 
            } else if (text) {
                await wa.sendMessage(waJid, { text: text });
                userSessions.delete(waJid);
            }
            return; 
        }

        if (text.includes("Masukkan PLU") || text.includes("Kirimkan daftar PLU")) {
            if (sessionData) {
                sessionData.waitingForInput = true;
                if (sessionData.pbar) {
                    clearInterval(sessionData.pbar.interval);
                    await wa.sendMessage(waJid, { text: "Silahkan Masukkan PLU", edit: sessionData.pbar.key });
                    sessionData.pbar = null;
                } else { await wa.sendMessage(waJid, { text: "Silahkan Masukkan PLU" }); }
            }
            return; 
        }

        if (text.includes("Ketik kode toko") || text.includes("Ketik nama toko")) {
            if (sessionData) {
                sessionData.waitingForInput = true;
                if (sessionData.pbar) {
                    clearInterval(sessionData.pbar.interval);
                    await wa.sendMessage(waJid, { text: "Silahkan Masukkan Kode Toko", edit: sessionData.pbar.key });
                    sessionData.pbar = null;
                } else { await wa.sendMessage(waJid, { text: "Silahkan Masukkan Kode Toko" }); }
            }
            return; 
        }

        const otherPrompts = ["Masukkan Kode", "Pilih Tombol", "Masukkan Nomor"];
        if (otherPrompts.some(prompt => text.includes(prompt))) {
            if (sessionData) sessionData.waitingForInput = true; 
        }

        if (msg.media && text.includes("PLU:")) {
            const info = extractProductInfo(text);
            const tgImagePath = await tg.downloadMedia(msg, { outputFile: `./temp_tg_${Date.now()}.jpg` });
            
            let newBarcodePath = null;
            let extractedNumber = null;
            if (fs.existsSync(tgImagePath)) {
                extractedNumber = await extractBarcodeNumber(tgImagePath);
                if (extractedNumber) newBarcodePath = await generateNewBarcode(extractedNumber);
            }

            saveToDatabase(info.nama, info.plu, extractedNumber);

            let productImagePath = info.plu ? await downloadCDNImage(info.plu) : null;

            if (sessionData && sessionData.pbar) {
                clearInterval(sessionData.pbar.interval);
                await wa.sendMessage(waJid, { text: "Selesai. Mengirim data...", edit: sessionData.pbar.key });
                sessionData.pbar = null;
            }

            let finalImagePath = (productImagePath && fs.existsSync(productImagePath)) ? productImagePath : tgImagePath;

            if (finalImagePath && fs.existsSync(finalImagePath)) {
                await wa.sendMessage(waJid, { image: { url: finalImagePath }, caption: `${info.nama}\nPLU: ${info.plu}` });
            } else {
                await wa.sendMessage(waJid, { text: `${info.nama}\nPLU: ${info.plu}\n(Gambar produk tidak tersedia)` });
            }

            if (newBarcodePath && fs.existsSync(newBarcodePath)) {
                await wa.sendMessage(waJid, { image: { url: newBarcodePath }, caption: `BARCODE: ${extractedNumber}` });
            } else {
                await wa.sendMessage(waJid, { text: `⚠️ Barcode gagal dimuat` });
            }

            if (fs.existsSync(tgImagePath)) fs.unlinkSync(tgImagePath);
            if (productImagePath && fs.existsSync(productImagePath)) fs.unlinkSync(productImagePath);
            if (newBarcodePath && fs.existsSync(newBarcodePath)) fs.unlinkSync(newBarcodePath);
        } 
        else if (text) {
             let cleanText = text.replace(/© t\.me\/idm_help_bot/gi, '').replace(/🔗 Lihat Harga/gi, '').replace(/t\.me\/\S+/gi, '').replace(/\n\s*\n/g, '\n').trim();
             if (cleanText && !cleanText.includes("Selamat Datang di IDM Help Bot") && !cleanText.includes("FITUR UTAMA")) {
                 if (sessionData && sessionData.pbar) {
                     clearInterval(sessionData.pbar.interval);
                     await wa.sendMessage(waJid, { text: "Selesai.", edit: sessionData.pbar.key });
                     sessionData.pbar = null;
                 }
                 await wa.sendMessage(waJid, { text: cleanText });
             }
        }
    }, new NewMessage({ incoming: true }));
}

async function initWA() {
    const { state, saveCreds } = await useMultiFileAuthState('sesi_wa_lenwy');
    const { version } = await fetchLatestBaileysVersion();

    wa = makeWASocket({ 
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        version,
        syncFullHistory: true
    });

    if (!wa.authState.creds.registered) {
        console.log("\n⚠️ WA Belum Terhubung! Menggunakan Pairing Code.");
        try {
            const phoneNumber = await input.text("📞 Masukkan Nomor WA Bot (contoh: 628xxxx): ");
            const code = await wa.requestPairingCode(phoneNumber.trim());
            console.log(`\n🎁 KODE PAIRING ANDA: \x1b[32m${code}\x1b[0m\n`);
        } catch (e) {
            console.log("Gagal meminta pairing code:", e.message);
        }
    }

    wa.ev.on('creds.update', saveCreds);
    
    wa.ev.on('connection.update', (up) => {
        if (up.connection === 'open') printBanner();
        if (up.connection === 'close') initWA();
    });

    wa.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        
        const sender = m.key.remoteJid; 
        const realSender = m.key.participant || sender; 
        
        if (sender === TARGET_CEK_STOK_GROUP) {
            const contextInfo = m.message?.extendedTextMessage?.contextInfo;
            if (contextInfo && contextInfo.stanzaId) {
                const repliedMsgId = contextInfo.stanzaId;
                if (pendingRequests.has(repliedMsgId)) {
                    const reqData = pendingRequests.get(repliedMsgId);
                    const replyText = m.message.conversation || m.message.extendedTextMessage?.text || "";
                    if (replyText) {
                        await wa.sendMessage(reqData.originalSender, { text: `📩 *Balasan Server:*\n${replyText}` });
                    }
                }
            }
            return; 
        }

        const isGroupAllowed = TARGET_GROUP_IDS.includes(sender);
        const isAdmin = ADMIN_IDS.includes(sender) || ADMIN_IDS.includes(realSender);

        if (!isGroupAllowed && !isAdmin) return; 

        const body = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
        if (!body) return;
        const cmd = body.toLowerCase();

        // 🚀 FUNGSI MENU
        if (cmd === '/menu') {
            await sendFakeMenu(sender, sender);
            return; 
        }

        if (cmd === '/export') {
            if (!isAdmin) {
                await wa.sendMessage(sender, { text: '⛔ Maaf, hanya Admin yang memiliki izin untuk mengekspor database.' }, { quoted: m });
                return;
            }
            if (fs.existsSync(DB_FILE)) {
                await wa.sendMessage(sender, { document: { url: DB_FILE }, mimetype: 'application/json', fileName: 'database_produk.json', caption: '📁 [ADMIN AKSES] File database produk.' });
            } else { await wa.sendMessage(sender, { text: '⚠️ Database masih kosong.' }); }
            return;
        }

        if (cmd.startsWith('/stok')) {
            const args = body.split(' ').filter(arg => arg !== ''); 
            if (args.length < 3) {
                await wa.sendMessage(sender, { text: "⚠️ Format salah!\nGunakan: `/stok (plu) (kodetoko)`\nContoh: `/stok 12345678 tnxi`" });
                return;
            }
            const plu = args[1];
            const kodetoko = args[2];

            const sentMsg = await wa.sendMessage(TARGET_CEK_STOK_GROUP, { text: `.plu ${plu} ${kodetoko}` });
            const msgId = sentMsg.key.id;
            const timer = setTimeout(() => { pendingRequests.delete(msgId); }, 3 * 60 * 1000); 

            pendingRequests.set(msgId, { originalSender: sender, timer: timer });
            await wa.sendMessage(sender, { text: `⏳ *Memeriksa stok...*\nPLU: ${plu}\nToko: ${kodetoko}\n\n_(Menunggu balasan server, max 3 menit)_` });
            return;
        }

        if (cmd === '/fair') {
            const sentMsg = await wa.sendMessage(TARGET_CEK_STOK_GROUP, { text: `.klik` });
            const msgId = sentMsg.key.id;
            const timer = setTimeout(() => { pendingRequests.delete(msgId); }, 3 * 60 * 1000); 

            pendingRequests.set(msgId, { originalSender: sender, timer: timer });
            await wa.sendMessage(sender, { text: `⏳ *Memproses perintah /fair...*\n_(Menunggu balasan server, max 3 menit)_` });
            return;
        }

        if (cmd === '/scan') {
            userSessions.clear(); 
            const pbar = await startProgressBar(sender, "Mengambil QR Code Poinku...");
            userSessions.set(sender, { pbar: pbar, waitingForInput: false });
            await tg.sendMessage(TARGET_POINKU_BOT, { message: body });
        } 
        else if (body.startsWith('/')) {
            userSessions.clear(); 
            const pbar = await startProgressBar(sender, "Memproses data...");
            userSessions.set(sender, { pbar: pbar, waitingForInput: false });
            await tg.sendMessage(TARGET_TG_BOT, { message: body });
        } 
        else if (userSessions.has(sender) && userSessions.get(sender).waitingForInput === true) {
            const pbar = await startProgressBar(sender, "Mencari data...");
            userSessions.get(sender).pbar = pbar;
            userSessions.get(sender).waitingForInput = false; 
            await tg.sendMessage(TARGET_TG_BOT, { message: body });
        }
    });
}

process.on('uncaughtException', function (err) { console.log('Abaikan Error Jaringan: ' + err.message); });
process.on('unhandledRejection', (reason, p) => { console.log('Abaikan Error Request: ' + reason); });

(async () => {
    try { await initTG(); await initWA(); } catch (e) { console.log("Fatal Error:", e.message); }
})();
