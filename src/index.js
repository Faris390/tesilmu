const { default: WAConnection, useMultiFileAuthState, Browsers, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const chalk = require('chalk'); 
const NodeCache = require('node-cache');
const { parsePhoneNumber } = require('awesome-phonenumber'); 
// Tambahkan library qrcode-terminal untuk menampilkan QR Code
const qrcode = require('qrcode-terminal'); 

// --- KONFIGURASI BOT ---
const SESSION_FOLDER = 'auth_info_baileys'; 
const msgRetryCounterCache = new NodeCache();

// 🚨 MODE QR CODE DIPILIH: UBAH KE false
const pairingCode = false; 

// --- GLOBAL STATE & SETUP CONSOLE INPUT ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

let lastReceivedMessage = null; // Menyimpan ID/JID pesan terakhir untuk Balasan Manual

console.log(chalk.green.bold('╔═════[ BOT WA INITIATOR ]═════'));
console.log(chalk.yellow(`> Session Folder: ${SESSION_FOLDER}`));
console.log(chalk.yellow(`> Pairing Mode: QR Code Manual Listener`));
console.log(chalk.green.bold('╚' + ('═'.repeat(30))));

// ... (Fungsi readConsoleInput tetap sama)
function readConsoleInput(sock) {
    console.log(chalk.bgCyan.black('\n>>> MODE KONSOLE AKTIF <<<'));
    console.log('1. BALAS: Cukup ketik [Pesan Balasan Anda] lalu ENTER (Hanya setelah pesan masuk).');
    console.log('2. KIRIM BARU: [JID_atau_Nomor] | [Isi_Pesan]'); 
    console.log('Ketik "exit" untuk keluar dari mode input.');
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
        if (!trimmedInput.includes('|') && lastReceivedMessage) {
            
            const { chatID, messageObject } = lastReceivedMessage;

            try {
                await sock.sendMessage(chatID, { text: trimmedInput }, { quoted: messageObject });
                console.log(chalk.green(`\n✅ Balasan terkirim ke ${chatID.split('@')[0]} (Reply)`));
            } catch (error) {
                console.error(chalk.red(`\n❌ Gagal membalas pesan:`), error.message);
            }

            lastReceivedMessage = null; 
            
        // --- LOGIKA KIRIM BARU ---
        } else if (trimmedInput.includes('|')) {
            const parts = trimmedInput.split('|').map(p => p.trim());
            let [recipient, messageBody] = parts;
            
            if (parts.length < 2) {
                 console.log(chalk.red('Format KIRIM BARU salah. Gunakan: [JID/Nomor] | [Pesan]'));
                 rl.prompt();
                 return;
            }

            if (!recipient.includes('@s.whatsapp.net') && !recipient.includes('@g.us')) {
                try {
                    const pn = parsePhoneNumber(recipient, 'ID');
                    if (pn && pn.isPossible()) {
                        recipient = pn.getNumber('international').replace('+', '') + '@s.whatsapp.net';
                    } else {
                        console.log(chalk.red(`\n❌ Nomor ${recipient} tidak valid.`));
                        rl.prompt();
                        return;
                    }
                } catch (error) {
                     console.log(chalk.red(`\n❌ Error validasi nomor: ${error.message}`));
                     rl.prompt();
                     return;
                }
            }
            
            try {
                await sock.sendMessage(recipient, { text: messageBody });
                console.log(chalk.green(`\n✅ Pesan terkirim ke ${recipient.split('@')[0]}`));
            } catch (error) {
                console.error(chalk.red(`\n❌ Gagal mengirim pesan ke ${recipient}:`), error.message);
            }

        } else {
             console.log(chalk.yellow('Tidak ada pesan untuk dibalas. Coba format KIRIM BARU.'));
        }
        
        rl.prompt(); 
    }).on('close', () => {
        process.exit(0);
    });
}
// ... (Akhir Fungsi readConsoleInput)


// =======================================================
// FUNGSI UTAMA KONEKSI BAOILEYS
// =======================================================
async function startBot() {
    
    // ⚠️ PERINGATAN: TAMBAH LIBRARY qrcode-terminal
    // Sebelum menjalankan kode ini, pastikan Anda sudah instal:
    // npm install qrcode-terminal
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    // 1. Konfigurasi Koneksi Socket
    const sock = WAConnection({
        version,
        logger: pino({ level: 'silent' }), 
        
        // 🚨 HAPUS OPSI printQRInTerminal
        
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

    // Menyimpan pesan masuk untuk manual reply
    sock.ev.on('messages.upsert', async (m) => {
        if (m.messages.length > 0 && m.type === 'notify' && !m.messages[0].key.fromMe) {
            const incomingMsg = m.messages[0];
            
            lastReceivedMessage = {
                chatID: incomingMsg.key.remoteJid,
                messageObject: incomingMsg
            };
            
            const textContent = incomingMsg.message?.conversation || incomingMsg.message?.extendedTextMessage?.text || 'Media Message';
            console.log(chalk.blue(`\n<<< Pesan Masuk dari ${incomingMsg.key.remoteJid.split('@')[0]}: "${textContent.substring(0, 50)}..."`));
            
            rl.prompt(true); 
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update; // 🚨 Ambil data 'qr' dari update

        // 🚨 LOGIKA BARU UNTUK MENAMPILKAN QR CODE SECARA MANUAL
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
