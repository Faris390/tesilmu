const { default: WAConnection, useMultiFileAuthState, Browsers, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const chalk = require('chalk'); 
const NodeCache = require('node-cache');
const { parsePhoneNumber } = require('awesome-phonenumber'); 
const qrcode = require('qrcode-terminal'); 

// --- KONFIGURASI BOT ---
const SESSION_FOLDER = 'auth_info_baileys'; 
const msgRetryCounterCache = new NodeCache();
const pairingCode = false; // Mode QR Code

// --- GLOBAL STATE & SETUP CONSOLE INPUT ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

let lastReceivedMessage = null; // Menyimpan ID/JID pesan terakhir untuk Balasan Manual

console.log(chalk.green.bold('╔═════[ risshyt.py bot ]═════'));
console.log(chalk.yellow(`> Session Folder: ${SESSION_FOLDER}`));
console.log(chalk.yellow(`> Pairing Mode: QR Code`));
console.log(chalk.green.bold('╚' + ('═'.repeat(30))));


// =======================================================
// FUNGSI: Membaca input dari Termux dan mengirim pesan
// =======================================================
function readConsoleInput(sock) {
    console.log(chalk.bgCyan.black('\n>>> MODE KONSOLE AKTIF <<<'));
    console.log('1. BALAS: Cukup ketik [Pesan Balasan Anda] lalu ENTER.');
    console.log('2. KIRIM BARU: [Nomor Tujuan], [Isi Pesan] (Contoh: 62812xxx, Halo)'); 
    console.log('Ketik "exit" untuk keluar.');
    console.log(chalk.cyan('-------------------------------------'));
    
    rl.setPrompt(chalk.green('Kirim/Balas > '));
    rl.prompt();

    rl.on('line', async (input) => {
        const trimmedInput = input.trim();
        if (trimmedInput.toLowerCase() === 'exit') {
            console.log(chalk.red('Keluar dari mode input.'));
            rl.setPrompt(chalk.gray('Listening... '));
            rl.prompt();
            return;
        }

        // --- LOGIKA REPLY MANUAL ---
        if (!trimmedInput.includes(',') && lastReceivedMessage) { 
            
            const { chatID, messageObject } = lastReceivedMessage;

            try {
                await sock.sendMessage(chatID, { text: trimmedInput }, { quoted: messageObject });
                console.log(chalk.green(`\n✅ Balasan terkirim ke ${chatID.split('@')[0]} (Reply)`));
            } catch (error) {
                console.error(chalk.red(`\n❌ Gagal membalas pesan:`), error.message);
            }

            lastReceivedMessage = null; 
            
        // --- LOGIKA KIRIM BARU (MENGGUNAKAN KOMA SEBAGAI PEMISAH) ---
        } else if (trimmedInput.includes(',')) {
            
            const parts = trimmedInput.split(',').map(p => p.trim());
            let [recipient, messageBody] = parts;
            
            if (parts.length < 2 || messageBody === '') {
                 console.log(chalk.red('Format KIRIM BARU salah. Gunakan: [Nomor Tujuan], [Isi Pesan]'));
                 rl.prompt();
                 return;
            }

            // --- LOGIKA VALIDASI DAN FORMAT NOMOR (Anti Error pn.isPossible) ---
            if (!recipient.includes('@s.whatsapp.net') && !recipient.includes('@g.us')) {
                let cleanedNumber = recipient.replace(/[^0-9]/g, '');
                
                if (cleanedNumber.startsWith('0')) {
                    cleanedNumber = '62' + cleanedNumber.substring(1); 
                } 
                else if (!cleanedNumber.startsWith('62')) {
                    cleanedNumber = '62' + cleanedNumber; 
                }

                if (cleanedNumber.length < 10) {
                    console.log(chalk.red('\n❌ Nomor terlalu pendek atau format salah.'));
                    rl.prompt();
                    return;
                }
                
                recipient = cleanedNumber + '@s.whatsapp.net';
                
                console.log(chalk.cyan(`> Mengirim ke Nomor Terformat: ${cleanedNumber}`));
            }
            // --- AKHIR LOGIKA PERBAIKAN NOMOR ---
            
            try {
                await sock.sendMessage(recipient, { text: messageBody });
                console.log(chalk.green(`\n✅ Pesan terkirim ke ${recipient.split('@')[0]}`));
            } catch (error) {
                console.error(chalk.red(`\n❌ Gagal mengirim pesan ke ${recipient}:`), error.message);
            }

        } else {
             console.log(chalk.yellow('Tidak ada pesan untuk dibalas (lastReceivedMessage null). Coba format KIRIM BARU.'));
        }
        
        rl.prompt(); 
    }).on('close', () => {
        process.exit(0);
    });
}


// =======================================================
// FUNGSI UTAMA KONEKSI BAOILEYS
// =======================================================
async function startBot() {
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    // 1. Konfigurasi Koneksi Socket
    const sock = WAConnection({
        version,
        logger: pino({ level: 'silent' }), 
        // printQRInTerminal dihilangkan
        browser: Browsers.ubuntu('Firefox'), 
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
    });
    
    // 2. LOGIKA QR CODE MANUAL
    if (!sock.authState.creds.registered) {
        console.log(chalk.greenBright('\n=========================================='));
        console.log(chalk.yellow.bold('   SCAN QR CODE YANG MUNCUL DI BAWAH INI'));
        console.log(chalk.white('   Buka WhatsApp HP > Perangkat Tertaut > Tautkan perangkat'));
        console.log(chalk.greenBright('==========================================\n'));
    }
    
    // 3. EVENT HANDLERS
    sock.ev.on('creds.update', saveCreds);

    // Menyimpan pesan masuk dan LOGGING JID/NOMOR
    sock.ev.on('messages.upsert', async (m) => {
        if (m.messages.length > 0 && m.type === 'notify' && !m.messages[0].key.fromMe) {
            const incomingMsg = m.messages[0];
            
            lastReceivedMessage = {
                chatID: incomingMsg.key.remoteJid,
                messageObject: incomingMsg
            };
            
            const textContent = incomingMsg.message?.conversation || incomingMsg.message?.extendedTextMessage?.text || 'Media Message';
            
            // 🚨 LOGIKA PEMBERSAH JID AGAR MENJADI 62xxxxxxxx (Menghilangkan JID Acak/Panjang)
            const senderJid = incomingMsg.key.remoteJid;
            let displayId;

            if (senderJid.endsWith('@g.us')) {
                // Jika itu JID Grup, tampilkan ID-nya yang dipotong dan label "GRUP"
                displayId = `[GRUP] ID: ${senderJid.split('@')[0].substring(0, 8)}...`;
            } else if (senderJid.endsWith('@s.whatsapp.net')) {
                // Jika JID Personal (Kontak)
                
                let rawNumber = senderJid.split('@')[0];
                
                // Jika terlalu panjang, ambil 10 digit terakhir dan tambahkan 62 (asumsi nomor Indo)
                if (rawNumber.length > 12) {
                    let cleanedNumber = rawNumber.substring(rawNumber.length - 10);
                    displayId = '62' + cleanedNumber;
                } else {
                    displayId = rawNumber;
                }
            } else {
                displayId = senderJid;
            }
                                
            console.log(chalk.blue(`\n<<< Pesan Masuk dari ${displayId}: "${textContent.substring(0, 50)}..."`));
            
            rl.prompt(true); 
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update; 

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log(chalk.yellow('QR Code muncul di atas. Segera scan!'));
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) { 
                console.log(chalk.red(`\n❌ Koneksi ditutup. Mencoba Reconnect...`));
                startBot(); 
            } else {
                 console.log(chalk.yellow('⚠️ Logout permanen. Hapus folder sesi jika ingin login ulang.'));
                 rl.close();
            }
        } else if (connection === 'open') {
            console.log(chalk.greenBright(`\n✅ BOT ${sock.user.id.split(':')[0]} Berhasil Terhubung!`));
            readConsoleInput(sock); 
        }
    });
}

// Panggil fungsi utama untuk memulai bot
startBot();
                    
