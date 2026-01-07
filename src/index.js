const { default: WAConnection, useMultiFileAuthState, Browsers, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const chalk = require('chalk');
const NodeCache = require('node-cache');
const { parsePhoneNumber } = require('awesome-phonenumber'); 

// --- KONFIGURASI BOT ---
const SESSION_FOLDER = 'auth_info_baileys'; 
// -----------------------

const msgRetryCounterCache = new NodeCache();
const pairingCode = true; 

// --- SETUP CONSOLE INPUT & GLOBAL STATE ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
let pairingStarted = false; 
let lastReceivedMessage = null; // 🚨 VARIABEL UNTUK MENYIMPAN PESAN MASUK TERAKHIR
let phoneNumber = ''; // Nomor HP bot yang diinput saat pairing

console.log(chalk.green.bold('╔═════[ BOT WA INITIATOR ]═════'));
console.log(chalk.yellow(`> Session Folder: ${SESSION_FOLDER}`));
console.log(chalk.yellow(`> Pairing Mode: Pairing Code`));
console.log(chalk.green.bold('╚' + ('═'.repeat(30))));


// =======================================================
// FUNGSI: Membaca input dari Termux dan mengirim pesan
// =======================================================
function readConsoleInput(sock) {
    console.log(chalk.bgCyan.black('\n>>> MODE KONSOLE AKTIF <<<'));
    console.log('1. MANUAL REPLY: Cukup ketik [Pesan Balasan Anda] lalu ENTER.');
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
                // KIRIM BALASAN dengan mengutip pesan terakhir
                await sock.sendMessage(chatID, { text: trimmedInput }, { quoted: messageObject });
                console.log(chalk.green(`\n✅ Balasan terkirim ke ${chatID.split('@')[0]} (Reply ke pesan yang baru masuk)`));
            } catch (error) {
                console.error(chalk.red(`\n❌ Gagal membalas pesan:`), error.message);
            }

            // Hapus pesan terakhir agar tidak terbalas dua kali
            lastReceivedMessage = null; 
            
        // --- LOGIKA KIRIM BARU ---
        } else if (trimmedInput.includes('|')) {
            const parts = trimmedInput.split('|').map(p => p.trim());
            let [recipient, messageBody] = parts;
            
            if (parts.length < 2) {
                 console.log(chalk.red('Format salah. Gunakan: [JID/Nomor] | [Pesan]'));
                 rl.prompt();
                 return;
            }

            // Cek dan format JID/Nomor
            if (!recipient.includes('@s.whatsapp.net') && !recipient.includes('@g.us')) {
                try {
                    const pn = parsePhoneNumber(recipient, 'ID');
                    if (pn.isValid()) {
                        recipient = pn.getNumber('international').replace('+', '') + '@s.whatsapp.net';
                    } else {
                        console.log(chalk.red(`\n❌ Nomor ${recipient} tidak valid.`));
                        rl.prompt();
                        return;
                    }
                } catch (error) {
                     console.log(chalk.red(`\n❌ Gagal memformat nomor: ${error.message}`));
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
             // Jika tidak ada '|' dan tidak ada pesan terakhir (lastReceivedMessage null)
             console.log(chalk.yellow('Tidak ada pesan untuk dibalas. Coba format KIRIM BARU atau tunggu pesan masuk.'));
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
        printQRInTerminal: !pairingCode, 
        browser: Browsers.macOS('Chrome'), 
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
    });
    
    // 2. LOGIKA PAIRING CODE & INPUT NOMOR
    if (pairingCode && !sock.authState.creds.registered) {
        
        pairingStarted = true;
        console.log(chalk.yellowBright('\n⚠️  Harap masukkan nomor telepon bot Anda (contoh: 628123456789)'));
        
        let inputNumber = await question('Nomor Telepon Bot: ');
        
        // Validasi dan format nomor dengan awesome-phonenumber
        try {
            const pn = parsePhoneNumber(inputNumber, 'ID');
            if (pn.isValid()) {
                phoneNumber = pn.getNumber('international').replace('+', ''); 
                console.log(chalk.yellow(`> Nomor terformat: ${phoneNumber}`));
            } else {
                console.error(chalk.red('\n❌ Nomor yang dimasukkan tidak valid. Mohon coba lagi.'));
                rl.close();
                return;
            }
        } catch (error) {
             console.error(chalk.red(`\n❌ Error validasi nomor: ${error.message}`));
             rl.close();
             return;
        }
        
        // Minta Pairing Code dari server WhatsApp
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(chalk.greenBright(`\n==========================================`));
                console.log(chalk.yellow.bold(`   ⚠️ KODE PAIRING (MASUKKAN DI WA HP ANDA): ${code}`));
                console.log(chalk.white('   Buka WhatsApp HP > Perangkat Tertaut > Tautkan dengan nomor telepon saja'));
                console.log(chalk.greenBright(`==========================================\n`));
            } catch (error) {
                console.error(chalk.red('❌ Gagal request pairing code. Pastikan nomor benar.'), error.message);
                pairingStarted = false;
            }
        }, 3000);
    }
    
    // 3. EVENT HANDLERS
    sock.ev.on('creds.update', saveCreds);

    // 🚨 INI KUNCI UTAMA: Menyimpan pesan masuk
    sock.ev.on('messages.upsert', async (m) => {
        if (m.messages.length > 0 && m.type === 'notify' && !m.messages[0].key.fromMe) {
            const incomingMsg = m.messages[0];
            
            // SIMPAN PESAN TERAKHIR yang masuk
            lastReceivedMessage = {
                chatID: incomingMsg.key.remoteJid,
                messageObject: incomingMsg
            };
            
            const textContent = incomingMsg.message?.conversation || incomingMsg.message?.extendedTextMessage?.text || 'Media Message';
            console.log(chalk.blue(`\n<<< Pesan Masuk dari ${incomingMsg.key.remoteJid.split('@')[0]}: "${textContent.substring(0, 50)}..."`));
            
            // Tampilkan ulang prompt agar Anda bisa langsung mengetik balasan
            rl.prompt(true); 
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && !pairingStarted) { 
                console.log(chalk.red(`\n❌ Koneksi ditutup. Mencoba Reconnect...`));
                startBot(); 
            } else if (!shouldReconnect) {
                 console.log(chalk.yellow('⚠️ Logout permanen. Hapus folder sesi jika ingin login ulang.'));
                 rl.close();
            }
        } else if (connection === 'open') {
            console.log(chalk.greenBright(`\n✅ BOT ${sock.user.id.split(':')[0]} Berhasil Terhubung!`));
            pairingStarted = false; 
            readConsoleInput(sock); 
        }
    });
}

// Panggil fungsi utama untuk memulai bot
startBot();
                            
