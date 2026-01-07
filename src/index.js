const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline'); // Modul untuk input console Termux
const { handleMessage } = require('./handler/messageHandler'); 

// Ganti dengan nomor bot kamu (awalan 62)
const BOT_PHONE_NUMBER = "6287884358475"; 

// Siapkan interface readline
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// =======================================================
// FUNGSI: Membaca input dari Termux dan mengirim pesan
// =======================================================
function readConsoleInput(sock) {
    console.log('\n==========================================');
    console.log('Mode Kirim Pesan MANUAL Aktif.');
    console.log('FORMAT: [JID_atau_Nomor] | [Isi_Pesan]');
    console.log('CONTOH: 6281234567890 | Halo, ini pesan dari Termux');
    console.log('Ketik "exit" untuk keluar.');
    console.log('==========================================');
    
    // Set prompt agar selalu siap menerima input
    rl.setPrompt('Kirim > ');
    rl.prompt();

    rl.on('line', async (input) => {
        if (input.toLowerCase() === 'exit') {
            console.log('Keluar dari mode kirim pesan manual. Bot tetap berjalan di background.');
            // rl.close(); // Jangan tutup, agar bot tetap bisa menerima pesan masuk
            return;
        }

        const parts = input.split('|').map(p => p.trim());

        if (parts.length < 2) {
            console.log('Format salah. Gunakan: [JID/Nomor] | [Pesan]');
            rl.prompt();
            return;
        }

        let [recipient, messageBody] = parts;
        
        // Cek dan format JID/Nomor
        if (!recipient.includes('@s.whatsapp.net') && !recipient.includes('@g.us')) {
             // Asumsi input adalah nomor HP (62...)
            recipient = recipient.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }

        try {
            await sock.sendMessage(recipient, { text: messageBody });
            console.log(`\n✅ Pesan terkirim ke ${recipient.split('@')[0]}`);
        } catch (error) {
            console.error(`\n❌ Gagal mengirim pesan ke ${recipient}:`, error.message);
        }
        
        rl.prompt(); // Tampilkan prompt lagi
    });

    // Jika terjadi error pada readline, pastikan kita masih bisa input
    rl.on('error', (err) => {
        console.error('Readline error:', err);
    });
}
// =======================================================

async function connectToWhatsApp() {
    console.log("Memulai koneksi bot...");
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["WhatsAppBot", "Safari", "1.0.0"]
    });

    // Logic Pairing Code (Jika belum login)
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                console.log(`\n==========================================`);
                console.log(`⚠️ KODE PAIRING (MASUKKAN DI WA HP ANDA): ${code}`);
                console.log('Buka WhatsApp HP > Perangkat Tertaut > Tautkan dengan nomor telepon saja');
                console.log(`==========================================\n`);
            } catch (err) {
                console.error("Gagal request pairing code:", err);
            }
        }, 3000);
    }

    // Update Sesi
    sock.ev.on('creds.update', saveCreds);

    // Handle Pesan Masuk (Auto-Reply)
    sock.ev.on('messages.upsert', async m => {
        if (m.messages.length > 0 && m.type === 'notify') {
            await handleMessage(sock, m.messages[0]);
            rl.prompt(true); // Tampilkan prompt ulang setelah pesan masuk diproses
        }
    });

    // Handle Koneksi
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Koneksi terputus. Mencoba reconnect...');
                connectToWhatsApp();
            } else {
                console.log('Logout permanen. Harap hapus folder auth_info_baileys jika ingin login ulang.');
                rl.close();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Berhasil Terhubung ke WhatsApp!');
            // Panggil fungsi input console setelah koneksi terbuka
            readConsoleInput(sock); 
        }
    });
}

connectToWhatsApp();
